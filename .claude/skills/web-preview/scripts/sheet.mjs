// Tile screenshots into one contact sheet, so a dozen screens can be reviewed in one image.
//   node sheet.mjs --prefix dark-1 --out tabs.png --cols 3
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { arg, launch, shotsDir, workDir } from "./lib.mjs";

const prefix = String(arg("prefix", ""));
const out = join(workDir, String(arg("out", "sheet.png")));
const cols = Number(arg("cols", "3"));
const files = readdirSync(shotsDir)
  .filter((file) => file.startsWith(prefix) && file.endsWith(".png"))
  .sort();
if (files.length === 0) {
  console.error(`No screenshots in ${shotsDir} start with "${prefix}".`);
  process.exit(1);
}

const cells = files
  .map(
    (file) =>
      `<figure><img src="${pathToFileURL(join(shotsDir, file)).href}"><figcaption>${file.replace(".png", "")}</figcaption></figure>`,
  )
  .join("");
const htmlPath = join(workDir, "sheet.html");
writeFileSync(
  htmlPath,
  `<style>body{margin:0;background:#888;display:grid;grid-template-columns:repeat(${cols},390px);gap:12px;padding:12px;font:14px sans-serif}figure{margin:0}img{width:390px;display:block}figcaption{background:#000;color:#fff;padding:4px}</style>${cells}`,
);

const browser = await launch();
const page = await browser.newPage({ viewport: { height: 900, width: 12 + cols * 402 } });
await page.goto(pathToFileURL(htmlPath).href);
await page.waitForTimeout(800);
await page.screenshot({ fullPage: true, path: out });
console.log(`${files.length} screenshots -> ${out}`);
await browser.close();
