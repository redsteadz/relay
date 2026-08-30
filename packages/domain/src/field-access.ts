/**
 * Dotted-path field access shared by the deterministic evaluator and semantic minimization.
 *
 * Both must agree on what "the subject field" resolves to on an item: a plan that deterministically
 * passes on `attributes.merchant` and then discloses `attributes.merchant` has to read the same
 * value both times, or the disclosure record would describe a field the evaluation never saw.
 */
export function readFilterField(item: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (typeof current !== "object" || current === null || !(segment in current)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, item);
}
