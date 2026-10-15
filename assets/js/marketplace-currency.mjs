const CURRENCY_LOCALES = {
  NGN: "en-NG", USD: "en-US", GBP: "en-GB", EUR: "en-IE",
  GHS: "en-GH", KES: "en-KE", ZAR: "en-ZA", TZS: "sw-TZ"
};

/** Format a stored amount in its selected currency without currency conversion. */
export function formatMarketplacePrice(price, currencyCode = "USD") {
  if (price === null || price === undefined || String(price).trim() === "") return "Price unavailable";
  const amount = Number(price);
  if (!Number.isFinite(amount) || amount < 0) return "Price unavailable";
  const currency = String(currencyCode || "USD").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return "Price unavailable";
  try {
    const locale = CURRENCY_LOCALES[currency] || "en";
    return new Intl.NumberFormat(locale, {
      style: "currency", currency, currencyDisplay: "symbol"
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString("en", { maximumFractionDigits: 2 })}`;
  }
}
