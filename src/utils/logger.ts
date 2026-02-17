import { DEV } from "../config";

type Level = "debug" | "info" | "warn" | "error";

const levelPriority: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const minLevel: Level = DEV ? "debug" : "info";

function ts() {
  return new Date().toISOString();
}

function shouldLog(level: Level) {
  return levelPriority[level] >= levelPriority[minLevel];
}

function format(level: Level, scope: string, message: string) {
  return `[${ts()}] ${level.toUpperCase()} ${scope} ${message}`;
}

function write(level: Level, scope: string, message: string, meta?: unknown) {
  if (!shouldLog(level)) return;
  const line = format(level, scope, message);
  const handler =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : level === "debug"
          ? console.debug
          : console.log;

  if (meta !== undefined) {
    handler(line, meta);
    return;
  }
  handler(line);
}

export const logger = {
  isLevelEnabled: (level: Level) => shouldLog(level),
  debug: (scope: string, message: string, meta?: unknown) =>
    write("debug", scope, message, meta),
  info: (scope: string, message: string, meta?: unknown) =>
    write("info", scope, message, meta),
  warn: (scope: string, message: string, meta?: unknown) =>
    write("warn", scope, message, meta),
  error: (scope: string, message: string, meta?: unknown) =>
    write("error", scope, message, meta),
};
