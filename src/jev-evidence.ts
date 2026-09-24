import type { JevProvider } from "./config";

export const PROGRAM_RECORD_TYPE = "jev-program-v1";
export type ProgramRecordType = typeof PROGRAM_RECORD_TYPE;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type QuestionType = "choice" | "score" | "boolean" | "noul";
export type QuestionRole = "required" | "observational";
export type EvaluationProvider = JevProvider | "local";

export interface ProviderTarget {
  readonly provider: JevProvider;
  readonly modelId: string;
}

export type QuestionInstructions = string | { readonly [key: string]: string };
export type ChoiceCriteria = { readonly [label: string]: string | null };
export type ScoreCriteria = readonly (string | null)[];
export type BooleanCriteria = { readonly true?: string | null; readonly false?: string | null };
export type QuestionCriteria = ChoiceCriteria | ScoreCriteria | BooleanCriteria;

export interface ResolverRef {
  readonly id: string;
  readonly version: number;
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

export interface ProjectionDefinition {
  readonly version: string;
  readonly keys: readonly string[];
}

export interface ProgramDefinition {
  readonly schema: string;
  readonly catalogVersion: string;
  readonly questions: readonly ProgramQuestion[];
  readonly groups: readonly EvaluationGroupDefinition[];
  readonly projection: ProjectionDefinition;
}

export interface ActiveProgram {
  readonly revision: string;
  readonly definition: ProgramDefinition;
  readonly requiredGroupId: string;
}

export type FeatureValueType = "string" | "number" | "object" | "array";
export type FeatureFreshness = "tick" | "unknown";

export interface FeatureMetadata {
  readonly id: string;
  readonly type: FeatureValueType;
  readonly meaning: string;
  readonly units: string | null;
  readonly maxItems: number | null;
  readonly availability: "always" | "nullable";
  readonly freshness: FeatureFreshness;
}

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

export type ProviderAnswer =
  | {
    readonly type: "choice";
    readonly choice: string;
    readonly confidence?: number;
    readonly probabilities?: { readonly [label: string]: number };
  }
  | {
    readonly type: "score";
    readonly score: number;
    readonly confidence?: number;
    readonly legend?: { readonly [score: string]: JsonValue };
    readonly probabilities?: { readonly [score: string]: number };
  }
  | { readonly type: "boolean"; readonly probability: number }
  | { readonly type: "noul"; readonly noul: number };

export interface BoundedRaw {
  readonly json: string;
  readonly bytes: number;
  readonly truncated: boolean;
}

export type AnswerStatus = "answered" | "missing" | "invalid" | "failed" | "incomplete";

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

export interface UnexpectedAnswer {
  readonly key: string;
  readonly raw: BoundedRaw | null;
}

export interface ProviderUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export interface ProviderMeta {
  readonly name: EvaluationProvider;
  readonly model?: string;
  readonly usage?: ProviderUsage;
}

export interface GroupTiming {
  readonly startedAt: number;
  readonly completedAt: number;
  readonly latencyMs: number;
}

export type GroupFailureCode = "timeout" | "provider_error" | "invalid_response";

export interface GroupFailure {
  readonly code: GroupFailureCode;
  readonly message: string;
  readonly status?: number;
}

export type GroupStatus = "complete" | "invalid" | "failed" | "timeout";

export interface GroupResult {
  readonly groupId: string;
  readonly status: GroupStatus;
  readonly answers: readonly QuestionEvidence[];
  readonly unexpected: readonly UnexpectedAnswer[];
  readonly provider: ProviderMeta;
  readonly timing: GroupTiming;
  readonly failure?: GroupFailure;
}

export type EvaluationStatus = "complete" | "invalid" | "failed";

export interface EvaluationEvidence {
  readonly recordType: ProgramRecordType;
  readonly capture: ProgramCapture;
  readonly required: GroupResult;
  readonly status: EvaluationStatus;
}

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
