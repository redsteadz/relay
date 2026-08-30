import { describe, expect, it } from "vitest";

import {
  enableSmsCapture,
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

describe("SMS enablement", () => {
  it("persists paused before permission and unpauses before synchronizing", async () => {
    const calls: string[] = [];
    const result = await enableSmsCapture({
      configure: (paused) => {
        calls.push(`configure:${paused.toString()}`);
        return Promise.resolve();
      },
      permissionGranted: false,
      requestPermissions: () => {
        calls.push("permissions");
        return Promise.resolve(true);
      },
      syncInbox: () => {
        calls.push("sync");
        return Promise.resolve(3);
      },
    });

    expect(result).toEqual({ captured: 3, granted: true });
    expect(calls).toEqual(["configure:true", "permissions", "configure:false", "sync"]);
  });

  it("remains paused and does not synchronize when permission is denied", async () => {
    const calls: string[] = [];
    const result = await enableSmsCapture({
      configure: (paused) => {
        calls.push(`configure:${paused.toString()}`);
        return Promise.resolve();
      },
      permissionGranted: false,
      requestPermissions: () => Promise.resolve(false),
      syncInbox: () => {
        calls.push("sync");
        return Promise.resolve(1);
      },
    });

    expect(result).toEqual({ captured: 0, granted: false });
    expect(calls).toEqual(["configure:true"]);
  });
});
