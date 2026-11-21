import { EventEmitter } from "events";

export interface AgentEventMap {
  "task:updated": { taskId: string; status: string };
  "task:step": { taskId: string; stepId: string; status: string };
  "task:approval-needed": {
    taskId: string;
    stepId: string;
    toolName: string;
    summary: string;
    arguments: Record<string, unknown>;
  };
  "task:completed": { taskId: string; summary: string };
  "task:failed": { taskId: string; error: string };
  "task:cancelled": { taskId: string; reason: string };
}

class TypedEventBus {
  private readonly emitter = new EventEmitter();

  public emit<K extends keyof AgentEventMap>(event: K, payload: AgentEventMap[K]): void {
    this.emitter.emit(event, payload);
  }

  public on<K extends keyof AgentEventMap>(
    event: K,
    listener: (payload: AgentEventMap[K]) => void
  ): () => void {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }
}

export const eventBus = new TypedEventBus();
