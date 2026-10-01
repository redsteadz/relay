/// <reference types="expo/types" />

declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_API_URL?: string;
    EXPO_PUBLIC_RELAY_DEMO?: string;
    EXPO_PUBLIC_REVENUECAT_ANDROID_KEY?: string;
    EXPO_PUBLIC_REVENUECAT_IOS_KEY?: string;
    EXPO_PUBLIC_SUPABASE_URL?: string;
    EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
  }
}
