import { expect, test } from "bun:test";
import { assertJevCredentials, resolveJevModelId, resolveJevProvider } from "../src/config";

test("explicit JEV_PROVIDER wins over whichever key is set", () => {
  expect(resolveJevProvider({ JEV_PROVIDER: "openrouter", TYPESAFE_API_KEY: "x" })).toBe("openrouter");
  expect(resolveJevProvider({ JEV_PROVIDER: "gateway", OPENROUTER_API_KEY: "x" })).toBe("gateway");
  expect(resolveJevProvider({ JEV_PROVIDER: "typesafe", OPENROUTER_API_KEY: "x", AI_GATEWAY_API_KEY: "y" })).toBe("typesafe");
});

test("unset provider prefers OpenRouter, then TypeSafe, then Gateway", () => {
  expect(resolveJevProvider({ OPENROUTER_API_KEY: "x", TYPESAFE_API_KEY: "y", AI_GATEWAY_API_KEY: "z" })).toBe("openrouter");
  expect(resolveJevProvider({ TYPESAFE_API_KEY: "y", AI_GATEWAY_API_KEY: "z" })).toBe("typesafe");
  expect(resolveJevProvider({ AI_GATEWAY_API_KEY: "z" })).toBe("gateway");
  expect(resolveJevProvider({})).toBe("openrouter");
});

test("invalid JEV_PROVIDER throws", () => {
  expect(() => resolveJevProvider({ JEV_PROVIDER: "openai" })).toThrow("openrouter, typesafe, or gateway");
});

test("model id defaults follow the provider", () => {
  expect(resolveJevModelId({}, "openrouter")).toBe("jev-latest");
  expect(resolveJevModelId({}, "typesafe")).toBe("jev-latest");
  expect(resolveJevModelId({}, "gateway")).toBe("typesafe-ai/jev");
  expect(resolveJevModelId({ JEV_MODEL_ID: "jev-1.13.0" }, "gateway")).toBe("jev-1.13.0");
  expect(resolveJevModelId({ JEV_MODEL_ID: "  " }, "typesafe")).toBe("jev-latest");
});

test("jev refuses to start without the key for the chosen provider", () => {
  expect(() => assertJevCredentials("jev", "openrouter", {})).toThrow("OPENROUTER_API_KEY");
  expect(() => assertJevCredentials("jev", "typesafe", {})).toThrow("TYPESAFE_API_KEY");
  expect(() => assertJevCredentials("jev", "gateway", {})).toThrow("AI_GATEWAY_API_KEY");
  expect(() => assertJevCredentials("mock", "openrouter", {})).not.toThrow();
  expect(() => assertJevCredentials("jev", "openrouter", { OPENROUTER_API_KEY: "x" })).not.toThrow();
  expect(() => assertJevCredentials("jev", "typesafe", { TYPESAFE_API_KEY: "x" })).not.toThrow();
  expect(() => assertJevCredentials("jev", "gateway", { AI_GATEWAY_API_KEY: "x" })).not.toThrow();
});
