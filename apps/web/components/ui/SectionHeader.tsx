import { cx } from "../../lib/cx";

import { Eyebrow } from "./Eyebrow";
import styles from "./SectionHeader.module.css";

export type SectionHeaderProps = {
  eyebrow?: string | undefined;
  title: string;
  body?: string | undefined;
  size?: "regular" | "large" | undefined;
  className?: string | undefined;
};

export function SectionHeader({
  eyebrow,
  title,
  body,
  size = "regular",
  className,
}: SectionHeaderProps) {
  return (
    <div className={cx(styles.root, className)}>
      {eyebrow === undefined ? null : <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className={cx(styles.title, size === "large" && styles.large)}>{title}</h2>
      {body === undefined ? null : <p className={styles.body}>{body}</p>}
    </div>
  );
}
