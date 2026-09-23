import { expect, test } from "bun:test";
import { createElement } from "../web/node_modules/react";
import { renderToString } from "../web/node_modules/react-dom/server";
import { SettingsProvider, useSettings } from "../web/src/lib/trading/SettingsProvider";

function ScopeProbe() {
  const { ready, scope, sessionState } = useSettings();
  return createElement("span", null, `${scope}:${sessionState}:${ready}`);
}

function renderProvider(): string {
  return renderToString(createElement(SettingsProvider, null, createElement(ScopeProbe)));
}

test("settings provider renders the same initial scope on the server and localhost client", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Reflect.deleteProperty(globalThis, "window");
  const serverMarkup = renderProvider();

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { hostname: "localhost", protocol: "http:" } },
  });

  try {
    expect(renderProvider()).toBe(serverMarkup);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
