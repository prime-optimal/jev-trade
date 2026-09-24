import { describe, expect, test } from "bun:test";
import { boundedRaw, parseGroupAnswers, RAW_LIMIT_BYTES, unansweredEvidence } from "../src/jev-answers";
import type { GroupSnapshot, QuestionType, ResolvedQuestion } from "../src/jev-evidence";

function question(key: string, type: QuestionType, criteria: ResolvedQuestion["criteria"], role: ResolvedQuestion["role"] = "observational"): ResolvedQuestion {
  return { key, type, role, instructions: `Answer ${key}`, criteria, resolver: null };
}

function snapshot(...questions: ResolvedQuestion[]): GroupSnapshot {
  return {
    groupId: "trade",
    capturedAt: 100,
    catalogVersion: "test-catalog",
    state: {},
    features: [],
    questions,
  };
}

const bias = question("bias", "choice", { long: null, short: null }, "required");
const scoreQuestion = question("quality", "score", ["low", "middle", "high"]);

describe("Jev answer evidence", () => {
  test("keeps choice confidence missing and preserves provider probabilities", () => {
    const parsed = parseGroupAnswers(snapshot(bias), {
      bias: { type: "choice", choice: "long", probabilities: { long: 0.3333333, short: 0.6666667 } },
    });
    expect(parsed.status).toBe("complete");
    expect(parsed.answers[0]?.answer).toEqual({
      type: "choice",
      choice: "long",
      probabilities: { long: 0.3333333, short: 0.6666667 },
    });
    expect(parsed.answers[0]?.answer && "confidence" in parsed.answers[0].answer).toBe(false);

    const withConfidence = parseGroupAnswers(snapshot(bias), {
      bias: { type: "choice", choice: "long", confidence: 0.81 },
    });
    expect(withConfidence.answers[0]?.answer).toEqual({ type: "choice", choice: "long", confidence: 0.81 });
  });

  for (const [name, probabilities] of [
    ["negative probability", { long: -0.01, short: 1.01 }],
    ["probability above one", { long: 1.01, short: 0 }],
    ["undeclared probability label", { long: 0.5, other: 0.5 }],
    ["non-number probability", { long: "0.5", short: 0.5 }],
  ] as const) {
    test(`marks ${name} invalid and retains its raw JSON`, () => {
      const answer = { type: "choice", choice: "long", probabilities };
      const parsed = parseGroupAnswers(snapshot(bias), { bias: answer });
      expect(parsed.status).toBe("invalid");
      expect(parsed.answers[0]?.status).toBe("invalid");
      expect(parsed.answers[0]?.raw?.json).toBe(JSON.stringify(answer));
      expect("answer" in (parsed.answers[0] ?? {})).toBe(false);
    });
  }

  test("rejects an answer type that differs from its question", () => {
    const parsed = parseGroupAnswers(snapshot(bias), { bias: { type: "score", score: 1 } });
    expect(parsed.status).toBe("invalid");
    expect(parsed.answers[0]?.error).toBe("type_mismatch");
  });

  test("keeps boolean probability separate from confidence", () => {
    const parsed = parseGroupAnswers(snapshot(question("ready", "boolean", { true: "yes", false: "no" })), {
      ready: { type: "boolean", probability: 0.73 },
    });
    expect(parsed.answers[0]?.answer).toEqual({ type: "boolean", probability: 0.73 });
    expect(parsed.answers[0]?.answer && "confidence" in parsed.answers[0].answer).toBe(false);
  });

  test("keeps the noul value under its declared field", () => {
    const parsed = parseGroupAnswers(snapshot(question("urgent", "noul", null)), {
      urgent: { type: "noul", noul: 0.42 },
    });
    expect(parsed.answers[0]?.answer).toEqual({ type: "noul", noul: 0.42 });
  });

  test("keeps score legend and probabilities and rejects out-of-range scores", () => {
    const valid = parseGroupAnswers(snapshot(scoreQuestion), {
      quality: { type: "score", score: 1.5, legend: { "0": "low", "1": "middle", "2": "high" }, probabilities: { "0": 0.1, "1": 0.5, "2": 0.4 } },
    });
    expect(valid.status).toBe("complete");
    expect(valid.answers[0]?.answer).toEqual({
      type: "score",
      score: 1.5,
      legend: { "0": "low", "1": "middle", "2": "high" },
      probabilities: { "0": 0.1, "1": 0.5, "2": 0.4 },
    });

    const invalid = parseGroupAnswers(snapshot(scoreQuestion), { quality: { type: "score", score: 3 } });
    expect(invalid.status).toBe("invalid");
    expect(invalid.answers[0]?.error).toBe("score_invalid");
  });

  test("copies only allowed answer fields and records unexpected answer keys", () => {
    const parsed = parseGroupAnswers(snapshot(bias), {
      bias: { type: "choice", choice: "long", internal: "drop this" },
      note: { token: "unexpected-value" },
    });
    expect(parsed.status).toBe("complete");
    expect(parsed.answers[0]?.answer).toEqual({ type: "choice", choice: "long" });
    expect(parsed.unexpected).toEqual([{ key: "note", raw: { json: '{"token":"unexpected-value"}', bytes: 28, truncated: false } }]);
  });

  test("marks an absent key missing and non-object answers missing for every question", () => {
    const questions = snapshot(bias, scoreQuestion);
    const absent = parseGroupAnswers(questions, {});
    expect(absent.status).toBe("invalid");
    expect(absent.answers.map((answer) => answer.status)).toEqual(["missing", "missing"]);

    const nonObject = parseGroupAnswers(questions, null);
    expect(nonObject.answers.map((answer) => answer.status)).toEqual(["missing", "missing"]);
  });

  test("bounds raw JSON by UTF-8 bytes and reports the original size", () => {
    const value = { text: "x".repeat(5000) };
    const raw = boundedRaw(value);
    expect(raw).not.toBeNull();
    expect(raw?.truncated).toBe(true);
    expect(raw?.bytes).toBe(new TextEncoder().encode(JSON.stringify(value)).length);
    expect(new TextEncoder().encode(raw?.json ?? "").length).toBeLessThanOrEqual(RAW_LIMIT_BYTES);
  });

  test("represents unserializable raw values safely", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(boundedRaw(cyclic)).toEqual({ json: '"[unserializable]"', bytes: 18, truncated: false });
    expect(boundedRaw(1n)?.json).toBe('"[unserializable]"');
    expect(boundedRaw(undefined)).toBeNull();
  });

  test("builds failed and incomplete evidence without raw provider data", () => {
    expect(unansweredEvidence(snapshot(bias), "failed", "provider request failed")).toEqual([{
      key: "bias",
      declaredType: "choice",
      groupId: "trade",
      role: "required",
      status: "failed",
      raw: null,
      error: "provider request failed",
    }]);
  });
});
