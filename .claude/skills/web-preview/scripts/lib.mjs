// Shared plumbing for the web-preview scripts: resolve Playwright, find a browser, finish onboarding.
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

export const baseUrl = process.env.RELAY_PREVIEW_URL ?? "http://localhost:8081";
export const workDir = process.env.RELAY_PREVIEW_DIR ?? join(tmpdir(), "relay-web-preview");
export const shotsDir = join(workDir, "shots");
mkdirSync(shotsDir, { recursive: true });

/** Phone-sized, matching a common Android/iPhone logical width. */
export const viewport = { width: 390, height: 844 };

/**
 * The main screens, in tab order then depth. Routes that redirect (e.g. `/sources`) are listed by
 * where they land so a 404 in the log is never mistaken for a broken screen.
 */
export const routes = [
  ["/", "10-today"],
  ["/inbox", "11-inbox"],
  ["/automations", "12-rules"],
  ["/connections", "13-sources"],
  ["/settings", "14-settings"],
  ["/activity", "20-activity"],
  ["/inbox/hidden", "21-inbox-removed"],
  ["/inbox/apps", "22-inbox-apps"],
  ["/sources/gmail", "30-source-gmail"],
  ["/categories", "31-categories"],
  ["/your-data", "32-your-data"],
  ["/disclosures", "33-disclosures"],
  ["/rules/editor", "34-rule-editor"],
  ["/demo", "35-demo-studio"],
];

function loadPlaywright() {
  const require = createRequire(join(workDir, "package.json"));
  try {
    return require("playwright-core");
  } catch {
    console.error(
      `playwright-core is not installed in ${workDir}.\n` +
        `Install it once with:  npm install --prefix "${workDir}" playwright-core@1`,
    );
    process.exit(2);
  }
}

/** An installed Chromium-family browser. Override with RELAY_PREVIEW_BROWSER. */
function browserPath() {
  const candidates = [
    process.env.RELAY_PREVIEW_BROWSER,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find((path) => path !== undefined && existsSync(path));
}

export async function launch() {
  const { chromium } = loadPlaywright();
  const executablePath = browserPath();
  // Without a system browser, fall back to Playwright's own (`npx playwright install chromium`).
  return chromium.launch(executablePath === undefined ? {} : { executablePath });
}

/**
 * A page past the introduction. Onboarding state lives in AsyncStorage (localStorage on web), so it
 * is completed through the UI once per context; every later `goto` in that context skips it.
 */
export async function preparedPage(browser, { scheme = "dark" } = {}) {
  const context = await browser.newContext({ colorScheme: scheme, deviceScaleFactor: 2, viewport });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(`[${pathOf(page)}] ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(`[${pathOf(page)}] ${message.text().split("\n")[0].slice(0, 200)}`);
    }
  });
  await page.goto(baseUrl + "/", { timeout: 120_000, waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  for (let slide = 0; slide < 4; slide += 1) {
    const next = page.getByText(/^(Continue|Open inbox)$/).first();
    if ((await next.count()) === 0) break;
    await next.click();
    await page.waitForTimeout(800);
  }
  return { consoleErrors, page, pageErrors };
}

function pathOf(page) {
  try {
    return new URL(page.url()).pathname;
  } catch {
    return page.url();
  }
}

/** `--name value` or `--flag` from argv. */
export function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? true : value;
}
