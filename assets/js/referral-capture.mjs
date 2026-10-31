// Store only a short invitation code, never profile or authentication details.
// Storage is optional, bounded and expires; the server remains authoritative.
const KEY = "blipmood:pending-referral:v1";
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const CODE = /^BL[0-9A-F]{12}$/;
export const normalizeReferralCode = value => String(value || "").trim().toUpperCase();
export const validReferralCode = value => CODE.test(normalizeReferralCode(value));
export function pendingReferralCode() {
  try {
    const record = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!record || !CODE.test(record.code) ||
        !Number.isFinite(record.storedAt) || record.storedAt > Date.now() ||
        Date.now() - record.storedAt > MAX_AGE) {
      localStorage.removeItem(KEY);
      return "";
    }
    return record.code;
  } catch { return ""; }
}
export function captureReferralCode(search = typeof location === "undefined" ? "" : location.search) {
  const raw = new URLSearchParams(search).get("ref");
  if (raw === null) return pendingReferralCode();
  const code = normalizeReferralCode(raw);
  if (!validReferralCode(code)) return "";
  try { localStorage.setItem(KEY, JSON.stringify({code,storedAt:Date.now()})); } catch { /* private mode */ }
  return code;
}
export function clearPendingReferralCode() {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
}
if (typeof window !== "undefined" && window.location) captureReferralCode(window.location.search);
