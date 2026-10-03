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
  /**
   * The mark, shared with the landing site's `apps/web/public/icon.svg` so one Relay is one Relay.
   *
   * Opaque and full-bleed: iOS rejects an icon with an alpha channel, and both platforms apply their
   * own corner mask, so the artwork carries no radius of its own. Android draws the adaptive layers
   * below in preference to this; this remains the iOS icon and the Android legacy fallback.
   */
  icon: "./assets/icon.png",
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
      foregroundImage: "./assets/adaptive-icon.png",
      // Android 13 and later recolour this to the wallpaper. Supplying one is what keeps Relay from
      // being the icon that stays fully coloured on a themed home screen.
      monochromeImage: "./assets/monochrome-icon.png",
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
