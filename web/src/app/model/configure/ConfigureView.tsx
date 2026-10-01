"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Header from "@/components/Header/Header";
import type { ProgramDefinition, ProgramQuestion, QuestionCriteria, QuestionType } from "@/lib/journal-types";
import { useSettings } from "@/lib/trading/SettingsProvider";
import { applySessionProgram, createVisitorSession, getOperator, getSessionProgram, OperatorRequestError, SESSION_API, startOperator, stopOperator, type SessionProgramSnapshot } from "@/lib/trading/operator";
import type { OperatorSnapshot } from "@/lib/trading/settings";
import { FEATURES, fingerprint, programProvider, required, supportedTypes, validateDraft } from "./editor";
import styles from "./configure.module.css";

export default function ConfigureView() {
  const context = useSettings();
  const [loaded, setLoaded] = useState<SessionProgramSnapshot | null>(null);
  const [draft, setDraft] = useState<ProgramDefinition | null>(null);
  const [session, setSession] = useState<OperatorSnapshot | null>(null);
  const [presetId, setPresetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [runAction, setRunAction] = useState<"start" | "stop" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [needsSession, setNeedsSession] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    setBusy(true);
    setError(null);
    try {
      const [program, operator] = await Promise.all([getSessionProgram(signal), getOperator(SESSION_API, signal)]);
      setLoaded(program); setDraft(program.definition); setSession(operator); setNeedsSession(false);
      setPresetId(program.presets.find((p) => fingerprint(p.definition) === fingerprint(program.definition))?.id ?? "");
    } catch (cause) {
      if (signal?.aborted) return;
      setError(cause instanceof Error ? cause.message : "Could not load the session program.");
      setNeedsSession(true);
    } finally { if (!signal?.aborted) setBusy(false); }
  }, []);
  useEffect(() => {
    if (!context.ready) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => { controller.abort(); setBusy(false); };
  }, [context.ready, load]);
  useEffect(() => {
    if (!loaded) return;
    let disposed = false;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      void getOperator(SESSION_API, controller.signal).then((operator) => { if (!disposed) setSession(operator); }).catch((cause) => { if (!disposed) { setSession(null); if (cause instanceof OperatorRequestError && (cause.status === 401 || cause.status === 410)) { setNeedsSession(true); setError("Your paper session is not connected. Reconnect to load its program."); } } });
    }, 5000);
    return () => { disposed = true; controller.abort(); window.clearInterval(timer); };
  }, [loaded]);
  const provider = programProvider(session?.configuration.model, session?.configuration.jevProvider);
  const errors = draft ? validateDraft(draft, provider) : [];
  const changed = !!draft && !!loaded && fingerprint(draft) !== fingerprint(loaded.definition);
  const preset = loaded?.presets.find((p) => p.id === presetId);
  const presetChanged = !!draft && !!preset && fingerprint(draft) !== fingerprint(preset.definition);
  const stopped = session?.run.status === "off" || session?.run.status === "expired";
  const canStop = session?.run.status === "starting" || session?.run.status === "running" || session?.run.status === "paused";
  const changeQuestion = (index: number, patch: Partial<ProgramQuestion>) => {
    setDraft((current) => current ? { ...current, questions: current.questions.map((q, i) => i === index ? { ...q, ...patch } : q) } : current);
    setNotice("");
  };
  const removeQuestion = (key: string) => {
    setDraft((current) => current ? { ...current, questions: current.questions.filter((q) => q.key !== key), groups: current.groups.map((g) => ({ ...g, questions: g.questions.filter((k) => k !== key) })).filter((g) => g.questions.length > 0) } : current);
    setNotice("");
  };
  const addQuestion = () => {
    if (!draft) return;
    let count = 1;
    while (draft.questions.some((q) => q.key === `observation${count}`)) count++;
    const key = `observation${count}`;
    const group = draft.groups.find((g) => !g.questions.some((k) => ["bias", "intent", "leverage"].includes(k)));
    let groupId = "observations";
    while (draft.groups.some((g) => g.id === groupId)) groupId += "_";
    setDraft({ ...draft, questions: [...draft.questions, { key, role: "observational", type: "choice", instructions: "Describe the market condition.", criteria: { quiet: "Limited directional movement", directional: "Clear directional movement" } }], groups: group ? draft.groups.map((g) => g.id === group.id ? { ...g, questions: [...g.questions, key] } : g) : [...draft.groups, { id: groupId, features: ["mid", "returnsBps"], questions: [key] }] });
    setNotice("");
  };
  const connect = async () => {
    setBusy(true); setError(null); setNotice("");
    try {
      if (context.scope === "visitor") await context.reconnect();
      else await createVisitorSession();
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The paper session could not connect."); }
    finally { setBusy(false); }
  };
  const controlRun = async (action: "start" | "stop") => {
    if (busy || needsSession || !session || (action === "start" ? !stopped : !canStop)) return;
    setBusy(true); setRunAction(action); setError(null); setNotice("");
    try {
      const run = action === "start" ? await startOperator(SESSION_API, false) : await stopOperator(SESSION_API);
      setSession((current) => current ? { ...current, run } : current);
      setNotice(action === "start"
        ? "Paper session start requested. This run uses the applied program, not unapplied draft changes."
        : "Paper session stop requested. Apply is available once this session is stopped.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not ${action} the paper session.`);
      if (cause instanceof OperatorRequestError && (cause.status === 401 || cause.status === 410)) {
        setSession(null); setNeedsSession(true);
      }
    } finally { setBusy(false); setRunAction(null); }
  };
  const apply = async () => {
    if (!draft || !stopped || errors.length) return;
    setBusy(true); setError(null); setNotice("");
    try {
      const operator = await getOperator(SESSION_API);
      setSession(operator);
      if (operator.run.status !== "off" && operator.run.status !== "expired") throw new Error("Stop the paper session before applying a program.");
      const result = await applySessionProgram(draft);
      setLoaded((current) => current ? { ...current, ...result } : current);
      setDraft(result.definition); setNotice("Program applied. This paper session remains stopped until you choose Start paper session.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not apply the program."); }
    finally { setBusy(false); }
  };
  return <div className={styles.page}>
    <Header connection={context.feed.connection} balance={null} unrealized={null} realized={null} showRunControl={false} />
    <main className={styles.main}>
      <header className={styles.heading}><h1>Configure model</h1><p>Edit a paper session program without changing the code-owned trading answers.</p><nav aria-label="Model configuration"><Link href="/model">Back to Model</Link><Link href="/help#questions">Program help</Link></nav></header>
      <section className={styles.status} aria-label="Session program status" aria-live="polite">
        <p>Paper session: {session ? stopped ? "Stopped" : session.run.status === "attention-required" ? "Attention required" : `Active (${session.run.status})` : "Not connected"}</p>
        <p>Revision: {loaded?.revision ?? "Not loaded"}</p><p>{changed ? "Unapplied changes" : "No unapplied changes"}</p>
        <div className={styles.row}>
          <button type="button" disabled={busy || needsSession || !session || !stopped || session.settings.enabledCoins.length === 0} onClick={() => void controlRun("start")}>{runAction === "start" ? "Starting..." : "Start paper session"}</button>
          <button type="button" disabled={busy || needsSession || !canStop} onClick={() => void controlRun("stop")}>{runAction === "stop" ? "Stopping..." : "Stop paper session"}</button>
        </div>
        <p>These controls affect only the visitor paper session whose program is shown here. Start uses the applied program.</p>
      </section>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.status} role="status">{notice}</p>}
      {loaded && needsSession && <button type="button" disabled={busy} onClick={() => void connect()}>Reconnect paper session</button>}
      {!loaded ? <section className={styles.panel}><h2>A paper session is needed</h2><p>{context.sessionState === "connecting" && !needsSession ? "Connecting to your paper session..." : "Connect or reconnect using the existing session service to load your saved program. No program is applied until you choose Apply."}</p>{context.notice && <p>{context.notice}</p>}<button type="button" disabled={busy || context.sessionState === "connecting"} onClick={() => void connect()}>Connect paper session</button></section> : draft && <>
        <section className={styles.panel}><h2>Starting point</h2><p>Presets are editable drafts, not automatic trading recommendations. Selecting one does not apply it.</p><label className={styles.field}>Preset<select value={presetId} disabled={busy} onChange={(event) => { const selected = loaded.presets.find((p) => p.id === event.target.value); if (selected) { setPresetId(selected.id); setDraft(selected.definition); setNotice(""); } }}><option value="" disabled>Current custom program</option>{loaded.presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>{preset && <><p>{preset.description}</p><p aria-live="polite">{presetChanged ? `Modified from ${preset.name}` : `Matches ${preset.name}`}</p></>}</section>
        <section className={styles.panel}><h2>Required trading answers</h2><p>Bias, intent and leverage are code-owned choice questions. Their instructions, answer schema, resolvers and trade projection cannot be edited here. Observations add context to the journal; they do not replace the buy, sell or hold decision.</p><ul>{draft.questions.filter(required).map((q) => <li key={q.key}>{q.key}: {q.type}, resolver {q.resolver?.id} version {q.resolver?.version}</li>)}</ul></section>
        <section className={styles.panel}><div className={styles.row}><h2>Observational questions</h2><button type="button" disabled={busy || draft.questions.length >= 16 || (draft.groups.length >= 4 && !draft.groups.some((g) => !g.questions.some((k) => ["bias", "intent", "leverage"].includes(k))))} onClick={addQuestion}>Add question</button></div><p>Supported answer types for this session provider ({provider}): {supportedTypes(provider).join(", ")}. Instructions are the question text Jev receives.</p>
          {!draft.questions.some((q) => !required(q)) && <p>No observational questions. Add one or load an editable preset.</p>}
          {draft.questions.map((q, index) => required(q) ? null : <fieldset key={index} className={styles.question} disabled={busy}><legend>{q.key}</legend><label className={styles.field}>Question key<input value={q.key} maxLength={40} onChange={(event) => { const key = event.target.value; if (["bias", "intent", "leverage"].includes(key) || draft.questions.some((other, i) => i !== index && other.key === key)) { setError("Question keys must be unique and cannot use bias, intent or leverage."); return; } setDraft({ ...draft, questions: draft.questions.map((other, i) => i === index ? { ...other, key } : other), groups: draft.groups.map((g) => ({ ...g, questions: g.questions.map((k) => k === q.key ? key : k) })) }); }} /></label>
            <label className={styles.field}>Answer type<select value={q.type} onChange={(event) => { const type = event.target.value as QuestionType; changeQuestion(index, { type, criteria: type === "choice" ? { low: "Low", high: "High" } : type === "score" ? ["Low", "High"] : { true: "True", false: "False" } }); }}>{supportedTypes(provider).map((type) => <option key={type}>{type}</option>)}</select></label>
            {typeof q.instructions === "object" ? Object.entries(q.instructions).map(([key, text]) => <label key={key} className={styles.field}>Instructions: {key}<textarea value={text} maxLength={2000} rows={3} onChange={(event) => changeQuestion(index, { instructions: { ...(q.instructions as Record<string, string>), [key]: event.target.value } })} /></label>) : <label className={styles.field}>Question instructions<textarea value={q.instructions ?? ""} maxLength={2000} rows={3} onChange={(event) => changeQuestion(index, { instructions: event.target.value })} /></label>}
            <fieldset className={styles.criteria}><legend>Answer criteria</legend>{Object.entries(q.criteria ?? {}).map(([label, text], criterionIndex) => <div key={criterionIndex} className={styles.criterion}><label className={styles.field}>{q.type === "choice" ? "Choice label" : q.type === "score" ? "Score level" : "Answer"}{q.type === "choice" ? <input value={label} maxLength={2000} onChange={(event) => { const next = event.target.value; if (next !== label && Object.hasOwn(q.criteria ?? {}, next)) { setError("Choice labels must be unique."); return; } changeQuestion(index, { criteria: Object.fromEntries(Object.entries(q.criteria ?? {}).map(([k, v]) => [k === label ? next : k, v])) }); }} /> : <span>{label}</span>}</label><label className={styles.field}>Meaning<textarea rows={2} maxLength={2000} value={text ?? ""} onChange={(event) => { const criteria = Array.isArray(q.criteria) ? q.criteria.map((v, i) => i === criterionIndex ? event.target.value : v) : { ...q.criteria, [label]: event.target.value }; changeQuestion(index, { criteria }); }} /></label>{(q.type === "choice" || q.type === "score") && <button type="button" disabled={Object.keys(q.criteria ?? {}).length <= 2} onClick={() => changeQuestion(index, { criteria: (Array.isArray(q.criteria) ? q.criteria.filter((_, i) => i !== criterionIndex) : Object.fromEntries(Object.entries(q.criteria ?? {}).filter(([k]) => k !== label))) as QuestionCriteria })}>Remove criterion</button>}</div>)}{(q.type === "choice" || q.type === "score") && <button type="button" disabled={Object.keys(q.criteria ?? {}).length >= (q.type === "choice" ? 32 : 11)} onClick={() => { if (Array.isArray(q.criteria)) changeQuestion(index, { criteria: [...q.criteria, ""] }); else { let id = 1; while (Object.hasOwn(q.criteria ?? {}, `choice${id}`)) id++; changeQuestion(index, { criteria: { ...q.criteria, [`choice${id}`]: "" } }); } }}>Add criterion</button>}</fieldset>
            <p>Evaluation group: {draft.groups.find((g) => g.questions.includes(q.key))?.id}</p><button type="button" onClick={() => removeQuestion(q.key)}>Remove question</button>
          </fieldset>)}
        </section>
        <section className={styles.panel}><h2>Feature inputs</h2><p>Select only catalog inputs for each evaluation group. An empty selection sends no feature state to that group. Removing an observational group happens when its last question is removed.</p>{draft.groups.map((group) => <fieldset key={group.id} className={styles.question} disabled={busy}><legend>{group.id} inputs</legend><p>Questions: {group.questions.join(", ")}</p><div className={styles.features}>{FEATURES.map(([id, description]) => <div key={id} className={styles.feature}><label><input type="checkbox" checked={group.features.includes(id)} onChange={(event) => setDraft({ ...draft, groups: draft.groups.map((g) => g.id === group.id ? { ...g, features: event.target.checked ? [...g.features, id] : g.features.filter((f) => f !== id) } : g) })} /><span><strong>{id}</strong><span>{description}</span></span></label><Link href={`/help#feature-${id}`}>Read about {id}</Link></div>)}</div></fieldset>)}</section>
        {errors.length > 0 && <section className={`${styles.panel} ${styles.error}`} role="alert"><h2>Fix before applying</h2><ul>{errors.map((message, i) => <li key={i}>{message}</li>)}</ul></section>}
        <footer className={styles.actions}><p aria-live="polite">{stopped ? "Apply saves this program for your next paper run and does not start it." : "Use Stop paper session above before applying. Apply requires this page's paper session to be stopped and does not start it. Draft editing remains available."}</p><div className={styles.row}><button type="button" className={styles.primary} disabled={busy || !changed || !stopped || errors.length > 0} onClick={() => void apply()}>{busy && !runAction ? "Saving..." : "Apply program"}</button><button type="button" disabled={busy || !changed} onClick={() => { setDraft(loaded.definition); setPresetId(loaded.presets.find((p) => fingerprint(p.definition) === fingerprint(loaded.definition))?.id ?? ""); setError(null); setNotice("Draft reset to the active session program."); }}>Reset draft</button></div></footer>
      </>}
    </main>
  </div>;
}
