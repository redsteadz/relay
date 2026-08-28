import { describe, expect, it } from "vitest";

import {
  isValidSmsSenderAllowlist,
  normalizeSmsSender,
  parseSmsSenderAllowlist,
} from "./sms-capture";

describe("SMS sender allowlist", () => {
  it("normalizes phone formatting and case without merging distinct senders", () => {
    expect(normalizeSmsSender("+92 (300) 123-4567")).toBe("+923001234567");
    expect(parseSmsSenderAllowlist("ExampleBank, examplebank\n+92 300 1234567")).toEqual([
      "examplebank",
      "+923001234567",
    ]);
  });

  it("requires a bounded, nonempty exact sender allowlist", () => {
    expect(isValidSmsSenderAllowlist([])).toBe(false);
    expect(isValidSmsSenderAllowlist(["bank-alerts"])).toBe(true);
    expect(isValidSmsSenderAllowlist(["sender\u0000name"])).toBe(false);
    expect(isValidSmsSenderAllowlist(Array.from({ length: 51 }, (_, index) => `${index}`))).toBe(
      false,
    );
  });
});
