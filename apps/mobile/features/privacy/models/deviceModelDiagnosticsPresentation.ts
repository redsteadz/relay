/**
 * What the device model journal says, in sentences.
 *
 * Pure, so the words a reader is given for "why did nothing happen" can be tested without rendering.
 * Every sentence names the gate that stopped a pass and, where there is one, the thing a reader can
 * change -- because each outcome in the journal is a state the reader controls rather than a fault
 * Relay could have avoided.
 */

import type { DeviceCapabilities } from "@/modules/relay-device-ingress";
import {
  deviceSemanticRefusalExplanation,
  deviceSemanticStatusExplanation,
} from "@/lib/device-semantic";
import type { DeviceModelAttempt, DeviceModelPassReport } from "@/lib/device-semantic-diagnostics";
import type { StoredDeviceDisclosure } from "@/lib/local-store";
import type { StatusPillTone } from "@/components/ui";

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : pluralForm}`;
}

/** Milliseconds as a reader reads them: whole seconds past one, otherwise milliseconds. */
export function formatDuration(durationMs: number): string {
  if (durationMs >= 1_000) return `${(durationMs / 1_000).toFixed(1)} s`;
  return `${String(Math.round(durationMs))} ms`;
}

/** How long ago, in the coarsest unit that is still honest. */
export function formatAgo(isoInstant: string, now: number): string {
  const then = Date.parse(isoInstant);
  if (!Number.isFinite(then)) return "at an unknown time";
  const seconds = Math.max(0, Math.round((now - then) / 1_000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${plural(minutes, "minute")} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${plural(hours, "hour")} ago`;
  return `${plural(Math.round(hours / 24), "day")} ago`;
}

const KIND_LABELS: Record<DeviceModelPassReport["kind"], string> = {
  filing: "Filing pass",
  probe: "Test question",
  quiet: "Quiet pass",
};

const TRIGGER_LABELS: Record<DeviceModelPassReport["trigger"], string> = {
  background: "in the background",
  foreground: "on open",
  manual: "by you",
};

export function passTitle(report: DeviceModelPassReport): string {
  return `${KIND_LABELS[report.kind]}, started ${TRIGGER_LABELS[report.trigger]}`;
}

/**
 * Why the pass stopped where it did, and what to do about it.
 *
 * `shade-unreadable` is the one most worth getting right. A reader whose dev client was reinstalled
 * has notification access granted and no listener bound, every candidate stays pending, no request
 * is ever made, and nothing on the phone says so -- it looks exactly like a model that is slow.
 */
export function passOutcomeExplanation(report: DeviceModelPassReport): string {
  const { counts } = report;
  switch (report.outcome) {
    case "evaluated": {
      if (counts.evaluated === 0) {
        const reasons: string[] = [];
        if (counts.skippedNoContent > 0) {
          reasons.push(
            `${plural(counts.skippedNoContent, "notification")} whose retained text has expired`,
          );
        }
        if (counts.skippedRuleGone > 0) {
          reasons.push(
            `${plural(counts.skippedRuleGone, "notification")} waiting on a rule that has since been edited or paused`,
          );
        }
        return reasons.length === 0
          ? "Nothing needed asking."
          : `Nothing was asked: ${reasons.join(", and ")}. Those will not be decided; they clear from the list as they expire.`;
      }
      const parts = [`Asked your model ${plural(counts.evaluated, "time")}`];
      if (counts.acted > 0)
        parts.push(`${plural(counts.acted, "notification")} put away or cleared`);
      if (counts.undecided > 0) {
        parts.push(`${String(counts.undecided)} got no usable answer and will be asked again`);
      }
      if (counts.skippedNoContent > 0) {
        parts.push(
          `${String(counts.skippedNoContent)} skipped because the retained text had expired`,
        );
      }
      if (counts.skippedRuleGone > 0) {
        parts.push(`${String(counts.skippedRuleGone)} skipped because the rule has since changed`);
      }
      return `${parts.join(". ")}.`;
    }
    case "failed":
      return "The pass failed before it could ask anything. The error is in the app log.";
    case "no-candidates":
      return "Nothing was waiting on a model.";
    case "none-posted":
      return `${plural(counts.candidates, "notification was", "notifications were")} waiting, but none is still on screen, so they were closed as already gone and nothing was asked.`;
    case "not-configured":
      return `${plural(counts.candidates, "notification is", "notifications are")} waiting, but no model is set up on this phone, so nothing was asked.`;
    case "shade-unreadable":
      return `${plural(counts.candidates, "notification is", "notifications are")} waiting, but Relay's notification listener is not connected right now, so your phone cannot read what is on screen and nothing was asked. This happens after a reinstall: turn Relay's notification access off and on again in Android settings, or restart the phone.`;
    case "store-unsupported":
      return "This platform has no local store, so a model cannot be asked here.";
  }
}

export function passTone(report: DeviceModelPassReport): StatusPillTone {
  if (report.outcome === "failed" || report.outcome === "shade-unreadable") return "warning";
  if (report.outcome === "not-configured") return "warning";
  if (report.outcome === "evaluated") {
    return report.attempts.some((attempt) => attempt.refusal !== undefined) ? "warning" : "success";
  }
  return "muted";
}

export function passPillLabel(report: DeviceModelPassReport): string {
  switch (report.outcome) {
    case "evaluated":
      return report.counts.evaluated === 0
        ? "Nothing asked"
        : report.attempts.some((attempt) => attempt.refusal !== undefined)
          ? "Asked, refused"
          : "Asked";
    case "failed":
      return "Failed";
    case "no-candidates":
      return "Nothing waiting";
    case "none-posted":
      return "All gone";
    case "not-configured":
      return "No model";
    case "shade-unreadable":
      return "Listener off";
    case "store-unsupported":
      return "Unsupported";
  }
}

const PROTOCOL_LABELS = { openai: "chat", "system-one": "decision engine" } as const;

/** One request as a line: where it went, how long it took, and how it ended. */
export function attemptLine(attempt: DeviceModelAttempt): string {
  const where =
    attempt.host === undefined
      ? "Nothing was sent"
      : `Sent to ${attempt.model ?? "the model"} at ${attempt.host}${
          attempt.protocol === undefined ? "" : ` as a ${PROTOCOL_LABELS[attempt.protocol]}`
        }`;
  const status = attempt.statusCode === undefined ? "" : ` · HTTP ${String(attempt.statusCode)}`;
  const ended =
    attempt.refusal === undefined
      ? attempt.decision === "undecided"
        ? "answered, but not confidently enough"
        : `answered ${attempt.decision === "match" ? "yes" : "no"}`
      : attempt.refusal;
  return `${where} · ${formatDuration(attempt.durationMs)}${status} · ${ended}`;
}

/** The explanation for a refused attempt, with what the HTTP status adds. */
export function attemptExplanation(attempt: DeviceModelAttempt): string | undefined {
  if (attempt.refusal === undefined) return undefined;
  const base = deviceSemanticRefusalExplanation(attempt.refusal);
  const status =
    attempt.statusCode === undefined
      ? undefined
      : deviceSemanticStatusExplanation(attempt.statusCode);
  return status === undefined ? base : `${base} ${status}`;
}

/** A device disclosure row as one line. The table is metadata only, so this is too. */
export function disclosureLine(row: StoredDeviceDisclosure): string {
  const where =
    row.disclosed === 1
      ? `${row.model.length === 0 ? "the model" : row.model} at ${row.endpoint_host ?? "an unknown host"}`
      : "nothing sent";
  const ended =
    row.failure_reason ?? (row.decision === "undecided" ? "not confident" : row.decision);
  return `${where} · ${ended}`;
}

/**
 * The live state of the thing most likely to be wrong, in one line.
 *
 * `undefined` for the bound flag means the native build predates it, which is itself worth saying:
 * a reader on an old build is told the phone cannot tell, not that the listener is off.
 */
export function listenerStateLine(capabilities: DeviceCapabilities | undefined): {
  detail: string;
  tone: StatusPillTone;
} {
  if (capabilities === undefined) {
    return { detail: "Reading the listener state…", tone: "muted" };
  }
  if (!capabilities.notificationListener) {
    return {
      detail: "Notification access is not granted, so no notification is captured or quieted.",
      tone: "warning",
    };
  }
  if (capabilities.notificationListenerBound === undefined) {
    return {
      detail:
        "Notification access is granted. This build cannot tell whether the listener is connected; rebuild the app to see it.",
      tone: "muted",
    };
  }
  if (!capabilities.notificationListenerBound) {
    return {
      detail:
        "Notification access is granted but the listener is not connected, so nothing waiting can be asked about. Turn notification access off and on again, or restart the phone.",
      tone: "warning",
    };
  }
  const pending = capabilities.notificationSilencePendingCount ?? 0;
  return {
    detail:
      pending === 0
        ? "Listener connected. Nothing is waiting on a model."
        : `Listener connected. ${plural(pending, "notification is", "notifications are")} waiting on a model.`,
    tone: "success",
  };
}
