export type Link = {
  label: string;
  href: string;
  /** Opens in a new tab with `rel="noopener noreferrer"`. */
  external?: boolean | undefined;
};
