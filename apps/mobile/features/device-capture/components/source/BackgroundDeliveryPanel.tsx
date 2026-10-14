import { AppSwitch, AppText, StatusMessage } from "@/components/ui";

import { useBackgroundDelivery } from "../../hooks/useBackgroundDelivery";

/**
 * Whether a capture reaches the server before the app is next opened.
 *
 * The notification listener already fills the encrypted queue with Relay closed; what waited on an
 * app launch was the upload. So this control is about delivery, not capture, and the copy says so:
 * turning it off does not stop Relay hearing a notification, it stops Relay sending what it heard
 * until you open it.
 *
 * It is a control rather than a default because the consent a person gave was for capture. A fair
 * reading covers delivery too, but a fair reading is not the standard worth asking someone to rely
 * on, so the behaviour is described and chosen rather than inferred.
 *
 * The timing is stated honestly. Android batches background work and stretches it further in Doze,
 * so the promise is "without opening Relay", never "immediately".
 */
export function BackgroundDeliveryPanel() {
  const delivery = useBackgroundDelivery();

  if (!delivery.supported) {
    return (
      <AppText tone="muted" variant="caption">
        Background delivery needs Android. Captures on this device upload while Relay is open.
      </AppText>
    );
  }

  return (
    <>
      <AppSwitch
        accessibilityHint="Lets Relay upload captures while the app is closed"
        detail={
          delivery.enabled
            ? `On. Captures upload while Relay is closed, in batches at least ${delivery.intervalMinutes} minutes apart — Android decides exactly when.`
            : "Off. Captures stay in the encrypted queue on this phone until you next open Relay."
        }
        disabled={delivery.busy}
        label="Deliver in the background"
        onValueChange={(next) => {
          void delivery.setEnabled(next);
        }}
        value={delivery.enabled}
      />
      {delivery.restricted ? (
        <StatusMessage tone="warning">
          Android is restricting background work for Relay. Allow background activity for Relay in
          your system battery settings, then turn this on again.
        </StatusMessage>
      ) : null}
      <AppText tone="muted" variant="caption">
        This changes when an existing upload happens, not what is uploaded. A background run with no
        signed-in session records that and stops.
      </AppText>
    </>
  );
}
