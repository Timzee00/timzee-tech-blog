const PREFIX = 'timzee_chat_context:';
const MAX_AGE = 5 * 60 * 1000;
export function storeChatContext(text, userId, storage = sessionStorage, now = Date.now()) {
  if (!userId || !text || text.length > 12000) throw new Error('Select a shorter message for the assistant.');
  // Remove expired handoffs, including any left behind by interrupted navigation.
  for (let i = storage.length - 1; i >= 0; i--) {
    const key = storage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    try { if (now - JSON.parse(storage.getItem(key)).createdAt < MAX_AGE) continue; } catch (_) {}
    storage.removeItem(key);
  }
  const id = crypto.randomUUID();
  storage.setItem(PREFIX + id, JSON.stringify({ text, userId, createdAt: now }));
  return id;
}
export function takeChatContext(id, userId, storage = sessionStorage, now = Date.now()) {
  if (!/^[a-f0-9-]{36}$/i.test(id || '')) return '';
  const key = PREFIX + id, raw = storage.getItem(key);
  storage.removeItem(key);
  try {
    const value = JSON.parse(raw);
    return value.userId === userId && typeof value.text === 'string' && value.text.length <= 12000
      && now >= value.createdAt && now - value.createdAt < MAX_AGE ? value.text : '';
  } catch (_) { return ''; }
}
