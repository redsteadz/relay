import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  smartOverviewSchema,
  smartResourcesSchema,
  smartRuleSchema,
  type SmartCommand,
  type SmartRule,
  type GoogleService,
} from "@relay/contracts";
import { router } from "expo-router";
import { randomUUID } from "expo-crypto";
import { useState } from "react";
import { Linking, View } from "react-native";

import { ReceiptScreen } from "@/components/ReceiptScreen";
import {
  ActionRow,
  AppButton,
  AppDialog,
  AppSwitch,
  AppText,
  AppTextInput,
  ConfirmationDialog,
  ContextualNotice,
  EditorialSurface,
  LoadingState,
  SectionHeading,
  StatusMessage,
  StatusPill,
} from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { demoModeEnabled } from "@/lib/demo/mode";
import { requestRelayApi } from "@/lib/relay-api";
import { reportUnexpectedUiError } from "@/lib/observability";
import { useRelayTheme } from "@/theme";
import { useFilterRules } from "@/features/filters/hooks/useFilterRules";

const serviceNames: Record<GoogleService, string> = {
  gmail: "Gmail",
  "google-sheets": "Google Sheets",
  "google-calendar": "Google Calendar",
  "google-tasks": "Google Tasks",
};
const scenarios = [
  ["transaction", "Record a transaction"],
  ["meeting", "Propose a meeting"],
  ["task", "Task from Gmail"],
  ["approval", "Request approval"],
  ["permission", "Permission failure"],
  ["duplicate", "Duplicate transaction"],
  ["disconnected", "Disconnected service"],
] as const;

export function SmartAutomationsScreen() {
  const { session, client } = useAuth();
  const theme = useRelayTheme();
  const queryClient = useQueryClient();
  const key = ["smart-automations", session?.user.id];
  const [editing, setEditing] = useState<SmartRule>();
  const [disconnecting, setDisconnecting] = useState<GoogleService>();
  const [error, setError] = useState<string>();
  const [selecting, setSelecting] = useState<GoogleService>();
  const [resources, setResources] = useState<{ id: string; label: string }[]>([]);
  const token = session?.access_token ?? "";
  const filters = useFilterRules(client, session?.user.id, session?.access_token);
  const overview = useQuery({
    enabled: session !== null,
    queryKey: key,
    queryFn: async () =>
      smartOverviewSchema.parse(await requestRelayApi(token, "/api/smart-automations")),
  });
  const change = useMutation({
    mutationFn: async (command: SmartCommand) =>
      smartOverviewSchema.parse(
        await requestRelayApi(token, "/api/smart-automations", { method: "POST", body: command }),
      ),
    onSuccess: async (state) => {
      queryClient.setQueryData(key, state);
      setEditing(undefined);
      setError(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["activity-ledger", session?.user.id] }),
        queryClient.invalidateQueries({ queryKey: ["inbox", session?.user.id] }),
      ]);
    },
    onError: (failure: unknown) => {
      reportUnexpectedUiError(failure, "ui.smart_automation_failed", {
        code: "SMART_AUTOMATION_UI_FAILED",
        integration: "relay-api",
        operation: "configureSmartAutomation",
      });
      setError("Could not apply that change. Review the connection and try again.");
    },
  });
  const demo = useMutation({
    mutationFn: async (body: { scenario?: string; connect?: string }) =>
      smartOverviewSchema.parse(
        await requestRelayApi(token, "/api/smart-automations/demo", { method: "POST", body }),
      ),
    onSuccess: async (state) => {
      queryClient.setQueryData(key, state);
      setError(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["activity-ledger", session?.user.id] }),
        queryClient.invalidateQueries({ queryKey: ["inbox", session?.user.id] }),
      ]);
    },
    onError: () => setError("Could not run that synthetic scenario."),
  });
  const connection = useMutation({
    mutationFn: async (service: GoogleService) => {
      const result = await requestRelayApi(token, "/api/smart-automations/connect", {
        method: "POST",
        body: { service },
      });
      if (
        typeof result !== "object" ||
        result === null ||
        !("url" in result) ||
        typeof result.url !== "string"
      )
        throw new Error("Connection unavailable");
      await Linking.openURL(result.url);
    },
    onError: () => setError("Could not start Google authorization. No permissions changed."),
  });
  const destinations = useMutation({
    mutationFn: async (service: GoogleService) =>
      smartResourcesSchema.parse(
        await requestRelayApi(token, `/api/smart-automations/resources?service=${service}`),
      ),
    onSuccess: (value) => setResources(value.resources),
    onError: () =>
      setError("Could not load available destinations. Reconnect the service and try again."),
  });
  const state = overview.data;
  const busy = change.isPending || demo.isPending || connection.isPending;
  return (
    <ReceiptScreen title="Smart Automations" onBack={() => router.back()}>
      <AppText tone="muted">Your signals, your rules, your Google workspace.</AppText>
      <ContextualNotice accessibilityLabel="Automation authorization">
        Each service is authorized separately. A connection never grants permission to execute a
        rule. Review its destination and choose approval before enabling it.
      </ContextualNotice>
      {demoModeEnabled() ? (
        <StatusMessage tone="info">
          Synthetic preview. No Google account is connected and no external writes occur.
        </StatusMessage>
      ) : null}
      {error === undefined ? null : <StatusMessage tone="error">{error}</StatusMessage>}
      {overview.isLoading ? <LoadingState label="Reading automations" /> : null}
      {overview.error !== null ? (
        <>
          <StatusMessage tone="error">
            Smart Automations is unavailable in this environment.
          </StatusMessage>
          <AppButton label="Retry" onPress={() => void overview.refetch()} tone="secondary" />
        </>
      ) : null}
      {state === undefined ? null : (
        <>
          <EditorialSurface
            title="Execution control"
            icon="pause-circle-outline"
            meta={state.paused ? "Paused" : "Ready"}
          >
            <AppSwitch
              label="Pause all automations"
              detail="Stops new dispatch. An operation already accepted by Google may finish."
              value={state.paused}
              disabled={busy}
              onValueChange={(paused) => change.mutate({ type: "pause", paused })}
            />
          </EditorialSurface>
          <SectionHeading label="Google services" />
          {state.services.map((service) => (
            <EditorialSurface
              key={service.service}
              title={serviceNames[service.service]}
              meta={service.targetLabel || "Choose a destination"}
              titleAccessory={
                <StatusPill
                  label={
                    !service.connected
                      ? "Disconnected"
                      : service.permissionRequired
                        ? "Permission needed"
                        : service.enabled
                          ? "Connected"
                          : "Paused"
                  }
                  tone={
                    service.permissionRequired ? "warning" : service.connected ? "success" : "muted"
                  }
                />
              }
            >
              <ActionRow>
                <AppButton
                  disabled={busy}
                  label={
                    service.permissionRequired
                      ? "Reconnect"
                      : service.connected
                        ? "Refresh"
                        : "Connect"
                  }
                  tone="secondary"
                  onPress={() =>
                    service.connected && !service.permissionRequired
                      ? void overview.refetch()
                      : demoModeEnabled()
                        ? demo.mutate({ connect: service.service })
                        : connection.mutate(service.service)
                  }
                />
                {service.connected ? (
                  <AppButton
                    disabled={busy}
                    label="Disconnect"
                    tone="secondary"
                    onPress={() => setDisconnecting(service.service)}
                  />
                ) : null}
                {service.connected && service.service !== "gmail" ? (
                  <AppButton
                    label="Choose destination"
                    tone="secondary"
                    onPress={() => {
                      setSelecting(service.service);
                      setResources([]);
                      destinations.mutate(service.service);
                    }}
                  />
                ) : null}
              </ActionRow>
              {service.connected && service.service !== "gmail" ? (
                <AppSwitch
                  label={`Enable ${serviceNames[service.service]}`}
                  value={service.enabled}
                  disabled={busy || service.permissionRequired}
                  onValueChange={(enabled) =>
                    change.mutate({ type: "service", service: service.service, enabled })
                  }
                />
              ) : null}
            </EditorialSurface>
          ))}
          <SectionHeading label="Your automations" />
          <ActionRow>
            {(["google-sheets", "google-calendar", "google-tasks"] as const).map((service) => {
              const destination = state.services.find((item) => item.service === service);
              return (
                <AppButton
                  key={service}
                  label={`Add ${serviceNames[service]} rule`}
                  tone="secondary"
                  disabled={destination?.connected !== true || !destination.targetId}
                  onPress={() =>
                    setEditing({
                      id: randomUUID(),
                      filterRuleId: filters.rules[0]?.id,
                      name:
                        service === "google-sheets"
                          ? "Record transactions"
                          : service === "google-calendar"
                            ? "Propose meetings"
                            : "Create tasks",
                      service,
                      enabled: false,
                      sources: ["gmail", "sms"],
                      senders: [],
                      exclusions: [],
                      minimumConfidence: service === "google-tasks" ? 0.85 : 0.95,
                      approval: "required",
                      targetId: destination?.targetId ?? "",
                      targetLabel: destination?.targetLabel ?? "",
                      revision: 1,
                    })
                  }
                />
              );
            })}
          </ActionRow>
          {state.rules.length === 0 ? (
            <AppText tone="muted">
              Create a filter in Rules, then configure its Google action.
            </AppText>
          ) : null}
          {state.rules.map((rule) => (
            <EditorialSurface
              key={rule.id}
              title={rule.name}
              icon="tune-variant"
              meta={`${serviceNames[rule.service]} · v${String(rule.revision)}`}
            >
              <AppText
                variant="caption"
                tone="muted"
              >{`${rule.targetLabel} · ${rule.approval === "automatic" ? "Authorized automatic execution" : "Approval required"} · ${String(Math.round(rule.minimumConfidence * 100))}% minimum confidence`}</AppText>
              <AppText
                variant="caption"
                tone="muted"
              >{`Inputs: ${rule.sources.join(", ")} · ${rule.senders.length === 0 ? "All senders in permitted sources" : rule.senders.join(", ")}`}</AppText>
              <ActionRow>
                <AppSwitch
                  disabled={busy}
                  label="Enabled"
                  value={rule.enabled}
                  onValueChange={(enabled) =>
                    change.mutate({ type: "save-rule", rule: { ...rule, enabled } })
                  }
                />
                <AppButton
                  label="Configure and preview"
                  tone="secondary"
                  onPress={() => setEditing(rule)}
                />
              </ActionRow>
            </EditorialSurface>
          ))}
          {demoModeEnabled() ? (
            <>
              <SectionHeading label="Try a scenario" />
              <AppText tone="muted" variant="caption">
                The same policy evaluator checks these synthetic captures. Reconnect a service after
                trying a failure.
              </AppText>
              <ActionRow>
                {scenarios.map(([scenario, label]) => (
                  <AppButton
                    key={scenario}
                    label={label}
                    tone="secondary"
                    disabled={busy}
                    onPress={() => demo.mutate({ scenario })}
                  />
                ))}
              </ActionRow>
            </>
          ) : null}
          <SectionHeading label="Action receipts" />
          {state.receipts.length === 0 ? (
            <AppText tone="muted">
              No executions yet. A receipt appears after a rule matches.
            </AppText>
          ) : null}
          {state.receipts.map((receipt) => (
            <EditorialSurface
              key={receipt.id}
              title={receipt.title}
              icon="receipt-text-outline"
              meta={serviceNames[receipt.service]}
              titleAccessory={
                <StatusPill
                  label={receipt.status.replaceAll("-", " ")}
                  tone={
                    receipt.status === "succeeded"
                      ? "success"
                      : receipt.status === "blocked" || receipt.status === "failed"
                        ? "warning"
                        : "muted"
                  }
                />
              }
            >
              <AppText variant="caption">{receipt.targetLabel}</AppText>
              <AppText tone="muted" variant="caption">
                {receipt.reason.replaceAll("-", " ")}
              </AppText>
              {receipt.preview?.map((field) => (
                <AppText
                  key={field.label}
                  variant="monoMeta"
                >{`${field.label}: ${field.value}`}</AppText>
              ))}
              {receipt.status === "awaiting-approval" ? (
                <ActionRow>
                  <AppButton
                    label="Approve action"
                    disabled={busy || state.paused}
                    onPress={() => change.mutate({ type: "approve", receiptId: receipt.id })}
                  />
                  <AppButton
                    label="Skip"
                    tone="secondary"
                    disabled={busy}
                    onPress={() => change.mutate({ type: "cancel", receiptId: receipt.id })}
                  />
                </ActionRow>
              ) : null}
              {receipt.status === "failed" && receipt.reason !== "outcome-unknown" ? (
                <AppButton
                  label="Retry safely"
                  tone="secondary"
                  disabled={busy || state.paused}
                  onPress={() => change.mutate({ type: "retry", receiptId: receipt.id })}
                />
              ) : null}
            </EditorialSurface>
          ))}
          <AppButton
            label="Open Activity"
            tone="secondary"
            onPress={() => router.push("/activity")}
          />
        </>
      )}
      <AppDialog
        actions={<AppButton label="Close" tone="secondary" onPress={() => setEditing(undefined)} />}
        title="Configure automation"
        visible={editing !== undefined}
        onDismiss={() => setEditing(undefined)}
      >
        {editing === undefined ? null : (
          <View style={{ gap: theme.relay.spacing.md }}>
            <AppTextInput
              label="Name"
              value={editing.name}
              onChangeText={(name) => setEditing({ ...editing, name })}
            />
            <AppText variant="caption">Matching filter from Rules</AppText>
            <ActionRow>
              {filters.rules.map((filter) => (
                <AppButton
                  key={filter.id}
                  label={filter.name}
                  tone={editing.filterRuleId === filter.id ? "primary" : "secondary"}
                  onPress={() => setEditing({ ...editing, filterRuleId: filter.id })}
                />
              ))}
            </ActionRow>
            <AppTextInput label="Destination ID" editable={false} value={editing.targetId} />
            <AppTextInput
              label="Sender allowlist (comma separated)"
              value={editing.senders.join(", ")}
              onChangeText={(value) =>
                setEditing({
                  ...editing,
                  senders: value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              }
            />
            <AppTextInput
              label="Excluded senders (comma separated)"
              value={editing.exclusions.join(", ")}
              onChangeText={(value) =>
                setEditing({
                  ...editing,
                  exclusions: value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              }
            />
            {(["gmail", "sms", "notification"] as const).map((source) => (
              <AppSwitch
                key={source}
                label={source}
                value={editing.sources.includes(source)}
                onValueChange={(enabled) =>
                  setEditing({
                    ...editing,
                    sources: enabled
                      ? [...editing.sources, source]
                      : editing.sources.filter((item) => item !== source),
                  })
                }
              />
            ))}
            <AppTextInput
              label="Minimum confidence (0.8 to 1)"
              keyboardType="decimal-pad"
              value={String(editing.minimumConfidence)}
              onChangeText={(value) => {
                const threshold = Number(value);
                if (Number.isFinite(threshold))
                  setEditing({ ...editing, minimumConfidence: threshold });
              }}
            />
            <AppSwitch
              label="Trusted automatic execution"
              detail="Authorize this rule to write to this destination without asking each time. Ambiguous or incomplete captures still stop."
              value={editing.approval === "automatic"}
              onValueChange={(automatic) =>
                setEditing({ ...editing, approval: automatic ? "automatic" : "required" })
              }
            />
            <AppText>{`Preview: ${serviceNames[editing.service]} → ${editing.targetLabel}. ${editing.approval === "required" ? "Every matching action waits for approval." : "Only complete, authorized matches may execute automatically."} No emails, invitations, or deletions.`}</AppText>
            <AppButton
              label="Save configuration"
              disabled={!smartRuleSchema.safeParse(editing).success}
              loading={change.isPending}
              onPress={() => change.mutate({ type: "save-rule", rule: editing })}
            />
          </View>
        )}
      </AppDialog>
      <AppDialog
        title="Choose destination"
        visible={selecting !== undefined}
        onDismiss={() => setSelecting(undefined)}
        actions={
          <AppButton label="Close" tone="secondary" onPress={() => setSelecting(undefined)} />
        }
      >
        {destinations.isPending ? <LoadingState label="Loading destinations" /> : null}
        {resources.map((resource) => (
          <AppButton
            key={resource.id}
            label={resource.label}
            tone="secondary"
            onPress={() => {
              if (selecting !== undefined && selecting !== "gmail")
                change.mutate({ type: "destination", service: selecting, targetId: resource.id });
              setSelecting(undefined);
            }}
          />
        ))}
        {selecting === "google-sheets" ? (
          <>
            <AppText tone="muted">
              Only files already authorized for Relay are listed. Creating a dedicated expense
              spreadsheet performs an explicit Google write.
            </AppText>
            <AppButton
              label="Create Relay expense spreadsheet"
              disabled={busy}
              onPress={() => {
                change.mutate({ type: "create-sheet" });
                setSelecting(undefined);
              }}
            />
          </>
        ) : null}
      </AppDialog>
      <ConfirmationDialog
        title="Disconnect this service?"
        detail={
          disconnecting === "gmail"
            ? "Stops Gmail synchronization using Relay's existing teardown. This revokes Google authorization and can require reconnecting your other Google services."
            : "Stops its automations and removes this service's credential from Relay. This does not revoke the shared Google grant or delete Google data."
        }
        confirmLabel="Disconnect"
        visible={disconnecting !== undefined}
        onCancel={() => setDisconnecting(undefined)}
        onConfirm={() => {
          if (disconnecting !== undefined)
            change.mutate({ type: "disconnect", service: disconnecting });
          setDisconnecting(undefined);
        }}
      />
    </ReceiptScreen>
  );
}
