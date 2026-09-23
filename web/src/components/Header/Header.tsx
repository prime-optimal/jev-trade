"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { fmtSignedUsd, fmtUsd } from "@/lib/format";
import { useSettings } from "@/lib/trading/SettingsProvider";
import Logo from "@/components/Logo/Logo";
import styles from "./Header.module.css";

export interface HeaderProps {
  connection: "connecting" | "live" | "reconnecting";
  balance: number | null;
  unrealized: number | null;
  realized: number | null;
}

function Score({ label, value, signed = true }: { label: string; value: number | null; signed?: boolean }) {
  const color = !signed || value == null ? undefined : value >= 0 ? "var(--pnl-pos)" : "var(--pnl-neg)";
  return (
    <span className={styles.score}>
      <span className={styles.scoreKey}>{label}</span>
      <span className={styles.scoreVal} style={color ? { color } : undefined}>
        {value == null ? <span aria-label="Not available">-</span> : signed ? fmtSignedUsd(value, 2) : fmtUsd(value, 2)}
      </span>
    </span>
  );
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function timeMs(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clock(value: number): string {
  const seconds = Math.max(0, Math.floor(value / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function Header({ connection, balance, unrealized, realized }: HeaderProps) {
  const pathname = usePathname();
  const { settings, run, connection: venueConnection, start, stop, ready, wallet, authorization, connect, disconnect, prepareNetwork, authorize, reconcile } = useSettings();
  const [now, setNow] = useState(() => Date.now());
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const status = run.status;
  const active = status === "starting" || status === "running" || status === "paused" || status === "stopping";

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  const clockOffset = useMemo(() => run.serverNow - Date.now(), [run.serverNow]);
  const timing = useMemo(() => {
    const duration = Math.max(0, run.durationMs || settings.runDurationMinutes * 60_000);
    const started = timeMs(run.startedAt);
    const deadline = timeMs(run.deadlineAt);
    const stopped = timeMs(run.stoppedAt);
    const current = now + clockOffset;
    const end = stopped ?? (status === "expired" ? deadline : current);
    const elapsed = started == null || end == null ? 0 : Math.min(duration, Math.max(0, end - started));
    const remaining = deadline == null ? duration : Math.min(duration, Math.max(0, deadline - current));
    return { duration, elapsed, remaining };
  }, [clockOffset, now, run.deadlineAt, run.durationMs, run.startedAt, run.stoppedAt, settings.runDurationMinutes, status]);

  const statusText = (() => {
    if (!ready) return "Loading settings";
    if (!wallet.connected) return "Disconnected";
    const progress = `${clock(timing.elapsed)} / ${clock(timing.duration)}`;
    if (status === "running") return `Running ${progress}`;
    if (status === "starting") return `Starting ${progress}`;
    if (status === "paused") return `Paused ${progress}`;
    if (status === "stopping") return `Stopping ${progress}`;
    if (status === "expired") return `Expired ${progress}`;
    if (status === "attention-required") return "Attention required";
    return `Connected, stopped ${clock(timing.duration)}`;
  })();

  const connectionReady = venueConnection?.ok === true && (settings.mode !== "real" || Boolean(authorization));
  const canStart = ready && !busy && wallet.connected && connectionReady && settings.enabledCoins.length > 0 && (status === "off" || status === "expired");
  const canStop = ready && !busy && active && status !== "stopping";
  const switchDisabled = active ? !canStop : !canStart;
  const switchHint = !ready
    ? "Browser settings are loading."
    : settings.enabledCoins.length === 0
      ? "Enable at least one asset."
      : !connectionReady
        ? "Validate a compatible connection before starting."
        : status === "attention-required"
          ? "Resolve the execution warning before starting another run."
          : "Controls trading in this browser only.";

  async function walletAction(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try { await action(); }
    catch (error) { setActionError(error instanceof Error ? error.message : "Wallet action failed."); }
    finally { setBusy(false); }
  }
  async function toggleRun() {
    setActionError(null);
    setBusy(true);
    try {
      if (active) {
        await stop();
        return;
      }
      if (settings.mode === "real") {
        const confirmed = window.confirm("Start real trading? Jev will manage whole-account net positions for enabled markets, including existing exposure. Stop cancels app-owned orders only. It does not close positions or revoke approval.");
        if (!confirmed) return;
        await start(true);
      } else {
        await start(false);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The run control request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className={styles.header} style={{ flexWrap: "wrap" }}>
      <div className={styles.brandLockup}>
        <Logo size={20} />
        <h1 className={styles.brand}>Jev Trade</h1>
        <span className={styles.tagline}>Live Jev trading bot</span>
        <nav className={styles.links} style={{ flexWrap: "wrap" }} aria-label="Primary navigation">
          <Link className={styles.navLink} aria-current={pathname === "/" ? "page" : undefined} href="/">Dashboard</Link>
          <Link className={styles.navLink} aria-current={pathname.startsWith("/settings") ? "page" : undefined} href="/settings">Settings</Link>
          <a className={styles.iconLink} href="https://github.com/aowang-ai/jev-trade" target="_blank" rel="noreferrer" aria-label="jev-trade on GitHub"><GitHubMark /></a>
          {!wallet.connected ? <button type="button" className={styles.navLink} disabled={!ready || busy} onClick={() => void walletAction(connect)}>Connect Brave Wallet</button> : <>
            <button type="button" className={styles.navLink} disabled={busy || active || status === "attention-required"} onClick={() => void walletAction(disconnect)}>Disconnect</button>
            {settings.mode === "real" && !authorization && !active && status !== "attention-required" ? <button type="button" className={styles.navLink} disabled={busy} onClick={() => void walletAction(async () => { await prepareNetwork(); await authorize(); })}>Authorize trading</button> : null}
          </>}
        </nav>
      </div>
      <span className={styles.controls} style={{ flexWrap: "wrap" }}>
        <span className={styles.runStatus}>{settings.network} / {settings.mode === "real" ? "real" : "paper"}</span>
        <span className={styles.priceStatus} data-connected={connection === "live"}>
          <span className={styles.dot} aria-hidden="true" />
          Prices {connection === "live" ? "connected" : connection === "reconnecting" ? "reconnecting" : "connecting"}
        </span>
        <span className={styles.runControl} title={switchHint}>
          <button className={styles.switch} type="button" role="switch" aria-checked={active} aria-label={active ? "Turn trading off" : "Turn trading on"} disabled={switchDisabled} onClick={toggleRun}>
            <span className={styles.switchTrack} aria-hidden="true"><span className={styles.switchThumb} /></span>
            <span>{active ? "Stop" : settings.mode === "paper" ? "On: paper" : "On: real"}</span>
          </button>
          <span className={styles.runStatus} data-running={status === "running"}>{statusText}</span>
          {status === "running" ? <span className={styles.remaining}>{clock(timing.remaining)} left</span> : null}
        </span>
      </span>
      <span className={styles.runStatus}>Markets: {settings.enabledCoins.join(", ") || "None"}{active && timeMs(run.deadlineAt) !== null ? ` / Expires ${new Date(timeMs(run.deadlineAt)!).toLocaleTimeString()}` : ""}</span>
      {status === "attention-required" ? <span className={styles.actionError} role="alert">Attention required. Resolve app-owned order cleanup before a new run. <button type="button" disabled={busy} onClick={() => void walletAction(reconcile)}>Retry cleanup</button></span> : null}
      {actionError ? <span className={styles.actionError} role="alert">{actionError}</span> : null}
      <span className={styles.scores}>
        <Score label="account equity" value={balance} signed={false} />
        <Score label="unrealized" value={unrealized} />
        <Score label="realized" value={realized} />
      </span>
    </header>
  );
}
