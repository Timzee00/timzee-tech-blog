const { test, expect } = require('@playwright/test');
const { mockSite, USER_ID } = require('./helpers/fixtures.cjs');
const FRIEND = '22222222-2222-4222-8222-222222222222';
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
const signed = (path, fresh = false) => 'https://duvbcwwprkzzyzikmcol.supabase.co/storage/v1/object/sign/chat-media/' + path + '?token=e30.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now()/1000) + (fresh ? 3600 : -60) })).toString('base64url') + '.signature';
async function chat(page) {
  await mockSite(page, { role: 'user' });
  await page.route('https://*/rest/v1/**', route => {
    const url = new URL(route.request().url()), table = url.pathname.split('/').pop();
    let data;
    if (table === 'friendships') data = [{ id: 'friend', requester_id: USER_ID, addressee_id: FRIEND, status: 'accepted' }];
    else if (table === 'public_profiles') data = [{ id: FRIEND, display_name: 'Ada Reader' }];
    else if (table === 'direct_messages') data = [{ id: '44444444-4444-4444-8444-444444444444', thread_id: [USER_ID, FRIEND].join('_'), sender_id: FRIEND, body: 'Private message: 100% accurate', created_at: '2026-10-09T10:00:00Z' }];
    else return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto('/chat.html?user=' + FRIEND);
  await expect(page.locator('.chat-message')).toHaveCount(1);
  await expect(page.locator('#chatBody')).toBeEnabled();
}
async function installMedia(page) {
  await mockSite(page, { role: 'user' });
  await page.goto('/offline.html');
  await page.evaluate(() => import('/assets/js/media.js'));
}
async function attachment(page, id, url) {
  await page.evaluate(({id,url}) => { const link = document.createElement('a'); link.id = id; link.href = url; link.textContent = 'Attachment'; document.body.append(link); }, {id,url});
}

test('message actions work by keyboard and restore focus without page overflow', async ({ page }, testInfo) => {
  await chat(page);
  const trigger = page.getByRole('button', { name: 'Message actions', exact: true });
  await trigger.focus(); await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Message actions' });
  await expect(menu).toBeVisible(); await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.screenshot({ path: testInfo.outputPath('message-menu.png') });
  await expect(menu.getByRole('menuitem', { name: 'Reply', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown'); await expect(menu.getByRole('menuitem', { name: 'Copy message', exact: true })).toBeFocused();
  await page.keyboard.press('End'); await expect(menu.getByRole('menuitem', { name: 'Report message', exact: true })).toBeFocused();
  await page.keyboard.press('Home'); await page.keyboard.press('Escape');
  await expect(menu).toBeHidden(); await expect(trigger).toBeFocused(); await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Shift+F10'); await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Reply', exact: true }).click();
  await expect(page.locator('#chatBody')).toBeFocused();
  await expect(page.locator('#chatBody')).toHaveValue('> Ada Reader: Private message: 100% accurate\n\n');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('clipboard failures report an error rather than a success toast', async ({ page }) => {
  await chat(page);
  await page.evaluate(() => { window.actionToasts = []; window.siteToast = (...args) => window.actionToasts.push(args); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }); });
  await page.getByRole('button', { name: 'Message actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Copy message', exact: true }).click();
  await expect(page.getByText(/Chat message action failed: Clipboard unavailable/)).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(window.actionToasts))).not.toContain('Message copied.');
});

test('replacing the selected message closes the menu and prevents a stale action', async ({ page }) => {
  await chat(page); await page.getByRole('button', { name: 'Message actions', exact: true }).click();
  await page.evaluate(() => { document.querySelector('#chatMessages').innerHTML = '<p>Conversation refreshed</p>'; });
  await expect(page.getByRole('menu', { name: 'Message actions' })).toBeHidden();
  await expect(page.locator('#chatBody')).toHaveValue('');
});

test('Ask AI transfers selected text once without placing it in navigation URLs', async ({ page }) => {
  await chat(page); const documents = [];
  page.on('request', request => { if (request.isNavigationRequest()) documents.push(request.url()); });
  await page.getByRole('button', { name: 'Message actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Ask AI', exact: true }).click();
  await expect(page).toHaveURL(/\/ai-chat.html$/);
  await expect(page.locator('#aiChatInput')).toHaveValue(/Private message: 100% accurate/);
  expect(documents.some(url => url.includes('context_ref='))).toBe(true);
  expect(documents.some(url => url.includes('Private') || url.includes('context='))).toBe(false);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('timzee_chat_context:')))).toEqual([]);
  await page.reload(); await expect(page.locator('#aiChatInput')).toHaveValue('');
});

test('assistant context respects the disabled preference and consumes the handoff', async ({ page }) => {
  await chat(page);
  await page.route('https://*/rest/v1/user_settings*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ preferences: { ai: { assistantContext: false } } }) }));
  await page.getByRole('button', { name: 'Message actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Ask AI', exact: true }).click();
  await expect(page).toHaveURL(/\/ai-chat.html$/);
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('timzee_chat_context:')).length)).toBe(0);
  await expect(page.locator('#aiChatInput')).toHaveValue('');
});

test('repeated attachment elements and rerenders share signing work', async ({ page }) => {
  await installMedia(page); const pending = gate(); const calls = []; const path = 'direct-messages/' + FRIEND + '/shared.png', fresh = signed(path, true);
  await page.route('**/.netlify/functions/chat-media-sign', async route => { calls.push(route.request().postDataJSON()); await pending.promise; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signedUrl: fresh }) }); });
  await attachment(page, 'first', signed(path)); await attachment(page, 'second', signed(path));
  await expect.poll(() => calls.length).toBe(1); pending.release();
  await expect(page.locator('#first')).toHaveAttribute('href', fresh);
  await expect(page.locator('#second')).toHaveAttribute('href', fresh);
  await attachment(page, 'rerender', signed(path));
  await expect(page.locator('#rerender')).toHaveAttribute('href', fresh);
  expect(calls).toHaveLength(1);
});

test('a late signing response cannot overwrite a reused attachment element', async ({ page }) => {
  await installMedia(page); const pending = gate(); const calls = [];
  const oldPath = 'direct-messages/' + FRIEND + '/old.png', newPath = 'direct-messages/' + FRIEND + '/new.png';
  const oldFresh = signed(oldPath, true), newFresh = signed(newPath, true);
  await page.route('**/.netlify/functions/chat-media-sign', async route => {
    const { path } = route.request().postDataJSON(); calls.push(path);
    if (path === oldPath) await pending.promise;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signedUrl: path === oldPath ? oldFresh : newFresh }) });
  });
  await attachment(page, 'changing', signed(oldPath)); await expect.poll(() => calls.length).toBe(1);
  await page.locator('#changing').evaluate((el, url) => { el.href = url; }, signed(newPath));
  pending.release(); await expect(page.locator('#changing')).toHaveAttribute('href', newFresh);
  expect(calls).toEqual([oldPath, newPath]);
});

test('signing failure does not poison a later retry', async ({ page }) => {
  await installMedia(page); let calls = 0; const path = 'direct-messages/' + FRIEND + '/retry.png', fresh = signed(path, true);
  await page.route('**/.netlify/functions/chat-media-sign', route => {
    const failed = ++calls === 1;
    return route.fulfill({ status: failed ? 503 : 200, contentType: 'application/json', body: JSON.stringify(failed ? { error: 'Temporary failure' } : { signedUrl: fresh }) });
  });
  await attachment(page, 'failed', signed(path)); await expect.poll(() => calls).toBe(1);
  await expect(page.locator('#failed')).not.toHaveAttribute('data-chat-media-refreshing', 'true');
  await attachment(page, 'retry', signed(path)); await expect(page.locator('#retry')).toHaveAttribute('href', fresh);
  expect(calls).toBe(2);
});


test('reply keeps the line breaks in a multiline message', async ({ page }) => {
  await chat(page);
  await page.locator('.chat-message-body').evaluate(el => { el.innerHTML = 'First line<br>Second line'; });
  await page.getByRole('button', { name: 'Message actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Reply', exact: true }).click();
  await expect(page.locator('#chatBody')).toHaveValue('> Ada Reader: First line\n> Second line\n\n');
});

test('closed details take no grid space and the populated dialog returns focus', async ({ page }, testInfo) => {
  await chat(page);
  const panel = page.locator('#chatInfoPanel'); await expect(panel).toBeHidden();
  const dimensions = await page.evaluate(() => {
    const layout = document.querySelector('#chatLayout').getBoundingClientRect();
    const pane = document.querySelector('.chat-pane').getBoundingClientRect();
    return { layout: layout.height, pane: pane.height };
  });
  expect(dimensions.pane).toBeGreaterThanOrEqual(dimensions.layout - 2);
  const trigger = page.getByRole('button', { name: 'Chat details', exact: true });
  await trigger.click(); await expect(page.getByRole('dialog', { name: 'Chat details', exact: true })).toBeVisible();
  await expect(panel.locator('#infoName')).toHaveText('Ada Reader');
  await expect(panel.locator('#infoStatus')).toHaveText('Private conversation');
  expect(await panel.locator('#chatProfileBtn').evaluate(el => el.getBoundingClientRect().height)).toBeLessThan(60);
  await expect(panel.locator('#editGroupBtn')).toBeHidden();
  await expect(panel.locator('#chatBlockBtn, #chatRemoveBtn, #viewAllMediaBtn')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('chat-details.png') });
  await page.keyboard.press('Escape'); await expect(panel).toBeHidden(); await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
