import { StatusPill } from "@/components/ui";

import type { SourceStatus } from "../../models/capturePresentation";

/**
 * A source's state.
 *
 * The icon that used to sit beside the word is gone: the tone already carries the distinction, and
 * a second encoding of the same fact competed with the source's own glyph for the same glance.
 */
export function SourceStatusLabel({ status }: { status: SourceStatus }) {
  return <StatusPill label={status.label} tone={status.tone} />;
}
