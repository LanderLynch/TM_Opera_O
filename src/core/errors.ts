export class AgentError extends Error {
  public readonly code: string;
  public readonly recoverable: boolean;

  constructor(message: string, code = "AGENT_ERROR", recoverable = false) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.recoverable = recoverable;
  }
}

export class ToolValidationError extends AgentError {
  public readonly toolName: string;

  constructor(toolName: string, message: string) {
    super(`Invalid arguments for tool "${toolName}": ${message}`, "TOOL_VALIDATION_ERROR", true);
    this.name = "ToolValidationError";
    this.toolName = toolName;
  }
}

export class PermissionDeniedError extends AgentError {
  public readonly toolName: string;

  constructor(toolName: string, reason: string) {
    super(`Permission denied for "${toolName}": ${reason}`, "PERMISSION_DENIED", false);
    this.name = "PermissionDeniedError";
    this.toolName = toolName;
  }
}

export class ExecutionCancelledError extends AgentError {
  constructor(message = "Task execution was cancelled by user or emergency stop.") {
    super(message, "EXECUTION_CANCELLED", false);
    this.name = "ExecutionCancelledError";
  }
}

export class ToolTimeoutError extends AgentError {
  constructor(toolName: string, timeoutMs: number) {
    super(`Tool "${toolName}" timed out after ${timeoutMs}ms.`, "TOOL_TIMEOUT", true);
    this.name = "ToolTimeoutError";
  }
}
