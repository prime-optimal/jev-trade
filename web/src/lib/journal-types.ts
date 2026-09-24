// Mirrors the bot journal contract in src/decision-store.ts and src/jev-evidence.ts. Keep in sync manually. This is not part of the byte-identical bot-types copy test.

export type QuestionType = "choice" | "score" | "boolean" | "noul";
export type QuestionRole = "required" | "observational";
export type QuestionInstructions = string | { readonly [key: string]: string };
export type ChoiceCriteria = { readonly [label: string]: string | null };
export type ScoreCriteria = readonly (string | null)[];
export type BooleanCriteria = { readonly true?: string | null; readonly false?: string | null };
export type QuestionCriteria = ChoiceCriteria | ScoreCriteria | BooleanCriteria;
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type AnswerStatus = "answered" | "missing" | "invalid" | "failed" | "incomplete";
export type GroupStatus = "complete" | "invalid" | "failed" | "timeout";
export type EvaluationStatus = "complete" | "invalid" | "failed";
export type GroupFailureCode = "timeout" | "provider_error" | "invalid_response";
export type EvaluationProvider = "openrouter" | "typesafe" | "gateway" | "local";
export type ProgramRecordType = "jev-program-v1";

export interface FeatureMetadata {
  readonly id: string;
  readonly type: "string" | "number" | "object" | "array";
  readonly meaning: string;
  readonly units: string | null;
  readonly maxItems: number | null;
  readonly availability: "always" | "nullable";
  readonly freshness: "tick" | "unknown";
}

export interface ResolverRef { readonly id: string; readonly version: number; }
export interface ResolvedQuestion {
  readonly key: string;
  readonly type: QuestionType;
  readonly role: QuestionRole;
  readonly instructions: QuestionInstructions;
  readonly criteria: QuestionCriteria | null;
  readonly resolver: ResolverRef | null;
}
export interface GroupSnapshot {
  readonly groupId: string;
  readonly capturedAt: number;
  readonly catalogVersion: string;
  readonly state: { readonly [feature: string]: JsonValue };
  readonly features: readonly FeatureMetadata[];
  readonly questions: readonly ResolvedQuestion[];
}
export interface ProgramCapture {
  readonly recordType: ProgramRecordType;
  readonly revision: string;
  readonly projectionVersion: string;
  readonly definition: ProgramDefinition;
  readonly requiredGroupId: string;
  readonly capturedAt: number;
  readonly groups: readonly GroupSnapshot[];
}
export interface ProgramDefinition {
  readonly schema: string;
  readonly catalogVersion: string;
  readonly questions: readonly ProgramQuestion[];
  readonly groups: readonly EvaluationGroupDefinition[];
  readonly projection: ProjectionDefinition;
}
export interface ProgramQuestion {
  readonly key: string;
  readonly type: QuestionType;
  readonly role?: QuestionRole;
  readonly instructions?: QuestionInstructions;
  readonly criteria?: QuestionCriteria;
  readonly resolver?: ResolverRef;
}
export interface EvaluationGroupDefinition {
  readonly id: string;
  readonly features: readonly string[];
  readonly questions: readonly string[];
}
export interface ProjectionDefinition { readonly version: string; readonly keys: readonly string[]; }
export type ProviderAnswer =
  | { readonly type: "choice"; readonly choice: string; readonly confidence?: number; readonly probabilities?: { readonly [label: string]: number } }
  | { readonly type: "score"; readonly score: number; readonly confidence?: number; readonly legend?: { readonly [score: string]: JsonValue }; readonly probabilities?: { readonly [score: string]: number } }
  | { readonly type: "boolean"; readonly probability: number }
  | { readonly type: "noul"; readonly noul: number };
export interface BoundedRaw { readonly json: string; readonly bytes: number; readonly truncated: boolean; }
export interface QuestionEvidence {
  readonly key: string;
  readonly declaredType: QuestionType;
  readonly groupId: string;
  readonly role: QuestionRole;
  readonly status: AnswerStatus;
  readonly raw: BoundedRaw | null;
  readonly answer?: ProviderAnswer;
  readonly error?: string;
}
export interface ProviderUsage { readonly inputTokens?: number; readonly outputTokens?: number; readonly totalTokens?: number; }
export interface ProviderMeta { readonly name: EvaluationProvider; readonly model?: string; readonly usage?: ProviderUsage; }
export interface GroupTiming { readonly startedAt: number; readonly completedAt: number; readonly latencyMs: number; }
export interface GroupFailure { readonly code: GroupFailureCode; readonly message: string; readonly status?: number; }
export interface GroupResult {
  readonly groupId: string;
  readonly status: GroupStatus;
  readonly answers: readonly QuestionEvidence[];
  readonly unexpected: readonly { readonly key: string; readonly raw: BoundedRaw | null }[];
  readonly provider: ProviderMeta;
  readonly timing: GroupTiming;
  readonly failure?: GroupFailure;
}
export interface EvaluationEvidence {
  readonly recordType: ProgramRecordType;
  readonly capture: ProgramCapture;
  readonly required: GroupResult;
  readonly status: EvaluationStatus;
}
export interface MarkoutEntry {
  horizonTicks: 1 | 5 | 20 | 100;
  observedBlock: number;
  observedTimestamp: number;
  observedMid: number;
  signedReturnBps: number;
  marketReturnBps: number;
}
export interface DecisionRow {
  decisionId: string;
  createdAt: number;
  updatedAt: number;
  decision: unknown;
  recordType: ProgramRecordType | "legacy";
  evidence: EvaluationEvidence | null;
  observations: { readonly [groupId: string]: GroupResult };
  programMetadata: "available" | "unavailable";
  quote: unknown | null;
  fills: unknown[];
  markouts: Record<string, unknown>;
}
export interface DecisionPage { rows: DecisionRow[]; nextBefore: string | null; }
