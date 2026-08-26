import { describe, expect, it, vi } from "vitest";

import { recordPipelineMetric } from "../src/metrics";

describe("recordPipelineMetric", () => {
  it("writes fixed metric identity with count and latency only", () => {
    const writeDataPoint = vi.fn();
    const dataset = { writeDataPoint } as unknown as AnalyticsEngineDataset;

    recordPipelineMetric(dataset, "source_item_persisted", 3, 12.5);

    expect(writeDataPoint).toHaveBeenCalledWith({
      doubles: [3, 12.5],
      indexes: ["source_item_persisted"],
    });
    expect(JSON.stringify(writeDataPoint.mock.calls)).not.toContain("user");
    expect(JSON.stringify(writeDataPoint.mock.calls)).not.toContain("ciphertext");
  });

  it("does not let telemetry failure change persistence behavior", () => {
    const dataset = {
      writeDataPoint: vi.fn(() => {
        throw new Error("synthetic telemetry failure");
      }),
    } as unknown as AnalyticsEngineDataset;

    expect(() => recordPipelineMetric(dataset, "source_item_failed", 1, 2)).not.toThrow();
  });
});
