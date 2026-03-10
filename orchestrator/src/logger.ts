/**
 * Structured JSON logger for the TypeScript orchestration service.
 *
 * We output JSON lines to stdout so the logs can be piped directly into
 * Azure Monitor / Log Analytics without any parsing configuration.
 * Each log line is a complete, self-contained JSON object with a timestamp,
 * level, service name, and arbitrary payload.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

function log(level: LogLevel, service: string, data: object | string): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service,
    ...(typeof data === "string" ? { message: data } : data),
  };
  // JSON.stringify guarantees a single line — no accidental multi-line log entries
  // that would confuse log parsers
  console.log(JSON.stringify(entry));
}

export function get_logger(service: string) {
  return {
    debug: (data: object | string) => log("debug", service, data),
    info: (data: object | string) => log("info", service, data),
    warn: (data: object | string) => log("warn", service, data),
    error: (data: object | string) => log("error", service, data),
  };
}
