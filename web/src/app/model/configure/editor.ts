import type { ProgramDefinition, ProgramQuestion, QuestionType } from "@/lib/journal-types";

// IDs mirror the versioned bot feature catalog. The editor never accepts arbitrary input IDs.
export const FEATURES = [
  ["coin", "Asset identifier"], ["market", "Market identifier"], ["tick", "Tick sequence number"],
  ["tickMs", "Configured decision interval in milliseconds"], ["mid", "Mid-market price in USD"],
  ["spreadBps", "Bid-ask spread in basis points"], ["bookImbalance", "Bid versus ask size within 100 basis points of mid"],
  ["depth", "Cumulative resting size by distance from mid"], ["book", "Best resting prices and sizes"],
  ["returnsBps", "Recent price returns in basis points"], ["recentMids", "Recent mid-market prices in USD"],
  ["trades", "Taker trade summary"], ["recentTrades", "Recent taker prints"],
  ["position", "Current position; freshness is unknown"], ["indicators", "Candle-derived indicators; may be unavailable and freshness is unknown"],
  ["asset", "Venue market data; may be unavailable and freshness is unknown"], ["maxLeverage", "Maximum cross leverage; freshness is unknown"],
] as const;
export const REQUIRED = ["bias", "intent", "leverage"];
export function required(question: ProgramQuestion): boolean { return REQUIRED.includes(question.key); }
export function fingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${fingerprint(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function supportedTypes(provider: string): QuestionType[] {
  if (provider === "local") return ["choice"];
  if (provider === "gateway") return ["choice", "score", "boolean"];
  if (provider === "openrouter" || provider === "typesafe") return ["choice", "score", "noul"];
  return ["choice"];
}
export function programProvider(model: string | undefined, configuredProvider: string | undefined): string {
  if (!model) return "unknown";
  return model === "jev" ? configuredProvider ?? "unknown" : "local";
}
export function validateDraft(draft: ProgramDefinition, provider: string): string[] {
  const errors: string[] = [];
  if (draft.questions.length > 16) errors.push("Use at most 16 questions.");
  if (!draft.groups.length || draft.groups.length > 4) errors.push("Use 1 to 4 evaluation groups.");
  const keys = new Set<string>();
  for (const q of draft.questions) {
    if (keys.has(q.key)) errors.push(`Duplicate question key: ${q.key}.`);
    keys.add(q.key);
    if (required(q)) continue;
    if (!/^[a-z][A-Za-z0-9_]{0,39}$/.test(q.key)) errors.push(`${q.key || "Question"}: use a letter first and up to 40 letters, digits or underscores.`);
    if (!supportedTypes(provider).includes(q.type)) errors.push(`${q.key}: ${q.type} is not supported by ${provider}.`);
    const instructions = typeof q.instructions === "string" ? [q.instructions] : Object.values(q.instructions ?? {});
    if (!instructions.length || instructions.some((text) => !text.trim() || text.length > 2000)) errors.push(`${q.key}: instructions need 1 to 2000 characters per field.`);
    const entries = Object.entries(q.criteria ?? {});
    if (q.type === "choice" && (entries.length < 2 || entries.length > 32)) errors.push(`${q.key}: use 2 to 32 choice labels.`);
    if (q.type === "score" && (!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.length > 11)) errors.push(`${q.key}: use 2 to 11 score levels.`);
    if (entries.some(([label, text]) => !label.trim() || label.length > 2000 || (text !== null && text.length > 2000))) errors.push(`${q.key}: criteria labels must be non-empty and text at most 2000 characters.`);
    if (draft.groups.filter((g) => g.questions.includes(q.key)).length !== 1) errors.push(`${q.key}: select exactly one evaluation group.`);
  }
  for (const group of draft.groups) {
    if (!group.questions.length) errors.push(`${group.id}: an evaluation group needs at least one question.`);
    if (group.features.some((id) => !FEATURES.some(([feature]) => feature === id))) errors.push(`${group.id}: contains an unsupported feature.`);
  }
  if (new TextEncoder().encode(JSON.stringify(draft)).byteLength > 32768) errors.push("The program exceeds the 32 KiB definition limit.");
  return errors;
}
