import { useRouter } from "expo-router";

import { ReceiptScreen } from "@/components/ReceiptScreen";
import { QuietScreen } from "@/features/silence/components/QuietScreen";

/**
 * Where a person makes their phone quieter, and stops it.
 *
 * Its own route rather than a panel inside Settings, because the controls here are the only ones in
 * Relay that change what the device itself does. Everything else moves rows inside Relay: hiding an
 * inbox item, filing a capture under a category, approving an action. Quieting reaches past Relay
 * into the notification the phone was about to make a sound for, and that difference deserves a page
 * of its own rather than a row among theme preferences.
 */
export default function QuietRoute() {
  const router = useRouter();
  return (
    <ReceiptScreen onBack={() => router.back()} title="Quiet">
      <QuietScreen />
    </ReceiptScreen>
  );
}
