/** Structured JSON logger. Values under secret-looking keys are always redacted. */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET_KEY_PATTERN = /(private_?key|secret|token|password|authorization|api_?key)/i;
const REDACTED = "[redacted]";

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export type LogSink = (line: string) => void;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") {
    return typeof value === "bigint" ? value.toString() : value;
  }
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY_PATTERN.test(k) ? REDACTED : redact(v, depth + 1);
  }
  return out;
}

export function createLogger(opts: { level?: LogLevel; sink?: LogSink; base?: LogFields } = {}): Logger {
  const min = LEVEL_ORDER[opts.level ?? "info"];
  const sink = opts.sink ?? ((line: string) => process.stdout.write(line + "\n"));
  const base = opts.base ?? {};
  const emit = (level: LogLevel, msg: string, fields?: LogFields): void => {
    if (LEVEL_ORDER[level] < min) return;
    const record = redact({ ts: new Date().toISOString(), level, msg, ...base, ...fields });
    sink(JSON.stringify(record));
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (fields) => createLogger({ ...opts, base: { ...base, ...fields } }),
  };
}

export const silentLogger: Logger = createLogger({ sink: () => {} });

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const short = (err as { shortMessage?: unknown }).shortMessage;
    return typeof short === "string" ? short : err.message;
  }
  return String(err);
}
