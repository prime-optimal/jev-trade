"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { fmtSignedUsd, fmtUsd } from "@/lib/format";
import { useSettings } from "@/lib/trading/SettingsProvider";
import Logo from "@/components/Logo/Logo";
import SiteIcon from "./SiteIcon";
import { siteConfig } from "@/lib/site-config";
import { Bone } from "@/components/Skeleton/Skeleton";
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
        {value == null ? <Bone w={64} h={16} /> : signed ? fmtSignedUsd(value, 2) : fmtUsd(value, 2)}
      </span>
    </span>
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
  const { settings, scope, sessionState, run, connection: venueConnection, start, stop, ready } = useSettings();
  const [now, setNow] = useState(() => Date.now());
  const [actionError, setActionError] = useState<string | null>(null);
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

  // The header shows one clock: time left while a run is active, the run limit while Off.
  const statusText = (() => {
    if (scope === "visitor" && !ready) {
      if (sessionState === "expired") return "Expired";
      if (sessionState === "error") return "Unavailable";
      return "Connecting";
    }
    if (status === "attention-required") return "Attention";
    if (status === "expired") return "Expired";
    return clock(active ? timing.remaining : timing.duration);
  })();
  const statusTitle = active
    ? `${status} ${clock(timing.elapsed)} of ${clock(timing.duration)}, ${clock(timing.remaining)} left`
    : `Run limit ${clock(timing.duration)}`;

  const connectionReady = venueConnection?.ok === true && (settings.mode !== "real" || venueConnection.realAllowed);
  const canStart = ready && (scope === "visitor" || connectionReady) && settings.enabledCoins.length > 0 && (status === "off" || status === "expired");
  const canStop = ready && active && status !== "stopping";
  const switchDisabled = active ? !canStop : !canStart;
  const switchHint = !ready
    ? scope === "visitor" && sessionState === "expired" ? "Reconnect your expired paper session in Settings." : "Trading control is connecting."
    : settings.enabledCoins.length === 0
      ? "Enable at least one asset."
      : scope === "operator" && !connectionReady
        ? "Validate a compatible connection before starting."
        : status === "attention-required"
          ? "Resolve the execution warning before starting another run."
          : scope === "visitor" ? "Controls this visitor paper session only." : undefined;

  async function toggleRun() {
    setActionError(null);
    try {
      if (active) {
        await stop();
        return;
      }
      if (settings.mode === "real") {
        const confirmed = window.confirm("Start real trading? Jev may place orders using the configured wallet.");
        if (!confirmed) return;
        await start(true);
      } else {
        await start(false);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The run control request failed.");
    }
  }

  const showScores = balance != null || unrealized != null || realized != null;
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <header className={styles.header}>
      <div className={styles.brandLockup}>
        {siteConfig.logo ? (
          <img className={styles.logoImg} src={siteConfig.logo} alt="" height={20} />
        ) : (
          <Logo size={20} />
        )}
        <h1 className={styles.brand}>{siteConfig.name}</h1>
        {siteConfig.slogan ? <span className={styles.tagline}>{siteConfig.slogan}</span> : null}
        <nav className={styles.links} aria-label="Primary navigation">
          {siteConfig.menu.map((item) =>
            item.href.startsWith("/") ? (
              <Link key={item.href} className={styles.navLink} aria-current={isActive(item.href) ? "page" : undefined} href={item.href}>
                {item.label}
              </Link>
            ) : (
              <a key={item.href} className={styles.navLink} href={item.href} target="_blank" rel="noreferrer">
                {item.label}
              </a>
            ),
          )}
          {siteConfig.icons.map((icon) => (
            <a key={icon.href} className={styles.iconLink} href={icon.href} target="_blank" rel="noreferrer" aria-label={icon.label} title={icon.label}>
              <SiteIcon kind={icon.kind} />
            </a>
          ))}
        </nav>
      </div>
      <span className={styles.priceStatus} data-connected={connection === "live"}>
        <span className={styles.dot} aria-hidden="true" />
        Prices {connection === "live" ? "connected" : connection === "reconnecting" ? "reconnecting" : "connecting"}
      </span>
      {actionError ? <span className={styles.actionError} role="alert">{actionError}</span> : null}
      <span className={styles.scores}>
        {showScores ? (
          <>
            <Score label="balance" value={balance} signed={false} />
            <Score label="unrealized" value={unrealized} />
            <Score label="realized" value={realized} />
          </>
        ) : null}
        <span className={styles.runControl} title={switchHint ?? statusTitle}>
          <button className={styles.switch} type="button" role="switch" aria-checked={active} aria-label={active ? "Turn trading off" : "Turn trading on"} disabled={switchDisabled} onClick={toggleRun}>
            <span className={styles.switchTrack} aria-hidden="true"><span className={styles.switchThumb} /></span>
            <span>{active ? "On" : "Off"}</span>
          </button>
          <span className={styles.runStatus} data-running={status === "running"} aria-label={statusTitle}>{statusText}</span>
        </span>
      </span>
    </header>
  );
}
