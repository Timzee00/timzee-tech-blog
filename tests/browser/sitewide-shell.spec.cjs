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
