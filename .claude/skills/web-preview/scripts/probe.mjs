// Measure what screenshots can hide: elements past the right edge, and runtime errors.
//   node probe.mjs                 every route in lib.mjs
//   node probe.mjs --route /inbox
import { arg, baseUrl, launch, preparedPage, routes } from "./lib.mjs";

const single = arg("route", undefined);
const targets = typeof single === "string" ? [[single, single]] : routes;

const browser = await launch();
const { consoleErrors, page, pageErrors } = await preparedPage(browser);
let overflowing = 0;
for (const [route] of targets) {
  await page.goto(baseUrl + route, { timeout: 60_000, waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const report = await page.evaluate(() => {
    const width = window.innerWidth;
    // Interactive elements only: a horizontally scrolling chip strip legitimately extends past the
    // edge, but a button that does is unreachable.
    const offscreen = [...document.querySelectorAll('button, a, [role="button"], [role="link"]')]
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.right > width + 1)
      .filter(({ element }) => {
        // Skip anything inside a horizontal scroller.
        for (let node = element.parentElement; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.overflowX === "auto" || style.overflowX === "scroll") return false;
        }
        return true;
      })
      .map(
        ({ element, rect }) =>
          `${element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 30)} (right edge ${Math.round(rect.right)}px)`,
      );
    return {
      offscreen: [...new Set(offscreen)],
      scrollWidth: document.documentElement.scrollWidth,
      width,
    };
  });
  overflowing += report.offscreen.length;
  const status =
    report.offscreen.length === 0 && report.scrollWidth <= report.width ? "ok" : "OVERFLOW";
  console.log(
    `${status.padEnd(9)} ${route.padEnd(18)} page width ${report.scrollWidth}/${report.width}`,
  );
  report.offscreen.forEach((line) => console.log(`          off-screen: ${line}`));
}
console.log(`off-screen controls: ${overflowing}`);
console.log(`page errors: ${pageErrors.length}`);
pageErrors.forEach((line) => console.log(`  ${line}`));
console.log(`console errors: ${new Set(consoleErrors).size}`);
[...new Set(consoleErrors)].forEach((line) => console.log(`  ${line}`));
await browser.close();
process.exitCode = overflowing === 0 && pageErrors.length === 0 ? 0 : 1;
