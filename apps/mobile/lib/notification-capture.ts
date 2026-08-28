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
