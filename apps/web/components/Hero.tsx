import type { ReactNode } from "react";

import { cx } from "../lib/cx";
import type { Link } from "../lib/links";

import { TrustStrip } from "./TrustStrip";
import { Eyebrow } from "./ui/Eyebrow";
import { LinkButton } from "./ui/LinkButton";
import styles from "./Hero.module.css";

export type HeroProps = {
  id?: string | undefined;
  eyebrow: string;
  /** One entry per headline line. */
  title: string[];
  subtitle: string;
  primaryCta: Link;
  secondaryCta: Link;
  trust: string[];
  /** Rendered beside the copy, for example the example receipt. */
  aside?: ReactNode | undefined;
};

export function Hero({
  id,
  eyebrow,
  title,
  subtitle,
  primaryCta,
  secondaryCta,
  trust,
  aside,
}: HeroProps) {
  return (
    <section id={id} className={cx("container", styles.root)}>
      <div className={styles.copy}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className={styles.title}>
          {title.map((line, index) => (
            <span key={line} className={styles.line}>
              {index > 0 ? " " : null}
              {line}
            </span>
          ))}
        </h1>
        <p className={styles.subtitle}>{subtitle}</p>
        <div className={styles.ctas}>
          <LinkButton href={primaryCta.href} external={primaryCta.external}>
            {primaryCta.label}
          </LinkButton>
          <LinkButton href={secondaryCta.href} variant="outline" external={secondaryCta.external}>
            {secondaryCta.label}
          </LinkButton>
        </div>
        <TrustStrip items={trust} />
      </div>
      {aside === undefined ? null : <div className={styles.aside}>{aside}</div>}
    </section>
  );
}
