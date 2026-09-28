import { describe, expect, test } from "bun:test";
import { parseModelUrl, serializeModelUrl } from "../web/src/lib/model-url";

describe("model URL state", () => {
  test("parses the linked decision and a supported horizon", () => {
    expect(parseModelUrl("?d=decision-42&h=20")).toEqual({ decisionId: "decision-42", horizon: 20 });
  });

  test("accepts each supported horizon", () => {
    for (const horizon of [1, 5, 20, 100] as const) {
      expect(parseModelUrl(`?h=${horizon}`).horizon).toBe(horizon);
    }
  });

  test("defaults absent or invalid horizons to five ticks", () => {
    for (const search of ["", "?d=decision-42", "?h=7", "?h=abc", "?h=3.5", "?h=0x14", "?h=2e1", "?h=%2020", "?h="]) {
      expect(parseModelUrl(search).horizon).toBe(5);
    }
  });

  test("treats empty decision identifiers as unselected", () => {
    expect(parseModelUrl("?d=")).toEqual({ decisionId: null, horizon: 5 });
    expect(parseModelUrl("?d=%20%20").decisionId).toBeNull();
  });

  test("serializes encoded ids and restores the same URL state", () => {
    const state = { decisionId: "decision / 42", horizon: 100 as const };
    const serialized = serializeModelUrl(state);
    expect(serialized).toBe("?d=decision+%2F+42&h=100");
    expect(parseModelUrl(serialized)).toEqual(state);
  });
});
