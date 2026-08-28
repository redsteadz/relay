import { describe, expect, it } from "vitest";

import {
  filterNotificationAppChoices,
  isValidNotificationAllowlist,
  normalizeNotificationAppChoices,
  parseNotificationAllowlist,
  toggleNotificationAppSelection,
} from "./notification-capture";

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

  it("deduplicates app choices by exact package and sorts by label then package", () => {
    expect(
      normalizeNotificationAppChoices([
        { label: "  Zebra  ", packageName: "com.example.zebra" },
        { label: "Alpha", packageName: "com.example.two" },
        { label: "Alpha", packageName: "com.example.one" },
        { label: "Duplicate", packageName: "com.example.zebra" },
      ]),
    ).toEqual([
      { label: "Alpha", packageName: "com.example.one" },
      { label: "Alpha", packageName: "com.example.two" },
      { label: "Zebra", packageName: "com.example.zebra" },
    ]);
  });

  it("searches app labels and package names without changing package identity", () => {
    const apps = [
      { label: "Example Bank", packageName: "com.example.bank" },
      { label: "Messages", packageName: "com.android.messages" },
    ];

    expect(filterNotificationAppChoices(apps, "BANK")).toEqual([apps[0]]);
    expect(filterNotificationAppChoices(apps, "android.message")).toEqual([apps[1]]);
    expect(
      toggleNotificationAppSelection(
        ["com.example.bank", "com.example.bank.beta"],
        "com.example.bank.beta",
      ),
    ).toEqual(["com.example.bank"]);
  });
});
