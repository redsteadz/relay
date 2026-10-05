import { describe, expect, it } from "vitest";

/**
 * The boundary between hiding an inbox row and acting on a notification.
 *
 * Hiding removes a row from Relay's own inbox and never touches the phone. Quieting and dismissing
 * change what the device does, and a dismissal cannot be undone. The M6 rework added a new way to
 * act on a notification in every surface -- a swipe, a per-application view, a category group, a
 * drawer -- and each one was an opportunity for the second capability to be acquired by accident.
 *
 * Review cannot hold that line, because the mistake it guards against is a one-line import. So this
 * asserts it structurally: the capability to act on a notification lives at one call site per
 * action, and nothing the inbox can reach touches any of them.
 *
 * See `docs/decisions/0017-notification-dismissal-after-posting.md` and issue #158.
 */

/**
 * The slice of `node:fs` this test uses.
 *
 * The mobile project carries no Node types, so the module is loaded through a specifier held in a
 * variable, the way `e2e/device-boundary.e2e.ts` and the local store's SQLite double do.
 */
type DirectoryEntry = { isDirectory: () => boolean; name: string };
type FileSystem = {
  readFileSync: (path: string, encoding: "utf8") => string;
  readdirSync: (path: string, options: { withFileTypes: true }) => DirectoryEntry[];
};
const fileSystemSpecifier = "node:fs";
const fileSystem = (await import(fileSystemSpecifier)) as FileSystem;

const mobileRoot = new URL("../../../", import.meta.url).pathname;
const nativeRoot = `${mobileRoot}modules/relay-device-ingress/android/src/main/java/com/redsteadz/relaydeviceingress/`;

const SOURCE_SUFFIXES = [".ts", ".tsx", ".kt"];

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of fileSystem.readdirSync(directory, { withFileTypes: true })) {
    const path = `${directory}${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...sourceFiles(`${path}/`));
      continue;
    }
    const source = SOURCE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix));
    if (source && !entry.name.endsWith(".test.ts")) found.push(path);
  }
  return found;
}

/**
 * A file's code with its comments removed.
 *
 * These assertions are about what the code can do, and the files involved discuss the capability at
 * length -- the listener's own comment says it never calls `cancelAllNotifications`. Matching prose
 * would fail the test on an accurate explanation and pass it on a renamed call.
 *
 * Strings are not excluded. None of these sources holds a literal containing `//`, and every
 * assertion is an absence, so the only way this could hide a real call is a string literal that
 * opens a comment -- a stranger thing to find than what is being guarded against.
 */
function codeOf(path: string): string {
  return fileSystem
    .readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/\/\/[^\n]*/gu, " ");
}

/** Everything a surface would have to touch to make a notification go away. */
const DISMISSAL_CAPABILITY = [
  "cancelNotification",
  "snoozeNotification",
  "configureNotificationSilence",
  "setNotificationSilenceKillSwitch",
];

describe("no inbox path can act on a device notification", () => {
  // The inbox, the routes that render it, and the shared component library. A gesture, a row, or a
  // swipe action in any of these can only ever move a row inside Relay.
  const reachableFromInbox = [
    `${mobileRoot}features/inbox/`,
    `${mobileRoot}app/inbox/`,
    `${mobileRoot}app/(tabs)/`,
    `${mobileRoot}components/`,
  ].flatMap(sourceFiles);

  it("finds inbox sources to check", () => {
    // A path that stopped resolving would make every assertion below vacuously true.
    expect(reachableFromInbox.length).toBeGreaterThan(10);
  });

  it.each(DISMISSAL_CAPABILITY)("no inbox surface references %s", (capability) => {
    const offenders = reachableFromInbox.filter((path) => codeOf(path).includes(capability));
    expect(offenders.map((path) => path.slice(mobileRoot.length))).toStrictEqual([]);
  });

  // Hiding is reachable from the inbox and must stay a Relay-only operation. If it ever imported the
  // silencing module, a swipe would be one edit away from clearing a notification off the phone.
  it("hiding an inbox row does not reach the silencing module", () => {
    for (const path of [
      `${mobileRoot}features/inbox/hooks/useHiddenInbox.ts`,
      `${mobileRoot}lib/local-store/hidden.ts`,
    ]) {
      const source = codeOf(path);
      expect(source).not.toContain("notification-silence");
      expect(source).not.toContain("Silence");
    }
  });
});

describe("the native capability is confined to one call site", () => {
  const native = sourceFiles(nativeRoot);

  it.each(["cancelNotification(", "snoozeNotification("])(
    "%s is called only by the listener",
    (call) => {
      const callers = native.filter((path) => codeOf(path).includes(call));
      expect(callers.map((path) => path.slice(nativeRoot.length))).toStrictEqual([
        "RelayNotificationListenerService.kt",
      ]);
    },
  );

  it("each call appears exactly once", () => {
    const listener = codeOf(`${nativeRoot}RelayNotificationListenerService.kt`);
    expect(listener.split("cancelNotification(").length - 1).toBe(1);
    expect(listener.split("snoozeNotification(").length - 1).toBe(1);
  });

  // `cancelAllNotifications` clears the shade wholesale. Relay cancels one key, decided one
  // notification at a time, or it cancels nothing.
  it("nothing cancels every notification at once", () => {
    for (const path of native) {
      expect(codeOf(path)).not.toContain("cancelAllNotifications");
    }
  });

  // Nothing here may claim the pre-posting hook. `NotificationAssistantService` and `Adjustment` are
  // `@SystemApi` and absent from the public SDK, so a reference could only be an attempt to promise
  // a capability a sideloaded Relay does not have. See ADR-0017.
  it("nothing reaches for the pre-posting hook", () => {
    for (const path of native) {
      const source = codeOf(path);
      expect(source).not.toContain("NotificationAssistantService()");
      expect(source).not.toContain("Adjustment(");
      expect(source).not.toContain("KEY_IMPORTANCE");
    }
  });
});
