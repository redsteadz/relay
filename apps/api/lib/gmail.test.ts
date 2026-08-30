import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateKek } from "@relay/crypto";

import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
  buildOAuthCookie,
  parseOAuthCookie,
  clearOAuthCookie,
  type GmailEnv,
} from "./gmail";

const gmailEnv: GmailEnv = {
  googleClientId: "synthetic-client-id",
  googleClientSecret: "synthetic-client-secret",
  kekKeyring: JSON.stringify({ activeVersion: 1, keys: { 1: generateKek() } }),
  relayEnvironment: "development",
  supabaseServiceRoleKey: "sb_secret_synthetic_backend_key_12345",
  supabaseUrl: "https://supabase.example.test",
};

describe("PKCE", () => {
  it("generates a code verifier with sufficient entropy", () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    // Base64url characters only.
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates different verifiers each call", () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });

  it("produces a SHA-256 S256 challenge", async () => {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    // SHA-256 digest is 32 bytes; base64url of 32 bytes is 43 characters.
    expect(challenge.length).toBe(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces a deterministic challenge for the same verifier", async () => {
    const verifier = generateCodeVerifier();
    const a = await generateCodeChallenge(verifier);
    const b = await generateCodeChallenge(verifier);
    expect(a).toBe(b);
  });

  it("produces different challenges for different verifiers", async () => {
    const a = await generateCodeChallenge(generateCodeVerifier());
    const b = await generateCodeChallenge(generateCodeVerifier());
    expect(a).not.toBe(b);
  });
});

describe("state", () => {
  it("generates a random state", () => {
    const state = generateState();
    expect(state.length).toBeGreaterThanOrEqual(43);
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates different states each call", () => {
    expect(generateState()).not.toBe(generateState());
  });
});

describe("OAuth cookie", () => {
  const userId = "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-29T10:00:00.000Z");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("round-trips state and verifier through authenticated encryption", async () => {
    const state = generateState();
    const verifier = generateCodeVerifier();
    const cookie = await buildOAuthCookie(state, verifier, userId, gmailEnv);

    // Extract raw value from Set-Cookie header string.
    const value = cookie.split(";")[0]!.split("=").slice(1).join("=");
    const request = new Request("https://localhost/api/connectors/gmail/callback", {
      headers: { cookie: `relay_gmail_oauth=${value}` },
    });

    const parsed = await parseOAuthCookie(request, gmailEnv);
    expect(parsed).not.toBeNull();
    expect(parsed!.state).toBe(state);
    expect(parsed!.codeVerifier).toBe(verifier);
    expect(parsed!.userId).toBe(userId);
  });

  it("returns null when cookie is missing", async () => {
    const request = new Request("https://localhost/api/connectors/gmail/callback");
    await expect(parseOAuthCookie(request, gmailEnv)).resolves.toBeNull();
  });

  it("returns null when cookie is malformed", async () => {
    const request = new Request("https://localhost/api/connectors/gmail/callback", {
      headers: { cookie: "relay_gmail_oauth=not-valid-base64!!" },
    });
    await expect(parseOAuthCookie(request, gmailEnv)).resolves.toBeNull();
  });

  it("rejects unsigned base64 cookie forgery", async () => {
    const state = generateState();
    const verifier = generateCodeVerifier();
    const payload = {
      state,
      codeVerifier: verifier,
      userId,
      expiresAt: Date.now() + 60_000,
    };
    const encoded = btoa(JSON.stringify(payload));
    const request = new Request("https://localhost/api/connectors/gmail/callback", {
      headers: { cookie: `relay_gmail_oauth=${encoded}` },
    });
    await expect(parseOAuthCookie(request, gmailEnv)).resolves.toBeNull();
  });

  it("returns null when encrypted cookie is expired", async () => {
    const cookie = await buildOAuthCookie(
      generateState(),
      generateCodeVerifier(),
      userId,
      gmailEnv,
    );
    const value = cookie.split(";")[0]!.split("=").slice(1).join("=");
    vi.advanceTimersByTime(601_000);
    const request = new Request("https://localhost/api/connectors/gmail/callback", {
      headers: { cookie: `relay_gmail_oauth=${value}` },
    });

    await expect(parseOAuthCookie(request, gmailEnv)).resolves.toBeNull();
  });

  it("sets HttpOnly, SameSite, Secure, and Path in cookie header", async () => {
    const cookie = await buildOAuthCookie(
      generateState(),
      generateCodeVerifier(),
      userId,
      gmailEnv,
    );
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/api/connectors/gmail");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
  });

  it("clear cookie sets Max-Age=0", () => {
    const cookie = clearOAuthCookie();
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
  });
});
