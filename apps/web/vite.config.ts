import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Explicit extensions: this file is loaded by Node, not resolved through the bundler like the page
// sources are, and Vite's native config loader rejects extensionless relative imports.
import { site } from "./content/site.ts";
import { themeInitScript } from "./lib/theme.ts";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Fills the head of index.html from the same modules the page renders from. The theme script is
 * emitted verbatim because it is JavaScript, not markup; lib/theme.ts keeps it free of `<`.
 */
function htmlDocument(): Plugin {
  const tokens: Array<[token: string, value: string]> = [
    ["%RELAY_TITLE%", escapeHtml(site.title)],
    ["%RELAY_DESCRIPTION%", escapeHtml(site.description)],
    ["%RELAY_THEME_INIT%", themeInitScript],
  ];

  return {
    name: "relay-html-document",
    transformIndexHtml: {
      // Ahead of Vite's own %VAR% substitution so no token reaches the env replacement pass.
      order: "pre",
      handler: (html) =>
        tokens.reduce((result, [token, value]) => result.replaceAll(token, value), html),
    },
  };
}

// Relative base so the built directory is hostable from any path, including a subdirectory.
export default defineConfig({
  base: "./",
  build: { outDir: "dist" },
  plugins: [react(), htmlDocument()],
  preview: { port: 3100, strictPort: true },
  server: { port: 3100, strictPort: true },
});
