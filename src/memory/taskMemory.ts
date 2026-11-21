export class TaskMemory {
  private readonly store = new Map<string, Record<string, unknown>>();

  public set(taskId: string, key: string, value: unknown): void {
    const existing = this.store.get(taskId) || {};
    existing[key] = value;
    this.store.set(taskId, existing);
  }

  public get(taskId: string, key: string): unknown {
    return this.store.get(taskId)?.[key];
  }

  public getAll(taskId: string): Record<string, unknown> {
    return { ...(this.store.get(taskId) || {}) };
  }

  public clear(taskId: string): void {
    this.store.delete(taskId);
  }
}
