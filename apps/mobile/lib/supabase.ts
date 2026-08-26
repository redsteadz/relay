import * as SecureStore from "expo-secure-store";
import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
};

const volatileWebValues = new Map<string, string>();
const volatileWebStorage = {
  getItem: (key: string) => Promise.resolve(volatileWebValues.get(key) ?? null),
  removeItem: (key: string) => {
    volatileWebValues.delete(key);
    return Promise.resolve();
  },
  setItem: (key: string, value: string) => {
    volatileWebValues.set(key, value);
    return Promise.resolve();
  },
};

export function createRelaySupabaseClient() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (url === undefined || anonKey === undefined) {
    throw new Error("Supabase public environment is not configured");
  }

  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: "pkce",
      persistSession: true,
      storage: Platform.OS === "web" ? volatileWebStorage : secureStorage,
    },
  });
}
