/**
 * The device's SHA-256, for the fingerprints `@relay/domain` computes.
 *
 * Hermes has no `crypto.subtle`, so the shared fingerprint functions take a digest rather than assume
 * one (see `packages/domain/src/digest.ts`). `expo-crypto` is already a dependency and already exposes
 * exactly the shape needed, so this is an adapter rather than a new capability: no polyfill is
 * installed, and nothing global changes.
 */

import type { Sha256Digest } from "@relay/domain";
import * as Crypto from "expo-crypto";

export const mobileSha256: Sha256Digest = async (bytes) =>
  new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes));
