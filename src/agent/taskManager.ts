import { eventBus } from "../core/eventBus";

export type TaskStatus =
  | "planning"
  | "running"
  | "waiting"
  | "recovering"
  | "completed"
  | "failed"
  | "cancelled";

export type StepStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "skipped";

export interface AgentStep {
  id: string;
  description: string;
  toolName: string;
  arguments: Record<string, unknown>;
  status: StepStatus;
  result?: unknown;
  verificationEvidence?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface AgentTask {
  id: string;
  goal: string;
  status: TaskStatus;
  planSummary: string[];
  steps: AgentStep[];
  currentStep: number;
  createdAt: number;
  updatedAt: number;
  context: {
    activeWindow?: string;
    workingDirectory?: string;
    outputFiles: string[];
  };
  finalReport?: string;
  error?: string;
}

export class TaskManager {
  private tasks = new Map<string, AgentTask>();
  private activeTaskId: string | null = null;
  private abortController: AbortController | null = null;
  private paused = false;
  private emergencyStopped = false;
  private approvalResolver: ((approved: boolean) => void) | null = null;

  public hasActiveTask(): boolean {
    if (!this.activeTaskId) return false;
    const t = this.tasks.get(this.activeTaskId);
    return Boolean(t && !["completed", "failed", "cancelled"].includes(t.status));
  }

  public getActiveTask(): AgentTask | null {
    return this.activeTaskId ? this.tasks.get(this.activeTaskId) || null : null;
  }

  public getTask(id: string): AgentTask | null {
    return this.tasks.get(id) || null;
  }

  public getAllTasks(): AgentTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  public createTask(goal: string, workingDirectory?: string): { task: AgentTask; signal: AbortSignal } {
    if (this.hasActiveTask()) {
      throw new Error(`Another task (${this.activeTaskId}) is already active.`);
    }
    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    const task: AgentTask = {
      id,
      goal,
      status: "planning",
      planSummary: [],
      steps: [],
      currentStep: 0,
      createdAt: now,
      updatedAt: now,
      context: {
        workingDirectory,
        outputFiles: [],
      },
    };

    this.tasks.set(id, task);
    this.activeTaskId = id;
    this.abortController = new AbortController();
    this.paused = false;
    this.emergencyStopped = false;

    eventBus.emit("task:updated", { taskId: id, status: task.status });
    return { task, signal: this.abortController.signal };
  }

  public setStatus(taskId: string, status: TaskStatus, error?: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = status;
    task.updatedAt = Date.now();
    if (error !== undefined) task.error = error;
    if (["completed", "failed", "cancelled"].includes(status) && this.activeTaskId === taskId) {
      this.activeTaskId = null;
      this.abortController = null;
    }
    eventBus.emit("task:updated", { taskId, status });
  }

  public setPlan(taskId: string, planSummary: string[]): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.planSummary = planSummary;
    task.updatedAt = Date.now();
  }

  public addStep(
    taskId: string,
    description: string,
    toolName: string,
    args: Record<string, unknown>
  ): AgentStep {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found.`);
    const step: AgentStep = {
      id: `step_${task.steps.length + 1}`,
      description,
      toolName,
      arguments: args,
      status: "running",
      startedAt: Date.now(),
    };
    task.steps.push(step);
    task.currentStep = task.steps.length;
    task.updatedAt = Date.now();
    eventBus.emit("task:step", { taskId, stepId: step.id, status: step.status });
    return step;
  }

  public completeStep(
    taskId: string,
    stepId: string,
    status: StepStatus,
    result?: unknown,
    evidence?: string,
    error?: string
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const step = task.steps.find((s) => s.id === stepId);
    if (!step) return;
    step.status = status;
    step.result = result;
    step.verificationEvidence = evidence;
    step.error = error;
    step.finishedAt = Date.now();
    task.updatedAt = Date.now();
    eventBus.emit("task:step", { taskId, stepId, status });
  }

  public pause(): boolean {
    if (!this.hasActiveTask()) return false;
    this.paused = true;
    if (this.activeTaskId) this.setStatus(this.activeTaskId, "waiting");
    return true;
  }

  public resume(): boolean {
    if (!this.hasActiveTask() || this.emergencyStopped) return false;
    this.paused = false;
    if (this.activeTaskId) this.setStatus(this.activeTaskId, "running");
    return true;
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public isEmergencyStopped(): boolean {
    return this.emergencyStopped;
  }

  public cancel(reason = "Cancelled by user"): boolean {
    if (!this.activeTaskId) return false;
    const id = this.activeTaskId;
    this.paused = false;
    this.resolveApproval(false);
    this.abortController?.abort();
    this.setStatus(id, "cancelled", reason);
    eventBus.emit("task:cancelled", { taskId: id, reason });
    return true;
  }

  public emergencyStop(): boolean {
    this.emergencyStopped = true;
    return this.cancel("EMERGENCY STOP triggered");
  }

  public requestApproval(
    taskId: string,
    stepId: string,
    toolName: string,
    summary: string,
    args: Record<string, unknown>
  ): Promise<boolean> {
    this.setStatus(taskId, "waiting");
    eventBus.emit("task:approval-needed", {
      taskId,
      stepId,
      toolName,
      summary,
      arguments: args,
    });
    return new Promise((resolve) => {
      this.approvalResolver = resolve;
    });
  }

  public resolveApproval(approved: boolean): void {
    if (this.approvalResolver) {
      const fn = this.approvalResolver;
      this.approvalResolver = null;
      fn(approved);
    }
  }
}
