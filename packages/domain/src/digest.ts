/**
 * The one hash this package needs, and a way to supply it.
 *
 * Fingerprints are the only reason `packages/domain` touches anything outside pure computation. Every
 * runtime that has run this code so far provided WebCrypto: Workers and Node both expose
 * `crypto.subtle`. Hermes does not, so the device -- which now derives facts and events itself -- has
 * no `crypto.subtle` to call.
 *
 * The fix is a parameter rather than a polyfill. Installing a global `crypto` shim from the app would
 * make this package's runtime neutrality accidental: it would still *assume* WebCrypto and merely be
 * lucky about who provided it. Taking the digest as an argument states the dependency, keeps the
 * default correct for the runtimes that already have one, and leaves nothing for a caller to
 * initialize in the right order.
 */

/**
 * A SHA-256 over bytes. Async because every platform implementation is.
 *
 * The input is narrowed to a view over a plain `ArrayBuffer` rather than the general
 * `Uint8Array<ArrayBufferLike>`, because `BufferSource` excludes `SharedArrayBuffer` and every caller
 * here passes `TextEncoder` output, which is already that exact type.
 */
export type Sha256Digest = (bytes: Uint8Array<ArrayBuffer>) => Promise<Uint8Array>;

/** The default, for runtimes that expose WebCrypto. */
export const webCryptoSha256: Sha256Digest = async (bytes) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));

/**
 * Lowercase hex of the digest.
 *
 * Shared so the three fingerprints cannot drift in how they render the same bytes, which would change
 * stored values without changing any input.
 */
export async function sha256Hex(
  bytes: Uint8Array<ArrayBuffer>,
  digest: Sha256Digest = webCryptoSha256,
): Promise<string> {
  const hashed = await digest(bytes);
  return Array.from(hashed, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
