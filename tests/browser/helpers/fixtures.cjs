const USER_ID = '11111111-1111-4111-8111-111111111111';
const POST_ID = '33333333-3333-4333-8333-333333333333';
const CATEGORY_ID = '44444444-4444-4444-8444-444444444444';
const records = {
  categories: [{ id: CATEGORY_ID, name: 'Engineering', color: '#087f73', description: 'How good software gets made' }],
  posts: [{ id: POST_ID, title: 'Building technology that works for everyone', content: '<p>Practical lessons in accessibility, performance, and thoughtful product design.</p>', author_id: USER_ID, author_name: 'Alex Morgan', category_id: CATEGORY_ID, status: 'published', created_at: '2026-10-06T08:00:00Z', tags: ['design', 'engineering'], pinned: true }],
  marketplace_items: [{ id: POST_ID, user_id: USER_ID, title: 'Mechanical keyboard for your next project', price: 85, currency: 'USD', category: 'hardware', condition: 'like-new', seller_name: 'Alex Morgan', is_available: true, location: 'Lagos', images: [], view_count: 12 }],
  videos: [{ id: POST_ID, title: 'A practical guide to accessible interfaces', user_id: USER_ID, author_name: 'Alex Morgan', is_public: true, category: 'tutorial', duration: 180, created_at: '2026-10-06T08:00:00Z', view_count: 24, like_count: 4 }],
  discussion_topics: [{ id: POST_ID, title: 'What makes an app feel fast?', description: 'Share the small performance improvements that made a difference.', author_id: USER_ID, author_name: 'Alex Morgan', created_at: '2026-10-06T08:00:00Z' }],
  novels: [{ id: POST_ID, title: 'The last signal', author_id: USER_ID, author_name: 'Alex Morgan', description: 'An engineer discovers a message from an abandoned network.', status: 'ongoing', created_at: '2026-10-06T08:00:00Z', genres: ['Science fiction'] }]
};
async function mockSite(page, { role = null, populated = false } = {}) {
  const user = { id: USER_ID, email: 'review@example.test', user_metadata: { display_name: 'Alex Morgan' }, app_metadata: { role: role || 'user' } };
  const profile = { id: USER_ID, display_name: 'Alex Morgan', username: 'alex', role: role || 'user', account_status: 'active', allow_messages: true, allow_requests: true, show_email: false };
  await page.addInitScript(({ user, authenticated }) => {
    localStorage.setItem('timzee_cookie_consent', 'declined');
    localStorage.setItem('timzee-theme', 'light');
    if (authenticated) {
      const expires_at = Math.floor(Date.now() / 1000) + 3600;
      const token = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' + btoa(JSON.stringify({ sub: user.id, exp: expires_at, role: 'authenticated' })) + '.fixture';
      localStorage.setItem('sb-duvbcwwprkzzyzikmcol-auth-token', JSON.stringify({ access_token: token, refresh_token: 'fixture-only', expires_at, token_type: 'bearer', user }));
    }
  }, { user, authenticated: !!role });
  await page.route('https://**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (!url.hostname.endsWith('.supabase.co')) return route.abort();
    const table = url.pathname.split('/').pop();
    const single = (request.headers().accept || '').includes('object+json');
    let value = single ? null : [];
    if (url.pathname === '/auth/v1/user') value = user;
    else if (table === 'profiles') value = single ? profile : [profile];
    else if (table === 'public_profiles') value = single ? profile : [profile];
    else if (table === 'user_settings') value = single ? { preferences: {} } : [];
    else if (populated && records[table]) value = single ? records[table][0] : records[table];
    else if (populated && ['get_popular_posts', 'get_trending_posts'].includes(table)) value = records.posts;
    else if (populated && table.endsWith('discussion_topics')) value = records.discussion_topics;
    else if (populated && ['get_personalized_feed', 'get_following_feed'].includes(table)) value = [{ ...records.posts[0], content_id: POST_ID, content_type: 'post', excerpt: 'A fixture article used only by local tests.' }];
    if (request.method() === 'POST' && !url.pathname.includes('/rpc/')) value = request.postDataJSON();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value), headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/1' } });
  });
  await page.route('**/.netlify/functions/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, users: [], admins: [], data: [], healthy: true }) }));
  await page.routeWebSocket('wss://**/*', socket => socket.close());
  return { user, profile };
}
module.exports = { mockSite, USER_ID, POST_ID, records };
