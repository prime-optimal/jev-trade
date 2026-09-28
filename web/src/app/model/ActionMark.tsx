import type { Action } from "./record";

const PATHS: Record<Action, string> = {
  buy: "M6 1.5 11 10.5H1Z",
  sell: "M6 10.5 1 1.5h10Z",
  hold: "M2 4h8v4H2Z",
  "no decision": "M2.5 2.5l7 7m0-7-7 7",
  unavailable: "M2.5 2.5l7 7m0-7-7 7",
};

export default function ActionMark({ action, size = 12 }: { action: Action; size?: number }) {
  const stroked = action === "no decision" || action === "unavailable";
  return <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
    <path d={PATHS[action]} fill={stroked ? "none" : "currentColor"} stroke={stroked ? "currentColor" : "none"} strokeWidth={stroked ? 2 : 0} />
  </svg>;
}
