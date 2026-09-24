import { leverageRungs } from "./plan";
import {
  deepFreeze,
  PROGRAM_RECORD_TYPE,
  type ActiveProgram,
  type EvaluationGroupDefinition,
  type EvaluationProvider,
  type GroupSnapshot,
  type ProgramCapture,
  type ProgramDefinition,
  type ProgramQuestion,
  type QuestionCriteria,
  type QuestionInstructions,
  type QuestionRole,
  type QuestionType,
  type ResolvedQuestion,
} from "./jev-evidence";
import { FEATURE_CATALOG, FEATURE_CATALOG_VERSION, FEATURE_IDS, extractFeatures } from "./jev-features";
import type { TradeState } from "./model";

export const PROGRAM_SCHEMA = "jev-program-2026-09-24.1";
export const PROJECTION_VERSION = "jev-trade-projection-1";
export const REQUIRED_KEYS: readonly ["bias", "intent", "leverage"] = Object.freeze(["bias", "intent", "leverage"]);

export const PROVIDER_QUESTION_TYPES: { readonly [provider in EvaluationProvider]: readonly QuestionType[] } = deepFreeze({
  openrouter: ["choice", "score", "noul"],
  typesafe: ["choice", "score", "noul"],
  gateway: ["choice", "score", "boolean"],
  local: ["choice"],
});

export const DEFAULT_PROGRAM: ProgramDefinition = deepFreeze({
  schema: PROGRAM_SCHEMA,
  catalogVersion: FEATURE_CATALOG_VERSION,
  questions: REQUIRED_KEYS.map((key) => ({
    key,
    type: "choice" as const,
    role: "required" as const,
    resolver: { id: `jev.${key}`, version: 1 },
  })),
  groups: [{ id: "trade", features: FEATURE_IDS, questions: REQUIRED_KEYS }],
  projection: { version: PROJECTION_VERSION, keys: REQUIRED_KEYS },
});

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export class ProgramValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super("Invalid Jev program");
    this.name = "ProgramValidationError";
    this.issues = deepFreeze(issues.map(({ path, message }) => ({ path, message })));
  }
}

const topLevelKeys: Record<string, true> = { schema: true, catalogVersion: true, questions: true, groups: true, projection: true };
const requiredKeySet: Record<string, true> = { bias: true, intent: true, leverage: true };
const questionTypes: Record<QuestionType, true> = { choice: true, score: true, boolean: true, noul: true };
const resolverIds: Record<string, string> = { bias: "jev.bias", intent: "jev.intent", leverage: "jev.leverage" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function serializableIssue(value: unknown): boolean {
  const ancestors = new WeakSet<object>();
  const visit = (current: unknown): boolean => {
    if (current === null || typeof current === "string" || typeof current === "boolean") return true;
    if (typeof current === "number") return Number.isFinite(current);
    if (typeof current !== "object") return false;
    if (ancestors.has(current)) return false;
    const prototype = Object.getPrototypeOf(current);
    if (Array.isArray(current)) {
      ancestors.add(current);
      for (let index = 0; index < current.length; index += 1) {
        if (!visit(current[index])) return false;
      }
      ancestors.delete(current);
      return true;
    }
    if (prototype !== Object.prototype && prototype !== null) return false;
    ancestors.add(current);
    for (const key of Reflect.ownKeys(current)) {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !("value" in descriptor) || !visit(descriptor.value)) return false;
    }
    ancestors.delete(current);
    return true;
  };
  try {
    return visit(value) && JSON.stringify(value) !== undefined;
  } catch {
    return false;
  }
}

function addTextIssue(issues: ValidationIssue[], value: unknown, path: string): void {
  if (typeof value === "string" && value.length > 2000) issues.push({ path, message: "must be at most 2000 characters" });
}

function validateInstructions(value: unknown, path: string, issues: ValidationIssue[]): boolean {
  if (typeof value === "string") {
    addTextIssue(issues, value, path);
    return true;
  }
  if (!isRecord(value) || Object.keys(value).length === 0) {
    issues.push({ path, message: "must be a non-empty string or object of strings" });
    return false;
  }
  let valid = true;
  for (const [key, text] of Object.entries(value)) {
    addTextIssue(issues, key, `${path}.${key}`);
    if (typeof text !== "string") {
      issues.push({ path: `${path}.${key}`, message: "must be a string" });
      valid = false;
    } else {
      addTextIssue(issues, text, `${path}.${key}`);
    }
  }
  return valid;
}

function validateCriteria(type: unknown, value: unknown, path: string, issues: ValidationIssue[]): boolean {
  if (type === "choice") {
    if (!isRecord(value)) {
      issues.push({ path, message: "choice criteria must be an object" });
      return false;
    }
    const labels = Object.entries(value);
    if (labels.length < 2 || labels.length > 32) issues.push({ path, message: "choice criteria must have 2 to 32 labels" });
    for (const [label, text] of labels) {
      addTextIssue(issues, label, `${path}.${label}`);
      if (text !== null && typeof text !== "string") issues.push({ path: `${path}.${label}`, message: "must be a string or null" });
      else addTextIssue(issues, text, `${path}.${label}`);
    }
    return labels.length >= 2 && labels.length <= 32 && labels.every(([, text]) => text === null || typeof text === "string");
  }
  if (type === "score") {
    if (!Array.isArray(value)) {
      issues.push({ path, message: "score criteria must be an array" });
      return false;
    }
    if (value.length < 2 || value.length > 11) issues.push({ path, message: "score criteria must have 2 to 11 levels" });
    value.forEach((text, index) => {
      if (text !== null && typeof text !== "string") issues.push({ path: `${path}[${index}]`, message: "must be a string or null" });
      else addTextIssue(issues, text, `${path}[${index}]`);
    });
    return value.length >= 2 && value.length <= 11 && value.every((text) => text === null || typeof text === "string");
  }
  if (value === undefined) return true;
  if (!isRecord(value)) {
    issues.push({ path, message: "boolean/noul criteria must be an object" });
    return false;
  }
  let valid = true;
  for (const [label, text] of Object.entries(value)) {
    if (label !== "true" && label !== "false") {
      issues.push({ path: `${path}.${label}`, message: "only true and false criteria are supported" });
      valid = false;
    }
    if (text !== null && typeof text !== "string") {
      issues.push({ path: `${path}.${label}`, message: "must be a string or null" });
      valid = false;
    } else addTextIssue(issues, text, `${path}.${label}`);
  }
  return valid;
}

export function validateProgram(definition: unknown, provider: EvaluationProvider): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  try {
    if (!isRecord(definition)) return [{ path: "$", message: "must be an object" }];
    if (!serializableIssue(definition)) issues.push({ path: "$", message: "must contain only serializable JSON values" });
    for (const key of Object.keys(definition)) {
      if (!Object.hasOwn(topLevelKeys, key)) issues.push({ path: key, message: "unknown top-level field" });
    }
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(definition);
    } catch {
      serialized = undefined;
    }
    if (serialized !== undefined && new TextEncoder().encode(serialized).byteLength > 32768) {
      issues.push({ path: "$", message: "serialized definition must be at most 32768 bytes" });
    }

    if (definition.schema !== PROGRAM_SCHEMA) issues.push({ path: "schema", message: "unsupported program schema" });
    if (definition.catalogVersion !== FEATURE_CATALOG_VERSION) issues.push({ path: "catalogVersion", message: "unsupported feature catalog version" });
    const projection = isRecord(definition.projection) ? definition.projection : null;
    if (!projection) issues.push({ path: "projection", message: "must be an object" });
    else {
      if (projection.version !== PROJECTION_VERSION) issues.push({ path: "projection.version", message: "unsupported projection version" });
      const projectionKeys = projection.keys;
      if (!Array.isArray(projectionKeys) || projectionKeys.length !== REQUIRED_KEYS.length || !REQUIRED_KEYS.every((key, index) => projectionKeys[index] === key)) {
        issues.push({ path: "projection.keys", message: "must exactly match required keys" });
      }
    }

    const questions = Array.isArray(definition.questions) ? definition.questions : [];
    if (!Array.isArray(definition.questions)) issues.push({ path: "questions", message: "must be an array" });
    if (questions.length > 16) issues.push({ path: "questions", message: "must contain at most 16 questions" });
    const questionsByKey = new Map<string, Record<string, unknown>>();
    const questionCounts = new Map<string, number>();
    for (const [index, value] of questions.entries()) {
      const path = `questions[${index}]`;
      if (!isRecord(value)) {
        issues.push({ path, message: "must be an object" });
        continue;
      }
      const key = value.key;
      if (typeof key !== "string") issues.push({ path: `${path}.key`, message: "must be a string" });
      else {
        if (!/^[a-z][A-Za-z0-9_]{0,39}$/.test(key)) issues.push({ path: `${path}.key`, message: "has invalid question key format" });
        if (questionsByKey.has(key)) issues.push({ path: `${path}.key`, message: "duplicate question key" });
        else questionsByKey.set(key, value);
      }
      if (typeof value.type !== "string" || !Object.hasOwn(questionTypes, value.type)) {
        issues.push({ path: `${path}.type`, message: "unsupported question type" });
      } else if (!PROVIDER_QUESTION_TYPES[provider]?.includes(value.type as QuestionType)) {
        issues.push({ path: `${path}.type`, message: `question type is not supported by ${provider}` });
      }
      const role = value.role === undefined ? "observational" : value.role;
      if (role !== "required" && role !== "observational") issues.push({ path: `${path}.role`, message: "must be required or observational" });
      if (typeof key === "string" && Object.hasOwn(requiredKeySet, key)) {
        if (value.type !== "choice") issues.push({ path: `${path}.type`, message: "required questions must use choice" });
        if (role !== "required") issues.push({ path: `${path}.role`, message: "required key must have required role" });
        const resolver = isRecord(value.resolver) ? value.resolver : null;
        if (!resolver || resolver.id !== resolverIds[key] || resolver.version !== 1) issues.push({ path: `${path}.resolver`, message: `must use ${resolverIds[key]} version 1` });
        if (value.instructions !== undefined) issues.push({ path: `${path}.instructions`, message: "required instructions are code-owned" });
        if (value.criteria !== undefined) issues.push({ path: `${path}.criteria`, message: "required criteria are code-owned" });
      } else {
        if (role === "required") issues.push({ path: `${path}.role`, message: "only required keys may have required role" });
        if (value.resolver !== undefined) issues.push({ path: `${path}.resolver`, message: "observational questions cannot use resolvers" });
        if (value.instructions === undefined) issues.push({ path: `${path}.instructions`, message: "static instructions are required" });
        else validateInstructions(value.instructions, `${path}.instructions`, issues);
        if ((value.type === "choice" || value.type === "score") && value.criteria === undefined) {
          issues.push({ path: `${path}.criteria`, message: "criteria are required for this type" });
        } else if (typeof value.type === "string" && Object.hasOwn(questionTypes, value.type)) {
          validateCriteria(value.type, value.criteria, `${path}.criteria`, issues);
        }
      }
    }
    for (const key of REQUIRED_KEYS) {
      if (!questionsByKey.has(key)) issues.push({ path: "questions", message: `missing required question ${key}` });
    }

    const groups = Array.isArray(definition.groups) ? definition.groups : [];
    if (!Array.isArray(definition.groups)) issues.push({ path: "groups", message: "must be an array" });
    if (groups.length > 4) issues.push({ path: "groups", message: "must contain at most 4 groups" });
    const groupIds = new Set<string>();
    const assignments = new Map<string, string[]>();
    for (const [index, value] of groups.entries()) {
      const path = `groups[${index}]`;
      if (!isRecord(value)) {
        issues.push({ path, message: "must be an object" });
        continue;
      }
      const groupId = value.id;
      if (typeof groupId !== "string" || groupId.length === 0) issues.push({ path: `${path}.id`, message: "must be a non-empty string" });
      else if (groupIds.has(groupId)) issues.push({ path: `${path}.id`, message: "duplicate group id" });
      else groupIds.add(groupId);
      const groupQuestions = Array.isArray(value.questions) ? value.questions : [];
      if (!Array.isArray(value.questions)) issues.push({ path: `${path}.questions`, message: "must be an array" });
      if (groupQuestions.length === 0) issues.push({ path: `${path}.questions`, message: "group must not be empty" });
      for (const questionKey of groupQuestions) {
        if (typeof questionKey !== "string") {
          issues.push({ path: `${path}.questions`, message: "question keys must be strings" });
          continue;
        }
        questionCounts.set(questionKey, (questionCounts.get(questionKey) ?? 0) + 1);
        if (!questionsByKey.has(questionKey)) issues.push({ path: `${path}.questions`, message: `unknown question ${questionKey}` });
        if (typeof groupId === "string") assignments.set(questionKey, [...(assignments.get(questionKey) ?? []), groupId]);
      }
      const selectedFeatures = Array.isArray(value.features) ? value.features : [];
      if (!Array.isArray(value.features)) issues.push({ path: `${path}.features`, message: "must be an array" });
      const selected = new Set<string>();
      for (const feature of selectedFeatures) {
        if (typeof feature !== "string" || !Object.hasOwn(FEATURE_CATALOG, feature)) {
          issues.push({ path: `${path}.features`, message: `unknown feature ${String(feature)}` });
        } else if (selected.has(feature)) issues.push({ path: `${path}.features`, message: `duplicate feature ${feature}` });
        else selected.add(feature);
      }
    }
    for (const key of questionsByKey.keys()) {
      if (questionCounts.get(key) !== 1) issues.push({ path: `questions.${key}`, message: "question must appear in exactly one group" });
    }
    const requiredGroups = REQUIRED_KEYS.map((key) => assignments.get(key) ?? []);
    const requiredGroupId = requiredGroups[0]?.[0];
    if (!requiredGroupId || requiredGroups.some((group) => group.length !== 1 || group[0] !== requiredGroupId)) {
      issues.push({ path: "groups", message: "all required questions must be in one group" });
    } else {
      const requiredGroup = groups.find((group) => isRecord(group) && group.id === requiredGroupId);
      if (isRecord(requiredGroup)) {
        const requiredQuestions = requiredGroup.questions;
        if (Array.isArray(requiredQuestions) && (requiredQuestions.length !== REQUIRED_KEYS.length || !REQUIRED_KEYS.every((key) => requiredQuestions.includes(key)))) {
          issues.push({ path: `groups.${requiredGroupId}.questions`, message: "required group cannot contain observational questions" });
        }
      }
    }
    return deepFreeze(issues);
  } catch {
    return deepFreeze([...issues, { path: "$", message: "could not validate malformed program" }]);
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) as string;
}

export function programRevision(definition: ProgramDefinition): string {
  const selectedFeatures = definition.groups.flatMap((group) => group.features).map((id) => FEATURE_CATALOG[id as keyof typeof FEATURE_CATALOG]);
  const canonicalQuestions = definition.questions.map((question) => ({
    key: question.key,
    type: question.type,
    role: question.role ?? "observational",
    instructions: question.instructions ?? null,
    criteria: question.criteria ?? null,
    resolver: question.resolver ?? null,
  }));
  const canonical = canonicalJson({
    schema: definition.schema,
    catalogVersion: definition.catalogVersion,
    catalog: selectedFeatures,
    questions: canonicalQuestions,
    groups: definition.groups,
    projection: definition.projection,
  });
  return `sha256:${new Bun.CryptoHasher("sha256").update(canonical).digest("hex")}`;
}

export function activateProgram(definition: unknown, provider: EvaluationProvider, expectedRevision?: string): ActiveProgram {
  const issues = validateProgram(definition, provider);
  if (issues.length > 0) throw new ProgramValidationError(issues);
  const copy = structuredClone(definition) as ProgramDefinition;
  const revision = programRevision(copy);
  if (expectedRevision !== undefined && expectedRevision !== revision) throw new Error("Program revision does not match expected revision");
  const requiredGroup = copy.groups.find((group) => REQUIRED_KEYS.every((key) => group.questions.includes(key)));
  if (!requiredGroup) throw new ProgramValidationError([{ path: "groups", message: "required group is missing" }]);
  return deepFreeze({ revision, definition: copy, requiredGroupId: requiredGroup.id });
}

function resolvedRequiredQuestion(key: string, state: TradeState): { instructions: QuestionInstructions; criteria: QuestionCriteria } {
  const asset = state.coin;
  const position = state.position;
  const stance = position.side === "flat"
    ? `flat ${asset}`
    : `${position.side} ${position.size} ${asset} @ ${position.entry ?? "?"}`;
  const levNow = position.leverage != null ? `${position.leverage}x` : "unset";
  const rungs = leverageRungs(state.maxLeverage);
  const context = `${asset} ${state.market}. position has side/size/entry. indicators are 1m sma/ema/rsi/vol. asset is mark/oracle/funding/oi. trades and book are the tape.`;
  if (key === "bias") {
    return {
      instructions: {
        question: `long or short ${asset}?`,
        goal: state.market,
        timing: `tickMs=${state.tickMs}. position=${stance}.`,
        inputs: context,
      },
      criteria: { long: "long", short: "short" },
    };
  }
  if (key === "intent") {
    return {
      instructions: {
        question: position.side === "flat" ? `open or hold ${asset}?` : `open, close, or hold ${asset}?`,
        goal: `position=${stance}.`,
        timing: `tickMs=${state.tickMs}`,
        inputs: context,
      },
      criteria: position.side === "flat"
        ? { open: "open", hold: "hold" }
        : { open: "open", close: "close", hold: "hold" },
    };
  }
  const criteria: Record<string, string> = {};
  for (const rung of rungs) criteria[String(rung)] = `${rung}x`;
  return {
    instructions: {
      question: `cross leverage for ${asset}?`,
      goal: `current ${levNow}. max ${state.maxLeverage}x.`,
      timing: `rungs ${rungs.join(" ")}`,
      inputs: context,
    },
    criteria,
  };
}

function resolveQuestion(question: ProgramQuestion, state: TradeState): ResolvedQuestion {
  const role: QuestionRole = question.role ?? "observational";
  if (question.resolver) {
    const materialized = resolvedRequiredQuestion(question.key, state);
    return {
      key: question.key,
      type: question.type,
      role,
      instructions: materialized.instructions,
      criteria: materialized.criteria,
      resolver: question.resolver,
    };
  }
  return {
    key: question.key,
    type: question.type,
    role,
    instructions: question.instructions!,
    criteria: question.criteria ?? null,
    resolver: null,
  };
}

export function captureProgram(program: ActiveProgram, state: TradeState, capturedAt: number): ProgramCapture {
  const questionsByKey = new Map(program.definition.questions.map((question) => [question.key, question]));
  const groups: GroupSnapshot[] = program.definition.groups.map((group: EvaluationGroupDefinition) => ({
    groupId: group.id,
    capturedAt,
    catalogVersion: program.definition.catalogVersion,
    state: extractFeatures(state, group.features),
    features: group.features.map((id) => FEATURE_CATALOG[id as keyof typeof FEATURE_CATALOG]),
    questions: group.questions.map((key) => resolveQuestion(questionsByKey.get(key)!, state)),
  }));
  return deepFreeze({
    recordType: PROGRAM_RECORD_TYPE,
    revision: program.revision,
    projectionVersion: program.definition.projection.version,
    definition: program.definition,
    requiredGroupId: program.requiredGroupId,
    capturedAt,
    groups,
  });
}
