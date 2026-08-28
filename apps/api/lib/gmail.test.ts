import { describe, expect, it } from "vitest";

import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
  buildOAuthCookie,
  parseOAuthCookie,
  clearOAuthCookie,
} from "./gmail";

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
  const userId = "00000000-0000-0000-0000-000000000001";

  it("round-trips state and verifier through cookie", () => {
    const state = generateState();
    const verifier = generateCodeVerifier();
    const cookie = buildOAuthCookie(state, verifier, userId);

    // Extract raw value from Set-Cookie header string.
    const value = cookie.split(";")[0]!.split("=").slice(1).join("=");
    const request = new Request("https://localhost/api/connectors/gmail/callback", {
      headers: { cookie: `relay_gmail_oauth=${value}` },
    });

    const parsed = parseOAuthCookie(request);
    expect(parsed).not.toBeNull();
    expect(parsed!.state).toBe(state);
    expect(parsed!.codeVerifier).toBe(verifier);
    expect(parsed!.userId).toBe(userId);
  });

  it("returns null when cookie is missing", () => {
    const request = new Request("https://localhost/api/connectors/gmail/callback");
    expect(parseOAuthCookie(request)).toBeNull();
  });

  it("returns null when cookie is malformed", () => {
    const request = new Request("https://localhost/api/connectors/gmail/callback", {
      headers: { cookie: "relay_gmail_oauth=not-valid-base64!!" },
    });
    expect(parseOAuthCookie(request)).toBeNull();
  });

  it("returns null when cookie is expired", () => {
    const state = generateState();
    const verifier = generateCodeVerifier();
    const payload = {
      state,
      codeVerifier: verifier,
      userId,
      expiresAt: Date.now() - 1000,
    };
    const encoded = btoa(JSON.stringify(payload));
    const request = new Request("https://localhost/api/connectors/gmail/callback", {
      headers: { cookie: `relay_gmail_oauth=${encoded}` },
    });
    expect(parseOAuthCookie(request)).toBeNull();
  });

  it("sets HttpOnly and Path in cookie header", () => {
    const cookie = buildOAuthCookie(generateState(), generateCodeVerifier(), userId);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/api/connectors/gmail");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("clear cookie sets Max-Age=0", () => {
    const cookie = clearOAuthCookie();
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
  });
});
