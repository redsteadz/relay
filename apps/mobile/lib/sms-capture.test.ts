import { afterEach, describe, expect, it, vi } from "vitest";

import {
  enableSmsCapture,
  isValidSmsSenderAllowlist,
  normalizeSmsSender,
  parseSmsSenderAllowlist,
  saveSmsSenderAllowlist,
} from "./sms-capture";

afterEach(() => vi.restoreAllMocks());

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

describe("SMS sender allowlist saving", () => {
  it("synchronizes existing inbox rows after saving an active allowlist", async () => {
    const calls: string[] = [];
    const result = await saveSmsSenderAllowlist({
      configure: (paused) => {
        calls.push(`configure:${paused.toString()}`);
        return Promise.resolve();
      },
      paused: false,
      syncInbox: () => {
        calls.push("sync");
        return Promise.resolve(2);
      },
    });

    expect(result).toEqual({ captured: 2, inboxSync: "succeeded" });
    expect(calls).toEqual(["configure:false", "sync"]);
  });

  it("reports an active inbox sync failure after saving the allowlist", async () => {
    const calls: string[] = [];
    const loggedError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await saveSmsSenderAllowlist({
      configure: (paused) => {
        calls.push(`configure:${paused.toString()}`);
        return Promise.resolve();
      },
      paused: false,
      syncInbox: () => {
        calls.push("sync");
        return Promise.reject(new Error("synthetic sync failure"));
      },
    });

    expect(result).toEqual({ captured: 0, inboxSync: "failed" });
    expect(calls).toEqual(["configure:false", "sync"]);
    expect(loggedError).toHaveBeenCalledOnce();
    expect(JSON.parse(loggedError.mock.calls[0]?.[0] as string)).toMatchObject({
      event: "capture.sms_inbox_sync_failed",
      error: { code: "SMS_INBOX_SYNC_FAILED" },
      level: "error",
    });
    expect(loggedError.mock.calls[0]?.[0]).not.toContain("synthetic sync failure");
  });

  it("saves a paused allowlist without reading the inbox", async () => {
    const calls: string[] = [];
    const result = await saveSmsSenderAllowlist({
      configure: (paused) => {
        calls.push(`configure:${paused.toString()}`);
        return Promise.resolve();
      },
      paused: true,
      syncInbox: () => {
        calls.push("sync");
        return Promise.resolve(1);
      },
    });

    expect(result).toEqual({ captured: 0, inboxSync: "skipped" });
    expect(calls).toEqual(["configure:true"]);
  });

  it("rejects as a save failure when configuration fails", async () => {
    const calls: string[] = [];
    const save = saveSmsSenderAllowlist({
      configure: (paused) => {
        calls.push(`configure:${paused.toString()}`);
        return Promise.reject(new Error("synthetic configuration failure"));
      },
      paused: false,
      syncInbox: () => {
        calls.push("sync");
        return Promise.resolve(1);
      },
    });

    await expect(save).rejects.toThrow("synthetic configuration failure");
    expect(calls).toEqual(["configure:false"]);
  });
});
