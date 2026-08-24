import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Relay",
  slug: "relay",
  scheme: "com.redsteadz.relay",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  plugins: ["expo-router", "expo-secure-store"],
  experiments: {
    typedRoutes: true,
  },
  android: {
    package: "com.redsteadz.relay",
    adaptiveIcon: {
      backgroundColor: "#111713",
    },
  },
  ios: {
    bundleIdentifier: "com.redsteadz.relay",
    supportsTablet: true,
  },
  web: {
    bundler: "metro",
    output: "static",
  },
};

export default config;
