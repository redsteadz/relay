import { router, type Href } from "expo-router";

import { Panel } from "@/components/Panel";
import { AppButton, AppText, StatusMessage } from "@/components/ui";

import { usePrivacySettings } from "../hooks/usePrivacySettings";
import { AccountDeletionPanel } from "./AccountDeletionPanel";
import { OpenAiPrivacyPanel } from "./OpenAiPrivacyPanel";
import { RetentionPanel } from "./RetentionPanel";

type PrivacySettingsProps = {
  accessToken: string | undefined;
  clearDeletedAccountSession: () => Promise<void>;
  userId: string | undefined;
};

export function PrivacySettings({
  accessToken,
  clearDeletedAccountSession,
  userId,
}: PrivacySettingsProps) {
  const privacy = usePrivacySettings(userId, accessToken);

  if (accessToken === undefined || userId === undefined) {
    return (
      <Panel title="Privacy controls" meta="SIGN-IN REQUIRED">
        <StatusMessage tone="warning">
          Sign in to inspect retained data, disclosure history, credentials, and deletion status.
        </StatusMessage>
      </Panel>
    );
  }

  return (
    <>
      <RetentionPanel
        error={privacy.purge.error ?? privacy.overview.error}
        loading={privacy.overview.isPending}
        onPurge={privacy.purgeRawPayloads}
        onRetry={privacy.overview.refetch}
        purging={privacy.purge.isPending}
        retention={privacy.overview.data?.retention}
      />
      <Panel title="AI disclosure history" meta="METADATA ONLY">
        <AppText tone="muted">
          Inspect provider, model, disclosed field names, purpose, and time—never prompts or source
          content.
        </AppText>
        <AppButton
          label="View disclosure history"
          onPress={() => router.push("/disclosures" as Href)}
          tone="secondary"
        />
      </Panel>
      <OpenAiPrivacyPanel
        error={privacy.revoke.error ?? privacy.openAi.error}
        loading={privacy.openAi.isPending}
        onRevoke={privacy.revokeOpenAiKey}
        onRetry={privacy.openAi.refetch}
        revoking={privacy.revoke.isPending}
        status={privacy.openAi.data}
      />
      <AccountDeletionPanel
        deleting={privacy.deletion.isPending}
        error={privacy.deletion.error}
        onDelete={async () => {
          await privacy.deleteAccount();
          await clearDeletedAccountSession();
        }}
        status={privacy.overview.data?.deletion}
      />
    </>
  );
}
