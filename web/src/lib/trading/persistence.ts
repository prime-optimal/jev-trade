import { DEFAULT_SETTINGS, persistableSettings, type TradingSettings } from "./settings";
import type { TradingNetwork } from "./networks";

export const NETWORK_STORAGE_KEY = "jev-trade:network:v1";
export const THEME_STORAGE_KEY = "jev-trade:theme:v1";
const PREFIX = "jev-trade:settings:v1";

export type SettingsOwner = string | null;
export type Theme = "light" | "dark";
export interface StorageNotice { message: string; denied: boolean }
export interface LoadedSettings { settings: TradingSettings; notice: StorageNotice | null; copiedGuest: boolean }

const memory = new Map<string, string>();
let storageDenied = false;

function normalizedOwner(owner: SettingsOwner): string {
  const value = owner?.trim().toLowerCase();
  if (!value) return "guest";
  if (!/^0x[0-9a-f]{40}$/.test(value)) throw new Error("Owner address must be a lowercase EVM address");
  return value;
}

export function settingsStorageKey(network: TradingNetwork, owner: SettingsOwner = null): string {
  return `${PREFIX}:${network}:${normalizedOwner(owner)}`;
}

function readValue(storage: Storage | null, key: string): string | null {
  if (!storage) { storageDenied = true; return memory.get(key) ?? null; }
  if (storageDenied) return memory.get(key) ?? null;
  try { return storage.getItem(key); }
  catch { storageDenied = true; return memory.get(key) ?? null; }
}

function writeValue(storage: Storage | null, key: string, value: string): boolean {
  memory.set(key, value);
  if (!storage) { storageDenied = true; return false; }
  if (storageDenied) return false;
  try { storage.setItem(key, value); return true; }
  catch { storageDenied = true; return false; }
}

export function storageFallbackNotice(): StorageNotice | null {
  return storageDenied ? { denied: true, message: "Settings will not survive a refresh." } : null;
}

export function loadSelectedNetwork(storage: Storage | null): { network: TradingNetwork; notice: StorageNotice | null } {
  const raw = readValue(storage, NETWORK_STORAGE_KEY);
  if (raw === "testnet" || raw === "mainnet") return { network: raw, notice: storageFallbackNotice() };
  if (raw !== null) return { network: "testnet", notice: { denied: false, message: "The saved network was invalid and has been reset." } };
  return { network: "testnet", notice: storageFallbackNotice() };
}

export function saveSelectedNetwork(storage: Storage | null, network: TradingNetwork): StorageNotice | null {
  const persisted = writeValue(storage, NETWORK_STORAGE_KEY, network);
  return persisted ? null : storageFallbackNotice();
}

export function loadTheme(storage: Storage | null, systemDark = false): { theme: Theme; notice: StorageNotice | null } {
  const raw = readValue(storage, THEME_STORAGE_KEY);
  if (raw === "light" || raw === "dark") return { theme: raw, notice: storageFallbackNotice() };
  if (raw !== null) return { theme: systemDark ? "dark" : "light", notice: { denied: false, message: "The saved theme was invalid and has been reset." } };
  return { theme: systemDark ? "dark" : "light", notice: storageFallbackNotice() };
}

export function saveTheme(storage: Storage | null, theme: Theme): StorageNotice | null {
  const persisted = writeValue(storage, THEME_STORAGE_KEY, theme);
  return persisted ? null : storageFallbackNotice();
}

export function loadSettings(storage: Storage | null, network: TradingNetwork, owner: SettingsOwner = null): LoadedSettings {
  const key = settingsStorageKey(network, owner);
  let raw = readValue(storage, key);
  let copiedGuest = false;
  if (raw === null && owner) {
    raw = readValue(storage, settingsStorageKey(network));
    if (raw !== null) copiedGuest = true;
  }
  if (raw === null) return { settings: { ...DEFAULT_SETTINGS, enabledCoins: [...DEFAULT_SETTINGS.enabledCoins], network }, notice: storageFallbackNotice(), copiedGuest };
  try {
    // Storage is untrusted, including values written by older versions.
    const settings = persistableSettings(JSON.parse(raw));
    if (settings.network !== network) throw new Error("Stored network does not match its scope");
    const safe = JSON.stringify(settings);
    if (copiedGuest || safe !== raw) writeValue(storage, key, safe);
    return { settings, notice: storageFallbackNotice(), copiedGuest };
  } catch {
    const reset = { ...DEFAULT_SETTINGS, enabledCoins: [...DEFAULT_SETTINGS.enabledCoins], network };
    writeValue(storage, key, JSON.stringify(persistableSettings(reset)));
    return {
      settings: reset,
      notice: { denied: false, message: "Saved settings were corrupt or from an unknown version and have been reset for this scope." },
      copiedGuest: false,
    };
  }
}

export function saveSettings(storage: Storage | null, settings: TradingSettings, owner: SettingsOwner = null): StorageNotice | null {
  const value = persistableSettings(settings);
  const memoryOnlyEndpoint = value.hyperliquidApiUrl !== settings.hyperliquidApiUrl
    || value.hyperliquidWsUrl !== settings.hyperliquidWsUrl
    || value.rpcUrl !== settings.rpcUrl;
  const persisted = writeValue(storage, settingsStorageKey(value.network, owner), JSON.stringify(value));
  const networkNotice = saveSelectedNetwork(storage, value.network);
  if (!persisted) return storageFallbackNotice();
  if (networkNotice) return networkNotice;
  return memoryOnlyEndpoint
    ? { denied: false, message: "Credential-bearing and provider base-path endpoint overrides remain in memory and must be re-entered after refresh." }
    : null;
}
