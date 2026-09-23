"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createBrowserTradingAdapter, EMPTY_TRADING_SNAPSHOT, type BrowserTradingAdapter, type BrowserTradingSnapshot } from "../useFeedTransport";
import { loadSelectedNetwork, loadSettings, loadTheme, saveSettings, saveTheme, type SettingsOwner, type Theme } from "./persistence";
import { DEFAULT_SETTINGS, validateApiKey, validateSettings, type ConnectionValidation, type TradingSettings } from "./settings";
export type { BrowserTradingAdapter, BrowserTradingSnapshot } from "../useFeedTransport";

interface SettingsContextValue extends BrowserTradingSnapshot {
  settings: TradingSettings; baseline: TradingSettings; theme: Theme;
  setTheme(theme: Theme): void;
  save(settings: TradingSettings, key?: string, clearedEndpoints?: (keyof TradingSettings)[]): Promise<void>;
  loadNetworkDraft(network: TradingSettings["network"]): TradingSettings;
  connection: ConnectionValidation | null; notice: string | null; apiKeyConfigured: boolean; ready: boolean;
  validateConnection(settings: TradingSettings, key?: string): Promise<ConnectionValidation>;
  connect(): Promise<void>; disconnect(): Promise<void>; prepareNetwork(): Promise<void>; authorize(replace?: boolean): Promise<void>;
  start(confirmReal?: boolean): Promise<void>; stop(): Promise<void>; reconcile(): Promise<void>;
}
const SettingsContext = createContext<SettingsContextValue | null>(null);
function browserStorage(): Storage | null { try { return window.localStorage; } catch { return null; } }
function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement("meta"); meta.name = "theme-color"; document.head.appendChild(meta); }
  meta.content = theme === "dark" ? "#0b0d10" : "#ffffff";
}

export function SettingsProvider({ children, owner = null, adapter: injected }: { children: ReactNode; owner?: SettingsOwner; adapter?: BrowserTradingAdapter }) {
  const [settings, setSettings] = useState<TradingSettings>({ ...DEFAULT_SETTINGS, enabledCoins: [...DEFAULT_SETTINGS.enabledCoins] });
  const [theme, setThemeState] = useState<Theme>("light");
  const [snapshot, setSnapshot] = useState(EMPTY_TRADING_SNAPSHOT);
  const [connection, setConnection] = useState<ConnectionValidation | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const runtime = useRef<BrowserTradingAdapter | null>(null);
  const settingsRef = useRef(settings);
  const revision = useRef(0);
  const busy = useRef(false);
  const lifetime = useRef(0);
  const baseline = useMemo(() => ({ ...DEFAULT_SETTINGS, enabledCoins: [...DEFAULT_SETTINGS.enabledCoins], network: settings.network }), [settings.network]);

  useEffect(() => {
    const token = ++lifetime.current;
    let active = true;
    if (!runtime.current) {
      runtime.current = injected ?? createBrowserTradingAdapter();
      const storage = browserStorage();
      const selected = loadSelectedNetwork(storage);
      const loaded = loadSettings(storage, selected.network, owner);
      const appearance = loadTheme(storage, window.matchMedia("(prefers-color-scheme: dark)").matches);
      settingsRef.current = loaded.settings; setSettings(loaded.settings);
      setThemeState(appearance.theme); applyTheme(appearance.theme);
      setNotice(loaded.notice?.message ?? selected.notice?.message ?? appearance.notice?.message ?? null);
      void runtime.current.applySettings(loaded.settings).then(() => { if (active) setReady(true); }).catch(error => { if (active) setNotice(error instanceof Error ? error.message : "Settings could not be loaded."); });
    } else setReady(true);
    const adapter = runtime.current;
    const update = () => { if (active) setSnapshot(adapter.getSnapshot()); };
    const unsubscribe = adapter.subscribe(update); update();
    return () => {
      active = false; unsubscribe();
      // React Strict Mode replays effects synchronously. Only a real unmount disposes.
      queueMicrotask(() => {
        if (lifetime.current !== token) return;
        runtime.current = null;
        if (!injected) void adapter.dispose();
      });
    };
  }, [injected, owner]);

  const requireRuntime = useCallback(() => {
    if (!runtime.current) throw new Error("The browser trading runtime is unavailable.");
    return runtime.current;
  }, []);
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next); applyTheme(next);
    const issue = saveTheme(browserStorage(), next); if (issue) setNotice(issue.message);
  }, []);
  const loadNetworkDraft = useCallback((network: TradingSettings["network"]) => loadSettings(browserStorage(), network, owner).settings, [owner]);
  const save = useCallback(async (draft: TradingSettings, key?: string, clearedEndpoints: (keyof TradingSettings)[] = []) => {
    if (!ready || busy.current) throw new Error("Settings are busy.");
    const adapter = requireRuntime();
    if (!["off", "expired"].includes(adapter.getSnapshot().run.status)) throw new Error("Stop trading before changing settings.");
    const valid = validateSettings(draft);
    for (const field of clearedEndpoints) {
      if (field !== "hyperliquidApiUrl" && field !== "hyperliquidWsUrl" && field !== "rpcUrl") throw new Error("Only endpoint overrides can be cleared.");
      valid[field] = null;
    }
    busy.current = true; revision.current++; setConnection(null);
    try {
      await adapter.applySettings(valid, key ? validateApiKey(key) : undefined);
      settingsRef.current = valid; setSettings(valid);
      setNotice(saveSettings(browserStorage(), valid, owner)?.message ?? null);
    } finally { busy.current = false; }
  }, [owner, ready, requireRuntime]);
  const validateConnection = useCallback(async (draft: TradingSettings, key?: string) => {
    if (busy.current) throw new Error("Settings are busy.");
    const token = ++revision.current;
    const valid = validateSettings(draft);
    const checked = await requireRuntime().validateConnection(valid, key ? validateApiKey(key) : undefined);
    if (revision.current === token && JSON.stringify(valid) === JSON.stringify(settingsRef.current)) setConnection(checked);
    return checked;
  }, [requireRuntime]);
  const start = useCallback(async (confirmReal = false) => {
    if (!ready || busy.current) throw new Error("Settings are busy.");
    if (!connection?.ok) throw new Error("Validate the applied connection before starting.");
    await requireRuntime().start(settingsRef.current, confirmReal);
  }, [connection, ready, requireRuntime]);
  const stop = useCallback(() => requireRuntime().stop(), [requireRuntime]);
  const reconcile = useCallback(() => requireRuntime().reconcile(), [requireRuntime]);
  const connect = useCallback(() => requireRuntime().connect(), [requireRuntime]);
  const disconnect = useCallback(() => requireRuntime().disconnect(), [requireRuntime]);
  const prepareNetwork = useCallback(() => requireRuntime().prepareNetwork(), [requireRuntime]);
  const authorize = useCallback((replace = false) => requireRuntime().authorize(replace), [requireRuntime]);
  const value = useMemo<SettingsContextValue>(() => ({ ...snapshot, settings, baseline, theme, setTheme, save, loadNetworkDraft,
    connection, notice, apiKeyConfigured: false, validateConnection, start, stop, reconcile, connect, disconnect, prepareNetwork, authorize, ready,
  }), [snapshot, settings, baseline, theme, setTheme, save, loadNetworkDraft, connection, notice, validateConnection, start, stop, reconcile, connect, disconnect, prepareNetwork, authorize, ready]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useSettings must be used inside SettingsProvider");
  return value;
}
