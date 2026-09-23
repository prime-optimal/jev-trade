import type { JevRequest, JevResponse } from "./bot-types";
import { addressFreeRequest } from "./trading/trader";

export function jevApiUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) return `${configured.replace(/\/+$/, "")}/decide`;
  if (typeof window === "undefined") return "http://localhost:3000/decide";
  const url = new URL(window.location.origin);
  url.port = "3000";
  url.pathname = "/decide";
  return url.href;
}
/** Only the allowlisted inference contract can leave the browser for Bun. */
export async function requestJev(input: JevRequest, signal: AbortSignal): Promise<JevResponse> {
  const response = await fetch(jevApiUrl(), {
    method: "POST", headers: { "content-type": "application/json" },
    credentials: "omit", referrerPolicy: "no-referrer", signal,
    body: JSON.stringify(addressFreeRequest(input.network, input.state)),
  });
  if (!response.ok) throw new Error(`Jev request failed: ${response.status}`);
  return await response.json() as JevResponse;
}
