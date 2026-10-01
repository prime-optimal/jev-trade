import { expect, test } from "bun:test";
import { programProvider } from "../web/src/app/model/configure/editor";

test("program question types match the active model runtime", () => {
  expect(programProvider("mock", "openrouter")).toBe("local");
  expect(programProvider("jev", "openrouter")).toBe("openrouter");
  expect(programProvider("jev", undefined)).toBe("unknown");
  expect(programProvider(undefined, "openrouter")).toBe("unknown");
});
