import { ingressEnvelopeSchema } from "@relay/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: (key: string) => Promise.resolve(storage.get(key) ?? null),
    setItem: (key: string, value: string) => {
      storage.set(key, value);
      return Promise.resolve();
    },
  },
}));

vi.mock("@/lib/observability", () => ({
  logMobileError: vi.fn(),
  runInBackground: (operation: Promise<unknown>) => {
    void operation.catch(() => undefined);
  },
}));

import {
  demoDeviceIngress,
  demoPostNotification,
  NOTIFICATION_FLAG_GROUP_SUMMARY,
  type DemoPostedNotification,
} from "./device-ingress";
import { demoDatabase } from "./store";

const TENANT = "00000000-0000-4000-8000-00000000a001";
const OTHER_TENANT = "00000000-0000-4000-8000-00000000a002";
const NOW = Date.parse("2026-09-30T12:00:00.000Z");

function posted(overrides: Partial<DemoPostedNotification> = {}): DemoPostedNotification {
  return {
    key: "0|com.example.bank|7|null|10001",
    packageName: "com.example.bank",
    postedAt: NOW - 60_000,
    text: "Synthetic balance reminder",
    title: "Synthetic bank",
    ...overrides,
  };
}

beforeEach(async () => {
  await demoDatabase.reset();
  await demoDeviceIngress.configureNotificationCapture(TENANT, ["com.example.bank"], false);
});

describe("demo listener decisions", () => {
  it("captures an allowlisted notification", async () => {
    expect((await demoPostNotification(posted(), NOW)).decision).toBe("capture");
  });

  it("applies the service gates before the policy", async () => {
    await demoDeviceIngress.configureNotificationCapture(TENANT, ["com.example.bank"], true);
    expect((await demoPostNotification(posted(), NOW)).decision).toBe("paused");

    demoDatabase.rows("capture_settings")[0].notification_listener = false;
    expect((await demoPostNotification(posted(), NOW)).decision).toBe("listener-disabled");
  });

  it("captures nothing until a tenant has configured capture", async () => {
    demoDatabase.replace("capture_settings", []);
    expect((await demoPostNotification(posted(), NOW)).decision).toBe("not-configured");
  });

  it("refuses Relay's own notifications, group summaries and apps not allowed", async () => {
    expect(
      (await demoPostNotification(posted({ packageName: "com.redsteadz.relay" }), NOW)).decision,
    ).toBe("own-notification");
    expect(
      (await demoPostNotification(posted({ flags: NOTIFICATION_FLAG_GROUP_SUMMARY | 0x10 }), NOW))
        .decision,
    ).toBe("group-summary");
    expect(
      (await demoPostNotification(posted({ packageName: "com.example.chat" }), NOW)).decision,
    ).toBe("package-not-allowed");
    expect(await demoDeviceIngress.getReadyCaptures(TENANT, NOW)).toHaveLength(0);
  });
});

describe("demo notification envelope", () => {
  it("has the shape the native factory builds", async () => {
    const { envelopeId } = await demoPostNotification(
      posted({ messagingSender: "  Synthetic Teller  " }),
      NOW,
    );
    const [queued] = await demoDeviceIngress.getReadyCaptures(TENANT, NOW);
    const envelope = ingressEnvelopeSchema.parse(queued?.envelope);

    expect(envelope.id).toBe(envelopeId);
    expect(envelope.source).toEqual({
      applicationId: "com.example.bank",
      externalId: envelopeId,
      kind: "notification",
    });
    expect(envelope.attributes).toEqual({ sender: "Synthetic Teller" });
    expect(envelope.sender).toBeUndefined();
    expect(envelope.occurredAt).toBe(new Date(NOW - 60_000).toISOString());
    expect(envelope.capturedAt).toBe(new Date(NOW).toISOString());
  });

  it("leaves out blank text but keeps it in the identity", async () => {
    const blank = await demoPostNotification(posted({ title: "   " }), NOW);
    const absent = await demoPostNotification(posted({ title: undefined }), NOW);
    const [first] = await demoDeviceIngress.getReadyCaptures(TENANT, NOW);
    expect(first?.envelope.subject).toBeUndefined();
    expect(blank.envelopeId).not.toBe(absent.envelopeId);
  });

  it("keeps one id for a redelivery and mints another for an edit", async () => {
    const first = await demoPostNotification(posted(), NOW);
    const redelivered = await demoPostNotification(posted({ postedAt: NOW - 1_000 }), NOW + 5_000);
    const edited = await demoPostNotification(posted({ text: "Synthetic edited text" }), NOW);

    expect(redelivered.envelopeId).toBe(first.envelopeId);
    expect(edited.envelopeId).not.toBe(first.envelopeId);
    const queued = await demoDeviceIngress.getReadyCaptures(TENANT, NOW + 5_000);
    expect(queued.map((entry) => entry.envelope.id)).toEqual([first.envelopeId, edited.envelopeId]);
    // The redelivery kept the original row rather than replacing it.
    expect(queued[0]?.envelope.capturedAt).toBe(new Date(NOW).toISOString());
  });

  it("keeps the device's own copy of what it said", async () => {
    const { envelopeId } = await demoPostNotification(posted(), NOW);
    const content = await demoDeviceIngress.getRetainedCaptureContent(TENANT, [envelopeId!]);
    expect(content[envelopeId!]).toEqual({
      body: "Synthetic balance reminder",
      subject: "Synthetic bank",
    });
  });
});

describe("demo capture queue", () => {
  it("offers pending captures oldest first and only to their tenant", async () => {
    const later = await demoPostNotification(posted({ key: "later" }), NOW + 1_000);
    const earlier = await demoPostNotification(posted({ key: "earlier" }), NOW);

    const ready = await demoDeviceIngress.getReadyCaptures(TENANT, NOW + 1_000);
    expect(ready.map((entry) => entry.envelope.id)).toEqual([earlier.envelopeId, later.envelopeId]);
    expect(ready.every((entry) => entry.attempts === 0)).toBe(true);
    expect(await demoDeviceIngress.getReadyCaptures(OTHER_TENANT, NOW + 1_000)).toEqual([]);
  });

  it("removes a capture only when it is acknowledged", async () => {
    const { envelopeId } = await demoPostNotification(posted(), NOW);
    await demoDeviceIngress.acknowledgeCapture(OTHER_TENANT, envelopeId!);
    expect(await demoDeviceIngress.getReadyCaptures(TENANT, NOW)).toHaveLength(1);

    await demoDeviceIngress.acknowledgeCapture(TENANT, envelopeId!);
    expect(await demoDeviceIngress.getReadyCaptures(TENANT, NOW)).toHaveLength(0);
  });

  it("counts attempts and stops offering a terminal failure", async () => {
    const { envelopeId } = await demoPostNotification(posted(), NOW);
    await demoDeviceIngress.failCapture(TENANT, envelopeId!, false);
    expect((await demoDeviceIngress.getReadyCaptures(TENANT, NOW))[0]?.attempts).toBe(1);

    await demoDeviceIngress.failCapture(TENANT, envelopeId!, true);
    expect(await demoDeviceIngress.getReadyCaptures(TENANT, NOW)).toHaveLength(0);
  });

  it("stops offering a capture seven days after it was taken", async () => {
    await demoPostNotification(posted(), NOW);
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(await demoDeviceIngress.getReadyCaptures(TENANT, NOW + sevenDays - 1)).toHaveLength(1);
    expect(await demoDeviceIngress.getReadyCaptures(TENANT, NOW + sevenDays)).toHaveLength(0);
  });

  it("clears only the signed-out tenant's captures", async () => {
    await demoPostNotification(posted(), NOW);
    await demoDeviceIngress.clearCaptureQueue(OTHER_TENANT);
    expect(await demoDeviceIngress.getReadyCaptures(TENANT, NOW)).toHaveLength(1);
    await demoDeviceIngress.clearCaptureQueue(TENANT);
    expect(await demoDeviceIngress.getReadyCaptures(TENANT, NOW)).toHaveLength(0);
  });
});
