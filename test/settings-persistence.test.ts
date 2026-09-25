import { expect, test } from "bun:test";
import {
  DEBUG_STORAGE_KEY,
  loadDebug,
  loadSelectedNetwork,
  loadSettings,
  saveDebug,
  saveSettings,
  settingsStorageKey,
} from "../web/src/lib/trading/persistence";
import { DEFAULT_SETTINGS, type TradingSettings } from "../web/src/lib/trading/settings";

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, value); },
  };
}

function settings(changes: Partial<TradingSettings> = {}): TradingSettings {
  return { ...DEFAULT_SETTINGS, enabledCoins: [...DEFAULT_SETTINGS.enabledCoins], ...changes };
}

test("settings persistence isolates networks and copies guest values only on first owner use", () => {
  const local = storage();
  const owner = "0x1111111111111111111111111111111111111111";
  saveSettings(local, settings({ quoteUsd: 55 }), null);
  const first = loadSettings(local, "testnet", owner);
  expect(first.copiedGuest).toBe(true);
  expect(first.settings.quoteUsd).toBe(55);

  saveSettings(local, settings({ quoteUsd: 80 }), null);
  expect(loadSettings(local, "testnet", owner).settings.quoteUsd).toBe(55);

  saveSettings(local, settings({ network: "mainnet", quoteUsd: 90 }), owner);
  expect(loadSettings(local, "mainnet", owner).settings.quoteUsd).toBe(90);
  expect(loadSelectedNetwork(local).network).toBe("mainnet");
});

test("loading another guest network does not overwrite its saved scope", () => {
  const local = storage();
  saveSettings(local, settings({ quoteUsd: 55 }));
  saveSettings(local, settings({ network: "mainnet", quoteUsd: 91 }));
  expect(loadSettings(local, "testnet").settings.quoteUsd).toBe(55);
  expect(loadSettings(local, "mainnet").settings.quoteUsd).toBe(91);
});

test("corrupt scope resets without overwriting another scope", () => {
  const local = storage();
  const owner = "0x2222222222222222222222222222222222222222";
  saveSettings(local, settings({ network: "mainnet", quoteUsd: 77 }), owner);
  local.setItem(settingsStorageKey("testnet", owner), "{bad json");
  const corrupt = loadSettings(local, "testnet", owner);
  expect(corrupt.settings.quoteUsd).toBe(DEFAULT_SETTINGS.quoteUsd);
  expect(corrupt.notice?.message).toContain("corrupt");
  expect(JSON.parse(local.getItem(settingsStorageKey("testnet", owner)) ?? "{}").version).toBe(1);
  expect(loadSettings(local, "mainnet", owner).settings.quoteUsd).toBe(77);
});

test("debug preference defaults on, persists, and resets invalid values", () => {
  const local = storage();
  expect(loadDebug(local)).toEqual({ debug: true, notice: null });
  expect(saveDebug(local, false)).toBeNull();
  expect(loadDebug(local).debug).toBe(false);
  expect(saveDebug(local, true)).toBeNull();
  expect(loadDebug(local).debug).toBe(true);

  local.setItem(DEBUG_STORAGE_KEY, "banana");
  const invalid = loadDebug(local);
  expect(invalid.debug).toBe(true);
  expect(invalid.notice?.message).toBe("The saved debug preference was invalid and has been reset.");
});

test("denied storage uses memory and reports that settings are not durable", () => {
  const denied = {
    get length(): number { throw new Error("denied"); },
    clear() { throw new Error("denied"); },
    getItem() { throw new Error("denied"); },
    key() { throw new Error("denied"); },
    removeItem() { throw new Error("denied"); },
    setItem() { throw new Error("denied"); },
  } as Storage;
  const notice = saveSettings(denied, settings({ quoteUsd: 61 }));
  expect(notice?.message).toBe("Settings will not survive a refresh.");
  expect(loadSettings(denied, "testnet").settings.quoteUsd).toBe(61);
});
