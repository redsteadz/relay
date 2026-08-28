import { describe, expect, it } from "vitest";

import { isValidNotificationAllowlist, parseNotificationAllowlist } from "./notification-capture";

describe("notification capture allowlist", () => {
  it("normalizes comma and whitespace separated package names without duplicates", () => {
    expect(
      parseNotificationAllowlist("com.example.bank, com.example.chat\ncom.example.bank"),
    ).toEqual(["com.example.bank", "com.example.chat"]);
  });

  it("requires at least one valid Android package name", () => {
    expect(isValidNotificationAllowlist([])).toBe(false);
    expect(isValidNotificationAllowlist(["Example Bank"])).toBe(false);
    expect(isValidNotificationAllowlist(["com.example.bank"])).toBe(true);
  });
});
