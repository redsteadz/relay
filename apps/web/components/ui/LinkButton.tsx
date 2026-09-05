import type { ReactNode } from "react";

import { cx } from "../../lib/cx";

import styles from "./LinkButton.module.css";

export type LinkButtonProps = {
  href: string;
  children: ReactNode;
  variant?: "primary" | "outline" | undefined;
  size?: "regular" | "compact" | undefined;
  external?: boolean | undefined;
  className?: string | undefined;
};

export function LinkButton({
  href,
  children,
  variant = "primary",
  size = "regular",
  external = false,
  className,
}: LinkButtonProps) {
  return (
    <a
      href={href}
      className={cx(styles.button, styles[variant], styles[size], className)}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  );
}
