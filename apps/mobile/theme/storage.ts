import AsyncStorage from "@react-native-async-storage/async-storage";

import { isThemePreference, type ThemePreference } from "./tokens";

const themePreferenceKey = "relay.theme-preference";

export async function readThemePreference(): Promise<ThemePreference> {
  const stored = await AsyncStorage.getItem(themePreferenceKey);
  return isThemePreference(stored) ? stored : "system";
}

export async function writeThemePreference(preference: ThemePreference): Promise<void> {
  await AsyncStorage.setItem(themePreferenceKey, preference);
}
