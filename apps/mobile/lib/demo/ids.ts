/**
 * Identifiers for demo rows.
 *
 * Seed rows need stable ids: a category referenced by a rule and a rule referenced by a
 * classification have to agree across restarts, and a hand-written UUID table would be one more
 * thing to keep consistent. `demoUuid` derives one from a name instead, so `demoUuid("category:task")`
 * is the same value on every run and in every table that mentions it.
 *
 * The output is a syntactically valid v4 UUID because `@relay/contracts` validates one, not because
 * anything here is random. Rows created while the demo is running use `demoRandomUuid`.
 */
export function demoUuid(name: string): string {
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index += 1) {
    // FNV-1a over the name and the byte position, which decorrelates the bytes of one name.
    let hash = 0x811c9dc5;
    for (const character of `${name}#${String(index)}`) {
      hash ^= character.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    bytes[index] = (hash ^ (hash >>> 16)) & 0xff;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let created = 0;

/**
 * A fresh identifier for a row created while the demo is running.
 *
 * Derived rather than random so this module needs no native crypto and stays runnable anywhere its
 * callers are tested. The clock and a per-process counter together make a repeat impossible within
 * one run, and rows from separate runs are already separated by the timestamp.
 */
export function demoRandomUuid(): string {
  created += 1;
  return demoUuid(`row:${String(Date.now())}:${String(created)}`);
}
