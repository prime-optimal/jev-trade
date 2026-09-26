"use client";

import { useEffect, useState } from "react";
import { ICON_KINDS, siteConfig, validateSiteConfig, type IconKind, type SiteConfig } from "@/lib/site-config";
import SiteIcon from "@/components/Header/SiteIcon";
import styles from "./settings.module.css";

function useLocalEditor(): boolean {
  const [local, setLocal] = useState(false);
  useEffect(() => {
    const host = window.location.hostname;
    setLocal(process.env.NODE_ENV === "development" && (host === "localhost" || host === "127.0.0.1"));
  }, []);
  return local;
}

function useLogoSize(src: string | null): string {
  const [size, setSize] = useState(src ? "loading" : "20 x 20 (built-in SVG mark)");
  useEffect(() => {
    if (!src) {
      setSize("20 x 20 (built-in SVG mark)");
      return;
    }
    const img = new Image();
    img.onload = () => setSize(`${img.naturalWidth} x ${img.naturalHeight} source, shown 20px tall`);
    img.onerror = () => setSize("could not load image");
    img.src = src;
  }, [src]);
  return size;
}

export default function SiteConfigPanel() {
  const editable = useLocalEditor();
  const [draft, setDraft] = useState<SiteConfig>(siteConfig);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const logoSize = useLogoSize(draft.logo);
  const dirty = JSON.stringify(draft) !== JSON.stringify(siteConfig);

  const set = <K extends keyof SiteConfig>(key: K, value: SiteConfig[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setItem = <K extends "menu" | "icons">(key: K, i: number, patch: Partial<SiteConfig[K][number]>) =>
    setDraft((d) => ({ ...d, [key]: d[key].map((v, j) => (j === i ? { ...v, ...patch } : v)) }));
  const remove = (key: "menu" | "icons", i: number) => setDraft((d) => ({ ...d, [key]: d[key].filter((_, j) => j !== i) }));

  async function save() {
    setMessage(null);
    try {
      validateSiteConfig(draft);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invalid site config");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/site-config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? `Request failed with status ${res.status}`);
      setMessage("Saved to web/src/site.config.json. Commit and merge it to change the live site.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset
      className={styles.section}
      disabled={!editable || busy}
      // This panel sits inside the trading settings form; Enter here must not submit trading settings.
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
      }}
    >
      <legend>Top row</legend>
      <p>
        The site name, slogan, logo, menu, and icon links come from <code>web/src/site.config.json</code> and apply to every visitor.
        {editable
          ? " This local dev server can write that file. Commit and merge it to deploy."
          : " Edit it from a local dev server (just web on localhost), then commit and merge. The live site only shows the current values."}
      </p>
      <div className={styles.grid}>
        <label className={styles.field}>
          <span>Site name</span>
          <input value={draft.name} maxLength={40} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label className={styles.field}>
          <span>Slogan</span>
          <input value={draft.slogan} maxLength={80} placeholder="Hidden when blank" onChange={(e) => set("slogan", e.target.value)} />
        </label>
        <label className={styles.field}>
          <span>Logo image</span>
          <input value={draft.logo ?? ""} placeholder="Built-in mark" onChange={(e) => set("logo", e.target.value.trim() || null)} />
          <small>A path in web/public such as /logo.png, or an https URL. Current size: {logoSize}.</small>
        </label>
      </div>

      <h3>Menu items</h3>
      {draft.menu.map((item, i) => (
        <div key={i} className={styles.actions}>
          <input aria-label={`Menu item ${i + 1} label`} value={item.label} onChange={(e) => setItem("menu", i, { label: e.target.value })} />
          <input aria-label={`Menu item ${i + 1} URL`} value={item.href} onChange={(e) => setItem("menu", i, { href: e.target.value })} />
          <button type="button" onClick={() => remove("menu", i)}>Remove</button>
        </div>
      ))}
      <div className={styles.actions}>
        <button type="button" onClick={() => set("menu", [...draft.menu, { label: "New", href: "/" }])}>Add menu item</button>
      </div>

      <h3>Icon links</h3>
      {draft.icons.map((icon, i) => (
        <div key={i} className={styles.actions}>
          <SiteIcon kind={icon.kind} />
          <select aria-label={`Icon link ${i + 1} kind`} value={icon.kind} onChange={(e) => setItem("icons", i, { kind: e.target.value as IconKind })}>
            {ICON_KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <input aria-label={`Icon link ${i + 1} label`} value={icon.label} onChange={(e) => setItem("icons", i, { label: e.target.value })} />
          <input aria-label={`Icon link ${i + 1} URL`} value={icon.href} onChange={(e) => setItem("icons", i, { href: e.target.value })} />
          <button type="button" onClick={() => remove("icons", i)}>Remove</button>
        </div>
      ))}
      <div className={styles.actions}>
        <button type="button" onClick={() => set("icons", [...draft.icons, { kind: "x", label: "Follow on X", href: "https://x.com/" }])}>Add icon link</button>
      </div>

      {editable ? (
        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={!dirty || busy} onClick={() => void save()}>Save to file</button>
          <button type="button" disabled={!dirty || busy} onClick={() => { setDraft(siteConfig); setMessage(null); }}>Cancel</button>
          {message ? <span>{message}</span> : null}
        </div>
      ) : null}
    </fieldset>
  );
}
