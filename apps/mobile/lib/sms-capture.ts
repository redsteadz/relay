const PHONE_LIKE = /^\+?[0-9\s().-]+$/u;

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
}

export function normalizeSmsSender(sender: string): string {
  const trimmed = sender.trim();
  return PHONE_LIKE.test(trimmed) ? trimmed.replace(/[\s().-]/gu, "") : trimmed.toLowerCase();
}

export function parseSmsSenderAllowlist(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\n,]+/u)
        .map(normalizeSmsSender)
        .filter(Boolean),
    ),
  ];
}

export function isValidSmsSenderAllowlist(senders: string[]): boolean {
  return (
    senders.length > 0 &&
    senders.length <= 50 &&
    senders.every(
      (sender) => sender.length <= 256 && !hasControlCharacter(sender) && sender.trim().length > 0,
    )
  );
}

type EnableSmsCaptureDependencies = {
  configure: (paused: boolean) => Promise<void>;
  permissionGranted: boolean;
  requestPermissions: () => Promise<boolean>;
  syncInbox: () => Promise<number>;
};

type SaveSmsSenderAllowlistDependencies = {
  configure: (paused: boolean) => Promise<void>;
  paused: boolean;
  syncInbox: () => Promise<number>;
};

export type EnableSmsCaptureResult =
  { captured: number; granted: true } | { captured: 0; granted: false };

export type SaveSmsSenderAllowlistResult =
  { captured: number; inboxSync: "succeeded" } | { captured: 0; inboxSync: "failed" | "skipped" };

/** Keeps provider reads paused until both Android SMS permissions have been granted. */
export async function enableSmsCapture({
  configure,
  permissionGranted,
  requestPermissions,
  syncInbox,
}: EnableSmsCaptureDependencies): Promise<EnableSmsCaptureResult> {
  if (!permissionGranted) {
    await configure(true);
    if (!(await requestPermissions())) return { captured: 0, granted: false };
  }

  await configure(false);
  return { captured: await syncInbox(), granted: true };
}

/** Commits the allowlist first, then reports best-effort active inbox sync separately. */
export async function saveSmsSenderAllowlist({
  configure,
  paused,
  syncInbox,
}: SaveSmsSenderAllowlistDependencies): Promise<SaveSmsSenderAllowlistResult> {
  await configure(paused);
  if (paused) return { captured: 0, inboxSync: "skipped" };

  try {
    return { captured: await syncInbox(), inboxSync: "succeeded" };
  } catch {
    return { captured: 0, inboxSync: "failed" };
  }
}
