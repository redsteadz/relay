import styles from "./TrustStrip.module.css";

export type TrustStripProps = {
  items: string[];
};

export function TrustStrip({ items }: TrustStripProps) {
  return (
    <ul className={styles.root}>
      {items.map((item) => (
        <li key={item} className={styles.item}>
          {item}
        </li>
      ))}
    </ul>
  );
}
