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
  if (meta !== undefined) {
    if (level === "error") console.error(line, meta);
    else if (level === "warn") console.warn(line, meta);
    else console.log(line, meta);
    return;
  }
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (scope: string, message: string, meta?: unknown) =>
    write("debug", scope, message, meta),
  info: (scope: string, message: string, meta?: unknown) =>
    write("info", scope, message, meta),
  warn: (scope: string, message: string, meta?: unknown) =>
    write("warn", scope, message, meta),
  error: (scope: string, message: string, meta?: unknown) =>
    write("error", scope, message, meta),
};
