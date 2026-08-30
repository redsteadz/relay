import {
  exactDecimalStringSchema,
  filterCompilationSchema,
  filterIntentSchema,
  filterPredicateSchema,
  type FilterCompilation,
  type FilterExpression,
  type FilterField,
  type FilterPredicate,
  type FilterSupportedPredicate,
  type FilterUnsupportedClause,
} from "@relay/contracts";

type FilterOperator = FilterSupportedPredicate["operators"][number];

export type FilterCategoryDescriptor = {
  name: string;
  slug: string;
};

export const SUPPORTED_FILTER_PREDICATES: FilterSupportedPredicate[] = [
  { field: "source.kind", operators: ["equals", "in"] },
  {
    field: "source.applicationId",
    operators: ["equals", "contains", "starts-with", "exists", "in"],
  },
  { field: "sender", operators: ["equals", "contains", "starts-with", "exists", "in"] },
  { field: "subject", operators: ["equals", "contains", "starts-with", "exists", "in"] },
  { field: "body", operators: ["equals", "contains", "starts-with", "exists", "in"] },
  { field: "category", operators: ["equals", "in"] },
  { field: "attributes.currency", operators: ["equals", "exists", "in"] },
  {
    field: "attributes.merchant",
    operators: ["equals", "contains", "starts-with", "exists", "in"],
  },
  { field: "attributes.amount", operators: ["equals", "exists", "in"] },
];

const fieldAliases: Record<string, FilterField> = {
  "source kind": "source.kind",
  source: "source.kind",
  application: "source.applicationId",
  app: "source.applicationId",
  sender: "sender",
  subject: "subject",
  body: "body",
  message: "body",
  text: "body",
  category: "category",
  currency: "attributes.currency",
  merchant: "attributes.merchant",
  amount: "attributes.amount",
};

const sourceAliases: Record<string, string> = {
  gmail: "gmail",
  sms: "sms",
  email: "email",
  emails: "email",
  notification: "notification",
  notifications: "notification",
};

const actionIntentPattern =
  /\b(?:send|forward|post|delete|dismiss|create|call|invoke|upload|use|provider|webhook|endpoint|credential|operation)\b/iu;

function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function splitClauses(intent: string): string[] {
  const clauses: string[] = [];
  let quote: '"' | "'" | undefined;
  let start = 0;
  let index = 0;
  while (index < intent.length) {
    const character = intent[index];
    if (quote !== undefined && character === quote && intent[index - 1] !== "\\") {
      quote = undefined;
      index += 1;
      continue;
    }
    if (
      quote === undefined &&
      (character === '"' || character === "'") &&
      (index === 0 || /[\s,(]/u.test(intent[index - 1] ?? "")) &&
      intent.indexOf(character, index + 1) !== -1
    ) {
      quote = character;
      index += 1;
      continue;
    }
    if (quote === undefined) {
      const separator = /^\s+and\s+/iu.exec(intent.slice(index));
      if (separator !== null) {
        clauses.push(intent.slice(start, index).trim());
        index += separator[0].length;
        start = index;
        continue;
      }
    }
    index += 1;
  }
  clauses.push(intent.slice(start).trim());
  return clauses.filter((clause) => clause.length > 0);
}

function readValue(raw: string): string | undefined {
  const value = raw.trim();
  const first = value[0];
  const last = value[value.length - 1];
  const startsQuoted = first === '"' || first === "'";
  const endsQuoted = last === '"' || last === "'";
  if (startsQuoted || endsQuoted) {
    if (value.length < 2 || first !== last) return undefined;
    const unquoted = value.slice(1, -1).trim();
    return unquoted.length > 0 ? unquoted : undefined;
  }
  return value.length > 0 ? value : undefined;
}

function supports(field: FilterField, operator: FilterOperator): boolean {
  return (
    SUPPORTED_FILTER_PREDICATES.find((predicate) => predicate.field === field)?.operators.includes(
      operator,
    ) === true
  );
}

function canonicalValue(
  field: FilterField,
  value: string,
  categories: readonly FilterCategoryDescriptor[],
): string | undefined {
  if (value.length > 1024) return undefined;
  if (field === "source.kind") return sourceAliases[normalizeText(value)];
  if (field === "category") {
    const normalized = normalizeText(value);
    return categories.find(
      (category) =>
        normalizeText(category.slug) === normalized || normalizeText(category.name) === normalized,
    )?.slug;
  }
  if (field === "attributes.currency") {
    const currency = value.toUpperCase();
    return /^[A-Z]{3}$/u.test(currency) ? currency : undefined;
  }
  if (field === "attributes.amount") {
    return exactDecimalStringSchema.safeParse(value).success ? value : undefined;
  }
  return value;
}

type ParsedClause =
  { predicate: FilterPredicate } | { unsupported: FilterUnsupportedClause; field?: FilterField };

function unsupported(
  text: string,
  reason: FilterUnsupportedClause["reason"],
  field?: FilterField,
): ParsedClause {
  return {
    unsupported: { text: text.slice(0, 1000), reason },
    ...(field === undefined ? {} : { field }),
  };
}

function parseClause(
  clause: string,
  categories: readonly FilterCategoryDescriptor[],
): ParsedClause {
  const sourceMatch = /^from\s+(gmail|sms|emails?|notifications?)$/iu.exec(clause);
  if (sourceMatch?.[1] !== undefined) {
    return {
      predicate: {
        field: "source.kind",
        operator: "equals",
        value: sourceAliases[normalizeText(sourceMatch[1])] ?? normalizeText(sourceMatch[1]),
      },
    };
  }

  const senderMatch = /^sent\s+by\s+(.+)$/iu.exec(clause);
  if (senderMatch?.[1] !== undefined) {
    const value = readValue(senderMatch[1]);
    const canonical = value === undefined ? undefined : canonicalValue("sender", value, categories);
    if (canonical !== undefined) {
      const predicate = filterPredicateSchema.safeParse({
        field: "sender",
        operator: "equals",
        value: canonical,
      });
      if (predicate.success) return { predicate: predicate.data };
    }
    return unsupported(clause, "invalid-value", "sender");
  }

  const existsMatch =
    /^(source(?:\s+kind)?|application|app|sender|subject|body|message|text|category|currency|merchant|amount)\s+(?:exists|is\s+present)$/iu.exec(
      clause,
    );
  if (existsMatch?.[1] !== undefined) {
    const field = fieldAliases[normalizeText(existsMatch[1])];
    if (field !== undefined && supports(field, "exists")) {
      const predicate = filterPredicateSchema.safeParse({ field, operator: "exists" });
      if (predicate.success) return { predicate: predicate.data };
    }
    return unsupported(clause, "invalid-value", field);
  }

  const inMatch =
    /^(source(?:\s+kind)?|application|app|sender|subject|body|message|text|category|currency|merchant|amount)\s+(?:is\s+)?(?:one\s+of|in)\s+(.+)$/iu.exec(
      clause,
    );
  if (inMatch?.[1] !== undefined && inMatch[2] !== undefined) {
    const field = fieldAliases[normalizeText(inMatch[1])];
    if (field === undefined || !supports(field, "in")) {
      return unsupported(clause, "invalid-value", field);
    }
    const rawValues = inMatch[2].split(",").map(readValue);
    if (rawValues.some((value) => value === undefined)) {
      return unsupported(clause, "invalid-value", field);
    }
    const values = (rawValues as string[]).map((value) => canonicalValue(field, value, categories));
    if (values.length === 0 || values.length > 32 || values.some((value) => value === undefined)) {
      return unsupported(clause, "invalid-value", field);
    }
    return { predicate: { field, operator: "in", value: values as string[] } };
  }

  const valueMatch =
    /^(source(?:\s+kind)?|application|app|sender|subject|body|message|text|category|currency|merchant|amount)\s+(is|equals?|contains?|starts(?:-|\s+)with)\s+(.+)$/iu.exec(
      clause,
    );
  if (valueMatch?.[1] !== undefined && valueMatch[2] !== undefined && valueMatch[3] !== undefined) {
    const field = fieldAliases[normalizeText(valueMatch[1])];
    const operatorText = normalizeText(valueMatch[2]);
    const operator: "contains" | "equals" | "starts-with" = operatorText.startsWith("contain")
      ? "contains"
      : operatorText.startsWith("start")
        ? "starts-with"
        : "equals";
    if (field === undefined || !supports(field, operator)) {
      return unsupported(clause, "invalid-value", field);
    }
    const value = readValue(valueMatch[3]);
    const canonical = value === undefined ? undefined : canonicalValue(field, value, categories);
    if (canonical !== undefined) {
      const predicate = filterPredicateSchema.safeParse({ field, operator, value: canonical });
      if (predicate.success) return { predicate: predicate.data };
    }
    return unsupported(clause, "invalid-value", field);
  }

  return actionIntentPattern.test(clause)
    ? unsupported(clause, "action-intent-not-allowed")
    : unsupported(clause, "semantic-required");
}

function allowedFieldsFor(
  parsed: readonly ParsedClause[],
  unsupportedClauses: readonly FilterUnsupportedClause[],
): FilterField[] {
  const fields = new Set<FilterField>();
  for (const clause of parsed) {
    if ("unsupported" in clause && clause.unsupported.reason === "semantic-required") {
      if (clause.field !== undefined) fields.add(clause.field);
      else {
        const text = normalizeText(clause.unsupported.text);
        if (/\bsender\b|\bfrom\b/u.test(text)) fields.add("sender");
        if (/\bsubject\b|\btitle\b/u.test(text)) fields.add("subject");
        if (/\bbody\b|\bmessage\b|\btext\b/u.test(text)) fields.add("body");
        if (/\bcategory\b/u.test(text)) fields.add("category");
        if (/\bamount\b/u.test(text)) fields.add("attributes.amount");
        if (/\bcurrency\b/u.test(text)) fields.add("attributes.currency");
        if (/\bmerchant\b|\bstore\b/u.test(text)) fields.add("attributes.merchant");
        if (/\bapp(?:lication)?\b/u.test(text)) fields.add("source.applicationId");
        if (/\bgmail\b|\bsms\b|\bemail\b|\bnotification\b/u.test(text)) {
          fields.add("source.kind");
        }
      }
    }
  }
  if (
    fields.size === 0 &&
    unsupportedClauses.some((clause) => clause.reason === "semantic-required")
  ) {
    fields.add("subject");
    fields.add("body");
  }
  return [...fields];
}

export function compileFilterPlan(
  rawIntent: string,
  categories: readonly FilterCategoryDescriptor[] = [],
): FilterCompilation {
  const intent = filterIntentSchema.parse(rawIntent);
  const clauses = splitClauses(intent);
  const parsed =
    clauses.length <= 16
      ? clauses.map((clause) => parseClause(clause, categories))
      : [unsupported(intent, "semantic-required")];
  const predicates = parsed.flatMap((clause) => ("predicate" in clause ? [clause.predicate] : []));
  const unsupportedClauses = parsed.flatMap((clause) =>
    "unsupported" in clause ? [clause.unsupported] : [],
  );

  let deterministic: FilterExpression | undefined;
  if (predicates.length === 1) deterministic = predicates[0];
  else if (predicates.length > 1) deterministic = { all: predicates };

  const semanticClauses = unsupportedClauses.filter(
    (clause) => clause.reason === "semantic-required",
  );
  if (unsupportedClauses.some((clause) => clause.reason === "invalid-value")) {
    deterministic =
      deterministic === undefined ? { never: true } : { all: [deterministic, { never: true }] };
  } else if (deterministic === undefined && semanticClauses.length === 0) {
    deterministic = { never: true };
  }
  const semantic =
    semanticClauses.length === 0
      ? undefined
      : {
          question:
            `Does this item satisfy: ${semanticClauses.map((clause) => clause.text).join(" and ")}`.slice(
              0,
              2000,
            ),
          minimumConfidence: 0.8,
          allowedFields: allowedFieldsFor(parsed, unsupportedClauses),
        };

  return filterCompilationSchema.parse({
    plan: {
      schemaVersion: 1,
      compilerVersion: 1,
      intent,
      ...(deterministic === undefined ? {} : { deterministic }),
      ...(semantic === undefined ? {} : { semantic }),
    },
    supportedPredicates: SUPPORTED_FILTER_PREDICATES.map((predicate) => ({
      field: predicate.field,
      operators: [...predicate.operators],
    })),
    unsupportedClauses,
  });
}
