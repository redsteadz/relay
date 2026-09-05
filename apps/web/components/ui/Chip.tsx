import type { ReactNode } from "react";

import { cx } from "../../lib/cx";

import styles from "./Chip.module.css";

export type ChipTone = "neutral" | "success" | "warning" | "danger" | "info";

export type ChipProps = {
  children: ReactNode;
  tone?: ChipTone | undefined;
  mono?: boolean | undefined;
  className?: string | undefined;
};

export function Chip({ children, tone = "neutral", mono = false, className }: ChipProps) {
  return (
    <span className={cx(styles.root, styles[tone], mono && styles.mono, className)}>
      {children}
    </span>
  );
}
