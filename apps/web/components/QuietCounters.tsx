import { cx } from "../lib/cx";
import type { Link } from "../lib/links";

import { LinkButton } from "./ui/LinkButton";
import { SectionHeader } from "./ui/SectionHeader";
import styles from "./QuietCounters.module.css";

export type Counter = {
  value: string;
  label: string;
};

export type QuietCountersProps = {
  id?: string | undefined;
  eyebrow?: string | undefined;
  title: string;
  body: string;
  primaryCta: Link;
  secondaryCta: Link;
  counters: Counter[];
};

export function QuietCounters({
  id,
  eyebrow,
  title,
  body,
  primaryCta,
  secondaryCta,
  counters,
}: QuietCountersProps) {
  return (
    <section id={id} className={cx("container", styles.root)}>
      <div className={styles.copy}>
        <SectionHeader eyebrow={eyebrow} title={title} body={body} size="large" />
        <div className={styles.ctas}>
          <LinkButton href={primaryCta.href} external={primaryCta.external}>
            {primaryCta.label}
          </LinkButton>
          <LinkButton href={secondaryCta.href} variant="outline" external={secondaryCta.external}>
            {secondaryCta.label}
          </LinkButton>
        </div>
      </div>
      <dl className={styles.tiles}>
        {counters.map((counter) => (
          <div key={counter.label} className={styles.tile}>
            <dt className={styles.value}>{counter.value}</dt>
            <dd className={styles.label}>{counter.label}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
