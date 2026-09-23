"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Header from "@/components/Header/Header";
import { useSettings } from "@/lib/trading/SettingsProvider";
import { NETWORK_ENDPOINTS } from "@/lib/trading/networks";
import { SUPPORTED_COINS, effectiveEndpoints, type TradingSettings } from "@/lib/trading/settings";
import styles from "./settings.module.css";

const ACTIVE = new Set(["starting", "running", "paused", "stopping", "attention-required"]);
const TABS = ["Trading", "Connections", "Session"] as const;

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
  const { settings, baseline, theme, setTheme, run, connection, apiKeyConfigured, notice, feed, ready } = context;
  const [draft, setDraft] = useState<TradingSettings>(settings);
  const [apiKey, setApiKey] = useState("");
  const [keyHost, setKeyHost] = useState<string | null>(null);
  const [clearCredential, setClearCredential] = useState(false);
  const [clearedEndpoints, setClearedEndpoints] = useState<EndpointKey[]>([]);
  const [advanced, setAdvanced] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<typeof TABS[number]>("Trading");

  useEffect(() => { setDraft(settings); }, [settings]);
  const locked = ACTIVE.has(run.status);
  const endpoints = useMemo(() => effectiveEndpoints(draft), [draft]);
  const officialApi = Object.values(NETWORK_ENDPOINTS).some((value) => new URL(value.apiUrl).host === new URL(endpoints.apiUrl).host);
  useEffect(() => {
    if (officialApi && !clearCredential && (apiKey || apiKeyConfigured)) {
      setApiKey("");
      setKeyHost(null);
      setClearCredential(true);
      setMessage("The API key will be cleared on Save. Official Hyperliquid hosts do not accept transport API keys.");
    }
  }, [apiKey, clearCredential, officialApi, apiKeyConfigured]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  const change = <K extends keyof TradingSettings>(key: K, value: TradingSettings[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    if ((key === "hyperliquidApiUrl" || key === "hyperliquidWsUrl" || key === "rpcUrl") && value !== null) {
      setClearedEndpoints((fields) => fields.filter((field) => field !== key));
    }
    setMessage(null);
  };
  const changeNetwork = (network: TradingSettings["network"]) => { setDraft(context.loadNetworkDraft(network)); setApiKey(""); setKeyHost(null); setClearCredential(true); setClearedEndpoints([]); setMessage(null); };
  const changeNumber = (field: NumericKey, value: number) => change(field, value);
  const changeApiUrl = (value: string) => {
    const next = value.trim() || null;
    if ((apiKey || apiKeyConfigured) && destinationHost({ ...draft, hyperliquidApiUrl: next }) !== destinationHost(draft)) {
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
      setMessage("Browser settings applied.");
    });
  };
  const reset = () => {
    setDraft(baseline); setApiKey(""); setKeyHost(null); setClearCredential(false); setClearedEndpoints([]); setMessage("Defaults are in the draft. Save to apply them.");
  };


  return <div className="shell">
    <Header connection={feed.connection} balance={null} unrealized={null} realized={null} />
    <main className={styles.page}>
      <header className={styles.intro}><div><p className={styles.eyebrow}>Browser settings</p><h1>Settings</h1><p>Settings apply only in this browser. Saving or connecting never starts trading.</p></div><span className={styles.status}>{run.status}</span></header>
      {notice && <div className={styles.notice} role="status">{notice}</div>}
      {message && <div className={styles.notice} role="status">{message}</div>}
      {locked && run.status !== "attention-required" && <div className={styles.warning}>Stop trading to change these settings.</div>}

      {run.status === "attention-required" && <div className={styles.warning}>Cleanup needs attention. New runs stay blocked until reconciliation succeeds. <button type="button" disabled={!ready || busy} onClick={() => void act(async () => { await context.reconcile(); setMessage("Cleanup reconciliation requested."); })}>Retry cleanup</button></div>}
      <div className={styles.segmented} role="tablist" aria-label="Settings sections">
        {TABS.map((item, index) => <button key={item} id={`settings-tab-${item}`} type="button" role="tab" aria-selected={tab === item} aria-controls={`settings-panel-${item}`} tabIndex={tab === item ? 0 : -1} onClick={() => setTab(item)} onKeyDown={(event) => {
          const next = event.key === "ArrowRight" ? (index + 1) % TABS.length : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null;
          if (next === null) return;
          event.preventDefault(); setTab(TABS[next]); document.getElementById(`settings-tab-${TABS[next]}`)?.focus();
        }}>{item}</button>)}
      </div>
      <form onSubmit={submit} className={styles.form}>
        <div hidden={tab !== "Trading"} role="tabpanel" id="settings-panel-Trading" aria-labelledby="settings-tab-Trading" tabIndex={0}>
        <section className={styles.section}><h2>Appearance</h2><p>Theme is independent from trading settings and can change while running.</p><div className={styles.segmented} aria-label="Color theme"><button type="button" aria-pressed={theme === "light"} onClick={() => setTheme("light")}>Light</button><button type="button" aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>Dark</button></div></section>

        <fieldset className={styles.section} disabled={!ready || locked || busy}><legend>Trading</legend>
          <div className={styles.grid}><label className={styles.field}><span>Network</span><select value={draft.network} onChange={(e) => changeNetwork(e.target.value as TradingSettings["network"])}><option value="testnet">Testnet</option><option value="mainnet">Mainnet</option></select></label><label className={styles.field}><span>Mode</span><select value={draft.mode} onChange={(e) => change("mode", e.target.value as TradingSettings["mode"])}><option value="paper">Paper</option><option value="real">Real</option></select><small>Real trading requires wallet authorization. Paper trading does not.</small></label><NumberField label="Entry notional, USD" field="quoteUsd" value={draft.quoteUsd} min={0.01} step="any" disabled={locked} onChange={changeNumber} /></div>
          <div className={styles.assets}><span>Enabled assets</span>{SUPPORTED_COINS.map((coin) => <label key={coin}><input type="checkbox" checked={draft.enabledCoins.includes(coin)} onChange={(e) => change("enabledCoins", e.target.checked ? [...draft.enabledCoins, coin] : draft.enabledCoins.filter((item) => item !== coin))} />{coin}</label>)}</div>
          {draft.enabledCoins.length === 0 && <p className={styles.error}>Enable at least one asset before starting.</p>}
        </fieldset>
        </div>
        <div hidden={tab !== "Connections"} role="tabpanel" id="settings-panel-Connections" aria-labelledby="settings-tab-Connections" tabIndex={0}>

        <fieldset className={styles.section} disabled={!ready || locked || busy}><legend>Connections</legend><p>Custom endpoints change transport only. The selected network determines signing identity.</p>
          <div className={styles.grid}><label className={styles.field}><span>Hyperliquid HTTP URL</span><input type="password" autoComplete="off" value={draft.hyperliquidApiUrl ?? ""} placeholder="Network default" onChange={(e) => changeApiUrl(e.target.value)} /><small>Provider base paths and query-bearing URLs stay in memory and must be re-entered after refresh.</small></label><label className={styles.field}><span>API key</span><input type="password" autoComplete="off" value={apiKey} disabled={officialApi} placeholder={officialApi ? "Not used by official Hyperliquid hosts" : clearCredential ? "Will be cleared on Save" : apiKeyConfigured ? "Configured, leave blank to keep" : "Optional, memory only"} onChange={(e) => { setApiKey(e.target.value); setClearCredential(false); setKeyHost(e.target.value ? destinationHost(draft) : null); }} /><small>{officialApi ? "Official Hyperliquid endpoints do not require or accept a transport API key." : `Sent only to ${destinationHost(draft)}. Never stored.`}</small>{(apiKeyConfigured || apiKey) && <button type="button" onClick={() => { setApiKey(""); setKeyHost(null); setClearCredential(true); setMessage("The API key will be cleared on Save."); }}>Clear credential</button>}</label><label className={styles.field}><span>SDK RPC URL</span><input type="password" autoComplete="off" value={draft.rpcUrl ?? ""} placeholder="Network default" onChange={(e) => change("rpcUrl", e.target.value.trim() || null)} /><small>Every RPC override is memory-only and must be re-entered after refresh.</small></label></div>
          <dl className={styles.endpoints}><div><dt>Effective HTTP</dt><dd>{safeDestination(endpoints.apiUrl)}</dd></div><div><dt>Effective WebSocket</dt><dd>{safeDestination(endpoints.wsUrl)}</dd></div><div><dt>Effective SDK RPC</dt><dd>{safeDestination(endpoints.rpcUrl, draft.rpcUrl !== null)}</dd></div></dl>
          <div className={styles.actions}><button type="button" disabled={locked || busy} onClick={() => void act(async () => { const result = await context.validateConnection(draft, clearCredential ? "" : apiKey || undefined); setMessage(result.message); })}>Validate connection</button>{connection && <span className={connection.ok ? styles.ok : styles.error}>{connection.message}</span>}</div>
        </fieldset>
        </div>
        <div hidden={tab !== "Session"} role="tabpanel" id="settings-panel-Session" aria-labelledby="settings-tab-Session" tabIndex={0}>
        <section className={styles.section}><h2>Wallet and session</h2><p>{context.wallet.connected ? "Wallet connected. Approval and On are separate actions." : "Connect Brave Wallet beside GitHub to prepare a session."}</p><p>Stop cancels only app-owned orders. It never liquidates positions or revokes wallet approval. A reload, reconnect, network change, or Save never starts a run.</p><p>Real mode manages whole-account net positions in enabled markets, including exposure opened elsewhere.</p></section>

        <fieldset className={styles.section} disabled={locked || busy}><legend>Run duration</legend><NumberField label="Minutes per run" field="runDurationMinutes" value={draft.runDurationMinutes} min={1} step={1} disabled={locked} onChange={changeNumber} help="A fresh start gets this full limit. There is no unlimited option." /></fieldset>

        <section className={styles.section}><button className={styles.advancedToggle} type="button" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}>Advanced settings {advanced ? "Hide" : "Show"}</button>{advanced && <fieldset className={styles.advanced} disabled={!ready || locked || busy}><div className={styles.grid}><NumberField label="Decision cadence, ms" field="tickMs" value={draft.tickMs} min={5000} max={300000} disabled={locked} onChange={changeNumber} /><NumberField label="Price refresh, ms" field="priceMs" value={draft.priceMs} min={50} max={5000} disabled={locked} onChange={changeNumber} /><NumberField label="Quote offset, ticks" field="quoteInsideTicks" value={draft.quoteInsideTicks} min={0} max={10} disabled={locked} onChange={changeNumber} /><NumberField label="Exit slippage, bps" field="closeSlippageBps" value={draft.closeSlippageBps} min={0} max={100} step="any" disabled={locked} onChange={changeNumber} /><NumberField label="Lookback, ticks" field="horizonBlocks" value={draft.horizonBlocks} min={20} max={400} disabled={locked} onChange={changeNumber} /><NumberField label="Paper bankroll, USD" field="bankrollUsd" value={draft.bankrollUsd} min={0.01} step="any" disabled={locked} onChange={changeNumber} /><NumberField label="Fallback polling, ms" field="fallbackMs" value={draft.fallbackMs} min={1000} max={300000} disabled={locked} onChange={changeNumber} /><><label className={styles.field}><span>WebSocket URL</span><input type="password" autoComplete="off" value={draft.hyperliquidWsUrl ?? ""} placeholder="Derived from HTTP URL" onChange={(e) => change("hyperliquidWsUrl", e.target.value.trim() || null)} /></label><label className={styles.field}><span>API key header</span><input value={draft.hyperliquidApiKeyHeader} onChange={(e) => change("hyperliquidApiKeyHeader", e.target.value)} /></label><label className={styles.field}><span>API key scheme</span><input value={draft.hyperliquidApiKeyScheme} placeholder="Blank sends raw key" onChange={(e) => change("hyperliquidApiKeyScheme", e.target.value)} /></label></></div></fieldset>}</section>
        <section className={styles.section}><h2>Browser ownership</h2><p>Non-secret preferences are saved locally. API keys and private endpoint paths stay in memory. Paper state is not persisted. Real trading requires explicit wallet authorization and a separate start.</p></section>
        </div>

        <footer className={styles.footer}><button type="submit" className={styles.primary} disabled={!ready || (!dirty && !apiKey && !clearCredential && clearedEndpoints.length === 0) || locked || busy}>Save</button><button type="button" disabled={(!dirty && !apiKey && !clearCredential && clearedEndpoints.length === 0) || busy} onClick={() => { setDraft(settings); setApiKey(""); setKeyHost(null); setClearCredential(false); setClearedEndpoints([]); setMessage("Draft changes cancelled."); }}>Cancel</button><button type="button" disabled={!ready || locked || busy} onClick={reset}>Reset draft</button><span>Save applies only in this browser.</span></footer>
      </form>
    </main>
  </div>;
}
