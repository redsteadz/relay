import type { ExpoConfig } from "expo/config";
import { AndroidConfig, withAndroidManifest, type ConfigPlugin } from "expo/config-plugins";

import buildConstants from "./config/build.constants.json";
import palette from "./theme/palette.json";

const { app, buildVariants, sms } = buildConstants;
type AndroidComponent = { $: { "android:name": string }; [key: string]: unknown };

function withoutComponent(
  components: AndroidComponent[] | undefined,
  componentName: string,
): AndroidComponent[] {
  return (components ?? []).filter((component) => component.$["android:name"] !== componentName);
}

const withRelaySms: ConfigPlugin<{ enabled: boolean }> = (config, { enabled }) =>
  withAndroidManifest(config, (manifestConfig) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifestConfig.modResults);
    application.receiver = withoutComponent(application.receiver, sms.receiverClass);
    application.service = withoutComponent(application.service, sms.syncServiceClass);

    if (enabled) {
      application.receiver.push({
        $: {
          "android:enabled": "true",
          "android:exported": "true",
          "android:name": sms.receiverClass,
          "android:permission": sms.broadcastPermission,
        },
        "intent-filter": [
          {
            action: [{ $: { "android:name": sms.receivedAction } }],
          },
        ],
      } as unknown as (typeof application.receiver)[number]);
      application.service.push({
        $: {
          "android:exported": "false",
          "android:name": sms.syncServiceClass,
          "android:permission": sms.jobServicePermission,
        },
      });
    }
    return manifestConfig;
  });

const buildVariant = process.env.RELAY_BUILD_VARIANT ?? buildVariants.development;
if (!Object.values(buildVariants).includes(buildVariant)) {
  throw new Error(`RELAY_BUILD_VARIANT must be ${Object.values(buildVariants).join(" or ")}`);
}

const isSideload = buildVariant === buildVariants.sideload;

/**
 * A demo build says so on the home screen.
 *
 * Same application id, so it replaces rather than sits beside a real install, but a distinct name
 * because the account inside it is synthetic and nobody should have to open it to find that out.
 */
const isDemo = process.env.EXPO_PUBLIC_RELAY_DEMO === "enabled";

const config: ExpoConfig = {
  name: isDemo ? `${app.name} Demo` : app.name,
  slug: app.slug,
  owner: app.owner,
  scheme: app.scheme,
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  plugins: ["expo-router", "expo-secure-store"],
  experiments: {
    typedRoutes: true,
  },
  android: {
    package: app.androidApplicationId,
    ...(isSideload ? { permissions: sms.permissions } : { blockedPermissions: sms.permissions }),
    adaptiveIcon: {
      backgroundColor: palette.dark.background,
    },
  },
  extra: {
    relayBuildVariant: buildVariant,
    eas: {
      projectId: app.projectId,
    },
  },
  ios: {
    bundleIdentifier: app.iosBundleIdentifier,
    supportsTablet: true,
  },
  web: {
    bundler: "metro",
    output: "static",
  },
};

export default withRelaySms(config, { enabled: isSideload });
