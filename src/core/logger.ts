export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  scope: string;
  message: string;
  data?: Record<string, unknown>;
}

const SENSITIVE_KEY_PATTERN = /(api[_-]?key|token|secret|password|authorization|cookie)/i;

function sanitizeData(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (SENSITIVE_KEY_PATTERN.test(k)) {
      out[k] = "[REDACTED]";
    } else if (typeof v === "string" && v.length > 500) {
      out[k] = `${v.slice(0, 500)}...[truncated]`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

class AgentLogger {
  private entries: LogEntry[] = [];
  private readonly maxEntries = 300;

  public log(level: LogLevel, scope: string, message: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      scope,
      message,
      data: sanitizeData(data),
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }

  public debug(scope: string, message: string, data?: Record<string, unknown>): void {
    this.log("debug", scope, message, data);
  }

  public info(scope: string, message: string, data?: Record<string, unknown>): void {
    this.log("info", scope, message, data);
  }

  public warn(scope: string, message: string, data?: Record<string, unknown>): void {
    this.log("warn", scope, message, data);
  }

  public error(scope: string, message: string, data?: Record<string, unknown>): void {
    this.log("error", scope, message, data);
  }

  public getRecent(limit = 50): LogEntry[] {
    return this.entries.slice(-limit);
  }

  public clear(): void {
    this.entries = [];
  }
}

export const logger = new AgentLogger();
