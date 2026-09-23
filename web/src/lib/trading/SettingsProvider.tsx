"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFeed } from "@/lib/useFeed";
import {
  applyOperatorSettings, getOperator, getRun, OFF_RUN, reconcileOperator, resolveOperatorApiUrl,
  resolvePublicApiUrl, startOperator, stopOperator, validateOperatorConnection,
} from "./operator";
import { loadSelectedNetwork, loadSettings, loadTheme, saveSettings, saveTheme, type SettingsOwner, type Theme } from "./persistence";
import {
  DEFAULT_SETTINGS, effectiveEndpoints, validateApiKey, validateSettings,
  type ConnectionValidation, type OperatorSnapshot, type RunSnapshot, type TradingSettings,
} from "./settings";

interface SettingsContextValue {
  settings: TradingSettings;
  baseline: TradingSettings;
  scope: "guest" | "operator";
  theme: Theme;
  setTheme: (theme: Theme) => void;
  save: (settings: TradingSettings, key?: string, clearedEndpoints?: (keyof TradingSettings)[]) => Promise<void>;
  loadNetworkDraft: (network: TradingSettings["network"]) => TradingSettings;
  run: RunSnapshot;
  connection: ConnectionValidation | null;
  operator: OperatorSnapshot | null;
  notice: string | null;
  validateConnection: (settings: TradingSettings, key?: string) => Promise<ConnectionValidation>;
  start: (confirmReal?: boolean) => Promise<void>;
  stop: () => Promise<void>;
  reconcile: () => Promise<void>;
  feed: ReturnType<typeof useFeed>;
  ready: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function endpointHost(settings: TradingSettings): string {
  return new URL(effectiveEndpoints(settings).apiUrl).host.toLowerCase();
}

type EndpointMemory = Partial<Pick<TradingSettings, "hyperliquidApiUrl" | "hyperliquidWsUrl" | "rpcUrl">>;

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
  const operatorApi = useMemo(resolveOperatorApiUrl, []);
  const feed = useFeed(publicApi);
  const [settings, setSettings] = useState<TradingSettings>({ ...DEFAULT_SETTINGS, enabledCoins: [...DEFAULT_SETTINGS.enabledCoins] });
  const [baseline, setBaseline] = useState<TradingSettings>({ ...DEFAULT_SETTINGS, enabledCoins: [...DEFAULT_SETTINGS.enabledCoins] });
  const [scope, setScope] = useState<"guest" | "operator">("guest");
  const [theme, setThemeState] = useState<Theme>("light");
  const [run, setRun] = useState<RunSnapshot>(OFF_RUN);
  const [connection, setConnection] = useState<ConnectionValidation | null>(null);
  const [operator, setOperator] = useState<OperatorSnapshot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const keyRef = useRef<string | undefined>(undefined);
  const keyHostRef = useRef<string | null>(null);
  const clockOffsetRef = useRef(0);
  const mutationRef = useRef(0);
  const endpointMemoryRef = useRef<EndpointMemory>({});

  useEffect(() => {
    const storage = (() => { try { return window.localStorage; } catch { return null; } })();
    const selected = loadSelectedNetwork(storage);
    const loaded = loadSettings(storage, selected.network, owner);
    const appearance = loadTheme(storage, window.matchMedia("(prefers-color-scheme: dark)").matches);
    setSettings(loaded.settings);
    setBaseline(loaded.settings);
    setThemeState(appearance.theme);
    applyTheme(appearance.theme);
    const loadNotice = loaded.notice?.message ?? selected.notice?.message ?? appearance.notice?.message ?? (loaded.copiedGuest ? "Guest settings were copied to this owner for first use." : null);
    setNotice((current) => loadNotice ?? current);
    setReady(!operatorApi);
  }, [operatorApi, owner]);

  useEffect(() => {
    let stopped = false;
    let controller: AbortController | null = null;
    const poll = async () => {
      controller?.abort();
      controller = new AbortController();
      const revision = mutationRef.current;
      try {
        const snapshot = await getRun(publicApi, controller.signal);
        if (stopped || revision !== mutationRef.current) return;
        const receivedAt = Date.now();
        clockOffsetRef.current = snapshot.serverNow - receivedAt;
        setRun({ ...snapshot, serverNow: receivedAt + clockOffsetRef.current });
      } catch (error) {
        if (!stopped && !(error instanceof DOMException && error.name === "AbortError")) setNotice((current) => current ?? "Run status is temporarily unavailable.");
      }
    };
    void poll();
    const interval = window.setInterval(poll, 2_000);
    return () => { stopped = true; controller?.abort(); window.clearInterval(interval); };
  }, [publicApi]);

  useEffect(() => {
    if (!operatorApi) return;
    let stopped = false;
    let controller: AbortController | null = null;
    const poll = async () => {
      controller?.abort();
      controller = new AbortController();
      const revision = mutationRef.current;
      try {
        const snapshot = await getOperator(operatorApi, controller.signal);
        if (stopped || revision !== mutationRef.current) return;
        setOperator(snapshot);
        setScope("operator");
        const visibleSettings = withMemoryEndpoints(snapshot.settings, snapshot.redactedEndpoints, endpointMemoryRef.current);
        setSettings((current) => JSON.stringify(current) === JSON.stringify(visibleSettings) ? current : visibleSettings);
        setBaseline((current) => JSON.stringify(current) === JSON.stringify(snapshot.baseline) ? current : snapshot.baseline);
        setConnection(snapshot.connection);
        const receivedAt = Date.now();
        clockOffsetRef.current = snapshot.run.serverNow - receivedAt;
        setRun({ ...snapshot.run, serverNow: receivedAt + clockOffsetRef.current });
        setReady(true);
      } catch (error) {
        if (!stopped) {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            setScope("guest");
            setOperator(null);
          }
          setReady(true);
        }
      }
    };
    void poll();
    const interval = window.setInterval(poll, 5_000);
    return () => { stopped = true; controller?.abort(); window.clearInterval(interval); };
  }, [operatorApi]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    const storage = (() => { try { return window.localStorage; } catch { return null; } })();
    const issue = saveTheme(storage, next);
    if (issue) setNotice(issue.message);
  }, []);

  const loadNetworkDraft = useCallback((network: TradingSettings["network"]) => {
    if (scope === "operator") return { ...settings, network };
    const storage = (() => { try { return window.localStorage; } catch { return null; } })();
    const loaded = loadSettings(storage, network, owner);
    if (loaded.notice) setNotice(loaded.notice.message);
    return loaded.settings;
  }, [owner, scope, settings]);

  const save = useCallback(async (draft: TradingSettings, key?: string, clearedEndpoints: (keyof TradingSettings)[] = []) => {
    if (run.status !== "off" && run.status !== "expired") throw new Error("Stop trading to change these settings.");
    const valid = validateSettings(draft);
    const nextHost = endpointHost(valid);
    const hostChanged = endpointHost(settings) !== nextHost;
    let credential = key;
    if (hostChanged && credential === undefined && (keyRef.current || operator?.apiKeyConfigured)) {
      credential = "";
      setNotice("The API key was cleared because the destination host changed.");
    }
    const validatedKey = credential === undefined || credential === "" ? credential : validateApiKey(credential);
    if (scope === "operator") {
      if (!operatorApi) throw new Error("Private operator control is unavailable.");
      const revision = ++mutationRef.current;
      const snapshot = await applyOperatorSettings(operatorApi, valid, validatedKey, clearedEndpoints);
      if (revision !== mutationRef.current) return;
      for (const field of ["hyperliquidApiUrl", "hyperliquidWsUrl", "rpcUrl"] as const) {
        if (clearedEndpoints.includes(field)) delete endpointMemoryRef.current[field];
        else if (valid[field]) endpointMemoryRef.current[field] = valid[field];
      }
      const visibleSettings = withMemoryEndpoints(snapshot.settings, snapshot.redactedEndpoints, endpointMemoryRef.current);
      setOperator(snapshot);
      setSettings(visibleSettings);
      setBaseline(snapshot.baseline);
      setConnection(snapshot.connection);
      setRun(snapshot.run);
    } else {
      const storage = (() => { try { return window.localStorage; } catch { return null; } })();
      const issue = saveSettings(storage, valid, owner);
      setSettings(valid);
      setBaseline(valid);
      setConnection(null);
      setNotice(issue?.message ?? "Guest settings saved in this browser. They do not change the shared bot.");
    }
    if (validatedKey === "") {
      keyRef.current = undefined;
      keyHostRef.current = null;
    } else if (validatedKey) {
      keyRef.current = validatedKey;
      keyHostRef.current = nextHost;
    }
  }, [operator, operatorApi, owner, run.status, scope, settings]);

  const validateConnection = useCallback(async (draft: TradingSettings, key?: string) => {
    if (run.status !== "off" && run.status !== "expired") throw new Error("Stop trading before validating connections.");
    if (scope !== "operator" || !operatorApi) throw new Error("Connection validation requires the private local operator channel.");
    const valid = validateSettings(draft);
    const credential = key === undefined
      ? endpointHost(valid) === keyHostRef.current ? keyRef.current : undefined
      : key === "" ? "" : validateApiKey(key);
    const revision = ++mutationRef.current;
    const checked = await validateOperatorConnection(operatorApi, valid, credential);
    if (revision !== mutationRef.current) return checked;
    setConnection(checked);
    return checked;
  }, [operatorApi, run.status, scope]);

  const start = useCallback(async (confirmReal = false) => {
    if (scope !== "operator" || !operatorApi) throw new Error("Only the operator can start the shared bot.");
    if (settings.enabledCoins.length === 0) throw new Error("Enable at least one asset.");
    if (!connection?.ok || (settings.mode === "real" && !connection.realAllowed)) throw new Error("Validate a compatible connection before starting.");
    const revision = ++mutationRef.current;
    setRun({
      runId: null, status: "starting", startedAt: null, deadlineAt: null, stoppedAt: null,
      durationMs: settings.runDurationMinutes * 60_000, stopReason: null, serverNow: Date.now(),
    });
    const snapshot = await startOperator(operatorApi, confirmReal);
    if (revision === mutationRef.current) setRun(snapshot);
  }, [connection, operatorApi, scope, settings]);

  const stop = useCallback(async () => {
    if (scope !== "operator" || !operatorApi) throw new Error("Only the operator can stop the shared bot.");
    const revision = ++mutationRef.current;
    const snapshot = await stopOperator(operatorApi);
    if (revision === mutationRef.current) setRun(snapshot);
  }, [operatorApi, scope]);

  const reconcile = useCallback(async () => {
    if (scope !== "operator" || !operatorApi) throw new Error("Only the operator can retry cleanup.");
    const revision = ++mutationRef.current;
    const snapshot = await reconcileOperator(operatorApi);
    if (revision === mutationRef.current) setRun(snapshot);
  }, [operatorApi, scope]);

  const value = useMemo<SettingsContextValue>(() => ({
    settings, baseline, scope, theme, setTheme, save, loadNetworkDraft, run, connection, operator, notice,
    validateConnection, start, stop, reconcile, feed, ready,
  }), [settings, baseline, scope, theme, setTheme, save, loadNetworkDraft, run, connection, operator, notice, validateConnection, start, stop, reconcile, feed, ready]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useSettings must be used inside SettingsProvider");
  return value;
}
