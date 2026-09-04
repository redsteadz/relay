import { createLogger, normalizeError } from "@relay/observability";

export type PipelineMetricName =
  | "dead_letter_parking_failed"
  | "gmail_maintenance_failed"
  | "kek_rotation_failed"
  | "retention_purge_failed"
  | "retention_purge"
  | "source_item_classified"
  | "source_item_classification_failed"
  | "source_item_duplicate"
  | "source_item_failed"
  | "source_item_persisted";

export function recordPipelineMetric(
  dataset: AnalyticsEngineDataset | undefined,
  name: PipelineMetricName,
  count: number,
  latencyMs: number,
  debugSpecification?: string,
): void {
  if (dataset === undefined) return;
  try {
    dataset.writeDataPoint({
      doubles: [count, Math.max(0, latencyMs)],
      indexes: [name],
    });
  } catch (error: unknown) {
    createLogger({ debugSpecification, namespace: "relay:pipeline" }).error(
      "telemetry.metric_write_failed",
      normalizeError(error, {
        code: "PIPELINE_METRIC_WRITE_FAILED",
        integration: "cloudflare-analytics-engine",
        operation: "writeDataPoint",
      }),
      { metric: name },
    );
  }
}
