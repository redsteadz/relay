import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { NotificationCapturePanel } from "@/components/NotificationCapturePanel";
import { SmsCapturePanel } from "@/components/SmsCapturePanel";
import { Page } from "@/components/Page";
import { Panel } from "@/components/Panel";
import { AppText } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import RelayDeviceIngress, { type DeviceCapabilities } from "@/modules/relay-device-ingress";

export default function ConnectionsScreen() {
  const { session } = useAuth();
  const [capabilities, setCapabilities] = useState<DeviceCapabilities>();

  useEffect(() => {
    const refresh = () => RelayDeviceIngress.getCapabilities().then(setCapabilities);
    void refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => subscription.remove();
  }, []);

  return (
    <Page
      eyebrow="Consent boundaries"
      title="Sources"
      detail="Every source is independently authorized, minimized, and revocable."
    >
      <Panel title="Gmail" meta="NOT CONNECTED">
        <AppText tone="muted">
          Restricted-scope testing flow. Google Pub/Sub delivers mailbox cursors, not message
          bodies.
        </AppText>
      </Panel>
      <NotificationCapturePanel
        capabilities={capabilities}
        onChanged={async () => setCapabilities(await RelayDeviceIngress.getCapabilities())}
        tenantId={session?.user.id}
      />
      <SmsCapturePanel
        capabilities={capabilities}
        onChanged={async () => setCapabilities(await RelayDeviceIngress.getCapabilities())}
        tenantId={session?.user.id}
      />
    </Page>
  );
}
