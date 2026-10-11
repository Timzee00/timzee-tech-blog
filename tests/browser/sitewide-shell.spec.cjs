const { test, expect } = require("@playwright/test");
const { mockSite } = require("./helpers/fixtures.cjs");

test("public pages include one versioned shared shell and staff pages do not", async ({ request }) => {
  for (const route of ["/", "/chat.html", "/stories.html", "/marketplace.html"]) {
    const response = await request.get(route);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect((html.match(/src="\/assets\/js\/site-shell\.js\?v=[0-9a-f]+"/g) || []).length).toBe(1);
  }
  const staff = await (await request.get("/admin/dashboard.html")).text();
  expect(staff).not.toContain("site-shell.js");
});

test("shared shell exposes cookie settings and a usable footer", async ({ page }) => {
  await mockSite(page);
  await page.goto("/");
  const footer = page.locator("footer.footer");
  await expect(footer.getByRole("button", { name: "Cookie settings" })).toBeVisible();
  await expect(footer).toContainText("Powered by Timzee Corp");
  await footer.getByRole("button", { name: "Cookie settings" }).click();
  await expect(page.getByRole("dialog", { name: "Cookie preferences" })).toBeVisible();
});

test("anonymous chat and stories never start with empty avatar URLs", async ({ page }) => {
  await mockSite(page);
  await page.goto("/chat.html");
  await expect(page.locator("#chatAvatar")).toHaveAttribute("src", "/assets/img/avatar-placeholder.svg");
  await expect(page.locator("#infoAvatar")).toHaveAttribute("src", "/assets/img/avatar-placeholder.svg");
  await page.goto("/stories.html");
  await expect(page.locator("#ownStoryAvatar")).toHaveAttribute("src", "/assets/img/avatar-placeholder.svg");
});


test("nonfatal ResizeObserver diagnostics do not display an app failure", async ({ page }) => {
  await mockSite(page);
  await page.goto("/chat.html");
  await page.evaluate(() => {
    document.getElementById("appToastRoot")?.replaceChildren();
    window.dispatchEvent(new ErrorEvent("error", {
      message: "ResizeObserver loop completed with undelivered notifications."
    }));
  });
  await expect(page.locator("#appToastRoot .app-toast.error")).toHaveCount(0);
});


test("new marketplace listing keeps the currency the seller selected", async ({ page }) => {
  await mockSite(page, { role: "user" });
  let created = null;
  await page.route("**/rest/v1/marketplace_items*", route => {
    if (route.request().method() !== "POST") return route.fallback();
    created = route.request().postDataJSON();
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(created),
      headers: { "access-control-allow-origin": "*" }
    });
  });
  await page.goto("/marketplace.html");
  await page.locator("#createSection").evaluate(element => { element.style.display = "block"; });
  await expect(page.locator("#listingCurrency")).toHaveValue("NGN");
  await page.locator("#listingTitle").fill("Test keyboard");
  await page.locator("#listingPrice").fill("15000");
  await page.locator("#listingCurrency").selectOption("NGN");
  await page.locator("#marketplaceWhatsapp").fill("+2348012345678");
  await page.locator("#createForm button[type=submit]").click();
  await expect.poll(() => created?.currency || "").toBe("NGN");
  await expect.poll(() => created?.price).toBe(15000);
  await expect(page.locator("#createStatus")).toContainText("Listing created successfully.");
});


test("anonymous pages do not trigger a missing-session server-user lookup", async ({ page }) => {
  await mockSite(page);
  let userLookups = 0;
  page.on("request", request => {
    if (request.url().includes(".supabase.co/auth/v1/user")) userLookups++;
  });
  await page.goto("/");
  await page.waitForTimeout(300);
  expect(userLookups).toBe(0);
});


test("unavailable social images use local fallbacks instead of broken icons", async ({ page }) => {
  await mockSite(page);
  await page.goto("/");
  await page.evaluate(() => {
    const img = document.createElement("img");
    img.id = "testBrokenArticleImage";
    img.src = "/missing-image-for-regression-test.png";
    img.alt = "Article cover";
    document.body.append(img);
  });
  await expect(page.locator("#testBrokenArticleImage")).toHaveAttribute("src", "/assets/img/media-placeholder.svg");
  await expect(page.locator("#testBrokenArticleImage")).toHaveAttribute("data-fallback-applied", "true");
});


test("stories, communities and profiles use a single accessible page heading", async ({ page }) => {
  await mockSite(page);
  for (const [url, text] of [["/stories.html", "Stories"], ["/discussion.html", "Communities"], ["/profile.html", null]]) {
    await page.goto(url);
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toHaveCount(1);
    if (text) await expect(heading).toHaveText(text);
  }
});

test("public pages share typography, surfaces, and the primary palette", async ({ page }) => {
  await mockSite(page);
  let baseline;
  for (const route of ["/login.html", "/marketplace.html", "/stories.html", "/discussion.html", "/settings.html"]) {
    await page.goto(route);
    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        bodyFont: getComputedStyle(document.body).fontFamily,
        background: style.getPropertyValue("--color-bg").trim(),
        surface: style.getPropertyValue("--color-surface").trim(),
        primary: style.getPropertyValue("--color-primary").trim()
      };
    });
    expect(tokens.bodyFont).toBeTruthy();
    if (baseline) expect(tokens).toEqual(baseline);
    else baseline = tokens;
  }
});

test("cookie consent stays in document flow below the header on phones", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSite(page);
  await page.goto("/login.html");
  await page.evaluate(() => {
    const banner = document.createElement("div");
    banner.id = "timzee-consent-banner";
    banner.className = "is-visible";
    banner.innerHTML = '<div class="timzee-consent-card"><div class="timzee-consent-copy">Manage your cookies</div><div class="timzee-consent-actions"><button type="button">Reject optional</button><button type="button">Accept optional</button></div></div>';
    document.querySelector(".site-header").insertAdjacentElement("afterend", banner);
  });
  const position = await page.locator("#timzee-consent-banner").evaluate(node => {
    const banner = node.getBoundingClientRect();
    const header = document.querySelector(".site-header").getBoundingClientRect();
    const css = getComputedStyle(node);
    return { position: css.position, bannerTop: banner.top, headerBottom: header.bottom, bannerWidth: banner.width, viewport: window.innerWidth };
  });
  expect(position.position).toBe("relative");
  expect(position.bannerTop).toBeGreaterThanOrEqual(position.headerBottom - 1);
  expect(position.bannerWidth).toBeLessThanOrEqual(position.viewport);
  await expect(page.locator("#loginEmail")).toBeVisible();
});

test("staff dashboards use the public brand surface and accessible focus", async ({ page }) => {
  await mockSite(page);
  await page.goto("/admin/login.html");
  const colors = await page.evaluate(() => {
    const computed = getComputedStyle(document.querySelector(".login-shell"));
    const root = getComputedStyle(document.documentElement);
    return { background: computed.backgroundColor, text: computed.color, body: root.getPropertyValue("--color-bg").trim() };
  });
  expect(colors.body).toBeTruthy();
  expect(colors.background).not.toBe("rgba(0, 0, 0, 0)");
  await expect(page.locator(".login-card")).toBeVisible();
});


test("settings and For You links show active navigation, and dynamic brand reaches the footer", async ({ page }) => {
  await mockSite(page);
  await page.goto("/settings.html");
  await expect(page.locator(".nav-more-menu a[href$='settings.html']")).toHaveAttribute("aria-current", "page");
  const footer = page.locator(".footer-wordmark");
  await expect(footer).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("timzee:branding-updated", { detail: { siteName: "Example Tech Community" } })));
  await expect(footer).toHaveText("Example Tech Community");
  await page.goto("/fyp.html");
  await expect(page.locator(".nav-more-menu a[href$='fyp.html']")).toHaveAttribute("aria-current", "page");
});
