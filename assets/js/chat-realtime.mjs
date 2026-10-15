/* One owned subscription per conversation. Database row policies remain the
   authority; no public broadcast or presence channel exposes member identity. */
export function createChatRealtime(client, {
  onStatus = () => {}, onMessage = () => {}, onConnected = () => {},
  onError = () => {}, canConnect = () => true,
  setTimer = setTimeout, clearTimer = clearTimeout,
  randomId = () => crypto.randomUUID(), random = Math.random
} = {}) {
  let generation = 0, thread = '', channel = null, retryTimer, connectTimer;
  let attempts = 0, retiring = Promise.resolve();
  const clearTimers = () => { clearTimer(retryTimer); clearTimer(connectTimer); retryTimer = connectTimer = undefined; };
  const retire = () => {
    const previous = channel; channel = null;
    if (previous) retiring = retiring.then(() => client.removeChannel(previous)).catch(onError);
    return retiring;
  };
  async function connect(version) {
    await retiring;
    if (version !== generation || !thread) return;
    if (!canConnect()) { onStatus('offline'); return; }
    const currentThread = thread;
    const current = client.channel(`timzee-chat-${currentThread}-${randomId()}`);
    channel = current;
    const owns = () => version === generation && channel === current;
    const failed = () => {
      if (!owns()) return;
      clearTimer(connectTimer); connectTimer = undefined;
      void retire();
      onStatus(canConnect() ? 'reconnecting' : 'offline');
      if (!canConnect()) return;
      const delay = Math.min(30000, 1500 * 2 ** Math.min(attempts++, 5)) + Math.floor(random() * 500);
      retryTimer = setTimer(() => { retryTimer = undefined; void connect(version).catch(onError); }, delay);
    };
    for (const event of ['INSERT', 'UPDATE']) current.on('postgres_changes', {
      event, schema: 'public', table: 'direct_messages', filter: `thread_id=eq.${currentThread}`
    }, payload => {
      if (!owns() || payload.new?.thread_id !== currentThread) return;
      Promise.resolve().then(() => { if (owns()) return onMessage(event, payload.new, currentThread); }).catch(onError);
    });
    onStatus('connecting');
    connectTimer = setTimer(failed, 10000);
    current.subscribe(status => {
      if (!owns()) return;
      if (status === 'SUBSCRIBED') {
        clearTimer(connectTimer); connectTimer = undefined; attempts = 0;
        onStatus('connected');
        Promise.resolve().then(() => { if (owns()) return onConnected(currentThread); }).catch(onError);
      } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) failed();
    });
  }
  return {
    async start(threadId) {
      const version = ++generation; thread = threadId; attempts = 0;
      clearTimers(); await retire();
      if (version === generation) await connect(version);
    },
    stop() { ++generation; thread = ''; clearTimers(); return retire(); }
  };
}
