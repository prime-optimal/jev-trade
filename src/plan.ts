import type { Action, Bias, Intent } from "./types";

/** Hyperliquid integer rungs up to the coin's max leverage. */
export function leverageRungs(max: number): number[] {
  const cap = Math.max(1, Math.floor(Number(max) || 1));
  const out = [1, 2, 3, 5, 10, 20, 40, 50].filter((n) => n <= cap);
  if (!out.includes(cap)) out.push(cap);
  return out;
}

export function parseLeverage(raw: unknown, max: number, fallback: number): number {
  const n = typeof raw === "number" || typeof raw === "string" ? Number(raw) : NaN;
  const rungs = leverageRungs(max);
  const seed = Number.isFinite(n) && n >= 1 ? Math.round(n) : fallback;
  return rungs.reduce((best, x) => (Math.abs(x - seed) < Math.abs(best - seed) ? x : best), rungs[0]!);
}

/** Close is only a real choice when a position exists. Flat plus close means stand down. */
export function liveIntent(positionSide: "long" | "short" | "flat", picked: Intent): Intent {
  if (positionSide !== "flat") return picked;
  return picked === "open" ? "open" : "hold";
}

export function quoteAction(intent: Intent, bias: Bias): Action {
  if (intent === "hold") return "hold";
  if (intent === "open") return bias === "long" ? "buy" : "sell";
  return bias === "long" ? "sell" : "buy";
}
