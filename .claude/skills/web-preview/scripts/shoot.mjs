// Screenshot screens at phone size.
//   node shoot.mjs                         every route in lib.mjs, dark
//   node shoot.mjs --scheme light          same, light
//   node shoot.mjs --route /inbox --name inbox-after
import { join } from "node:path";

import { arg, baseUrl, launch, preparedPage, routes, shotsDir } from "./lib.mjs";

const scheme = arg("scheme", "dark");
const single = arg("route", undefined);
const targets = typeof single === "string" ? [[single, arg("name", "shot")]] : routes;
const settle = Number(arg("wait", "1800"));

const browser = await launch();
const { consoleErrors, page, pageErrors } = await preparedPage(browser, { scheme });
for (const [route, name] of targets) {
  try {
    await page.goto(baseUrl + route, { timeout: 60_000, waitUntil: "networkidle" });
    await page.waitForTimeout(settle);
    const file = join(shotsDir, `${scheme}-${name}.png`);
    // Screens scroll inside a ScrollView, not the document, so this is always the viewport.
    await page.screenshot({ path: file });
    console.log(`${name.padEnd(20)} ${new URL(page.url()).pathname.padEnd(18)} ${file}`);
  } catch (error) {
    console.log(`${name.padEnd(20)} FAILED ${String(error).split("\n")[0]}`);
  }
}
console.log(`page errors: ${pageErrors.length}`);
pageErrors.slice(0, 8).forEach((line) => console.log(`  ${line}`));
console.log(`console errors: ${new Set(consoleErrors).size}`);
[...new Set(consoleErrors)].slice(0, 8).forEach((line) => console.log(`  ${line}`));
await browser.close();
