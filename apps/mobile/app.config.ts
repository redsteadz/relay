import type { ExpoConfig } from "expo/config";

const buildVariant = process.env.RELAY_BUILD_VARIANT ?? "development";
if (buildVariant !== "development" && buildVariant !== "sideload") {
  throw new Error("RELAY_BUILD_VARIANT must be development or sideload");
}

const smsPermissions = ["android.permission.READ_SMS", "android.permission.RECEIVE_SMS"];
const isSideload = buildVariant === "sideload";

const config: ExpoConfig = {
  name: "Relay",
  slug: "relay",
  owner: "harcoleis-team",
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
    ...(isSideload ? { permissions: smsPermissions } : { blockedPermissions: smsPermissions }),
    adaptiveIcon: {
      backgroundColor: "#111713",
    },
  },
  extra: {
    relayBuildVariant: buildVariant,
    eas: {
      projectId: "abda47b3-6e3d-43db-94de-bea147723388",
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
