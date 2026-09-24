import { createGateway } from "@ai-sdk/gateway";
import { experimental_evaluate as evaluate } from "ai";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { config, OPENROUTER_BASE_URL, runtimeEnv, type JevProvider } from "./config";
import { parseGroupAnswers, unansweredEvidence } from "./jev-answers";
import type {
  EvaluationProvider,
  GroupFailureCode,
  GroupResult,
  GroupSnapshot,
  ProviderMeta,
  ProviderTarget,
  ProviderUsage,
} from "./jev-evidence";

export const JEV_DEADLINE_MS = 4000;

interface ProviderResponse {
  readonly answers: unknown;
  readonly model?: unknown;
  readonly usage?: unknown;
}
type ProviderCallOutcome =
  | { readonly kind: "response"; readonly response: ProviderResponse }
  | { readonly kind: "error"; readonly error: unknown }
  | { readonly kind: "timeout" };

let typesafe: TypeSafeClient | undefined;
let openrouter: TypeSafeClient | undefined;
const gateway = createGateway({ apiKey: runtimeEnv.AI_GATEWAY_API_KEY });

function sdkClient(provider: Exclude<JevProvider, "gateway">): TypeSafeClient {
  if (provider === "openrouter") {
    return (openrouter ??= new TypeSafeClient({
      apiKey: runtimeEnv.OPENROUTER_API_KEY,
      baseURL: OPENROUTER_BASE_URL,
      defaultModel: config.jevModelId,
      retry: { maxRetries: 0 },
    }));
  }
  return (typesafe ??= new TypeSafeClient({
    apiKey: runtimeEnv.TYPESAFE_API_KEY,
    defaultModel: config.jevModelId,
    retry: { maxRetries: 0 },
  }));
}

async function requestGroup(snapshot: GroupSnapshot, target: ProviderTarget, signal: AbortSignal): Promise<ProviderResponse> {
  const questions = Object.fromEntries(snapshot.questions.map((question) => [question.key, {
    type: question.type,
    instructions: question.instructions,
    ...(question.criteria === null ? {} : { criteria: question.criteria }),
  }]));
  if (target.provider === "gateway") {
    const response = await evaluate({
      model: gateway.evaluationModel(target.modelId),
      state: snapshot.state as never,
      questions: questions as never,
      maxRetries: 0,
      abortSignal: signal,
    });
    return { answers: response.answers, model: response.response?.modelId, usage: response.usage };
  }
  const response = await sdkClient(target.provider).systemOne({
    model: target.modelId,
    state: snapshot.state as never,
    questions: questions as never,
  }, { retry: { maxRetries: 0 }, signal });
  return { answers: response.answers, model: response.model, usage: response.usage };
}

function optionalNumber(record: Record<string, unknown> | null, key: string): number | undefined {
  if (!record) return undefined;
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function providerMeta(provider: EvaluationProvider, model: unknown, rawUsage: unknown, gatewayProvider: boolean): ProviderMeta {
  const modelValue = typeof model === "string" ? model : undefined;
  const usageRecord = rawUsage !== null && typeof rawUsage === "object"
    ? rawUsage as Record<string, unknown>
    : null;
  const inputTokens = optionalNumber(usageRecord, gatewayProvider ? "inputTokens" : "input_tokens");
  const outputTokens = optionalNumber(usageRecord, gatewayProvider ? "outputTokens" : "output_tokens");
  const totalTokens = gatewayProvider ? optionalNumber(usageRecord, "totalTokens") : undefined;
  const usage: ProviderUsage = {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
  };
  return {
    name: provider,
    ...(modelValue === undefined ? {} : { model: modelValue }),
    ...(Object.keys(usage).length === 0 ? {} : { usage }),
  };
}

function failureStatus(error: unknown): number | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  try {
    for (const key of ["statusCode", "status"]) {
      const value = record[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function timing(startedAt: number, startedPerf: number) {
  return {
    startedAt,
    completedAt: Date.now(),
    latencyMs: performance.now() - startedPerf,
  };
}

export function failedGroupResult(
  snapshot: GroupSnapshot,
  provider: EvaluationProvider,
  code: GroupFailureCode,
  startedAt: number,
  startedPerf: number,
): GroupResult {
  const message = code === "timeout"
    ? `jev timeout ${JEV_DEADLINE_MS}ms`
    : code === "provider_error"
      ? "provider request failed"
      : "provider response invalid";
  return {
    groupId: snapshot.groupId,
    status: code === "timeout" ? "timeout" : "failed",
    answers: unansweredEvidence(snapshot, code === "timeout" ? "incomplete" : "failed", message),
    unexpected: [],
    provider: { name: provider },
    timing: timing(startedAt, startedPerf),
    failure: { code, message },
  };
}

export async function callProviderGroup(snapshot: GroupSnapshot, target: ProviderTarget): Promise<GroupResult> {
  const startedAt = Date.now();
  const startedPerf = performance.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;

  try {
    const completion = Promise.withResolvers<ProviderCallOutcome>();
    timer = setTimeout(() => {
      try {
        controller.abort();
      } finally {
        completion.resolve({ kind: "timeout" });
      }
    }, JEV_DEADLINE_MS);
    Promise.resolve()
      .then(() => requestGroup(snapshot, target, controller.signal))
      .then(
        (response) => {
          clearTimeout(timer);
          completion.resolve({ kind: "response", response });
        },
        (error: unknown) => {
          clearTimeout(timer);
          completion.resolve({ kind: "error", error });
        },
      );
    const result = await completion.promise;

    if (result.kind === "timeout") {
      return failedGroupResult(snapshot, target.provider, "timeout", startedAt, startedPerf);
    }
    if (result.kind === "error") {
      const failed = failedGroupResult(snapshot, target.provider, "provider_error", startedAt, startedPerf);
      const status = failureStatus(result.error);
      return status === undefined || !failed.failure
        ? failed
        : { ...failed, failure: { ...failed.failure, status } };
    }

    const parsed = parseGroupAnswers(snapshot, result.response.answers);
    return {
      groupId: snapshot.groupId,
      status: parsed.status,
      answers: parsed.answers,
      unexpected: parsed.unexpected,
      provider: providerMeta(target.provider, result.response.model, result.response.usage, target.provider === "gateway"),
      timing: timing(startedAt, startedPerf),
    };
  } catch {
    return failedGroupResult(snapshot, target.provider, "provider_error", startedAt, startedPerf);
  }
}
