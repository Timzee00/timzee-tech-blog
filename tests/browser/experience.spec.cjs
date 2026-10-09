const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('node:fs');
const path = require('node:path');
const { mockSite, USER_ID, POST_ID } = require('./helpers/fixtures.cjs');
const root = path.resolve(__dirname, '../..');
const routes = fs.readdirSync(root).filter(file => file.endsWith('.html')).concat(['admin/login.html', 'admin/dashboard.html', 'author/dashboard.html', 'moderator/dashboard.html', 'super/login.html', 'super/panel.html', 'super/professional-panel.html']);

for (const route of routes) {
  test(`route is usable with no missing local assets or horizontal overflow: ${route}`, async ({ page }) => {
    await mockSite(page);
    const errors = [], missing = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.url().startsWith('http://127.0.0.1:5173') && response.status() >= 400) missing.push(response.url()); });
    await page.goto('/' + route);
    await page.waitForTimeout(600);
    await expect(page.locator('body')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.readyState)).toBe('complete');
    const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, forms: [...document.forms].every(form => form.noValidate) }));
    expect(layout.scroll).toBeLessThanOrEqual(layout.width + 1);
    expect(layout.forms).toBe(true);
    expect(errors).toEqual([]);
    expect(missing).toEqual([]);
    await expect(page.locator('#timzeeBootLoader, .welcome-modal')).toHaveCount(0);
  });
}

for (const route of ['/', '/login.html', '/contact.html', '/marketplace.html', '/settings.html', '/admin/login.html', '/discussion.html']) {
  test(`accessible shared interface and contrast: ${route}`, async ({ page }) => {
    await mockSite(page, { populated: true });
    await page.goto(route);
    await page.waitForTimeout(700);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) }))).toEqual([]);
  });
}

test('mobile drawer restores focus and makes the page inert; dropdown state resets', async ({ page }, testInfo) => {
  await mockSite(page); await page.goto('/');
  if (testInfo.project.name === 'mobile') {
    const toggle = page.getByRole('button', { name: 'Menu', exact: true });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(await page.locator('main').evaluate(el => el.inert)).toBe(true);
    await expect(page.getByRole('button', { name: 'Close menu' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    expect(await page.locator('#siteMenu').evaluate(el => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(toggle).toBeFocused();
    expect(await page.locator('main').evaluate(el => el.inert)).toBe(false);
    await expect(page.locator('#siteMenu')).toBeHidden();
  } else {
    const more = page.getByRole('button', { name: /More/ });
    await more.click(); await expect(more).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape'); await expect(more).toHaveAttribute('aria-expanded', 'false');
  }
});

test('video upload opens from its real destination without covering discovery initially', async ({ page }, testInfo) => {
  await mockSite(page, { role: 'user', populated: true }); await page.goto('/videos.html');
  await expect(page.locator('.video-card')).toHaveCount(1);
  await expect(page.locator('#uploadSection')).toBeHidden();
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.locator('#uploadBtnHeader').click();
  await expect(page.locator('#uploadSection')).toBeVisible();
  await expect(page).toHaveURL(/#uploadSection$/);
});

test('consent stores independent choices and cancel/Escape restores focus', async ({ page }) => {
  await mockSite(page); await page.goto('/cookies.html');
  const opener = page.locator('.footer-cookie-settings');
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Cookie preferences' });
  await dialog.getByLabel('Preferences', { exact: false }).check();
  await dialog.getByLabel('Measurement', { exact: false }).uncheck();
  await dialog.getByRole('button', { name: 'Save choices' }).click();
  await expect(opener).toBeFocused();
  await opener.click();
  await expect(dialog.locator('#timzeePreferenceChoice')).toBeChecked();
  await expect(dialog.locator('#timzeeMeasurementChoice')).not.toBeChecked();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('timzee_cookie_choices')))).toEqual({ preferences: true, measurement: false });
});

test('confirmation defaults to cancel and prompt masks passwords', async ({ page }) => {
  await mockSite(page); await page.goto('/login.html');
  await page.evaluate(() => { window.dialogResult = 'pending'; window.appUI.confirm('Remove this item?').then(value => window.dialogResult = value); });
  const dialog = page.getByRole('dialog', { name: 'Confirm action' });
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.dialogResult)).toBe(false);
  await page.evaluate(() => { void window.appUI.prompt('Set a password', { inputType: 'password' }); });
  await expect(page.getByRole('dialog').locator('input')).toHaveAttribute('type', 'password');
  await page.keyboard.press('Escape');
});

test('login has inline required errors and only one reachable auth panel', async ({ page }) => {
  await mockSite(page); await page.goto('/login.html');
  await page.locator('#loginForm button[type=submit]').click();
  await expect(page.locator('#loginEmail')).toBeFocused();
  await expect(page.locator('#loginEmail')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#signupForm')).toBeHidden();
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();
  await expect(page.locator('#signupName')).toBeFocused();
  await expect(page.locator('#loginForm')).toBeHidden();
  await page.locator('#signupPassword').fill('test-password-only');
  await page.locator('[data-password-toggle="signupPassword"]').click();
  await expect(page.locator('#signupPassword')).toHaveAttribute('type', 'text');
});

test('contact form keeps input on failure and prevents duplicate submissions', async ({ page }) => {
  await mockSite(page); let requests = 0, release;
  const gate = new Promise(resolve => release = resolve);
  await page.route('**/rest/v1/contact_requests*', async route => { requests++; await gate; await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"unavailable"}' }); });
  await page.goto('/contact.html');
  await page.locator('[name="name"]').fill('Local review');
  await page.locator('[name="email"]').fill('review@example.test');
  const subject = page.locator('[name="subject"]'); if (await subject.count()) await subject.fill('Test request');
  await page.locator('[name="message"]').fill('A local fixture submission, never sent to production.');
  await page.locator('[name="consent"]').check();
  await page.locator('#contactForm button[type="submit"]').click();
  await expect.poll(() => requests).toBe(1);
  await page.locator('#contactForm').evaluate(form => form.requestSubmit());
  expect(requests).toBe(1); release();
  await expect(page.locator('#contactStatus')).toContainText('Your details are still here');
  await expect(page.locator('[name="message"]')).not.toHaveValue('');
  await expect(page.locator('#contactForm button[type="submit"]')).toBeEnabled();
});

test('marketplace search ignores stale responses, keeps category and clears accessibly', async ({ page }, testInfo) => {
  await mockSite(page); let releaseOld; const gate = new Promise(resolve => releaseOld = resolve);
  let slowStarted = false;
  await page.route('**/rest/v1/marketplace_items*', async route => {
    const url = new URL(route.request().url()); const query = url.searchParams.get('search_vector') || '';
    if (query.includes('old')) { slowStarted = true; await gate; }
    const rows = query ? [{ id: POST_ID, title: query.includes('old') ? 'Old result' : 'Current result', price: 12, category: 'hardware', images: [] }] : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });
  await page.goto('/marketplace.html');
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const search = page.locator('#marketplaceSearch');
  await search.fill('old'); await expect.poll(() => slowStarted).toBe(true);
  await search.fill('current');
  await expect(page.locator('.listing-title')).toHaveText('Current result');
  releaseOld(); await page.waitForTimeout(100);
  await expect(page.locator('.listing-title')).toHaveText('Current result');
  await page.getByRole('button', { name: 'Clear search listings...' }).click();
  await expect(search).toHaveValue('');
  await expect(page.locator('.listing-card')).toHaveCount(0);
});

test('marketplace search waits for IME composition and retains the category', async ({ page }, testInfo) => {
  await mockSite(page); const requests = [];
  page.on('request', request => { if (request.url().includes('/rest/v1/marketplace_items')) requests.push(new URL(request.url())); });
  await page.goto('/marketplace.html');
  await page.locator('[data-category="hardware"]').click();
  await expect(page.locator('[data-category="hardware"]')).toHaveAttribute('aria-pressed', 'true');
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const search = page.locator('#marketplaceSearch');
  await search.dispatchEvent('compositionstart'); await search.fill('工具');
  await page.waitForTimeout(400);
  expect(requests.filter(url => url.searchParams.has('search_vector'))).toHaveLength(0);
  await search.dispatchEvent('compositionend');
  await expect.poll(() => requests.filter(url => url.searchParams.has('search_vector')).length).toBe(1);
  expect(requests.at(-1).searchParams.get('category')).toBe('eq.hardware');
});

test('settings saves the latest edit made during an earlier pending save', async ({ page }) => {
  await mockSite(page, { role: 'user' });
  let release; const gate = new Promise(resolve => release = resolve); const writes = [];
  await page.route('**/rest/v1/user_settings*', async route => {
    if (route.request().method() === 'POST') {
      writes.push(route.request().postDataJSON());
      if (writes.length === 1) await gate;
      return route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"preferences":{}}' });
  });
  await page.goto('/settings.html'); await expect(page.locator('#settingsStatus')).toHaveText('Settings loaded');
  const control = page.locator('[data-path="appearance.reduceMotion"]');
  await control.check(); await expect.poll(() => writes.length).toBe(1);
  await control.uncheck(); release();
  await expect.poll(() => writes.length).toBe(2);
  await expect(page.locator('#settingsStatus')).toHaveText('Saved');
  expect(writes[0].preferences.appearance.reduceMotion).toBe(true);
  expect(writes[1].preferences.appearance.reduceMotion).toBe(false);
  await expect(page.locator('html')).toHaveAttribute('data-reduce-motion', 'false');
});

for (const [route, role] of [['/', null], ['/settings.html', 'user'], ['/super/professional-panel.html', 'super']]) {
  test(`dark theme contrast and accessibility: ${route}`, async ({ page }) => {
    await mockSite(page, { role, populated: true });
    await page.addInitScript(() => localStorage.setItem('timzee-theme', 'dark'));
    await page.goto(route); await page.waitForTimeout(800);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => ({ target: node.target, issue: node.failureSummary })) }))).toEqual([]);
  });
}

test('small phone and tablet controls fit without clipped action labels', async ({ page }) => {
  await mockSite(page, { role: 'user' }); await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto('/settings.html'); await expect(page.locator('#settingsStatus')).toHaveText('Settings loaded');
    const fit = await page.evaluate(() => {
      const brand = document.querySelector('.brand').getBoundingClientRect();
      const theme = document.querySelector('.theme-control').getBoundingClientRect();
      return { scroll: document.documentElement.scrollWidth, brandRight: brand.right, themeLeft: theme.left,
        clipped: [...document.querySelectorAll('.settings-content .btn')].filter(el => el.scrollWidth > el.clientWidth + 2).map(el => el.textContent.trim()) };
    });
    expect(fit.scroll).toBeLessThanOrEqual(width + 1);
    expect(fit.brandRight).toBeLessThanOrEqual(fit.themeLeft + 1);
    expect(fit.clipped).toEqual([]);
  }
});

test('staff tabs reveal their panels and member names remain text', async ({ page }) => {
  await mockSite(page, { role: 'super' });
  await page.route('**/rest/v1/moderators*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ user_id: USER_ID, full_name: '<img src=x onerror="window.compromised=true">', email: 'review@example.test', is_active: true }]) }));
  await page.goto('/super/professional-panel.html');
  await expect(page.locator('#moderatorsList h4')).toContainText('<img');
  await expect(page.locator('#moderatorsList img')).toHaveCount(0);
  expect(await page.evaluate(() => !!window.compromised)).toBe(false);
  await page.locator('button[data-tab="authors"]').click();
  await expect(page.locator('.tab-content[data-tab="authors"]')).toBeVisible();
  await expect(page.locator('.tab-content[data-tab="moderators"]')).toBeHidden();
  await page.locator('button[data-tab="promote"]').click();
  await expect(page.locator('#promoteSearch')).toBeVisible();
});

test('ranking requests settle instead of observing their own render forever', async ({ page }) => {
  await mockSite(page, { populated: true }); const counts = {};
  page.on('request', request => { const table = request.url().split('/').pop(); if (['get_popular_posts','get_trending_posts'].includes(table)) counts[table] = (counts[table] || 0) + 1; });
  await page.goto('/'); await expect(page.locator('#popularTrack article')).toHaveCount(1);
  await expect(page.locator('#latestPosts article')).toHaveCount(1);
  await expect(page.locator('#latestPosts')).not.toContainText('Loading');
  await page.waitForTimeout(800);
  expect(counts).toEqual({ get_popular_posts: 1, get_trending_posts: 1 });
});

for (const [route, role] of [['/settings.html','user'], ['/profile.html','user'], ['/fyp.html','user'], ['/ai-chat.html','user'], ['/admin/dashboard.html','admin'], ['/author/dashboard.html','author'], ['/moderator/dashboard.html','moderator'], ['/super/professional-panel.html','super']]) {
  test(`authenticated layout: ${route}`, async ({ page }) => {
    await mockSite(page, { role, populated: true }); const errors=[]; page.on('pageerror', error=>errors.push(error.message));
    await page.goto(route); await page.waitForTimeout(900);
    expect(new URL(page.url()).pathname).toBe(route);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
    expect(errors).toEqual([]);
  });
}
