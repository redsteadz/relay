import type { ReactNode } from "react";

import { cx } from "../lib/cx";
import type { Link } from "../lib/links";

import { LinkButton } from "./ui/LinkButton";
import { Wordmark } from "./ui/Wordmark";
import styles from "./Nav.module.css";

export type NavProps = {
  wordmark: { label: string; href: string };
  links: Link[];
  cta: Link;
  navLabel: string;
  /** Controls rendered beside the CTA, such as the theme toggle. */
  actions?: ReactNode | undefined;
};

export function Nav({ wordmark, links, cta, navLabel, actions }: NavProps) {
  return (
    <header className={styles.root}>
      <div className={cx("container", styles.inner)}>
        <Wordmark label={wordmark.label} href={wordmark.href} />
        <nav aria-label={navLabel} className={styles.links}>
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={styles.link}
              {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className={styles.actions}>
          {actions}
          <LinkButton href={cta.href} size="compact" external={cta.external}>
            {cta.label}
          </LinkButton>
        </div>
      </div>
    </header>
  );
}
