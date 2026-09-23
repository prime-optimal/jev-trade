"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Header from "@/components/Header/Header";
import { useSettings } from "@/lib/trading/SettingsProvider";
import { NETWORK_ENDPOINTS } from "@/lib/trading/networks";
import { SUPPORTED_COINS, effectiveEndpoints, type TradingSettings } from "@/lib/trading/settings";
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
  const { settings, baseline, scope, sessionState, reconnect, theme, setTheme, run, connection, operator, notice, feed, ready } = context;
  const [draft, setDraft] = useState<TradingSettings>(settings);
  const [apiKey, setApiKey] = useState("");
  const [keyHost, setKeyHost] = useState<string | null>(null);
  const [clearCredential, setClearCredential] = useState(false);
  const [clearedEndpoints, setClearedEndpoints] = useState<EndpointKey[]>([]);
  const [activeTab, setActiveTab] = useState<"trading" | "model" | "connections">("trading");
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
  const changeNetwork = (network: TradingSettings["network"]) => change("network", network);
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
      setMessage(scope === "operator" ? "Operator settings applied." : "Paper session settings applied.");
    });
  };
  const reset = () => {
    setDraft(baseline); setApiKey(""); setKeyHost(null); setClearCredential(false); setClearedEndpoints([]); setMessage("Defaults are in the draft. Save to apply them.");
  };


  const tab = (id: "trading" | "model" | "connections", label: string) => (
    <button
      type="button"
      role="tab"
      id={`settings-tab-${id}`}
      aria-controls={`settings-panel-${id}`}
      aria-selected={activeTab === id}
      onKeyDown={(event) => {
        const ids = ["trading", "model", "connections"] as const;
        const current = ids.indexOf(id);
        const next = event.key === "ArrowRight" ? (current + 1) % ids.length
          : event.key === "ArrowLeft" ? (current - 1 + ids.length) % ids.length
            : event.key === "Home" ? 0
              : event.key === "End" ? ids.length - 1
                : null;
        if (next === null) return;
        event.preventDefault();
        const nextId = ids[next];
        setActiveTab(nextId);
        document.getElementById(`settings-tab-${nextId}`)?.focus();
      }}
      tabIndex={activeTab === id ? 0 : -1}
      onClick={() => setActiveTab(id)}
    >
      {label}
    </button>
  );

  return <div className="shell">
    <Header connection={feed.connection} balance={null} unrealized={null} realized={null} />
    <main className={styles.page}>
      <header className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>{scope === "operator" ? "Private operator scope" : "Private visitor paper session"}</p>
          <h1>Settings</h1>
          <p>{scope === "operator" ? "Configure the shared executor through its private local channel." : "These settings and trades belong only to this browser session. The shared demo stays untouched."}</p>
        </div>
        <span className={styles.status}>{scope === "visitor" && !ready ? sessionState : run.status}</span>
      </header>
      {notice && <div className={styles.notice} role="status">{notice}</div>}
      {message && <div className={styles.notice} role="status">{message}</div>}
      {scope === "visitor" && sessionState !== "ready" && <div className={styles.warning}>{sessionState === "connecting" ? "Connecting your paper session..." : sessionState === "expired" ? "Your paper session expired. Reconnect to start with a fresh session." : "The paper session is unavailable."} {sessionState !== "connecting" && <button type="button" disabled={busy} onClick={() => void act(reconnect)}>Reconnect</button>}</div>}
      {locked && run.status !== "attention-required" && <div className={styles.warning}>Stop trading to change these settings.</div>}
      {run.status === "attention-required" && <div className={styles.warning}>{scope === "visitor" ? "This paper run needs a safe reset before it can start again." : "Cleanup needs attention. New runs stay blocked until reconciliation succeeds."} <button type="button" disabled={!ready || busy} onClick={() => void act(async () => { await context.reconcile(); setMessage(scope === "visitor" ? "Paper run reset." : "Cleanup reconciliation requested."); })}>{scope === "visitor" ? "Reset paper run" : "Retry cleanup"}</button></div>}

      <form onSubmit={submit} className={styles.form}>
        <section className={styles.section}>
          <h2>Appearance</h2>
          <p>Choose the dashboard color theme. This display preference does not affect trading and can change while a run is active.</p>
          <div className={styles.segmented} aria-label="Color theme">
            <button type="button" aria-pressed={theme === "light"} onClick={() => setTheme("light")}>Light</button>
            <button type="button" aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>Dark</button>
          </div>
        </section>

        <div className={styles.tabs} role="tablist" aria-label="Settings sections">
          {tab("trading", "Trading")}
          {tab("model", "Jev model")}
          {tab("connections", "Connections")}
        </div>

        <section className={styles.tabPanel} role="tabpanel" id="settings-panel-trading" aria-labelledby="settings-tab-trading" hidden={activeTab !== "trading"}>
          <fieldset className={styles.section} disabled={!ready || locked || busy}>
            <legend>Trading</legend>
            <p>These controls configure order execution and run limits. They are not direct Jev model inputs.</p>
            <div className={styles.grid}>
              <label className={styles.field}><span>Network</span><select value={draft.network} onChange={(e) => changeNetwork(e.target.value as TradingSettings["network"])}><option value="testnet">Testnet</option><option value="mainnet">Mainnet</option></select><small>Selects the Hyperliquid venue network used for market data and execution.</small></label>
              <label className={styles.field}><span>Mode</span><select value={draft.mode} disabled={scope === "visitor"} onChange={(e) => change("mode", e.target.value as TradingSettings["mode"])}><option value="paper">Paper</option>{scope === "operator" && <option value="real">Real</option>}</select><small>{scope === "visitor" ? "Visitor sessions are paper only and never load a wallet or place real orders." : "Paper simulates fills, while real mode submits orders with the configured wallet."}</small></label>
              <NumberField label="Entry notional, USD" field="quoteUsd" value={draft.quoteUsd} min={0.01} step="any" disabled={locked} onChange={changeNumber} help="Execution control: sets the target USD notional for a new position." />
              <NumberField label="Price refresh, ms" field="priceMs" value={draft.priceMs} min={50} max={5000} disabled={locked} onChange={changeNumber} help="Execution control: sets how often the local price snapshot refreshes between decisions." />
              <NumberField label="Quote offset, ticks" field="quoteInsideTicks" value={draft.quoteInsideTicks} min={0} max={10} disabled={locked} onChange={changeNumber} help="Execution control: places resting quotes this many ticks inside the current spread." />
              <NumberField label="Exit slippage, bps" field="closeSlippageBps" value={draft.closeSlippageBps} min={0} max={100} step="any" disabled={locked} onChange={changeNumber} help="Execution control: caps the price allowance used when closing a position." />
              <NumberField label="Paper bankroll, USD" field="bankrollUsd" value={draft.bankrollUsd} min={0.01} step="any" disabled={locked} onChange={changeNumber} help="Execution control: sets the starting balance for simulated visitor and paper runs." />
              <NumberField label="Minutes per run" field="runDurationMinutes" value={draft.runDurationMinutes} min={1} step={1} disabled={locked} onChange={changeNumber} help="Execution control: gives each fresh run this full time limit, with no unlimited option." />
            </div>
            <fieldset className={styles.assetChoices}>
              <legend>Enabled assets</legend>
              <p>Execution control: choose which asset markets receive independent Jev decisions and orders.</p>
              <div>{SUPPORTED_COINS.map((coin) => <label key={coin}><input type="checkbox" checked={draft.enabledCoins.includes(coin)} onChange={(e) => change("enabledCoins", e.target.checked ? [...draft.enabledCoins, coin] : draft.enabledCoins.filter((item) => item !== coin))} />{coin}</label>)}</div>
            </fieldset>
            {draft.enabledCoins.length === 0 && <p className={styles.error}>Enable at least one asset before starting.</p>}
          </fieldset>
        </section>

        <section className={styles.tabPanel} role="tabpanel" id="settings-panel-model" aria-labelledby="settings-tab-model" hidden={activeTab !== "model"}>
          <fieldset className={styles.section} disabled={!ready || locked || busy}>
            <legend>Jev model</legend>
            <p>These settings control when Jev evaluates and the compact market-history window included in each exact prompt snapshot.</p>
            <div className={styles.grid}>
              <NumberField label="Decision cadence, ms" field="tickMs" value={draft.tickMs} min={scope === "visitor" ? 30000 : 5000} max={300000} disabled={locked} onChange={changeNumber} help="Model input control: sets how often Jev receives a fresh state and answers all three question families." />
              <NumberField label="Lookback, ticks" field="horizonBlocks" value={draft.horizonBlocks} min={20} max={400} disabled={locked} onChange={changeNumber} help="Model input control: sets the compact recent-mid and public-trade window. Fixed returns, current book depth, and indicators keep their own windows." />
            </div>
          </fieldset>
          <article className={`${styles.section} ${styles.promptCard}`} aria-labelledby="jev-prompt-title">
            <header><div><p className={styles.eyebrow}>Read only prompt contract</p><h2 id="jev-prompt-title">What Jev evaluates</h2></div><code>jev-trade-2026-09-23.1</code></header>
            <p>Every decision asks the same three question families from one state snapshot.</p>
            <div className={styles.questionGrid}>
              <section><h3>Bias</h3><p><code>long or short {"{asset}"}?</code></p></section>
              <section><h3>Intent</h3><p><code>open or hold {"{asset}"}?</code> while flat; <code>open, close, or hold {"{asset}"}?</code> while positioned.</p></section>
              <section><h3>Leverage</h3><p><code>cross leverage for {"{asset}"}?</code></p></section>
            </div>
            <h3>Complete input catalog</h3>
            <dl className={styles.catalog}>
              <div><dt>Identity and timing</dt><dd>Coin, market, tick number, and tick cadence.</dd></div>
              <div><dt>Price and returns</dt><dd>Mid price, returns over 1, 5, 20, and 100 ticks, plus recent mid prices.</dd></div>
              <div><dt>L2 book and depth</dt><dd>Spread in basis points, book imbalance, top five bid and ask levels, and cumulative bid and ask depth within 10, 25, and 50 basis points.</dd></div>
              <div><dt>Public trade tape</dt><dd>Trade count, buy size, sell size, cumulative volume delta, VWAP, last price, last side, and recent public trades.</dd></div>
              <div><dt>Current position</dt><dd>Coin, side, size, notional, entry, current leverage, liquidation price, liquidation distance, and unrealized PnL.</dd></div>
              <div><dt>Indicators</dt><dd>SMA 20, SMA 50, EMA 20, mid distance from both SMAs, RSI 14, 20 tick volatility, high, low, and range position.</dd></div>
              <div><dt>Venue asset context</dt><dd>Mark price, oracle price, funding, premium, open interest, daily notional volume, daily change, and the asset maximum leverage.</dd></div>
              <div><dt>Max leverage</dt><dd>The venue maximum repeated as the decision cap and used to derive the allowed integer leverage rungs.</dd></div>
            </dl>
            <p className={styles.exclusion}>Wallet identity, account equity, lifetime realized PnL, fees, and private credentials are excluded.</p>
          </article>
        </section>

        <section className={styles.tabPanel} role="tabpanel" id="settings-panel-connections" aria-labelledby="settings-tab-connections" hidden={activeTab !== "connections"}>
          {scope === "visitor" ? <section className={styles.section}>
            <h2>Connections</h2>
            <p>Visitor paper sessions use official Hyperliquid endpoints. Custom URLs, API keys, authentication headers, and wallet credentials are unavailable so browser sessions cannot reach private trading infrastructure.</p>
            <div className={styles.actions}><button type="button" disabled={!ready || locked || busy} onClick={() => void act(async () => { const result = await context.validateConnection(draft); setMessage(result.message); })}>Check paper connection</button>{connection && <span className={connection.ok ? styles.ok : styles.error}>{connection.message}</span>}</div>
          </section> : <fieldset className={styles.section} disabled={locked || busy}>
            <legend>Connections</legend>
            <p>These transport controls configure venue connectivity. They are not Jev model inputs and do not change this dashboard's Bun API destination.</p>
            <div className={styles.grid}>
              <label className={styles.field}><span>Hyperliquid HTTP URL</span><input type="password" autoComplete="off" value={draft.hyperliquidApiUrl ?? ""} placeholder={hiddenEndpoint("hyperliquidApiUrl") ? "Configured on server, hidden" : "Network default"} onChange={(e) => changeApiUrl(e.target.value)} /><small>Overrides the venue HTTP base URL; provider base paths and query-bearing URLs stay in memory and must be re-entered after refresh.</small></label>
              <label className={styles.field}><span>WebSocket URL</span><input type="password" autoComplete="off" value={draft.hyperliquidWsUrl ?? ""} placeholder={hiddenEndpoint("hyperliquidWsUrl") ? "Configured on server, hidden" : "Derived from HTTP URL"} onChange={(e) => change("hyperliquidWsUrl", e.target.value.trim() || null)} /><small>Overrides the live market data transport; blank derives it from the HTTP destination.</small></label>
              <label className={styles.field}><span>SDK RPC URL</span><input type="password" autoComplete="off" value={draft.rpcUrl ?? ""} placeholder={hiddenEndpoint("rpcUrl") ? "Configured on server, hidden" : "Network default"} onChange={(e) => change("rpcUrl", e.target.value.trim() || null)} /><small>Overrides the SDK RPC destination in memory and must be re-entered after refresh.</small></label>
              <NumberField label="Fallback polling, ms" field="fallbackMs" value={draft.fallbackMs} min={1000} max={300000} disabled={locked} onChange={changeNumber} help="Transport control: sets the HTTP polling interval used when the live feed needs a fallback." />
              <label className={styles.field}><span>API key</span><input type="password" autoComplete="off" value={apiKey} disabled={officialApi} placeholder={officialApi ? "Not used by official Hyperliquid hosts" : clearCredential ? "Will be cleared on Save" : operator?.apiKeyConfigured ? "Configured, leave blank to keep" : "Optional, memory only"} onChange={(e) => { setApiKey(e.target.value); setClearCredential(false); setKeyHost(e.target.value ? destinationHost(draft) : null); }} /><small>{officialApi ? "Official Hyperliquid endpoints do not require or accept a transport API key." : `Sent only to ${hiddenEndpoint("hyperliquidApiUrl") ? "the configured hidden host" : destinationHost(draft)} and never stored.`}</small>{(operator?.apiKeyConfigured || apiKey) && <button type="button" onClick={() => { setApiKey(""); setKeyHost(null); setClearCredential(true); setMessage("The API key will be cleared on Save."); }}>Clear credential</button>}</label>
              <label className={styles.field}><span>API key header</span><input value={draft.hyperliquidApiKeyHeader} onChange={(e) => change("hyperliquidApiKeyHeader", e.target.value)} /><small>Names the HTTP request header that carries the optional transport API key.</small></label>
              <label className={styles.field}><span>API key scheme</span><input value={draft.hyperliquidApiKeyScheme} placeholder="Blank sends raw key" onChange={(e) => change("hyperliquidApiKeyScheme", e.target.value)} /><small>Prefixes the transport API key value, or sends the raw key when left blank.</small></label>
            </div>
            <dl className={styles.endpoints}><div><dt>Effective HTTP</dt><dd>{hiddenEndpoint("hyperliquidApiUrl") ? "Configured on server, hidden" : safeDestination(endpoints.apiUrl)}</dd></div><div><dt>Effective WebSocket</dt><dd>{hiddenEndpoint("hyperliquidWsUrl") || hiddenEndpoint("hyperliquidApiUrl") && !draft.hyperliquidWsUrl ? "Configured on server, hidden" : safeDestination(endpoints.wsUrl)}</dd></div><div><dt>Effective SDK RPC</dt><dd>{hiddenEndpoint("rpcUrl") ? "Configured on server, hidden" : safeDestination(endpoints.rpcUrl, draft.rpcUrl !== null)}</dd></div></dl>
            <div className={styles.actions}><button type="button" disabled={locked || busy} onClick={() => void act(async () => { const result = await context.validateConnection(draft, clearCredential ? "" : apiKey || undefined); setMessage(result.message); })}>Validate connection</button>{connection && <span className={connection.ok ? styles.ok : styles.error}>{connection.message}</span>}</div>
            {(["hyperliquidApiUrl", "hyperliquidWsUrl", "rpcUrl"] as const).some((field) => redactedEndpoints.has(field)) && <div className={styles.actions}><span>Clear hidden override:</span>{(["hyperliquidApiUrl", "hyperliquidWsUrl", "rpcUrl"] as const).filter((field) => redactedEndpoints.has(field)).map((field) => <button type="button" key={field} onClick={() => { change(field, null); setClearedEndpoints((values) => values.includes(field) ? values : [...values, field]); setMessage(`${field} will be cleared on Save.`); }}>{field === "hyperliquidApiUrl" ? "HTTP" : field === "hyperliquidWsUrl" ? "WebSocket" : "RPC"}</button>)}</div>}
          </fieldset>}

          <section className={styles.section}>
            <h2>{scope === "operator" ? "Operator configuration" : "Session ownership"}</h2>
            {scope === "operator" && operator ? <><p>Environment values form the baseline. Session overrides are listed without exposing secrets.</p><dl className={styles.operator}><div><dt>Model</dt><dd>{operator.configuration.model}</dd></div><div><dt>Provider</dt><dd>{operator.configuration.jevProvider}</dd></div><div><dt>Model ID</dt><dd>{operator.configuration.jevModelId}</dd></div><div><dt>Bot port</dt><dd>{operator.configuration.port}</dd></div><div><dt>Provider secrets</dt><dd>OpenRouter {operator.configuration.providerKeys.openrouter ? "configured" : "missing"}, TypeSafe {operator.configuration.providerKeys.typesafe ? "configured" : "missing"}, Gateway {operator.configuration.providerKeys.gateway ? "configured" : "missing"}</dd></div><div><dt>Server wallet</dt><dd>{operator.configuration.walletConfigured ? "configured" : "missing"}</dd></div><div><dt>Session overrides</dt><dd>{overrideKeys.size ? [...overrideKeys].join(", ") : "None"}</dd></div></dl><p className={styles.warning}>Private keys and wallet JSON stay server only and are managed through fnox.</p></> : <p>This visitor session has its own executor, settings, run state, history, and paper balance. Its controls cannot start, stop, or reconfigure the shared demo.</p>}
          </section>
        </section>

        <footer className={styles.footer}><button type="submit" className={styles.primary} disabled={!ready || (!dirty && !apiKey && !clearCredential && clearedEndpoints.length === 0) || locked || busy}>Save</button><button type="button" disabled={(!dirty && !apiKey && !clearCredential && clearedEndpoints.length === 0) || busy} onClick={() => { setDraft(settings); setApiKey(""); setKeyHost(null); setClearCredential(false); setClearedEndpoints([]); setMessage("Draft changes cancelled."); }}>Cancel</button><button type="button" disabled={!ready || locked || busy} onClick={reset}>Reset draft</button><span>{scope === "operator" ? "Save applies to the shared executor." : "Save applies to this visitor session on the server."}</span></footer>
      </form>
    </main>
  </div>;
}
