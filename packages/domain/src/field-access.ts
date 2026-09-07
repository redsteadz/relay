/**
 * Dotted-path field access shared by the deterministic evaluator and semantic minimization.
 *
 * Both must agree on what "the subject field" resolves to on an item: a plan that deterministically
 * passes on `attributes.merchant` and then discloses `attributes.merchant` has to read the same
 * value both times, or the disclosure record would describe a field the evaluation never saw.
 *
 * Supports both nested envelope shapes (e.g. `item.source.kind`) and flattened server persistence
 * row shapes (e.g. `item.source` string or `item.application_id`).
 */
export function readFilterField(item: Record<string, unknown>, path: string): unknown {
  if (typeof item !== "object" || item === null) return undefined;

  // 1. Direct standard nested path traversal
  const nestedValue = path.split(".").reduce<unknown>((current, segment) => {
    if (typeof current !== "object" || current === null || !(segment in current)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, item);

  if (nestedValue !== undefined && nestedValue !== null) {
    return nestedValue;
  }

  // 2. Special fallback mappings for server-side persistence records
  if (path === "source.kind") {
    if (typeof item.source === "string" && item.source.length > 0) return item.source;
    if (typeof item.source_kind === "string" && item.source_kind.length > 0) return item.source_kind;
    if (typeof item.sourceKind === "string" && item.sourceKind.length > 0) return item.sourceKind;
  }

  if (path === "source.applicationId") {
    if (typeof item.application_id === "string" && item.application_id.length > 0) return item.application_id;
    if (typeof item.applicationId === "string" && item.applicationId.length > 0) return item.applicationId;
    if (typeof item.source_application_id === "string" && item.source_application_id.length > 0) return item.source_application_id;
  }

  if (path.startsWith("attributes.")) {
    const subfield = path.slice("attributes.".length);
    if (typeof item.attributes === "string" && item.attributes.length > 0) {
      try {
        const parsed = JSON.parse(item.attributes) as unknown;
        if (typeof parsed === "object" && parsed !== null && subfield in parsed) {
          return (parsed as Record<string, unknown>)[subfield];
        }
      } catch {
        // Ignored if invalid JSON string
      }
    }
    if (subfield in item && item[subfield] !== undefined && item[subfield] !== null) {
      return item[subfield];
    }
  }

  // 3. Fallbacks for scalar fields
  if (path in item) return item[path];
  const snakePath = path.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  if (snakePath in item) return item[snakePath];

  return undefined;
}
