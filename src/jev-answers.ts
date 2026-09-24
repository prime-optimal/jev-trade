import type {
  BoundedRaw,
  GroupSnapshot,
  JsonValue,
  ProviderAnswer,
  QuestionEvidence,
  ResolvedQuestion,
  UnexpectedAnswer,
} from "./jev-evidence";

export const RAW_LIMIT_BYTES = 4096;

const invalid = (question: ResolvedQuestion, groupId: string, raw: BoundedRaw | null, error: string): QuestionEvidence => ({
  key: question.key,
  declaredType: question.type,
  groupId,
  role: question.role,
  status: "invalid",
  raw,
  error,
});

function safeJson(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? JSON.stringify("[unserializable]") : json;
  } catch {
    return JSON.stringify("[unserializable]");
  }
}

function utf8Prefix(bytes: Uint8Array, limit: number): string {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let end = Math.min(bytes.length, limit);
  while (end > 0) {
    try {
      return decoder.decode(bytes.subarray(0, end));
    } catch {
      end -= 1;
    }
  }
  return "";
}

export function boundedRaw(value: unknown): BoundedRaw | null {
  if (value === undefined) return null;
  const json = safeJson(value);
  const bytes = new TextEncoder().encode(json);
  const truncated = bytes.length > RAW_LIMIT_BYTES;
  return {
    json: truncated ? utf8Prefix(bytes, RAW_LIMIT_BYTES) : json,
    bytes: bytes.length,
    truncated,
  };
}


interface OwnField {
  readonly present: boolean;
  readonly value?: unknown;
  readonly accessor?: boolean;
}

function readOwn(record: Record<string, unknown>, key: string): OwnField {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) return { present: false };
  if (!("value" in descriptor)) return { present: true, accessor: true };
  return { present: true, value: descriptor.value };
}

function finiteProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function finiteConfidence(record: Record<string, unknown>): { readonly ok: boolean; readonly present: boolean; readonly value?: number } {
  const field = readOwn(record, "confidence");
  if (!field.present) return { ok: true, present: false };
  if (field.accessor || !finiteProbability(field.value)) return { ok: false, present: true };
  return { ok: true, present: true, value: field.value };
}


function cloneJsonValue(value: unknown, ancestors: Set<object>): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "object") return undefined;
  if (ancestors.has(value)) return undefined;
  ancestors.add(value);
  let copy: JsonValue | undefined;
  if (Array.isArray(value)) {
    const items: JsonValue[] = [];
    for (const item of value) {
      const cloned = cloneJsonValue(item, ancestors);
      if (cloned === undefined) {
        ancestors.delete(value);
        return undefined;
      }
      items.push(cloned);
    }
    copy = items;
  } else {
    const entries: [string, JsonValue][] = [];
    for (const key of Object.keys(value)) {
      const field = readOwn(value as Record<string, unknown>, key);
      if (!field.present || field.accessor) {
        ancestors.delete(value);
        return undefined;
      }
      const cloned = cloneJsonValue(field.value, ancestors);
      if (cloned === undefined) {
        ancestors.delete(value);
        return undefined;
      }
      entries.push([key, cloned]);
    }
    const record: Record<string, JsonValue> = {};
    for (const [key, child] of entries) {
      Object.defineProperty(record, key, { value: child, enumerable: true, writable: true, configurable: true });
    }
    copy = record;
  }
  ancestors.delete(value);
  return copy;
}

function jsonObject(value: unknown): Record<string, JsonValue> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const cloned = cloneJsonValue(value, new Set());
  return cloned !== undefined && !Array.isArray(cloned) && typeof cloned === "object" && cloned !== null
    ? cloned as Record<string, JsonValue>
    : null;
}

function parseProbabilities(value: unknown, labels: ReadonlySet<string>): Record<string, number> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const result: Record<string, number> = {};
  for (const key of Object.keys(record)) {
    if (!labels.has(key)) return null;
    const field = readOwn(record, key);
    if (!field.present || field.accessor || !finiteProbability(field.value)) return null;
    Object.defineProperty(result, key, { value: field.value, enumerable: true, writable: true, configurable: true });
  }
  return result;
}

function parseChoice(question: ResolvedQuestion, groupId: string, raw: BoundedRaw | null, value: Record<string, unknown>): QuestionEvidence {
  const choiceField = readOwn(value, "choice");
  const criteria = question.criteria;
  if (!choiceField.present || choiceField.accessor || typeof choiceField.value !== "string" || criteria === null || Array.isArray(criteria) || typeof criteria !== "object") {
    return invalid(question, groupId, raw, "choice_invalid");
  }
  const labels = Object.keys(criteria);
  const normalized = new Set(labels.map((label) => label.trim().toLowerCase()));
  if (!normalized.has(choiceField.value.trim().toLowerCase())) return invalid(question, groupId, raw, "choice_invalid");

  const confidence = finiteConfidence(value);
  if (!confidence.ok) return invalid(question, groupId, raw, "confidence_invalid");
  const probabilitiesField = readOwn(value, "probabilities");
  let probabilities: Record<string, number> | undefined;
  if (probabilitiesField.present) {
    if (probabilitiesField.accessor) return invalid(question, groupId, raw, "probabilities_invalid");
    const parsed = parseProbabilities(probabilitiesField.value, new Set(labels));
    if (!parsed) return invalid(question, groupId, raw, "probabilities_invalid");
    probabilities = parsed;
  }

  const answer: ProviderAnswer = {
    type: "choice",
    choice: choiceField.value,
    ...(confidence.present ? { confidence: confidence.value } : {}),
    ...(probabilities ? { probabilities } : {}),
  };
  return { key: question.key, declaredType: question.type, groupId, role: question.role, status: "answered", raw, answer };
}

function parseScore(question: ResolvedQuestion, groupId: string, raw: BoundedRaw | null, value: Record<string, unknown>): QuestionEvidence {
  const scoreField = readOwn(value, "score");
  const criteria = question.criteria;
  if (!scoreField.present || scoreField.accessor || typeof scoreField.value !== "number" || !Number.isFinite(scoreField.value) || !Array.isArray(criteria) || scoreField.value < 0 || scoreField.value > criteria.length - 1) {
    return invalid(question, groupId, raw, "score_invalid");
  }

  const confidence = finiteConfidence(value);
  if (!confidence.ok) return invalid(question, groupId, raw, "confidence_invalid");
  const legendField = readOwn(value, "legend");
  let legend: Record<string, JsonValue> | undefined;
  if (legendField.present) {
    if (legendField.accessor) return invalid(question, groupId, raw, "legend_invalid");
    const parsed = jsonObject(legendField.value);
    if (!parsed) return invalid(question, groupId, raw, "legend_invalid");
    legend = parsed;
  }

  const probabilitiesField = readOwn(value, "probabilities");
  let probabilities: Record<string, number> | undefined;
  if (probabilitiesField.present) {
    const labels = new Set(criteria.map((_, index) => String(index)));
    if (probabilitiesField.accessor) return invalid(question, groupId, raw, "probabilities_invalid");
    const parsed = parseProbabilities(probabilitiesField.value, labels);
    if (!parsed) return invalid(question, groupId, raw, "probabilities_invalid");
    probabilities = parsed;
  }

  const answer: ProviderAnswer = {
    type: "score",
    score: scoreField.value,
    ...(confidence.present ? { confidence: confidence.value } : {}),
    ...(legend ? { legend } : {}),
    ...(probabilities ? { probabilities } : {}),
  };
  return { key: question.key, declaredType: question.type, groupId, role: question.role, status: "answered", raw, answer };
}

function parseTypedAnswer(question: ResolvedQuestion, groupId: string, raw: BoundedRaw | null, value: Record<string, unknown>): QuestionEvidence {
  const type = readOwn(value, "type");
  if (type.accessor || (type.present && type.value !== question.type)) return invalid(question, groupId, raw, "type_mismatch");
  if (question.type === "choice") return parseChoice(question, groupId, raw, value);
  if (question.type === "score") return parseScore(question, groupId, raw, value);

  const fieldName = question.type === "boolean" ? "probability" : "noul";
  const field = readOwn(value, fieldName);
  if (!field.present || field.accessor || !finiteProbability(field.value)) {
    return invalid(question, groupId, raw, question.type === "boolean" ? "probability_invalid" : "noul_invalid");
  }
  const answer: ProviderAnswer = question.type === "boolean"
    ? { type: "boolean", probability: field.value }
    : { type: "noul", noul: field.value };
  return { key: question.key, declaredType: question.type, groupId, role: question.role, status: "answered", raw, answer };
}

function missingEvidence(question: ResolvedQuestion, groupId: string): QuestionEvidence {
  return { key: question.key, declaredType: question.type, groupId, role: question.role, status: "missing", raw: null };
}

export function parseGroupAnswers(snapshot: GroupSnapshot, rawAnswers: unknown): {
  readonly status: "complete" | "invalid";
  readonly answers: readonly QuestionEvidence[];
  readonly unexpected: readonly UnexpectedAnswer[];
} {
  const answersRecord = rawAnswers !== null && typeof rawAnswers === "object" && !Array.isArray(rawAnswers)
    ? rawAnswers as Record<string, unknown>
    : null;
  if (!answersRecord) {
    const answers = snapshot.questions.map((question) => missingEvidence(question, snapshot.groupId));
    return { status: answers.every((answer) => answer.status === "answered") ? "complete" : "invalid", answers, unexpected: [] };
  }

  let answerKeys: string[];
  try {
    answerKeys = Object.keys(answersRecord);
  } catch {
    const answers = snapshot.questions.map((question) => missingEvidence(question, snapshot.groupId));
    return { status: "invalid", answers, unexpected: [] };
  }
  const expected = new Set(snapshot.questions.map((question) => question.key));
  const unexpected: UnexpectedAnswer[] = answerKeys
    .filter((key) => !expected.has(key))
    .map((key) => ({ key, raw: boundedRaw(readOwn(answersRecord, key).value) }));

  const answers = snapshot.questions.map((question) => {
    let field: OwnField;
    try {
      field = readOwn(answersRecord, question.key);
    } catch {
      return missingEvidence(question, snapshot.groupId);
    }
    if (!field.present) return missingEvidence(question, snapshot.groupId);
    const raw = boundedRaw(field.value);
    if (field.accessor || field.value === null || typeof field.value !== "object" || Array.isArray(field.value)) {
      return invalid(question, snapshot.groupId, raw, "answer_invalid");
    }
    try {
      return parseTypedAnswer(question, snapshot.groupId, raw, field.value as Record<string, unknown>);
    } catch {
      return invalid(question, snapshot.groupId, raw, "answer_invalid");
    }
  });
  return {
    status: answers.every((answer) => answer.status === "answered") ? "complete" : "invalid",
    answers,
    unexpected,
  };
}

export function unansweredEvidence(snapshot: GroupSnapshot, status: "failed" | "incomplete", error: string): readonly QuestionEvidence[] {
  return snapshot.questions.map((question) => ({
    key: question.key,
    declaredType: question.type,
    groupId: snapshot.groupId,
    role: question.role,
    status,
    raw: null,
    error,
  }));
}
