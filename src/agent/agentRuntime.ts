import { AgentModelClient, ModelTier } from "../ai/toolCalling";
import { desktopExecutionLock } from "./executionLock";
import { ExecutionCancelledError } from "../core/errors";
import { eventBus } from "../core/eventBus";
import { logger } from "../core/logger";
import { MemoryStore } from "../memory/memoryStore";
import { TaskMemory } from "../memory/taskMemory";
import { AuditLog } from "../safety/auditLog";
import { ToolRegistry } from "../tools/registry";
import { AgentExecutor } from "./executor";
import { DesktopObserver } from "./observer";
import { AgentPlanner } from "./planner";
import { RecoveryManager } from "./recovery";
import { AgentTask, TaskManager } from "./taskManager";
import { ActionVerifier } from "./verifier";

export interface SkillRouteResult {
  handled: boolean;
  success?: boolean;
  summary?: string;
  plan?: string[];
}

export interface AgentRuntimeConfig {
  maxSteps?: number;
  maxRetriesPerStep?: number;
  maxDurationMs?: number;
  observeWindowFn?: () => Promise<string>;
  storageDir?: string;
  skillRouter?: (goal: string, task: AgentTask) => Promise<SkillRouteResult>;
}

export class AgentRuntime {
  public readonly taskManager: TaskManager;
  public readonly observer: DesktopObserver;
  public readonly verifier: ActionVerifier;
  public readonly recovery: RecoveryManager;
  public readonly memoryStore: MemoryStore | null;
  public readonly taskMemory: TaskMemory;
  public readonly auditLog: AuditLog;
  private readonly planner: AgentPlanner;
  private readonly executor: AgentExecutor;
  private readonly maxSteps: number;
  private readonly maxRetriesPerStep: number;
  private readonly maxDurationMs: number;
  private readonly observeWindowFn?: () => Promise<string>;
  private readonly skillRouter?: (goal: string, task: AgentTask) => Promise<SkillRouteResult>;

  constructor(
    modelClient: AgentModelClient,
    private readonly registry: ToolRegistry,
    config: AgentRuntimeConfig = {}
  ) {
    this.taskManager = new TaskManager();
    this.planner = new AgentPlanner(modelClient, registry);
    this.executor = new AgentExecutor(registry, this.taskManager);
    this.observer = new DesktopObserver(config.observeWindowFn || (async () => ""));
    this.verifier = new ActionVerifier();
    this.recovery = new RecoveryManager(this.observer);
    this.memoryStore = config.storageDir ? new MemoryStore(config.storageDir) : null;
    this.taskMemory = new TaskMemory();
    this.auditLog = new AuditLog();
    this.maxSteps = config.maxSteps ?? Number.POSITIVE_INFINITY;
    this.maxRetriesPerStep = config.maxRetriesPerStep ?? 2;
    this.maxDurationMs = config.maxDurationMs ?? Number.POSITIVE_INFINITY;
    this.observeWindowFn = config.observeWindowFn;
    this.skillRouter = config.skillRouter;
  }

  public async runObjective(goal: string, workingDirectory?: string): Promise<AgentTask> {
    const { task, signal } = this.taskManager.createTask(goal, workingDirectory);
    const lock = desktopExecutionLock.acquire(task.id);
    if (!lock.ok) {
      const msg = `Desktop execution lock is currently held by task "${lock.holder}".`;
      this.taskManager.setStatus(task.id, "failed", msg);
      eventBus.emit("task:failed", { taskId: task.id, error: msg });
      return task;
    }
    const startMs = Date.now();
    logger.info("runtime", "Starting agent objective", { taskId: task.id, goal });

    try {
      this.taskManager.setStatus(task.id, "running");

      if (this.skillRouter) {
        const routed = await this.skillRouter(goal, task);
        if (routed.handled) {
          if (routed.plan && routed.plan.length > 0) {
            this.taskManager.setPlan(task.id, routed.plan);
          }
          task.finalReport = routed.summary || "Skill workflow executed.";
          if (routed.success === false) {
            this.taskManager.setStatus(task.id, "failed", task.finalReport);
            this.memoryStore?.saveTask(task);
            eventBus.emit("task:failed", { taskId: task.id, error: task.finalReport });
          } else {
            this.taskManager.setStatus(task.id, "completed");
            this.memoryStore?.saveTask(task);
            eventBus.emit("task:completed", { taskId: task.id, summary: task.finalReport });
          }
          return task;
        }
      }

      let consecutiveErrors = 0;

      for (let stepIdx = 0; stepIdx < this.maxSteps; stepIdx++) {
        // Respect pause
        while (this.taskManager.isPaused() && !signal.aborted) {
          await new Promise((r) => setTimeout(r, 200));
        }

        if (signal.aborted || this.taskManager.isEmergencyStopped()) {
          throw new ExecutionCancelledError();
        }

        if (Date.now() - startMs > this.maxDurationMs) {
          this.taskManager.setStatus(task.id, "failed", "Task exceeded maximum duration budget.");
          return task;
        }

        // Observe desktop context before planning next action
        if (this.observeWindowFn) {
          try {
            task.context.activeWindow = await this.observeWindowFn();
          } catch {}
        }

        const tier: ModelTier = consecutiveErrors > 0 ? "chief" : stepIdx === 0 ? "standard" : "fast";
        const turn = await this.planner.nextTurn(task, 2, tier);
        if (turn.plan && turn.plan.length > 0) {
          this.taskManager.setPlan(task.id, turn.plan);
        }

        if (turn.finalAnswer !== undefined && !turn.action) {
          task.finalReport = turn.finalAnswer;
          this.taskManager.setStatus(task.id, "completed");
          this.memoryStore?.saveTask(task);
          this.taskMemory.clear(task.id);
          eventBus.emit("task:completed", { taskId: task.id, summary: turn.finalAnswer });
          return task;
        }

        if (!turn.action) {
          this.taskManager.setStatus(task.id, "failed", "Planner returned neither action nor finalAnswer.");
          return task;
        }

        const step = this.taskManager.addStep(
          task.id,
          turn.thought || `Execute ${turn.action.tool}`,
          turn.action.tool,
          turn.action.arguments
        );

        try {
          const beforeSnap = await this.observer.captureSnapshot();
          const outcome = await this.executor.executeStep(
            task.id,
            step.id,
            turn.action.tool,
            turn.action.arguments,
            signal
          );
          const afterSnap = await this.observer.captureSnapshot();
          const diff = this.observer.compare(beforeSnap, afterSnap);
          const verRecord = this.verifier.verifyOutcome(
            outcome.toolResult,
            { verified: outcome.verified, evidence: outcome.verificationEvidence },
            beforeSnap,
            afterSnap,
            diff
          );

          this.auditLog.recordAction({
            taskId: task.id,
            action: turn.action.tool,
            target: JSON.stringify(turn.action.arguments),
            outcome: verRecord.verified && outcome.toolResult.success ? "executed" : "failed",
            details: verRecord.evidence,
          });
          this.memoryStore?.recordStepHistory(
            task.id,
            step.id,
            turn.action.tool,
            verRecord.verified && outcome.toolResult.success ? "completed" : "failed",
            verRecord.evidence
          );

          if (verRecord.verified && outcome.toolResult.success) {
            consecutiveErrors = 0;
            this.taskManager.completeStep(
              task.id,
              step.id,
              "completed",
              outcome.toolResult.output,
              verRecord.evidence
            );
          } else {
            consecutiveErrors++;
            const rec = await this.recovery.attemptRecovery(
              turn.action.tool,
              turn.action.arguments,
              outcome.toolResult.error || "Verification failed."
            );
            this.taskManager.completeStep(
              task.id,
              step.id,
              "failed",
              outcome.toolResult.output,
              `${verRecord.evidence} | Recovery: ${rec.note}`,
              outcome.toolResult.error || "Verification failed."
            );
            this.taskManager.setStatus(task.id, "recovering");
          }
        } catch (err) {
          if (err instanceof ExecutionCancelledError || signal.aborted) {
            this.taskManager.completeStep(task.id, step.id, "skipped", undefined, undefined, "Cancelled");
            this.memoryStore?.saveTask(task);
            throw err;
          }
          consecutiveErrors++;
          const msg = err instanceof Error ? err.message : String(err);
          const rec = await this.recovery.attemptRecovery(turn.action.tool, turn.action.arguments, msg);
          this.auditLog.recordAction({
            taskId: task.id,
            action: turn.action.tool,
            target: JSON.stringify(turn.action.arguments),
            outcome: "failed",
            details: `${msg} | ${rec.note}`,
          });
          this.taskManager.completeStep(task.id, step.id, "failed", undefined, rec.note, msg);
          this.taskManager.setStatus(task.id, "recovering");
        }
        this.memoryStore?.saveTask(task);

        if (consecutiveErrors > this.maxRetriesPerStep) {
          const failMsg = `Stopped after ${consecutiveErrors} consecutive failed steps.`;
          this.taskManager.setStatus(task.id, "failed", failMsg);
          eventBus.emit("task:failed", { taskId: task.id, error: failMsg });
          return task;
        }

        this.taskManager.setStatus(task.id, "running");
      }

      const maxMsg = `Reached maximum step limit (${this.maxSteps}).`;
      task.finalReport = maxMsg;
      this.taskManager.setStatus(task.id, "completed");
      eventBus.emit("task:completed", { taskId: task.id, summary: maxMsg });
      return task;
    } catch (err) {
      if (err instanceof ExecutionCancelledError || signal.aborted) {
        if (task.status !== "cancelled") {
          this.taskManager.setStatus(task.id, "cancelled", "Cancelled");
        }
        return task;
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.taskManager.setStatus(task.id, "failed", msg);
      eventBus.emit("task:failed", { taskId: task.id, error: msg });
      return task;
    } finally {
      desktopExecutionLock.release(task.id);
    }
  }
}
