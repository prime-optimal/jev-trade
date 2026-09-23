import { afterEach, expect, test } from "bun:test";
import { config } from "../src/config";
import type { Feed } from "../src/feed";
import { Market } from "../src/market";

const dryRun = config.dryRun;
afterEach(() => {
  config.dryRun = dryRun;
});

test("a sleeve without a wallet key simulates fills even when real mode is selected", () => {
  config.dryRun = false;
  const market = new Market({} as Feed, { coin: "BTC", pair: "BTC-USD", label: "BTC" });
  expect(market.wallet).toBeNull();
  expect(market.address).toBeNull();
});

test("a keyed sleeve in real mode keeps its wallet", () => {
  config.dryRun = false;
  const market = new Market({} as Feed, {
    coin: "BTC",
    pair: "BTC-USD",
    label: "BTC",
    privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  });
  expect(market.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
});
