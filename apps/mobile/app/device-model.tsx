import { router } from "expo-router";

import { ReceiptScreen } from "@/components/ReceiptScreen";
import { DeviceModelDiagnostics } from "@/features/privacy/components/DeviceModelDiagnostics";
import { useAuth } from "@/lib/auth-context";

/**
 * Whether the model on this phone is being asked, and what it says when it is.
 *
 * Its own route rather than a section of Your data, because a reader arrives here with one question
 * -- why is this notification still "waiting on your model" -- and the answer is several readings
 * long: the listener state, a live test, the recent passes, the recent requests. Those belong on a
 * page a person can be sent to from the rule that is waiting.
 */
export default function DeviceModelRoute() {
  const { session } = useAuth();
  return (
    <ReceiptScreen onBack={() => router.back()} title="Model on this phone">
      <DeviceModelDiagnostics tenantId={session?.user.id} />
    </ReceiptScreen>
  );
}
