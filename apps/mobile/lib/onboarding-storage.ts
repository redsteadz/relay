import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Whether the introduction has been seen on this device.
 *
 * Device-local rather than account-backed on purpose: it records that a person has read what Relay
 * may capture on *this* phone, and a second device is a second set of source permissions to
 * understand. It is also readable before sign-in, which is when the introduction runs.
 */
const onboardingKey = "relay.onboarding-complete";

export async function readOnboardingComplete(): Promise<boolean> {
  return (await AsyncStorage.getItem(onboardingKey)) === "true";
}

export async function writeOnboardingComplete(): Promise<void> {
  await AsyncStorage.setItem(onboardingKey, "true");
}
