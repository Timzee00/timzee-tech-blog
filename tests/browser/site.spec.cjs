const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  // Deterministic anonymous fixtures. No production data or credentials are used.
  await page.route("https://**/*", async route => {
    const request = route.request();
    if (request.url().includes(".supabase.co/rest/v1/")) {
      const single = (request.headers().accept || "").includes("object+json");
      return route.fulfill({ status: 200, contentType: "application/json", body: single ? "null" : "[]", headers: { "access-control-allow-origin": "*", "content-range": "*/0" } });
    }
    return route.abort();
  });
  await page.routeWebSocket("wss://**/*", socket => socket.close());
});

test("rich content keeps formatting and removes executable markup", async ({ page }) => {
  await page.goto("/offline.html");
  const result = await page.evaluate(async () => {
    const { sanitizeHTML, normalizeHtml } = await import("/assets/js/utils.js");
    const html = sanitizeHTML('<p>Hello <strong>reader</strong><a href="https://example.com">link</a></p><iframe srcdoc="<script>parent.compromised=true</script>"></iframe><img src=x onerror="window.compromised=true"><svg><a href="javascript:alert(1)">x</a></svg><form action="https://example.com"><input name="password"></form><a href="java&#x09;script:alert(1)">bad</a>');
    const output = document.createElement("div"); output.innerHTML = html; document.body.append(output);
    return { html, encoded: normalizeHtml('&lt;img src=x onerror="alert(1)"&gt;'), unsafe: output.querySelectorAll("script,iframe,svg,form,input,[onerror],[srcdoc]").length, strong: output.querySelector("strong")?.textContent };
  });
  expect(result.unsafe).toBe(0);
  expect(result.strong).toBe("reader");
  expect(result.html).toContain('href="https://example.com"');
  expect(result.html).not.toMatch(/javascript:|onerror|srcdoc/i);
  expect(result.encoded).not.toContain("onerror");
});

for (const path of ["/", "/login.html", "/chat.html", "/cookies.html", "/accessibility.html"]) {
  test(`anonymous page loads without module errors: ${path}`, async ({ page }) => {
    const errors = [];
    const missing = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => {
      if (response.url().startsWith("http://127.0.0.1") && response.status() >= 400) missing.push(response.url());
    });
    await page.goto(path);
    await expect(page.locator("body")).toBeVisible();
    await expect.poll(() => page.evaluate(() => typeof window.supabase?.auth?.getSession)).toBe("function");
    if (path === "/chat.html") await expect(page.getByRole("heading", { name: "Sign in to chat" })).toBeVisible();
    if (path === "/cookies.html") await expect(page.getByRole("heading", { name: "Cookie Policy" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.readyState)).toBe("complete");
    expect(errors).toEqual([]);
    expect(missing).toEqual([]);
  });
}

test("public build excludes server source and identifies the release", async ({ request }) => {
  for (const path of ["/package.json", "/netlify/functions/llm-proxy.js", "/SUPABASE_SCHEMA.sql", "/PRODUCTION_READINESS.md", "/.git/config"]) {
    expect((await request.get(path)).status()).toBe(404);
  }
  const release = await (await request.get("/release.json")).json();
  expect(release.commit).toMatch(/^[a-f0-9]{40}$/);
  expect((await request.get("/assets/vendor/supabase.mjs")).status()).toBe(200);
  const html = await (await request.get("/")).text();
  const module = await (await request.get("/assets/js/supabase.js")).text();
  const css = await (await request.get("/assets/css/styles.css")).text();
  expect(html).toContain(`.js?v=${release.asset_version}`);
  expect(module).toContain(`supabase.mjs?v=${release.asset_version}`);
  expect(css).toContain(`variables.css?v=${release.asset_version}`);
});

test("long chats start with recent messages and load older history", async ({ page }) => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const friendId = "22222222-2222-4222-8222-222222222222";
  const threadId = [userId, friendId].join("_");
  const user = { id: userId, email: "test@example.com", app_metadata: { role: "user" }, user_metadata: { display_name: "Test User" } };
  await page.addInitScript(({ user }) => {
    const expires_at = Math.floor(Date.now() / 1000) + 3600;
    const token = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })) + "." + btoa(JSON.stringify({ sub: user.id, exp: expires_at, role: "authenticated" })) + ".test";
    localStorage.setItem("sb-duvbcwwprkzzyzikmcol-auth-token", JSON.stringify({ access_token: token, refresh_token: "test-only", expires_at, token_type: "bearer", user }));
  }, { user });
  const historyRequests = [];
  const posted = [];
  let releasePost;
  const postGate = new Promise(resolve => { releasePost = resolve; });
  await page.route("https://duvbcwwprkzzyzikmcol.supabase.co/**", async route => {
    const url = new URL(route.request().url());
    const table = url.pathname.split("/").pop();
    let data = [];
    if (url.pathname === "/auth/v1/user") data = user;
    else if (table === "profiles") data = { id: userId, role: "user", account_status: "active" };
    else if (table === "public_profiles") data = [{ id: friendId, display_name: "Test Friend" }];
    else if (table === "friendships") data = [{ id: "friendship", requester_id: userId, addressee_id: friendId, status: "accepted" }];
    else if (table === "direct_messages" && route.request().method() === "POST") {
      data = route.request().postDataJSON();
      posted.push(data);
      await postGate;
    }
    else if (table === "direct_messages" && url.searchParams.get("thread_id") === `eq.${threadId}`) {
      historyRequests.push(url);
      const older = url.searchParams.has("or");
      data = Array.from({ length: older ? 2 : 50 }, (_, index) => ({
        id: String((older ? 50 : 100) - index), thread_id: threadId,
        sender_id: friendId, recipient_id: userId,
        body: `Message ${(older ? 50 : 100) - index}`,
        created_at: new Date(Date.UTC(2026, 0, 1, 0, (older ? 50 : 100) - index)).toISOString()
      }));
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data), headers: { "access-control-allow-origin": "*" } });
  });
  await page.goto(`/chat.html?user=${friendId}`);
  await expect(page.locator("#chatConversation")).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".chat-message")).toHaveCount(50);
  await expect(page.locator(".chat-message").last()).toContainText("Message 100");
  expect(historyRequests[0].searchParams.get("limit")).toBe("50");
  expect(historyRequests[0].searchParams.get("order")).toBe("created_at.desc,id.desc");
  await page.getByRole("button", { name: "Load older messages" }).click();
  await expect(page.locator(".chat-message")).toHaveCount(52);
  await expect(page.locator(".chat-message").first()).toContainText("Message 49");
  await expect(page.getByRole("button", { name: "Load older messages" })).toBeHidden();
  expect(historyRequests[1].searchParams.get("or")).toContain('id.lt."51"');
  await page.locator("#chatBody").fill("A single message");
  await page.locator("#chatBody").press("Enter");
  await expect.poll(() => posted.length).toBe(1);
  await page.locator("#chatBody").press("Enter");
  releasePost();
  await expect(page.locator("#chatBody")).toHaveValue("");
  await expect(page.locator(".chat-message")).toHaveCount(53);
  expect(posted).toHaveLength(1);
  expect(posted[0].thread_id).toBe(threadId);
  expect(posted[0].recipient_id).toBe(friendId);
});
