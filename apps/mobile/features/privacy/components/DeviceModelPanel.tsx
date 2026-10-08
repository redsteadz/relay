import { useState } from "react";

import { AppButton, AppText, ConfirmationDialog, EditorialSurface } from "@/components/ui";

import { useDeviceModel } from "../hooks/useDeviceModel";
import { deviceModelFormDefaults, deviceModelSummary } from "../models/deviceModelPresentation";
import { DeviceModelDialog } from "./DeviceModelDialog";

/**
 * The model this phone asks, and the fact that it asks it directly.
 *
 * Sits beside the server's BYOK panel rather than replacing it, because the two are separate
 * credentials with separate reach: this one lets the device decide a semantic clause as a
 * notification arrives, and the server's lets the pipeline decide one during processing. Revoking
 * either leaves the other alone, and the copy says so — a reader who removed one key and assumed
 * both were gone would be wrong about where their data can go.
 *
 * See [ADR-0019](../../../../docs/decisions/0019-device-semantic-evaluation.md).
 */
export function DeviceModelPanel({ tenantId }: { tenantId: string | undefined }) {
  const model = useDeviceModel(tenantId);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);

  const configured = model.config !== undefined;

  return (
    <EditorialSurface
      icon="brain"
      meta={configured ? "On this phone" : "Not set up"}
      title="Model on this phone"
    >
      <AppText tone="muted">{deviceModelSummary(model.config)}</AppText>
      <AppText tone="muted" variant="caption">
        Rules that ask a model are decided here, as captures arrive, without Relay&apos;s servers
        seeing the question. Point it at a model you run and nothing leaves your network. This is
        separate from the key saved to your account — removing one does not remove the other.
      </AppText>

      <AppButton
        disabled={tenantId === undefined || model.loading || model.saving}
        label={configured ? "Change model" : "Set up a model"}
        onPress={() => setEditing(true)}
        tone={configured ? "secondary" : "primary"}
      />
      {configured ? (
        <AppButton
          disabled={model.saving}
          label="Remove from this phone"
          onPress={() => setRemoving(true)}
          tone="secondary"
        />
      ) : null}

      <DeviceModelDialog
        configured={configured}
        defaults={deviceModelFormDefaults(model.config)}
        {...(model.saveError === null
          ? {}
          : { errorMessage: "That could not be saved on this phone." })}
        onDismiss={() => setEditing(false)}
        onSave={async (values) => {
          await model.save(values);
          setEditing(false);
        }}
        saving={model.saving}
        visible={editing}
      />
      <ConfirmationDialog
        confirmLabel="Remove"
        detail="Rules that ask a model will wait for one again. The key saved to your account is not affected."
        onCancel={() => setRemoving(false)}
        onConfirm={() => {
          void (async () => {
            await model.remove();
            setRemoving(false);
          })();
        }}
        title="Remove this phone's model?"
        visible={removing}
      />
    </EditorialSurface>
  );
}
