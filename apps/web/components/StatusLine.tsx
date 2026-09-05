import { cx } from "../lib/cx";
import type { Link } from "../lib/links";

import styles from "./StatusLine.module.css";

export type StatusState = "done" | "pending" | "blocked";

export type StatusItem = {
  label: string;
  state: StatusState;
};

export type StatusLineProps = {
  id?: string | undefined;
  label: string;
  summary: string;
  items: StatusItem[];
  stateLabels: Record<StatusState, string>;
  link: Link;
};

const glyph: Record<StatusState, string> = {
  done: "✓",
  pending: "○",
  blocked: "■",
};

export function StatusLine({ id, label, summary, items, stateLabels, link }: StatusLineProps) {
  return (
    <div className="plate">
      <section id={id} className={cx("container", styles.root)} aria-label={label}>
        <div className={styles.band}>
          <div className={styles.head}>
            <span className={styles.label}>{label}</span>
            <p className={styles.summary}>{summary}</p>
          </div>
          <ul className={styles.items}>
            {items.map((item) => (
              <li key={item.label} className={styles.item} data-state={item.state}>
                <span className={styles.glyph} aria-hidden="true">
                  {glyph[item.state]}
                </span>
                {item.label}
                <span className="visually-hidden">: {stateLabels[item.state]}</span>
              </li>
            ))}
          </ul>
          <a
            href={link.href}
            className={styles.link}
            {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            {link.label} →
          </a>
        </div>
      </section>
    </div>
  );
}
