"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Header from "@/components/Header/Header";
import { useSettings } from "@/lib/trading/SettingsProvider";
import { NETWORK_ENDPOINTS } from "@/lib/trading/networks";
import { DEFAULT_SETTINGS, SUPPORTED_COINS, effectiveEndpoints, type TradingSettings } from "@/lib/trading/settings";
import styles from "./settings.module.css";

const ACTIVE = new Set(["starting", "running", "paused", "stopping", "attention-required"]);

type NumericKey = "tickMs" | "priceMs" | "quoteUsd" | "quoteInsideTicks" | "closeSlippageBps" | "horizonBlocks" | "bankrollUsd" | "runDurationMinutes" | "fallbackMs";
type EndpointKey = "hyperliquidApiUrl" | "hyperliquidWsUrl" | "rpcUrl";

function destinationHost(settings: TradingSettings): string {
  try { return new URL(effectiveEndpoints(settings).apiUrl).host; } catch { return "invalid destination"; }
}

function safeDestination(raw: string, alwaysPrivate = false): string {
  try {
    const url = new URL(raw);
    const privatePath = alwaysPrivate || Boolean(url.search) || (url.pathname !== "/" && url.pathname !== "/ws");
    return privatePath ? `${url.origin}/[private path]` : raw;
  } catch {
    return "Invalid destination";
  }
}

function NumberField({ label, field, value, onChange, min, max, step = 1, disabled, help }: {
  label: string; field: NumericKey; value: number; onChange: (field: NumericKey, value: number) => void;
  min: number; max?: number; step?: number | "any"; disabled: boolean; help?: string;
}) {
  return <label className={styles.field}><span>{label}</span><input name={field} type="number" value={value} min={min} max={max} step={step} disabled={disabled} onChange={(event) => onChange(field, Number(event.target.value))} />{help && <small>{help}</small>}</label>;
}

export default function SettingsForm() {
  const context = useSettings();
  const { settings, baseline, scope, theme, setTheme, run, connection, operator, notice, feed, ready } = context;
  const [draft, setDraft] = useState<TradingSettings>(settings);
  const [apiKey, setApiKey] = useState("");
  const [keyHost, setKeyHost] = useState<string | null>(null);
  const [clearCredential, setClearCredential] = useState(false);
  const [clearedEndpoints, setClearedEndpoints] = useState<EndpointKey[]>([]);
  const [advanced, setAdvanced] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setDraft(settings); }, [settings]);
  const locked = ACTIVE.has(run.status);
  const endpoints = useMemo(() => effectiveEndpoints(draft), [draft]);
  const redactedEndpoints = new Set(operator?.redactedEndpoints ?? []);
  const hiddenEndpoint = (field: EndpointKey) => redactedEndpoints.has(field);
  const officialApi = !hiddenEndpoint("hyperliquidApiUrl") && Object.values(NETWORK_ENDPOINTS).some((value) => new URL(value.apiUrl).host === new URL(endpoints.apiUrl).host);
  useEffect(() => {
    if (officialApi && !clearCredential && (apiKey || operator?.apiKeyConfigured)) {
      setApiKey("");
      setKeyHost(null);
      setClearCredential(true);
      setMessage("The API key will be cleared on Save. Official Hyperliquid hosts do not accept transport API keys.");
    }
  }, [apiKey, clearCredential, officialApi, operator?.apiKeyConfigured]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const overrideKeys = new Set(operator?.overrides ?? []);

  const change = <K extends keyof TradingSettings>(key: K, value: TradingSettings[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    if ((key === "hyperliquidApiUrl" || key === "hyperliquidWsUrl" || key === "rpcUrl") && value !== null) {
      setClearedEndpoints((fields) => fields.filter((field) => field !== key));
    }
    setMessage(null);
  };
  const changeNetwork = (network: TradingSettings["network"]) => {
    if (scope === "guest") {
      setDraft(context.loadNetworkDraft(network));
      setApiKey("");
      setKeyHost(null);
      setClearCredential(false);
      setClearedEndpoints([]);
      setMessage(`Loaded the saved ${network} guest draft. Save to select it.`);
      return;
    }
    change("network", network);
  };
  const changeNumber = (field: NumericKey, value: number) => change(field, value);
  const changeApiUrl = (value: string) => {
    const next = value.trim() || null;
    if ((apiKey || operator?.apiKeyConfigured) && destinationHost({ ...draft, hyperliquidApiUrl: next }) !== destinationHost(draft)) {
      setApiKey("");
      setKeyHost(null);
      setClearCredential(true);
      setMessage("The API key will be cleared on Save because the destination host changed.");
    }
    change("hyperliquidApiUrl", next);
  };

  const act = async (action: () => Promise<void>) => {
    setBusy(true); setMessage(null);
    try { await action(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "The request failed."); }
    finally { setBusy(false); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const credential = clearCredential ? "" : apiKey || undefined;
    void act(async () => {
      await context.save(draft, credential, clearedEndpoints);
      setApiKey("");
      setClearCredential(false);
      setClearedEndpoints([]);
      setMessage(scope === "operator" ? "Operator settings applied." : null);
    });
  };
  const reset = () => {
    const resetValue = scope === "operator" ? baseline : { ...DEFAULT_SETTINGS, enabledCoins: [...DEFAULT_SETTINGS.enabledCoins], network: draft.network };
    setDraft(resetValue); setApiKey(""); setKeyHost(null); setClearCredential(false); setClearedEndpoints([]); setMessage("Defaults are in the draft. Save to apply them.");
  };

  if (!ready) return <div className="shell"><Header connection={feed.connection} balance={null} unrealized={null} realized={null} /><main className={styles.page}>Loading settings...</main></div>;

  return <div className="shell">
    <Header connection={feed.connection} balance={null} unrealized={null} realized={null} />
    <main className={styles.page}>
      <header className={styles.intro}><div><p className={styles.eyebrow}>{scope === "operator" ? "Private operator scope" : "Guest browser scope"}</p><h1>Settings</h1><p>Configure local preferences and inspect the effective trading transport. Guest changes never alter the shared bot.</p></div><span className={styles.status}>{run.status}</span></header>
      {notice && <div className={styles.notice} role="status">{notice}</div>}
      {message && <div className={styles.notice} role="status">{message}</div>}
      {locked && run.status !== "attention-required" && <div className={styles.warning}>Stop trading to change these settings.</div>}

      {run.status === "attention-required" && scope === "operator" && <div className={styles.warning}>Cleanup needs attention. New runs stay blocked until reconciliation succeeds. <button type="button" disabled={busy} onClick={() => void act(async () => { await context.reconcile(); setMessage("Cleanup reconciliation requested."); })}>Retry cleanup</button></div>}
      <form onSubmit={submit} className={styles.form}>
        <section className={styles.section}><h2>Appearance</h2><p>Theme is independent from trading settings and can change while running.</p><div className={styles.segmented} aria-label="Color theme"><button type="button" aria-pressed={theme === "light"} onClick={() => setTheme("light")}>Light</button><button type="button" aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>Dark</button></div></section>

        <fieldset className={styles.section} disabled={locked || busy}><legend>Trading</legend>
          <div className={styles.grid}><label className={styles.field}><span>Network</span><select value={draft.network} onChange={(e) => changeNetwork(e.target.value as TradingSettings["network"])}><option value="testnet">Testnet</option><option value="mainnet">Mainnet</option></select></label><label className={styles.field}><span>Mode</span><select value={draft.mode} onChange={(e) => change("mode", e.target.value as TradingSettings["mode"])}><option value="paper">Paper</option><option value="real">Real</option></select></label><NumberField label="Entry notional, USD" field="quoteUsd" value={draft.quoteUsd} min={0.01} step="any" disabled={locked} onChange={changeNumber} /></div>
          <div className={styles.assets}><span>Enabled assets</span>{SUPPORTED_COINS.map((coin) => <label key={coin}><input type="checkbox" checked={draft.enabledCoins.includes(coin)} onChange={(e) => change("enabledCoins", e.target.checked ? [...draft.enabledCoins, coin] : draft.enabledCoins.filter((item) => item !== coin))} />{coin}</label>)}</div>
          {draft.enabledCoins.length === 0 && <p className={styles.error}>Enable at least one asset before starting.</p>}
        </fieldset>

        <fieldset className={styles.section} disabled={locked || busy}><legend>Connections</legend><p>These venue endpoints do not change this dashboard's Bun API destination.</p>
          <div className={styles.grid}><label className={styles.field}><span>Hyperliquid HTTP URL</span><input type="password" autoComplete="off" value={draft.hyperliquidApiUrl ?? ""} placeholder={hiddenEndpoint("hyperliquidApiUrl") ? "Configured on server, hidden" : "Network default"} onChange={(e) => changeApiUrl(e.target.value)} /><small>Provider base paths and query-bearing URLs stay in memory and must be re-entered after refresh.</small></label><label className={styles.field}><span>API key</span><input type="password" autoComplete="off" value={apiKey} disabled={officialApi} placeholder={officialApi ? "Not used by official Hyperliquid hosts" : clearCredential ? "Will be cleared on Save" : operator?.apiKeyConfigured ? "Configured, leave blank to keep" : "Optional, memory only"} onChange={(e) => { setApiKey(e.target.value); setClearCredential(false); setKeyHost(e.target.value ? destinationHost(draft) : null); }} /><small>{officialApi ? "Official Hyperliquid endpoints do not require or accept a transport API key." : `Sent only to ${hiddenEndpoint("hyperliquidApiUrl") ? "the configured hidden host" : destinationHost(draft)}. Never stored.`}</small>{(operator?.apiKeyConfigured || apiKey) && <button type="button" onClick={() => { setApiKey(""); setKeyHost(null); setClearCredential(true); setMessage("The API key will be cleared on Save."); }}>Clear credential</button>}</label><label className={styles.field}><span>SDK RPC URL</span><input type="password" autoComplete="off" value={draft.rpcUrl ?? ""} placeholder={hiddenEndpoint("rpcUrl") ? "Configured on server, hidden" : "Network default"} onChange={(e) => change("rpcUrl", e.target.value.trim() || null)} /><small>Every RPC override is memory-only and must be re-entered after refresh.</small></label></div>
          <dl className={styles.endpoints}><div><dt>Effective HTTP</dt><dd>{hiddenEndpoint("hyperliquidApiUrl") ? "Configured on server, hidden" : safeDestination(endpoints.apiUrl)}</dd></div><div><dt>Effective WebSocket</dt><dd>{hiddenEndpoint("hyperliquidWsUrl") || hiddenEndpoint("hyperliquidApiUrl") && !draft.hyperliquidWsUrl ? "Configured on server, hidden" : safeDestination(endpoints.wsUrl)}</dd></div><div><dt>Effective SDK RPC</dt><dd>{hiddenEndpoint("rpcUrl") ? "Configured on server, hidden" : safeDestination(endpoints.rpcUrl, draft.rpcUrl !== null)}</dd></div></dl>
          <div className={styles.actions}><button type="button" disabled={scope !== "operator" || locked || busy} onClick={() => void act(async () => { const result = await context.validateConnection(draft, clearCredential ? "" : apiKey || undefined); setMessage(result.message); })}>Validate connection</button>{connection && <span className={connection.ok ? styles.ok : styles.error}>{connection.message}</span>}</div>
          {scope === "operator" && (["hyperliquidApiUrl", "hyperliquidWsUrl", "rpcUrl"] as const).some((field) => redactedEndpoints.has(field)) && <div className={styles.actions}><span>Clear hidden override:</span>{(["hyperliquidApiUrl", "hyperliquidWsUrl", "rpcUrl"] as const).filter((field) => redactedEndpoints.has(field)).map((field) => <button type="button" key={field} onClick={() => { change(field, null); setClearedEndpoints((values) => values.includes(field) ? values : [...values, field]); setMessage(`${field} will be cleared on Save.`); }}>{field === "hyperliquidApiUrl" ? "HTTP" : field === "hyperliquidWsUrl" ? "WebSocket" : "RPC"}</button>)}</div>}
        </fieldset>

        <fieldset className={styles.section} disabled={locked || busy}><legend>Run duration</legend><NumberField label="Minutes per run" field="runDurationMinutes" value={draft.runDurationMinutes} min={1} step={1} disabled={locked} onChange={changeNumber} help="A fresh start gets this full limit. There is no unlimited option." /></fieldset>

        <section className={styles.section}><button className={styles.advancedToggle} type="button" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}>Advanced settings {advanced ? "Hide" : "Show"}</button>{advanced && <fieldset className={styles.advanced} disabled={locked || busy}><div className={styles.grid}><NumberField label="Decision cadence, ms" field="tickMs" value={draft.tickMs} min={5000} max={300000} disabled={locked} onChange={changeNumber} /><NumberField label="Price refresh, ms" field="priceMs" value={draft.priceMs} min={50} max={5000} disabled={locked} onChange={changeNumber} /><NumberField label="Quote offset, ticks" field="quoteInsideTicks" value={draft.quoteInsideTicks} min={0} max={10} disabled={locked} onChange={changeNumber} /><NumberField label="Exit slippage, bps" field="closeSlippageBps" value={draft.closeSlippageBps} min={0} max={100} step="any" disabled={locked} onChange={changeNumber} /><NumberField label="Lookback, ticks" field="horizonBlocks" value={draft.horizonBlocks} min={20} max={400} disabled={locked} onChange={changeNumber} /><NumberField label="Paper bankroll, USD" field="bankrollUsd" value={draft.bankrollUsd} min={0.01} step="any" disabled={locked} onChange={changeNumber} /><NumberField label="Fallback polling, ms" field="fallbackMs" value={draft.fallbackMs} min={1000} max={300000} disabled={locked} onChange={changeNumber} /><label className={styles.field}><span>WebSocket URL</span><input type="password" autoComplete="off" value={draft.hyperliquidWsUrl ?? ""} placeholder={hiddenEndpoint("hyperliquidWsUrl") ? "Configured on server, hidden" : "Derived from HTTP URL"} onChange={(e) => change("hyperliquidWsUrl", e.target.value.trim() || null)} /></label><label className={styles.field}><span>API key header</span><input value={draft.hyperliquidApiKeyHeader} onChange={(e) => change("hyperliquidApiKeyHeader", e.target.value)} /></label><label className={styles.field}><span>API key scheme</span><input value={draft.hyperliquidApiKeyScheme} placeholder="Blank sends raw key" onChange={(e) => change("hyperliquidApiKeyScheme", e.target.value)} /></label></div></fieldset>}</section>
        <section className={styles.section}><h2>Operator configuration</h2>{scope === "operator" && operator ? <><p>Environment values form the baseline. Session overrides are listed without exposing secrets.</p><dl className={styles.operator}><div><dt>Model</dt><dd>{operator.configuration.model}</dd></div><div><dt>Provider</dt><dd>{operator.configuration.jevProvider}</dd></div><div><dt>Model ID</dt><dd>{operator.configuration.jevModelId}</dd></div><div><dt>Bot port</dt><dd>{operator.configuration.port}</dd></div><div><dt>Provider secrets</dt><dd>OpenRouter {operator.configuration.providerKeys.openrouter ? "configured" : "missing"}, TypeSafe {operator.configuration.providerKeys.typesafe ? "configured" : "missing"}, Gateway {operator.configuration.providerKeys.gateway ? "configured" : "missing"}</dd></div><div><dt>Server wallet</dt><dd>{operator.configuration.walletConfigured ? "configured" : "missing"}</dd></div><div><dt>Session overrides</dt><dd>{overrideKeys.size ? [...overrideKeys].join(", ") : "None"}</dd></div></dl><p className={styles.warning}>Private keys and wallet JSON stay server-only and are managed through fnox.</p></> : <p>Shared model, provider, wallet, and secret status are available only through the private local operator channel.</p>}</section>

        <footer className={styles.footer}><button type="submit" className={styles.primary} disabled={(!dirty && !apiKey && !clearCredential && clearedEndpoints.length === 0) || locked || busy}>Save</button><button type="button" disabled={(!dirty && !apiKey && !clearCredential && clearedEndpoints.length === 0) || busy} onClick={() => { setDraft(settings); setApiKey(""); setKeyHost(null); setClearCredential(false); setClearedEndpoints([]); setMessage("Draft changes cancelled."); }}>Cancel</button><button type="button" disabled={locked || busy} onClick={reset}>Reset draft</button><span>{scope === "operator" ? "Save applies to the shared executor." : "Save persists only this browser scope."}</span></footer>
      </form>
    </main>
  </div>;
}
