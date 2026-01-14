type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const DEFAULT_LEVEL: LogLevel = "info";

function resolveLogLevel(): LogLevel {
  const raw = (process.env["BACKEND_LOG_LEVEL"] ?? "").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return DEFAULT_LEVEL;
}

const CURRENT_LEVEL = resolveLogLevel();

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[CURRENT_LEVEL];
}

function formatPrefix(level: LogLevel): string {
  const timestamp = new Date().toISOString();
  return `[backend] ${timestamp} ${level.toUpperCase()}`;
}

function emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const prefix = formatPrefix(level);
  const payload = meta && Object.keys(meta).length > 0 ? [meta] : [];
  const handler = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  handler(prefix, message, ...payload);
}

export function logDebug(message: string, meta?: Record<string, unknown>): void {
  emit("debug", message, meta);
}

export function logInfo(message: string, meta?: Record<string, unknown>): void {
  emit("info", message, meta);
}

export function logWarn(message: string, meta?: Record<string, unknown>): void {
  emit("warn", message, meta);
}

export function logError(message: string, meta?: Record<string, unknown>): void {
  emit("error", message, meta);
}
