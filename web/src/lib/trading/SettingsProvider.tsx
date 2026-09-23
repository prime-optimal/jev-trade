"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFeed, type FeedResult } from "@/lib/useFeed";
import {
  applyOperatorSettings, applyVisitorSettings, createVisitorSession, getOperator, getRun, OFF_RUN, OperatorRequestError,
  reconcileOperator, resolveOperatorApiUrl, resolvePublicApiUrl, SESSION_API, startOperator, stopOperator,
  validateOperatorConnection,
} from "./operator";
import { loadSelectedNetwork, loadSettings, loadTheme, saveTheme, type SettingsOwner, type Theme } from "./persistence";
import {
  DEFAULT_SETTINGS, effectiveEndpoints, validateApiKey, validateSettings,
  type ConnectionValidation, type OperatorSnapshot, type RunSnapshot, type TradingSettings,
} from "./settings";

type Scope = "visitor" | "operator";
type SessionState = "local" | "connecting" | "ready" | "error" | "expired";
type SessionOperatorSnapshot = OperatorSnapshot & { paperOnly?: boolean };

interface SettingsContextValue {
  settings: TradingSettings;
  baseline: TradingSettings;
  scope: Scope;
  sessionState: SessionState;
  reconnect: () => Promise<void>;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  save: (settings: TradingSettings, key?: string, clearedEndpoints?: (keyof TradingSettings)[]) => Promise<void>;
  loadNetworkDraft: (network: TradingSettings["network"]) => TradingSettings;
  run: RunSnapshot;
  connection: ConnectionValidation | null;
  operator: OperatorSnapshot | null;
  notice: string | null;
  feed: FeedResult;
  validateConnection: (settings: TradingSettings, key?: string) => Promise<ConnectionValidation>;
  start: (confirmReal?: boolean) => Promise<void>;
  stop: () => Promise<void>;
  reconcile: () => Promise<void>;
  ready: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);
type EndpointMemory = Partial<Pick<TradingSettings, "hyperliquidApiUrl" | "hyperliquidWsUrl" | "rpcUrl">>;

function endpointHost(settings: TradingSettings): string {
  return new URL(effectiveEndpoints(settings).apiUrl).host.toLowerCase();
}

function withMemoryEndpoints(settings: TradingSettings, redacted: (keyof TradingSettings)[], memory: EndpointMemory): TradingSettings {
  const next = { ...settings };
  for (const field of ["hyperliquidApiUrl", "hyperliquidWsUrl", "rpcUrl"] as const) {
    if (redacted.includes(field) && memory[field]) next[field] = memory[field] ?? null;
  }
  return next;
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

export function SettingsProvider({ children, owner = null }: { children: ReactNode; owner?: SettingsOwner }) {
  const publicApi = useMemo(resolvePublicApiUrl, []);
  const localOperatorApi = useMemo(resolveOperatorApiUrl, []);
  const isVisitor = !localOperatorApi;
  const controlApi = isVisitor ? SESSION_API : localOperatorApi;
  const [settings, setSettings] = useState<TradingSettings>({ ...DEFAULT_SETTINGS, enabledCoins: [...DEFAULT_SETTINGS.enabledCoins] });
  const [baseline, setBaseline] = useState<TradingSettings>({ ...DEFAULT_SETTINGS, enabledCoins: [...DEFAULT_SETTINGS.enabledCoins] });
  const [theme, setThemeState] = useState<Theme>("light");
  const [run, setRun] = useState<RunSnapshot>(OFF_RUN);
  const [connection, setConnection] = useState<ConnectionValidation | null>(null);
  const [operator, setOperator] = useState<OperatorSnapshot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>(isVisitor ? "connecting" : "local");
  const keyRef = useRef<string | undefined>(undefined);
  const keyHostRef = useRef<string | null>(null);
  const bootstrapStartedRef = useRef(false);
  const mutationRef = useRef(0);
  const endpointMemoryRef = useRef<EndpointMemory>({});
  const feedApi = isVisitor ? SESSION_API : publicApi;
  const feed = useFeed(feedApi, !isVisitor || sessionState === "ready");
  const ready = isVisitor ? sessionState === "ready" : operator !== null;

  const applySnapshot = useCallback((snapshot: SessionOperatorSnapshot) => {
    const visible = isVisitor ? snapshot.settings : withMemoryEndpoints(snapshot.settings, snapshot.redactedEndpoints, endpointMemoryRef.current);
    setOperator(snapshot);
    setSettings((current) => JSON.stringify(current) === JSON.stringify(visible) ? current : visible);
    setBaseline((current) => JSON.stringify(current) === JSON.stringify(snapshot.baseline) ? current : snapshot.baseline);
    setConnection(snapshot.connection);
    setRun(snapshot.run);
    if (isVisitor) setSessionState("ready");
  }, [isVisitor]);

  const expireSession = useCallback((error: unknown): boolean => {
    if (!isVisitor || !(error instanceof OperatorRequestError) || error.status !== 401 && error.status !== 410) return false;
    setSessionState("expired");
    setNotice("Your paper session expired. Reconnect to create a new session.");
    setOperator(null);
    return true;
  }, [isVisitor]);

  const reconnect = useCallback(async () => {
    if (!isVisitor) return;
    setSessionState("connecting");
    setNotice(null);
    try {
      applySnapshot(await createVisitorSession());
    } catch (error) {
      setSessionState("error");
      setNotice(error instanceof Error ? error.message : "The paper session could not connect.");
      throw error;
    }
  }, [applySnapshot, isVisitor]);

  useEffect(() => {
    const storage = (() => { try { return window.localStorage; } catch { return null; } })();
    const selected = loadSelectedNetwork(storage);
    const loaded = loadSettings(storage, selected.network, owner);
    const appearance = loadTheme(storage, window.matchMedia("(prefers-color-scheme: dark)").matches);
    setThemeState(appearance.theme);
    applyTheme(appearance.theme);
    if (!isVisitor) {
      setSettings(loaded.settings);
      setBaseline(loaded.settings);
      setNotice(loaded.notice?.message ?? selected.notice?.message ?? appearance.notice?.message ?? null);
    } else if (!bootstrapStartedRef.current) {
      bootstrapStartedRef.current = true;
      setNotice(appearance.notice?.message ?? null);
      void reconnect().catch(() => {});
    }
  }, [isVisitor, owner, reconnect]);

  useEffect(() => {
    if (!controlApi || (isVisitor && sessionState !== "ready")) return;
    let stopped = false;
    let controller: AbortController | null = null;
    const poll = async () => {
      controller?.abort();
      controller = new AbortController();
      const revision = mutationRef.current;
      try {
        const snapshot = await getOperator(controlApi, controller.signal);
        if (!stopped && revision === mutationRef.current) applySnapshot(snapshot);
      } catch (error) {
        if (stopped || error instanceof DOMException && error.name === "AbortError") return;
        if (!expireSession(error) && !isVisitor) setOperator(null);
      }
    };
    void poll();
    const interval = window.setInterval(poll, 5_000);
    return () => { stopped = true; controller?.abort(); window.clearInterval(interval); };
  }, [applySnapshot, controlApi, expireSession, isVisitor, sessionState]);

  useEffect(() => {
    if (isVisitor) return;
    let stopped = false;
    const poll = async () => {
      const revision = mutationRef.current;
      try {
        const snapshot = await getRun(publicApi);
        if (!stopped && revision === mutationRef.current) setRun(snapshot);
      } catch {
        if (!stopped) setNotice((current) => current ?? "Run status is temporarily unavailable.");
      }
    };
    void poll();
    const interval = window.setInterval(poll, 2_000);
    return () => { stopped = true; window.clearInterval(interval); };
  }, [isVisitor, publicApi]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    const storage = (() => { try { return window.localStorage; } catch { return null; } })();
    const issue = saveTheme(storage, next);
    if (issue) setNotice(issue.message);
  }, []);

  const loadNetworkDraft = useCallback((network: TradingSettings["network"]) => ({ ...settings, network }), [settings]);

  const save = useCallback(async (draft: TradingSettings, key?: string, clearedEndpoints: (keyof TradingSettings)[] = []) => {
    if (!controlApi) throw new Error("Trading control is unavailable.");
    if (run.status !== "off" && run.status !== "expired") throw new Error("Stop trading to change these settings.");
    const valid = validateSettings(draft);
    if (isVisitor) {
      if (valid.mode !== "paper") throw new Error("Visitor sessions are paper-only.");
      if (valid.tickMs < 30_000) throw new Error("Visitor decision cadence must be at least 30000 ms.");
      if (valid.hyperliquidApiUrl || valid.hyperliquidWsUrl || valid.rpcUrl || key || clearedEndpoints.length) {
        throw new Error("Visitor paper sessions use official venue endpoints without credentials.");
      }
    }
    let credential = key;
    const nextHost = endpointHost(valid);
    if (!isVisitor && endpointHost(settings) !== nextHost && credential === undefined && (keyRef.current || operator?.apiKeyConfigured)) credential = "";
    const validatedKey = credential === undefined || credential === "" ? credential : validateApiKey(credential);
    const revision = ++mutationRef.current;
    try {
      const snapshot = isVisitor
        ? await applyVisitorSettings(controlApi, valid)
        : await applyOperatorSettings(controlApi, valid, validatedKey, clearedEndpoints);
      if (revision !== mutationRef.current) return;
      if (!isVisitor) {
        for (const field of ["hyperliquidApiUrl", "hyperliquidWsUrl", "rpcUrl"] as const) {
          if (clearedEndpoints.includes(field)) delete endpointMemoryRef.current[field];
          else if (valid[field]) endpointMemoryRef.current[field] = valid[field];
        }
      }
      applySnapshot(snapshot);
      if (validatedKey === "") { keyRef.current = undefined; keyHostRef.current = null; }
      else if (validatedKey) { keyRef.current = validatedKey; keyHostRef.current = nextHost; }
    } catch (error) {
      expireSession(error);
      throw error;
    }
  }, [applySnapshot, controlApi, expireSession, isVisitor, operator, run.status, settings]);

  const validateConnection = useCallback(async (draft: TradingSettings, key?: string) => {
    if (!controlApi) throw new Error("Connection validation is unavailable.");
    if (run.status !== "off" && run.status !== "expired") throw new Error("Stop trading before validating connections.");
    const valid = validateSettings(draft);
    if (isVisitor && (valid.mode !== "paper" || valid.hyperliquidApiUrl || valid.hyperliquidWsUrl || valid.rpcUrl || key)) {
      throw new Error("Visitor paper sessions use official venue endpoints without credentials.");
    }
    const credential = isVisitor ? undefined : key === undefined ? endpointHost(valid) === keyHostRef.current ? keyRef.current : undefined : key === "" ? "" : validateApiKey(key);
    try {
      const checked = await validateOperatorConnection(controlApi, valid, credential);
      setConnection(checked);
      return checked;
    } catch (error) {
      expireSession(error);
      throw error;
    }
  }, [controlApi, expireSession, isVisitor, run.status]);

  const start = useCallback(async (confirmReal = false) => {
    if (!controlApi) throw new Error("Trading control is unavailable.");
    if (settings.enabledCoins.length === 0) throw new Error("Enable at least one asset.");
    if (!isVisitor && (!connection?.ok || settings.mode === "real" && !connection.realAllowed)) throw new Error("Validate a compatible connection before starting.");
    const revision = ++mutationRef.current;
    try {
      const snapshot = await startOperator(controlApi, isVisitor ? false : confirmReal);
      if (revision === mutationRef.current) setRun(snapshot);
    } catch (error) { expireSession(error); throw error; }
  }, [connection, controlApi, expireSession, isVisitor, settings]);

  const stop = useCallback(async () => {
    if (!controlApi) throw new Error("Trading control is unavailable.");
    const revision = ++mutationRef.current;
    try {
      const snapshot = await stopOperator(controlApi);
      if (revision === mutationRef.current) setRun(snapshot);
    } catch (error) { expireSession(error); throw error; }
  }, [controlApi, expireSession]);

  const reconcile = useCallback(async () => {
    if (!controlApi) throw new Error("Cleanup reconciliation is unavailable.");
    try {
      const snapshot = await reconcileOperator(controlApi);
      setRun(snapshot);
    } catch (error) { expireSession(error); throw error; }
  }, [controlApi, expireSession]);

  const value = useMemo<SettingsContextValue>(() => ({
    settings, baseline, scope: isVisitor ? "visitor" : "operator", sessionState, reconnect, theme, setTheme,
    save, loadNetworkDraft, run, connection, operator, notice, validateConnection, start, stop, reconcile, feed, ready,
  }), [settings, baseline, isVisitor, sessionState, reconnect, theme, setTheme, save, loadNetworkDraft, run, connection, operator, notice, validateConnection, start, stop, reconcile, feed, ready]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useSettings must be used inside SettingsProvider");
  return value;
}
