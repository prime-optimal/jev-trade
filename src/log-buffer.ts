export type LogLevel = "log" | "warn" | "error";

export interface LogRecord {
  seq: number;
  ts: number;
  level: LogLevel;
  line: string;
}

export interface LogBuffer {
  readonly capacity: number;
  latestSeq(): number;
  append(level: LogLevel, line: string): LogRecord;
  replay(afterSeq: number): LogRecord[];
  subscribe(listener: (record: LogRecord) => void): () => void;
}

/** Bounded ring of recent console lines with live subscribers. */
export function createLogBuffer(capacity = 500, now: () => number = Date.now): LogBuffer {
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Log buffer capacity must be a positive integer");
  const records = new Array<LogRecord>(capacity);
  const listeners = new Set<(record: LogRecord) => void>();
  let seq = 0;
  let size = 0;
  let nextIndex = 0;
  return {
    capacity,
    latestSeq: () => seq,
    append(level, line) {
      seq += 1;
      const record: LogRecord = { seq, ts: now(), level, line: line.replace(/[\r\n]+/g, " ") };
      records[nextIndex] = record;
      nextIndex = (nextIndex + 1) % capacity;
      size = Math.min(size + 1, capacity);
      for (const listener of listeners) {
        try { listener(record); } catch { /* subscriber failure must not break logging */ }
      }
      return record;
    },
    replay(afterSeq) {
      const oldestIndex = (nextIndex - size + capacity) % capacity;
      const replay: LogRecord[] = [];
      for (let offset = 0; offset < size; offset++) {
        const record = records[(oldestIndex + offset) % capacity]!;
        if (record.seq > afterSeq) replay.push(record);
      }
      return replay;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

function formatArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`;
  try {
    const json = JSON.stringify(arg);
    if (json !== undefined) return json;
  } catch { /* circular or unserializable: fall through */ }
  return String(arg);
}

/** Mirror console.log/warn/error into the buffer while keeping stdout unchanged. Returns a restore function. */
export function captureConsoleLogs(buffer: LogBuffer, sanitize?: (line: string) => string): () => void {
  const originals = { log: console.log, warn: console.warn, error: console.error };
  for (const level of ["log", "warn", "error"] as const) {
    console[level] = (...args: unknown[]) => {
      const line = args.map(formatArg).join(" ");
      buffer.append(level, sanitize ? sanitize(line) : line);
      Reflect.apply(originals[level], console, args);
    };
  }
  return () => {
    console.log = originals.log;
    console.warn = originals.warn;
    console.error = originals.error;
  };
}

