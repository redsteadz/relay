import { cx } from "../lib/cx";
import type { Link } from "../lib/links";

import { Wordmark } from "./ui/Wordmark";
import styles from "./Footer.module.css";

export type FooterProps = {
  wordmark: { label: string; href: string };
  links: Link[];
  navLabel: string;
  note: string;
};

export function Footer({ wordmark, links, navLabel, note }: FooterProps) {
  return (
    <footer className={styles.root}>
      <div className={cx("container", styles.inner)}>
        <Wordmark label={wordmark.label} href={wordmark.href} size="small" />
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
        <p className={styles.note}>{note}</p>
      </div>
    </footer>
  );
}
