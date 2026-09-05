import { cx } from "../lib/cx";

import { SectionHeader } from "./ui/SectionHeader";
import styles from "./Faq.module.css";

export type FaqItem = {
  /** Anchor id so the question can be deep-linked, for example from the app. */
  id: string;
  question: string;
  answer: string;
};

export type FaqGroup = {
  title: string;
  items: FaqItem[];
};

export type FaqProps = {
  id?: string | undefined;
  eyebrow: string;
  title: string;
  groups: FaqGroup[];
};

export function Faq({ id, eyebrow, title, groups }: FaqProps) {
  return (
    <section id={id} className={cx("container", styles.root)}>
      <SectionHeader eyebrow={eyebrow} title={title} />
      <div className={styles.groups}>
        {groups.map((group) => (
          <div key={group.title} className={styles.group}>
            <h3 className={styles.groupTitle}>{group.title}</h3>
            {group.items.map((item) => (
              <details key={item.id} id={item.id} className={styles.item}>
                <summary className={styles.question}>{item.question}</summary>
                <p className={styles.answer}>{item.answer}</p>
              </details>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
