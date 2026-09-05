import { cx } from "../lib/cx";

import { SectionHeader } from "./ui/SectionHeader";
import styles from "./PipelinePlate.module.css";

export type PipelineStep = {
  title: string;
  body: string;
  /** Trust boundary the step runs inside, for example "on your device". */
  boundary?: string | undefined;
};

export type PipelinePlateProps = {
  id?: string | undefined;
  eyebrow: string;
  title: string;
  steps: PipelineStep[];
};

export function PipelinePlate({ id, eyebrow, title, steps }: PipelinePlateProps) {
  return (
    <section id={id} className={cx("container", styles.root)}>
      <SectionHeader eyebrow={eyebrow} title={title} />
      <ol className={styles.grid}>
        {steps.map((step, index) => (
          <li key={step.title} className={styles.step}>
            <div className={styles.stepHead}>
              <span className={styles.index}>{String(index + 1).padStart(2, "0")}</span>
              {step.boundary === undefined ? null : (
                <span className={styles.boundary}>{step.boundary}</span>
              )}
            </div>
            <h3 className={styles.title}>{step.title}</h3>
            <p className={styles.body}>{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
