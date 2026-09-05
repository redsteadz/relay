import { cx } from "../lib/cx";

import { SectionHeader } from "./ui/SectionHeader";
import styles from "./DataFlowMatrix.module.css";

export type MatrixMark = "stored" | "minimized" | "never" | "n/a";

export type MatrixRow = {
  label: string;
  note: string;
  /** One mark per column, in column order. */
  cells: MatrixMark[];
};

export type DataFlowMatrixProps = {
  id?: string | undefined;
  eyebrow: string;
  title: string;
  body: string;
  /** Column headings after the row label column. */
  columns: string[];
  rows: MatrixRow[];
  legend: Array<{ mark: MatrixMark; label: string }>;
  footnote?: string | undefined;
};

const glyph: Record<MatrixMark, string> = {
  stored: "●",
  minimized: "◐",
  never: "○",
  "n/a": "—",
};

export function DataFlowMatrix({
  id,
  eyebrow,
  title,
  body,
  columns,
  rows,
  legend,
  footnote,
}: DataFlowMatrixProps) {
  const markLabel = new Map(legend.map((entry) => [entry.mark, entry.label]));

  return (
    <div className="plate">
      <section id={id} className={cx("container", styles.root)}>
        <SectionHeader eyebrow={eyebrow} title={title} body={body} />
        <div className={styles.frame}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col" className={styles.rowHeading}>
                  <span className="visually-hidden">{eyebrow}</span>
                </th>
                {columns.map((column) => (
                  <th key={column} scope="col" className={styles.columnHeading}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className={styles.row}>
                  <th scope="row" className={styles.labelCell}>
                    <span className={styles.label}>{row.label}</span>
                    <span className={styles.note}>{row.note}</span>
                  </th>
                  {row.cells.map((mark, index) => (
                    <td
                      key={columns[index] ?? index}
                      className={styles.cell}
                      data-label={columns[index]}
                    >
                      <span className={styles.mark} data-mark={mark} aria-hidden="true">
                        {glyph[mark]}
                      </span>
                      <span className="visually-hidden">{markLabel.get(mark) ?? mark}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <ul className={styles.legend}>
            {legend.map((entry) => (
              <li key={entry.mark}>
                <span className={styles.mark} data-mark={entry.mark} aria-hidden="true">
                  {glyph[entry.mark]}
                </span>{" "}
                {entry.label}
              </li>
            ))}
          </ul>
        </div>
        {footnote === undefined ? null : <p className={styles.footnote}>{footnote}</p>}
      </section>
    </div>
  );
}
