import { cx } from "../lib/cx";

import { SectionHeader } from "./ui/SectionHeader";
import styles from "./ComparisonTable.module.css";

export type Contender = {
  name: string;
  highlight?: boolean | undefined;
};

export type Criterion = {
  question: string;
  /** One answer per contender, in contender order. */
  answers: string[];
};

export type ComparisonTableProps = {
  id?: string | undefined;
  eyebrow: string;
  title: string;
  body?: string | undefined;
  contenders: Contender[];
  criteria: Criterion[];
  ruleOfThumbLabel: string;
  ruleOfThumb: string;
};

export function ComparisonTable({
  id,
  eyebrow,
  title,
  body,
  contenders,
  criteria,
  ruleOfThumbLabel,
  ruleOfThumb,
}: ComparisonTableProps) {
  return (
    <section id={id} className={cx("container", styles.root)}>
      <SectionHeader eyebrow={eyebrow} title={title} body={body} />

      <div className={styles.frame}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col" className={styles.corner}>
                <span className="visually-hidden">{eyebrow}</span>
              </th>
              {contenders.map((contender) => (
                <th
                  key={contender.name}
                  scope="col"
                  className={cx(styles.contender, contender.highlight && styles.highlight)}
                >
                  {contender.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {criteria.map((criterion) => (
              <tr key={criterion.question}>
                <th scope="row" className={styles.question}>
                  {criterion.question}
                </th>
                {criterion.answers.map((answer, index) => (
                  <td
                    key={contenders[index]?.name ?? index}
                    className={cx(styles.answer, contenders[index]?.highlight && styles.highlight)}
                  >
                    {answer}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <div className={styles.cards}>
          {contenders.map((contender, contenderIndex) => (
            <article
              key={contender.name}
              className={cx(styles.card, contender.highlight && styles.highlight)}
            >
              <h3 className={styles.cardTitle}>{contender.name}</h3>
              <dl className={styles.cardList}>
                {criteria.map((criterion) => (
                  <div key={criterion.question} className={styles.cardItem}>
                    <dt className={styles.cardQuestion}>{criterion.question}</dt>
                    <dd className={styles.cardAnswer}>{criterion.answers[contenderIndex]}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>

        <p className={styles.rule}>
          <span className={styles.ruleLabel}>{ruleOfThumbLabel}</span> {ruleOfThumb}
        </p>
      </div>
    </section>
  );
}
