import { cx } from "../../lib/cx";

import styles from "./Wordmark.module.css";

export type WordmarkProps = {
  label: string;
  href: string;
  size?: "regular" | "small" | undefined;
};

export function Wordmark({ label, href, size = "regular" }: WordmarkProps) {
  const glyph = size === "small" ? 20 : 30;
  return (
    <a href={href} className={cx(styles.root, size === "small" && styles.small)}>
      <svg
        width={glyph}
        height={glyph}
        viewBox="0 0 32 32"
        fill="none"
        strokeLinecap="round"
        strokeWidth="3"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M4 8C10 8 12 16 16 16M4 16H16M4 24C10 24 12 16 16 16" className={styles.ink} />
        <path d="M16 16H28" className={styles.accent} />
      </svg>
      <span className={styles.label}>{label}</span>
    </a>
  );
}
