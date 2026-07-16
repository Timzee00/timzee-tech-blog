import { supabase } from "./supabase.js";

let channel = null;
let lastCount = 0;
const listeners = new Set();

function countPresence(state = {}) {
  return Object.values(state).reduce((sum, entries) => sum + (entries?.length || 0), 0);
}

function notify() {
  if (!channel) return;
  const count = countPresence(channel.presenceState());
  if (count === lastCount) return;
  lastCount = count;
  listeners.forEach((cb) => cb(count));
}

export function startPresence(page = "site") {
  if (!channel) {
    let key = "";
    try {
      key = localStorage.getItem("presence_key") || "";
    } catch (error) {
      key = "";
    }
    if (!key) {
      key = crypto.randomUUID();
      try {
        localStorage.setItem("presence_key", key);
      } catch (error) {
        // Ignore localStorage failures (private mode).
      }
    }
    channel = supabase.channel("site-presence", {
      config: {
        presence: { key }
      }
    });
    channel
      .on("presence", { event: "sync" }, notify)
      .on("presence", { event: "join" }, notify)
      .on("presence", { event: "leave" }, notify)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            page,
            entered_at: new Date().toISOString()
          });
          notify();
        }
      });
  } else if (page) {
    channel.track({
      page,
      entered_at: new Date().toISOString()
    });
  }
  return channel;
}

export function onPresenceUpdate(callback) {
  listeners.add(callback);
  if (lastCount) callback(lastCount);
  return () => listeners.delete(callback);
}

export function getPresenceCount() {
  if (!channel) return 0;
  return countPresence(channel.presenceState());
}
