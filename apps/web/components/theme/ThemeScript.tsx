import { themeInitScript } from "../../lib/theme";

/** Applies a stored explicit theme before first paint; see lib/theme.ts. */
export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />;
}
