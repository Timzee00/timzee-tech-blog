const { test, expect } = require("@playwright/test");
const { mockSite } = require("./helpers/fixtures.cjs");

// The broad route-level test still runs on desktop and mobile. This additional
// audit deliberately checks the narrowest supported device sizes and preserves
// horizontal scrolling inside intentional scrollers (tables, tabs, galleries).
const routes = [
  "/", "/login.html", "/settings.html", "/discussion.html", "/chat.html",
  "/stories.html", "/fyp.html", "/videos.html", "/marketplace.html",
  "/profile.html", "/post.html", "/my-tech.html", "/ai-chat.html", "/novels.html"
];

test("phone and small-tablet viewports contain public page controls", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Test narrow mobile layouts once.");
  test.setTimeout(180_000);
  await mockSite(page, { role: "user", populated: true });
  const failures = [];

  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 780 });
    for (const route of routes) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const info = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        const maxDocumentWidth = Math.max(
          document.documentElement.scrollWidth,
          document.body?.scrollWidth || 0
        );
        const visible = el => {
          if (el.closest("[hidden], [inert], [aria-hidden='true']")) return false;
          const styles = getComputedStyle(el);
          if (styles.display === "none" || styles.visibility === "hidden" || styles.opacity === "0") return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const insideScroller = node => {
          for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            if (/(auto|scroll)/.test(style.overflowX) && parent.scrollWidth > parent.clientWidth + 2) return true;
          }
          return false;
        };
        const outOfBounds = [...document.querySelectorAll(
          "main button, main input, main select, main textarea, main [role='button'], .site-header button"
        )]
          .filter(visible)
          .filter(el => !insideScroller(el))
          .map(el => {
            const rect = el.getBoundingClientRect();
            return { label: el.id || el.getAttribute("aria-label") || el.tagName.toLowerCase(),
              left: Math.round(rect.left), right: Math.round(rect.right) };
          })
          .filter(x => x.left < -2 || x.right > width + 2)
          .slice(0, 6);
        return { width, maxDocumentWidth, outOfBounds };
      });
      if (info.maxDocumentWidth > info.width + 2 || info.outOfBounds.length) {
        failures.push({ route, requestedWidth: width, ...info });
      }
    }
  }
  expect(failures).toEqual([]);
});

test("long text and code stay inside their cards rather than expanding the page", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile");
  await mockSite(page, { role: "user", populated: true });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/settings.html");
  await page.locator(".settings-card").first().evaluate(card => {
    const pre = document.createElement("pre");
    pre.textContent = "UNBROKEN_TEST_TEXT_".repeat(200);
    pre.id = "viewportLongCodeTest";
    card.append(pre);
  });
  const measurement = await page.locator("#viewportLongCodeTest").evaluate(el => {
    const rect = el.getBoundingClientRect();
    return {
      width: Math.round(rect.width),
      pageWidth: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
      locallyScrollable: el.scrollWidth > el.clientWidth
    };
  });
  expect(measurement.pageWidth).toBeLessThanOrEqual(measurement.viewport + 2);
  expect(measurement.width).toBeLessThanOrEqual(measurement.viewport);
  expect(measurement.locallyScrollable).toBe(true);
});
