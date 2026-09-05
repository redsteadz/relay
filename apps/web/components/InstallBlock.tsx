import { cx } from "../lib/cx";
import type { Link } from "../lib/links";

import { CopyButton } from "./ui/CopyButton";
import { SectionHeader } from "./ui/SectionHeader";
import styles from "./InstallBlock.module.css";

export type InstallBlockProps = {
  id?: string | undefined;
  eyebrow: string;
  title: string;
  body: string;
  /** Shell commands, one per line. Rendered verbatim and copied verbatim. */
  command: string;
  commandLabel: string;
  copy: { label: string; copiedLabel: string; failedLabel: string };
  requirementsLabel: string;
  requirements: string[];
  docs: Link;
};

export function InstallBlock({
  id,
  eyebrow,
  title,
  body,
  command,
  commandLabel,
  copy,
  requirementsLabel,
  requirements,
  docs,
}: InstallBlockProps) {
  return (
    <div className="plate">
      <section id={id} className={cx("container", styles.root)}>
        <div className={styles.copy}>
          <SectionHeader eyebrow={eyebrow} title={title} body={body} />
          <p className={styles.requirementsLabel}>{requirementsLabel}</p>
          <ul className={styles.requirements}>
            {requirements.map((requirement) => (
              <li key={requirement}>{requirement}</li>
            ))}
          </ul>
          <a
            href={docs.href}
            className={styles.docs}
            {...(docs.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            {docs.label} →
          </a>
        </div>
        <div className={styles.terminal}>
          <div className={styles.terminalHead}>
            <span>{commandLabel}</span>
            <CopyButton
              text={command}
              label={copy.label}
              copiedLabel={copy.copiedLabel}
              failedLabel={copy.failedLabel}
            />
          </div>
          <pre className={styles.pre}>
            <code>{command}</code>
          </pre>
        </div>
      </section>
    </div>
  );
}
