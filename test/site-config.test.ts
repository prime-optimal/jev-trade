import { expect, test } from "bun:test";
import raw from "../web/src/site.config.json";
import { validateSiteConfig } from "../web/src/lib/site-config";

test("checked-in site config is valid", () => {
  expect(validateSiteConfig(raw).name).toBe(raw.name);
});

test("rejects unsafe links and forbidden punctuation", () => {
  const base = { name: "A", slogan: "", logo: null, menu: [], icons: [] };
  expect(() => validateSiteConfig({ ...base, menu: [{ label: "x", href: "javascript:alert(1)" }] })).toThrow();
  expect(() => validateSiteConfig({ ...base, menu: [{ label: "x", href: "//evil.test" }] })).toThrow();
  expect(() => validateSiteConfig({ ...base, icons: [{ kind: "x", label: "X", href: "http://x.com" }] })).toThrow("https");
  expect(() => validateSiteConfig({ ...base, icons: [{ kind: "myspace", label: "M", href: "https://m.test" }] })).toThrow("kind");
  expect(() => validateSiteConfig({ ...base, slogan: "a — b" })).toThrow("dashes");
  expect(() => validateSiteConfig({ ...base, menu: [{ label: "a", href: "/" }, { label: "b", href: "/" }] })).toThrow("unique");
  expect(validateSiteConfig({ ...base, logo: "/logo.png", menu: [{ label: "Docs", href: "https://x.test/docs" }] }).logo).toBe("/logo.png");
});
