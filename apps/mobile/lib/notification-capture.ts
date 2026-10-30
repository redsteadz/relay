const ANDROID_PACKAGE_NAME = /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

export type NotificationAppChoice = {
  label: string;
  packageName: string;
};

export function parseNotificationAllowlist(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\s,]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export function isValidNotificationAllowlist(packages: string[]): boolean {
  return packages.length > 0 && packages.every((name) => ANDROID_PACKAGE_NAME.test(name));
}

export function normalizeNotificationAppChoices(
  apps: readonly NotificationAppChoice[],
): NotificationAppChoice[] {
  const byPackage = new Map<string, NotificationAppChoice>();

  for (const app of apps) {
    if (!ANDROID_PACKAGE_NAME.test(app.packageName) || byPackage.has(app.packageName)) continue;
    const label = app.label.trim();
    byPackage.set(app.packageName, {
      label: label.length > 0 ? label : app.packageName,
      packageName: app.packageName,
    });
  }

  return [...byPackage.values()].sort(
    (left, right) =>
      left.label.localeCompare(right.label, undefined, { sensitivity: "base" }) ||
      left.packageName.localeCompare(right.packageName),
  );
}

export function filterNotificationAppChoices(
  apps: readonly NotificationAppChoice[],
  query: string,
): NotificationAppChoice[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) return [...apps];
  return apps.filter(
    (app) =>
      app.label.toLocaleLowerCase().includes(normalizedQuery) ||
      app.packageName.toLocaleLowerCase().includes(normalizedQuery),
  );
}

export function toggleNotificationAppSelection(
  packages: readonly string[],
  packageName: string,
): string[] {
  return packages.includes(packageName)
    ? packages.filter((selected) => selected !== packageName)
    : [...packages, packageName];
}

/**
 * The allowlist after naming an application grants it capture (ADR-0023).
 *
 * Returns `undefined` when every named application is already allowed, so a caller can skip the
 * device write entirely rather than reconfigure capture with an identical list.
 */
export function nextNotificationAllowlist(
  current: readonly string[],
  namedApplicationIds: readonly string[],
): string[] | undefined {
  const merged = new Set(current);
  let changed = false;
  for (const id of namedApplicationIds) {
    if (!merged.has(id)) {
      merged.add(id);
      changed = true;
    }
  }
  return changed ? [...merged] : undefined;
}

/**
 * Whether capture should stay paused after a named application is granted (ADR-0023).
 *
 * `RelayDeviceIngressModule.getCapabilities` reports an empty allowlist and `paused: true` from
 * the exact same null read when capture has never been configured on this device -- there is no
 * path that writes an empty allowlist deliberately, so an empty `previouslyAllowed` is never a
 * person's own choice to represent. A non-empty one is always either an active setup or a pause
 * someone chose on purpose, and that choice is left alone: naming an application grants it
 * capture, it does not override a pause.
 */
export function nextNotificationCapturePaused(
  previouslyAllowed: readonly string[],
  currentlyPaused: boolean,
): boolean {
  return previouslyAllowed.length === 0 ? false : currentlyPaused;
}
