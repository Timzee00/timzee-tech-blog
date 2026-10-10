const { test, expect } = require('@playwright/test');
const { mockSite, USER_ID } = require('./helpers/fixtures.cjs');
const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';
const profiles = [{ id: A, display_name: 'Ada Friend', username: 'ada' }, { id: B, display_name: 'Ben Friend', username: 'ben' }];
const thread = id => [USER_ID, id].sort().join('_');
const message = (id, body) => ({ id: 'message-' + id, thread_id: thread(id), sender_id: id, recipient_id: USER_ID, body, created_at: '2026-10-08T10:00:00Z' });
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
async function fixture(page, handler = () => undefined) {
  await mockSite(page, { role: 'user' });
  const requests = [];
  await page.route('https://*/rest/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), table = url.pathname.split('/').pop();
    requests.push({ table, url, method: request.method() });
    let data = await handler({ route, request, url, table });
    if (data === undefined) {
      if (table === 'friendships') data = profiles.map(p => ({ id: 'friend-' + p.id, requester_id: USER_ID, addressee_id: p.id, status: 'accepted' }));
      else if (table === 'public_profiles') data = profiles;
      else if (table === 'direct_messages') {
        const id = [A, B].find(id => url.searchParams.get('thread_id') === 'eq.' + thread(id));
        data = id ? [message(id, 'History for ' + id)] : [];
      } else return route.fallback();
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto('/chat.html');
  await expect(page.locator('[data-friend-id]')).toHaveCount(2);
  return requests;
}
async function back(page) {
  if (await page.locator('#chatBackBtn').isVisible()) await page.locator('#chatBackBtn').click();
}
async function open(page, id) { await back(page); await page.locator(`[data-friend-id="${id}"]`).click(); }

test('late history cannot overwrite a newer visit to the same conversation', async ({ page }) => {
  const old = gate(); let aRequests = 0;
  await fixture(page, async ({ table, url }) => {
    if (table === 'direct_messages' && url.searchParams.get('thread_id') === 'eq.' + thread(A)) {
      if (++aRequests === 1) { await old.promise; return [message(A, 'Stale first visit')]; }
      return [message(A, 'Current second visit')];
    }
  });
  await open(page, A); await expect.poll(() => aRequests).toBe(1);
  await expect(page.locator('#chatBody')).toBeDisabled();
  await open(page, B); await expect(page.locator('.chat-message')).toContainText('History for ' + B);
  await open(page, A); await expect(page.locator('.chat-message')).toContainText('Current second visit');
  const response = page.waitForResponse(r => r.url().includes('direct_messages') && r.url().includes(encodeURIComponent(thread(A))));
  old.release(); await response;
  await page.waitForTimeout(150);
  await expect(page.locator('.chat-message')).toHaveCount(1);
  await expect(page.locator('.chat-message')).toContainText('Current second visit');
  await expect(page.locator('#chatBody')).toBeEnabled();
});

test('draft text and attachments stay with their conversation', async ({ page }) => {
  await fixture(page); await open(page, A);
  await page.locator('#chatBody').fill('Draft for Ada');
  await page.locator('#chatMedia').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Draft attachment') });
  await expect(page.locator('#chatMediaPreview')).toContainText('notes.txt');
  await open(page, B); await expect(page.locator('#chatBody')).toHaveValue('');
  await expect(page.locator('#chatMediaPreview')).toBeEmpty();
  await page.locator('#chatBody').fill('Draft for Ben');
  await open(page, A); await expect(page.locator('#chatBody')).toHaveValue('Draft for Ada');
  await expect(page.locator('#chatMediaPreview')).toContainText('notes.txt');
  await open(page, B); await expect(page.locator('#chatBody')).toHaveValue('Draft for Ben');
});

test('a send completing after a switch preserves the new draft and clears only the sent draft', async ({ page }) => {
  const pending = gate(); let sent;
  await fixture(page, async ({ table, request }) => {
    if (table === 'direct_messages' && request.method() === 'POST') { sent = request.postDataJSON(); await pending.promise; return sent; }
  });
  await open(page, A); await page.locator('#chatBody').fill('Send to Ada'); await page.locator('#chatBody').press('Enter');
  await expect.poll(() => sent?.body).toBe('Send to Ada');
  await open(page, B); await page.locator('#chatBody').fill('Keep Ben draft');
  pending.release(); await expect(page.locator('#chatForm')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#chatBody')).toHaveValue('Keep Ben draft');
  expect(sent.recipient_id).toBe(A); expect(sent.thread_id).toBe(thread(A));
  await open(page, A); await expect(page.locator('#chatBody')).toHaveValue('');
});

test('people discovery queries public names and ignores obsolete results', async ({ page }) => {
  const old = gate(); const searches = [];
  await fixture(page, async ({ table, url }) => {
    if (table === 'public_profiles' && url.searchParams.has('or')) {
      searches.push(url);
      if (url.searchParams.get('or').includes('Older')) { await old.promise; return [{ id: 'old', display_name: 'Older result' }]; }
      return [{ id: '44444444-4444-4444-8444-444444444444', display_name: 'New person', username: 'newperson' }];
    }
  });
  await page.getByRole('button', { name: 'Find people', exact: true }).click();
  await page.locator('#peopleSearch').fill('Older'); await expect.poll(() => searches.length).toBe(1);
  await page.locator('#peopleSearch').fill('New'); await expect(page.locator('#peopleResults')).toContainText('New person');
  const response = page.waitForResponse(r => r.url().includes('public_profiles') && r.url().includes('Older'));
  old.release(); await response; await page.waitForTimeout(150);
  await expect(page.locator('#peopleResults')).toContainText('New person');
  await expect(page.locator('#peopleResults')).not.toContainText('Older result');
  await expect(page.locator('#peopleResults').getByRole('button', { name: 'Add friend' })).toBeEnabled();
  expect(searches[0].searchParams.get('select')).toBe('id,display_name,username,avatar_url');
  expect(searches[0].searchParams.get('limit')).toBe('20');
  await page.locator('#peopleSearch').fill(''); await expect(page.locator('#peopleResults')).toContainText('at least 2');
});

test('filtering the inbox uses cached previews instead of fetching messages per keystroke', async ({ page }) => {
  const requests = await fixture(page);
  const before = requests.filter(r => r.table === 'direct_messages').length;
  await page.locator('#chatSearch').fill('Ada'); await expect(page.locator('[data-friend-id]')).toHaveCount(1);
  await page.locator('#chatSearch').fill('Ben'); await expect(page.locator('[data-friend-id]')).toHaveCount(1);
  await page.locator('#chatSearch').fill(''); await expect(page.locator('[data-friend-id]')).toHaveCount(2);
  expect(requests.filter(r => r.table === 'direct_messages')).toHaveLength(before);
});

test('unread count uses an exact HEAD count above the REST row cap', async ({ page }) => {
  await mockSite(page); const requests = [];
  await page.route('https://*/rest/v1/notifications*', route => {
    requests.push(route.request());
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': '*/1500' }, body: '' });
  });
  await page.goto('/offline.html');
  const count = await page.evaluate(async userId => (await import('/assets/js/data.js')).fetchUnreadNotificationCount(userId), USER_ID);
  expect(count).toBe(1500); expect(requests).toHaveLength(1);
  expect(requests[0].method()).toBe('HEAD'); expect(requests[0].headers().prefer).toContain('count=exact');
});

test('realtime edits win over an older reconnect snapshot and connection status is honest', async ({ page }) => {
  const catchup = gate(); let history = 0;
  await fixture(page, async ({ table, url }) => {
    if (table === 'direct_messages' && url.searchParams.get('thread_id') === 'eq.' + thread(A)) {
      if (++history === 2) await catchup.promise;
      return [message(A, 'Before edit')];
    }
  });
  await page.evaluate(() => {
    const original = window.supabase.channel.bind(window.supabase);
    const remove = window.supabase.removeChannel.bind(window.supabase);
    window.chatChannels = [];
    window.supabase.channel = name => {
      if (!name.startsWith('timzee-chat-')) return original(name);
      const channel = { handlers: [], on(type, filter, fn) { this.handlers.push({ filter, fn }); return this; }, subscribe(fn) { this.status = fn; return this; } };
      window.chatChannels.push(channel); return channel;
    };
    window.supabase.removeChannel = channel => window.chatChannels.includes(channel) ? Promise.resolve('ok') : remove(channel);
  });
  await open(page, A); await expect(page.locator('#chatStatusText')).toHaveText('Connecting…');
  await expect(page.locator('#chatLiveDot')).not.toHaveClass(/is-live/);
  await page.evaluate(() => window.chatChannels[0].status('SUBSCRIBED'));
  await expect.poll(() => history).toBe(2);
  await expect(page.locator('#chatStatusText')).toHaveText('Connected');
  await page.evaluate(row => window.chatChannels[0].handlers.find(h => h.filter.event === 'UPDATE').fn({ new: row }), message(A, 'Edited during reconnect'));
  await expect(page.locator('.chat-message')).toContainText('Edited during reconnect');
  const response = page.waitForResponse(r => r.url().includes('direct_messages') && r.url().includes(encodeURIComponent(thread(A))));
  catchup.release(); await response; await page.waitForTimeout(150);
  await expect(page.locator('.chat-message')).toHaveCount(1);
  await expect(page.locator('.chat-message')).toContainText('Edited during reconnect');
  await page.evaluate(() => window.chatChannels[0].status('CHANNEL_ERROR'));
  await expect(page.locator('#chatStatusText')).toHaveText('Reconnecting…');
  await expect(page.locator('#chatLiveDot')).not.toHaveClass(/is-live/);
});

test('failed send keeps the draft and permits a deliberate retry', async ({ page }) => {
  await fixture(page); let attempts = 0;
  await page.route('https://*/rest/v1/direct_messages*', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const failed = ++attempts === 1;
    return route.fulfill({ status: failed ? 503 : 200, contentType: 'application/json', body: JSON.stringify(failed ? { message: 'Temporarily unavailable' } : route.request().postDataJSON()), headers: { 'access-control-allow-origin': '*' } });
  });
  await open(page, A); await page.locator('#chatBody').fill('Keep on failure');
  await page.locator('#chatBody').press('Enter'); await expect.poll(() => attempts).toBe(1);
  await expect(page.locator('#chatForm')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#chatBody')).toHaveValue('Keep on failure');
  await open(page, B); await open(page, A); await expect(page.locator('#chatBody')).toHaveValue('Keep on failure');
  await page.locator('#chatBody').press('Enter'); await expect(page.locator('#chatBody')).toHaveValue('');
  expect(attempts).toBe(2); await expect(page.locator('.chat-message').last()).toContainText('Keep on failure');
});


test('new private attachment saves its permanent path for recipient renewal', async ({ page }) => {
  let sent;
  await fixture(page, async ({ table, request }) => {
    if (table === 'direct_messages' && request.method() === 'POST') {
      sent = request.postDataJSON();
      return sent;
    }
  });
  await page.route('**/storage/v1/object/chat-media/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'chat-media/test-file' }) }));
  await page.route('**/.netlify/functions/chat-media-sign', route => {
    const storagePath = route.request().postDataJSON().path;
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        signedUrl: 'https://duvbcwwprkzzyzikmcol.supabase.co/storage/v1/object/sign/chat-media/' + storagePath + '?token=e30.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.test',
        path: storagePath, expiresIn: 3600
      })
    });
  });
  await open(page, A);
  await page.locator('#chatMedia').setInputFiles({ name: 'demo.txt', mimeType: 'text/plain', buffer: Buffer.from('private attachment') });
  await page.locator('#chatBody').fill('Attached file');
  await page.locator('#chatBody').press('Enter');
  await expect.poll(() => sent?.media_path || '').toMatch(/^direct-messages\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.txt$/);
  expect(sent.recipient_id).toBe(A);
  expect(sent.media_url).toContain('/storage/v1/object/sign/chat-media/' + sent.media_path);
});
