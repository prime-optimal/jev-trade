"use client";

import { useEffect } from "react";
import { useSettings } from "./trading/SettingsProvider";

interface DebugLogRecord {
  seq?: number;
  ts?: number;
  level?: string;
  line?: string;
}

export function useDebugLogs(): void {
  const { scope, sessionState, debug } = useSettings();
  const active = debug && scope === "visitor" && sessionState === "ready";

  useEffect(() => {
    if (!active) return;
    const source = new EventSource("/api/session/logs");
    source.onmessage = (event) => {
      let record: DebugLogRecord;
      try {
        record = JSON.parse(event.data) as DebugLogRecord;
      } catch {
        return;
      }
      if (typeof record?.line !== "string") return;
      const line = `[jev] ${record.line}`;
      if (record.level === "error") console.error(line);
      else if (record.level === "warn") console.warn(line);
      else console.log(line);
    };
    return () => source.close();
  }, [active]);
}
