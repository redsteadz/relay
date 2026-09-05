import { useState } from "react";

import { cx } from "../lib/cx";

import { Chip, type ChipTone } from "./ui/Chip";
import styles from "./ExplainableReceipt.module.css";

export type ReceiptFact = {
  key: string;
  value: string;
  verified?: boolean | undefined;
};

/** What the proposed action does at the provider; drives the color-coded effect label. */
export type EffectKind = "read-only" | "writes" | "sends";

export type ExplainableReceiptProps = {
  /** Accessible name for the whole card. */
  title: string;
  labels: { arrived: string; read: string; filed: string; proposed: string };
  arrived: { reference: string; source: string; sourceGlyph: string; body: string };
  read: { confidence: string; headline: string; facts: ReceiptFact[] };
  filed: { category: string; version: string; mode: string; summary: string };
  proposed: {
    provider: string;
    title: string;
    due: string;
    effect: { kind: EffectKind; label: string };
  };
  actions: { approve: string; edit: string; skip: string; undo: string };
  outcomes: { approved: string; skipped: string };
  footnote: string;
};

type Decision = "pending" | "approved" | "skipped";

const effectTone: Record<EffectKind, ChipTone> = {
  "read-only": "info",
  writes: "warning",
  sends: "danger",
};

export function ExplainableReceipt({
  title,
  labels,
  arrived,
  read,
  filed,
  proposed,
  actions,
  outcomes,
  footnote,
}: ExplainableReceiptProps) {
  const [decision, setDecision] = useState<Decision>("pending");

  return (
    <article className={styles.card} aria-label={title}>
      <section className={cx(styles.step, styles.first)}>
        <header className={styles.stepHead}>
          <span>{labels.arrived}</span>
          <span className={styles.meta}>{arrived.reference}</span>
        </header>
        <p className={styles.source}>
          <span className={styles.glyph} aria-hidden="true">
            {arrived.sourceGlyph}
          </span>
          {arrived.source}
        </p>
        <p className={styles.body}>{arrived.body}</p>
      </section>

      <section className={styles.step}>
        <header className={styles.stepHead}>
          <span>{labels.read}</span>
          <span className={styles.meta}>{read.confidence}</span>
        </header>
        <p className={styles.headline}>{read.headline}</p>
        <ul className={styles.facts}>
          {read.facts.map((fact) => (
            <li key={fact.key} className={styles.fact}>
              <span className={styles.factKey}>{fact.key} </span>
              {fact.value}
              {fact.verified === false ? null : (
                <span className={styles.check} aria-hidden="true">
                  {" "}
                  ✓
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.step}>
        <header className={styles.stepHead}>
          <span>{labels.filed}</span>
        </header>
        <div className={styles.filedRow}>
          <span className={styles.category}>
            {filed.category} <span className={styles.version}>{filed.version}</span>
          </span>
          <Chip mono>{filed.mode}</Chip>
        </div>
        <p className={styles.summary}>{filed.summary}</p>
      </section>

      <section className={cx(styles.step, styles.last)}>
        <header className={styles.stepHead}>
          <span>{labels.proposed}</span>
        </header>
        <div className={styles.proposedRow}>
          <span className={styles.arrow} aria-hidden="true">
            →
          </span>
          <span className={styles.provider}>{proposed.provider}</span>
          <span className={styles.proposedTitle}>{proposed.title}</span>
          <Chip tone={effectTone[proposed.effect.kind]} mono>
            {proposed.effect.label}
          </Chip>
          <span className={styles.due}>{proposed.due}</span>
        </div>
        {decision === "pending" ? (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.approve}
              onClick={() => setDecision("approved")}
            >
              {actions.approve}
            </button>
            <button type="button" className={styles.edit}>
              {actions.edit}
            </button>
            <button type="button" className={styles.skip} onClick={() => setDecision("skipped")}>
              {actions.skip}
            </button>
          </div>
        ) : (
          <div
            className={cx(styles.outcome, decision === "approved" && styles.approved)}
            role="status"
          >
            <span>{decision === "approved" ? outcomes.approved : outcomes.skipped}</span>
            <button type="button" className={styles.undo} onClick={() => setDecision("pending")}>
              {actions.undo}
            </button>
          </div>
        )}
        <p className={styles.footnote}>{footnote}</p>
      </section>
    </article>
  );
}
