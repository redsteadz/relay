const ANDROID_PACKAGE_NAME = /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

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
