import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: () => Promise.resolve(null), setItem: () => Promise.resolve() },
}));
vi.mock("../observability", () => ({ logMobileError: vi.fn(), runInBackground: vi.fn() }));
import { demoDatabase } from "./store";
import {
  commandSmartDemo,
  connectSmartDemo,
  runSmartDemoScenario,
  smartDemoOverview,
} from "./smart-automations";
describe("Smart Automations synthetic end-to-end flow", () => {
  beforeEach(async () => {
    await demoDatabase.ready();
    demoDatabase.replace("smart_automations", []);
  });
  it("processes a transaction, deduplicates another source, and stops after pause", async () => {
    expect((await runSmartDemoScenario("transaction")).receipts[0]?.status).toBe("succeeded");
    expect((await runSmartDemoScenario("transaction")).receipts[0]?.status).toBe("duplicate");
    await commandSmartDemo({ type: "pause", paused: true });
    expect((await runSmartDemoScenario("task")).receipts[0]?.reason).toBe("paused");
  });
  it("proposes a meeting and records explicit approval", async () => {
    const state = await runSmartDemoScenario("meeting");
    const receipt = state.receipts[0];
    expect(receipt.status).toBe("awaiting-approval");
    expect(
      (await commandSmartDemo({ type: "approve", receiptId: receipt.id })).receipts[0]?.status,
    ).toBe("succeeded");
    await expect(commandSmartDemo({ type: "approve", receiptId: receipt.id })).rejects.toThrow();
  });
  it("disconnect and permission failure prevent execution until reconnect", async () => {
    expect((await runSmartDemoScenario("permission")).receipts[0]?.reason).toBe(
      "permission-required",
    );
    await connectSmartDemo("google-sheets");
    await commandSmartDemo({ type: "disconnect", service: "google-sheets" });
    expect((await runSmartDemoScenario("transaction")).receipts[0]?.reason).toBe("disconnected");
  });
  it("editing a rule invalidates outstanding approval", async () => {
    const state = await runSmartDemoScenario("task");
    const rule = state.rules.find((item) => item.service === "google-tasks")!;
    await commandSmartDemo({ type: "save-rule", rule: { ...rule, approval: "automatic" } });
    expect((await smartDemoOverview()).receipts[0]?.status).toBe("cancelled");
  });
  it("disabling one service blocks its effects without disconnecting other services", async () => {
    await commandSmartDemo({ type: "service", service: "google-sheets", enabled: false });
    expect((await runSmartDemoScenario("transaction")).receipts[0]?.status).toBe("blocked");
    const state = await runSmartDemoScenario("meeting");
    expect(state.receipts[0]?.status).toBe("awaiting-approval");
    expect(state.services.find((service) => service.service === "google-sheets")?.connected).toBe(
      true,
    );
  });
});
