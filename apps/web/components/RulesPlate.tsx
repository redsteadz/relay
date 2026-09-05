import { cx } from "../lib/cx";

import { Chip, type ChipTone } from "./ui/Chip";
import { SectionHeader } from "./ui/SectionHeader";
import styles from "./RulesPlate.module.css";

export type DryRunResult = "match" | "model" | "no-match";

export type RulesExample = {
  intentLabel: string;
  intent: string;
  /** The clause the compiler could not decide deterministically. */
  intentSemantic?: string | undefined;
  planLabel: string;
  plan: string[];
  fallback: { label: string; text: string };
  dryRunLabel: string;
  dryRunSummary: string;
  dryRun: Array<{ name: string; result: DryRunResult; label: string }>;
  disclosureNote: string;
};

export type RulesPlateProps = {
  id?: string | undefined;
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  example: RulesExample;
};

const resultTone: Record<DryRunResult, ChipTone> = {
  match: "success",
  model: "warning",
  "no-match": "neutral",
};

export function RulesPlate({ id, eyebrow, title, body, bullets, example }: RulesPlateProps) {
  return (
    <div className="plate">
      <section id={id} className={cx("container", styles.root)}>
        <div className={styles.copy}>
          <SectionHeader eyebrow={eyebrow} title={title} body={body} />
          <ul className={styles.bullets}>
            {bullets.map((bullet) => (
              <li key={bullet} className={styles.bullet}>
                <span className={styles.arrow} aria-hidden="true">
                  →
                </span>
                {bullet}
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.asideWrap}>
          <div className={styles.card}>
            <div className={styles.block}>
              <p className={styles.label}>{example.intentLabel}</p>
              <p className={styles.intent}>
                {example.intent}
                {example.intentSemantic === undefined ? null : (
                  <span className={styles.semantic}> {example.intentSemantic}</span>
                )}
              </p>
            </div>
            <div className={styles.block}>
              <p className={styles.label}>{example.planLabel}</p>
              <ul className={styles.plan}>
                {example.plan.map((line) => (
                  <li key={line} className={styles.planLine}>
                    {line}
                  </li>
                ))}
              </ul>
              <p className={styles.fallback}>
                <span className={styles.fallbackLabel}>{example.fallback.label}</span> ·{" "}
                {example.fallback.text}
              </p>
            </div>
            <div className={cx(styles.block, styles.lastBlock)}>
              <div className={styles.dryRunHead}>
                <p className={styles.label}>{example.dryRunLabel}</p>
                <span className={styles.dryRunSummary}>{example.dryRunSummary}</span>
              </div>
              <ul className={styles.dryRun}>
                {example.dryRun.map((item) => (
                  <li key={item.name} className={styles.dryRunRow}>
                    <span className={styles.dryRunName}>{item.name}</span>
                    <Chip tone={resultTone[item.result]}>{item.label}</Chip>
                  </li>
                ))}
              </ul>
              <p className={styles.note}>{example.disclosureNote}</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
