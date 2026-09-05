/**
 * What Relay holds, where, and in what form.
 *
 * A summary of the architecture rather than a read of anyone's account: it is the same statement for
 * every tenant, and it is true because of how the system is built rather than because of what a
 * query returned. It is kept as data so the screen cannot drift from the canonical record in
 * `docs/security/privacy.md`, and so a change to the architecture is a change to one table here.
 *
 * The four places are the four boundaries a person actually cares about crossing. "Model" and
 * "Providers" are external; "This device" and "Relay server" are not.
 */

export type HoldingLevel =
  /** Held in full, readable by Relay. */
  | "full"
  /** Held, but encrypted or reduced to an allowlisted subset. */
  | "partial"
  /** Never held here. */
  | "none"
  /** Cannot apply to this boundary. */
  | "n/a";

export type DataHolding = {
  /** One level per column of `holdingPlaces`, in that order. */
  levels: readonly [HoldingLevel, HoldingLevel, HoldingLevel, HoldingLevel];
  label: string;
  /** The qualification the row's four marks cannot make on their own. */
  note: string;
  sublabel: string;
};

export const holdingPlaces = ["Device", "Relay", "Model", "Providers"] as const;

export const holdingMarks: Readonly<Record<HoldingLevel, string>> = {
  full: "●",
  "n/a": "—",
  none: "○",
  partial: "◐",
};

export const holdingDescriptions: Readonly<Record<HoldingLevel, string>> = {
  full: "held in full",
  "n/a": "not applicable",
  none: "never held",
  partial: "held encrypted or reduced",
};

export const dataHoldings: readonly DataHolding[] = [
  {
    label: "Raw capture",
    levels: ["partial", "partial", "none", "none"],
    note: "Encrypted on this device and on the server. Deleted after seven days.",
    sublabel: "title · text · sender",
  },
  {
    label: "Facts and events",
    levels: ["full", "full", "partial", "partial"],
    note: "A model sees redacted, allowlisted fields only on semantic fallback. Providers get only the fields of an action you approved.",
    sublabel: "amounts · dates · merchants",
  },
  {
    label: "Categories and rules",
    levels: ["none", "full", "none", "none"],
    note: "Versions are appended, never rewritten.",
    sublabel: "every version",
  },
  {
    label: "Approvals and actions",
    levels: ["none", "full", "none", "full"],
    note: "Append-only. Providers receive what you approved and nothing else.",
    sublabel: "the ledger",
  },
  {
    label: "OpenAI key",
    levels: ["none", "full", "n/a", "none"],
    note: "Envelope-encrypted by the backend. Never displayed again once saved.",
    sublabel: "yours, optional",
  },
];

/** A row read aloud, so the table is usable without seeing its marks. */
export function holdingAccessibilityLabel(holding: DataHolding): string {
  const cells = holding.levels
    .map((level, index) => `${holdingPlaces[index]}: ${holdingDescriptions[level]}`)
    .join(", ");
  return `${holding.label}. ${cells}. ${holding.note}`;
}
