const test = require("node:test");
const assert = require("node:assert/strict");

test("new Nigerian listings use recognisable naira prices without conversion", async () => {
  const { formatMarketplacePrice } = await import("../assets/js/marketplace-currency.mjs");
  const result = formatMarketplacePrice(15000, "NGN");
  assert.match(result, /₦/);
  assert.match(result, /15,000/);
});

test("existing USD listings remain USD and global choices stay distinct", async () => {
  const { formatMarketplacePrice } = await import("../assets/js/marketplace-currency.mjs");
  assert.match(formatMarketplacePrice(18, "USD"), /\$/);
  assert.match(formatMarketplacePrice(18, "GBP"), /£/);
  assert.match(formatMarketplacePrice(18, "ZAR"), /R/);
  assert.notEqual(formatMarketplacePrice(18, "NGN"), formatMarketplacePrice(18, "USD"));
});

test("missing and invalid amounts never masquerade as zero", async () => {
  const { formatMarketplacePrice } = await import("../assets/js/marketplace-currency.mjs");
  for (const amount of [null, undefined, "", "oops", NaN, Infinity, -5]) {
    assert.equal(formatMarketplacePrice(amount, "NGN"), "Price unavailable");
  }
  assert.notEqual(formatMarketplacePrice(0, "NGN"), "Price unavailable");
});
