"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FeedResult } from "@/lib/useFeed";
import { loadSelectedNetwork, loadSettings, loadTheme, saveSettings, saveTheme, type SettingsOwner, type Theme } from "./persistence";
import {
  authorizationChanged, DEFAULT_SETTINGS, effectiveEndpoints, validateApiKey, validateSettings,
  type ConnectionValidation, type RunSnapshot, type TradingSettings,
} from "./settings";

export interface BrowserTradingSnapshot {
  run: RunSnapshot;
  feed: FeedResult;
}

/** Browser-owned runtime. Applying settings or validating never starts a run. */
export interface BrowserTradingAdapter {
  getSnapshot: () => BrowserTradingSnapshot;
  subscribe: (listener: () => void) => () => void;
  invalidateAuthorization: () => void;
  applySettings: (settings: TradingSettings, apiKey?: string) => Promise<void>;
  validateConnection: (settings: TradingSettings, apiKey?: string) => Promise<ConnectionValidation>;
  start: (settings: TradingSettings, confirmReal: boolean) => Promise<void>;
  stop: () => Promise<void>;
  reconcile: () => Promise<void>;
}

interface SettingsContextValue {
  settings: TradingSettings;
  baseline: TradingSettings;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  save: (settings: TradingSettings, key?: string, clearedEndpoints?: (keyof TradingSettings)[]) => Promise<void>;
  loadNetworkDraft: (network: TradingSettings["network"]) => TradingSettings;
  run: RunSnapshot;
  connection: ConnectionValidation | null;
  notice: string | null;
  feed: FeedResult;
  apiKeyConfigured: boolean;
  validateConnection: (settings: TradingSettings, key?: string) => Promise<ConnectionValidation>;
  start: (confirmReal?: boolean) => Promise<void>;
  stop: () => Promise<void>;
  reconcile: () => Promise<void>;
  ready: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);
const IDLE_SNAPSHOT: BrowserTradingSnapshot = {
  run: { runId: null, status: "off", startedAt: null, deadlineAt: null, stoppedAt: null, durationMs: 0, stopReason: null, serverNow: 0 },
  feed: {
    meta: null, connection: "connecting", byCoin: {},
    loadTape: () => { throw new Error("The browser trading runtime is unavailable."); },
  },
};

function browserStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = theme === "dark" ? "#0b0d10" : "#ffffff";
}

export function SettingsProvider({ children, owner = null, adapter }: {
  children: ReactNode;
  owner?: SettingsOwner;
  adapter?: BrowserTradingAdapter;
}) {
  const [settings, setSettings] = useState<TradingSettings>({ ...DEFAULT_SETTINGS, enabledCoins: [...DEFAULT_SETTINGS.enabledCoins] });
  const [theme, setThemeState] = useState<Theme>("light");
  const [snapshot, setSnapshot] = useState<BrowserTradingSnapshot>(IDLE_SNAPSHOT);
  const [connection, setConnection] = useState<ConnectionValidation | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const keyRef = useRef<string | undefined>(undefined);
  const settingsRef = useRef(settings);
  const mutationRef = useRef(false);
  const revisionRef = useRef(0);
  const validationRef = useRef<{ settings: string; key: string | undefined } | null>(null);
  const baseline = useMemo(() => ({ ...DEFAULT_SETTINGS, enabledCoins: [...DEFAULT_SETTINGS.enabledCoins], network: settings.network }), [settings.network]);

  useEffect(() => {
    const storage = browserStorage();
    const selected = loadSelectedNetwork(storage);
    const loaded = loadSettings(storage, selected.network, owner);
    const appearance = loadTheme(storage, window.matchMedia("(prefers-color-scheme: dark)").matches);
    revisionRef.current++;
    adapter?.invalidateAuthorization();
    keyRef.current = undefined;
    validationRef.current = null;
    setApiKeyConfigured(false);
    setConnection(null);
    settingsRef.current = loaded.settings;
    setSettings(loaded.settings);
    setThemeState(appearance.theme);
    applyTheme(appearance.theme);
    setNotice(loaded.notice?.message ?? selected.notice?.message ?? appearance.notice?.message ?? null);
    setReady(true);
    // Loading browser preferences never connects a wallet or starts trading.
  }, [adapter, owner]);

  useEffect(() => {
    if (!adapter) { setSnapshot(IDLE_SNAPSHOT); return; }
    const update = () => setSnapshot(adapter.getSnapshot());
    const unsubscribe = adapter.subscribe(update);
    update();
    return unsubscribe;
  }, [adapter]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    const issue = saveTheme(browserStorage(), next);
    if (issue) setNotice(issue.message);
  }, []);

  const loadNetworkDraft = useCallback((network: TradingSettings["network"]) => {
    return loadSettings(browserStorage(), network, owner).settings;
  }, [owner]);

  const save = useCallback(async (draft: TradingSettings, key?: string, clearedEndpoints: (keyof TradingSettings)[] = []) => {
    if (!ready || mutationRef.current) throw new Error("Settings are busy.");
    const run = adapter?.getSnapshot().run ?? IDLE_SNAPSHOT.run;
    if (run.status !== "off" && run.status !== "expired") throw new Error("Stop trading to change these settings.");
    const valid = validateSettings(draft);
    for (const field of clearedEndpoints) {
      if (field !== "hyperliquidApiUrl" && field !== "hyperliquidWsUrl" && field !== "rpcUrl") throw new Error("Only endpoint overrides can be cleared.");
      valid[field] = null;
    }
    const previous = settingsRef.current;
    const changed = authorizationChanged(previous, valid);
    const credential = key === undefined
      ? changed ? undefined : keyRef.current
      : key === "" ? undefined : validateApiKey(key);
    const revision = ++revisionRef.current;
    mutationRef.current = true;
    try {
      if (changed || credential !== keyRef.current) adapter?.invalidateAuthorization();
      validationRef.current = null;
      setConnection(null);
      await adapter?.applySettings(valid, credential);
      if (revision !== revisionRef.current) throw new Error("The settings scope changed before saving completed.");
      keyRef.current = credential;
      setApiKeyConfigured(credential !== undefined);
      settingsRef.current = valid;
      setSettings(valid);
      setNotice(saveSettings(browserStorage(), valid, owner)?.message ?? null);
    } finally { mutationRef.current = false; }
  }, [adapter, owner, ready]);

  const validateConnection = useCallback(async (draft: TradingSettings, key?: string) => {
    if (!adapter) throw new Error("The browser trading runtime is unavailable.");
    if (mutationRef.current) throw new Error("Settings are busy.");
    const run = adapter.getSnapshot().run;
    if (run.status !== "off" && run.status !== "expired") throw new Error("Stop trading before validating connections.");
    const valid = validateSettings(draft);
    const credential = key === undefined
      ? effectiveEndpoints(valid).apiUrl === effectiveEndpoints(settingsRef.current).apiUrl ? keyRef.current : undefined
      : key === "" ? undefined : validateApiKey(key);
    const revision = ++revisionRef.current;
    const checked = await adapter.validateConnection(valid, credential);
    if (revision === revisionRef.current) {
      validationRef.current = { settings: JSON.stringify(valid), key: credential };
      setConnection(checked);
    }
    return checked;
  }, [adapter]);

  const start = useCallback(async (confirmReal = false) => {
    if (!adapter) throw new Error("The browser trading runtime is unavailable.");
    if (!ready || mutationRef.current) throw new Error("Settings are busy.");
    const current = settingsRef.current;
    const run = adapter.getSnapshot().run;
    if (run.status !== "off" && run.status !== "expired") throw new Error("Stop the current run before starting another.");
    if (!current.enabledCoins.length) throw new Error("Enable at least one asset.");
    if (!connection?.ok || validationRef.current?.settings !== JSON.stringify(current) || validationRef.current.key !== keyRef.current) {
      throw new Error("Validate the applied connection before starting.");
    }
    if (current.mode === "real" && (!connection.realAllowed || !confirmReal)) throw new Error("Authorize and confirm real trading before starting.");
    await adapter.start(current, confirmReal);
  }, [adapter, connection, ready]);

  const stop = useCallback(async () => {
    if (!adapter) throw new Error("The browser trading runtime is unavailable.");
    await adapter.stop();
  }, [adapter]);

  const reconcile = useCallback(async () => {
    if (!adapter) throw new Error("The browser trading runtime is unavailable.");
    await adapter.reconcile();
  }, [adapter]);

  const value = useMemo<SettingsContextValue>(() => ({
    settings, baseline, theme, setTheme, save, loadNetworkDraft,
    run: snapshot.run, feed: snapshot.feed, connection, notice, apiKeyConfigured,
    validateConnection, start, stop, reconcile, ready,
  }), [settings, baseline, theme, setTheme, save, loadNetworkDraft, snapshot, connection, notice, apiKeyConfigured, validateConnection, start, stop, reconcile, ready]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useSettings must be used inside SettingsProvider");
  return value;
}
