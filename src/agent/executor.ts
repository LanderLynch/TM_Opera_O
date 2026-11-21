import { ExecutionCancelledError, PermissionDeniedError, ToolTimeoutError, ToolValidationError } from "../core/errors";
import { logger } from "../core/logger";
import { evaluateToolPermission } from "../tools/permissions";
import { ToolRegistry } from "../tools/registry";
import { ToolResult } from "../tools/toolTypes";
import { TaskManager } from "./taskManager";

export interface ExecutedStepOutcome {
  toolResult: ToolResult;
  verified: boolean;
  verificationEvidence: string;
}

export class AgentExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly taskManager: TaskManager
  ) {}

  public async executeStep(
    taskId: string,
    stepId: string,
    toolName: string,
    rawArgs: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<ExecutedStepOutcome> {
    if (signal.aborted || this.taskManager.isEmergencyStopped()) {
      throw new ExecutionCancelledError();
    }

    const tool = this.registry.get(toolName);
    if (!tool) {
      throw new ToolValidationError(toolName, "Tool is not registered.");
    }

    // 1. Validate tool arguments before permission check or execution
    const validatedArgs = this.registry.validate(toolName, rawArgs);

    // 2. Check permission policy (autonomous vs confirm)
    const perm = evaluateToolPermission(toolName, tool.permissionLevel);
    if (!perm.allowed) {
      throw new PermissionDeniedError(toolName, perm.reason || "Blocked by policy");
    }
    if (perm.requiresApproval) {
      const approved = await this.taskManager.requestApproval(
        taskId,
        stepId,
        toolName,
        `Approve executing "${toolName}"?`,
        validatedArgs
      );
      if (!approved || signal.aborted || this.taskManager.isEmergencyStopped()) {
        throw new ExecutionCancelledError("Action rejected or cancelled during approval.");
      }
      this.taskManager.setStatus(taskId, "running");
    }

    // 3. Execute with timeout & cancellation race
    const timeoutMs = tool.timeoutMs ?? 20_000;
    logger.info("executor", `Executing tool ${toolName}`, { taskId, stepId, args: validatedArgs });

    const execPromise = tool.execute(validatedArgs, { taskId, signal });
    const timeoutPromise = new Promise<ToolResult>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new ToolTimeoutError(toolName, timeoutMs)), timeoutMs);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new ExecutionCancelledError());
        },
        { once: true }
      );
    });

    const toolResult = await Promise.race([execPromise, timeoutPromise]);

    if (signal.aborted || this.taskManager.isEmergencyStopped()) {
      throw new ExecutionCancelledError();
    }

    // 4. Verify result (never assume tool call == verified success if verify() is implemented)
    let verified = toolResult.success;
    let verificationEvidence = toolResult.evidence;

    if (tool.verify) {
      const v = await tool.verify(validatedArgs, toolResult, { taskId, signal });
      verified = v.verified;
      verificationEvidence = v.evidence;
    }

    return {
      toolResult,
      verified,
      verificationEvidence,
    };
  }
}
