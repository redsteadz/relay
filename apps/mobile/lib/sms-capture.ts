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
