export type PipelineMetricName =
  "retention_purge" | "source_item_duplicate" | "source_item_failed" | "source_item_persisted";

export function recordPipelineMetric(
  dataset: AnalyticsEngineDataset | undefined,
  name: PipelineMetricName,
  count: number,
  latencyMs: number,
): void {
  if (dataset === undefined) return;
  try {
    dataset.writeDataPoint({
      doubles: [count, Math.max(0, latencyMs)],
      indexes: [name],
    });
  } catch {
    // Telemetry must not change persistence behavior.
  }
}
