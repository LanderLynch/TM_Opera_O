/**
 * Single active desktop-control lock so concurrent tasks never fight over mouse,
 * keyboard, or foreground window focus.
 */
export class ExecutionLock {
  private holderTaskId: string | null = null;
  private acquiredAt = 0;

  public acquire(taskId: string): { ok: boolean; holder?: string } {
    if (this.holderTaskId && this.holderTaskId !== taskId) {
      return { ok: false, holder: this.holderTaskId };
    }
    this.holderTaskId = taskId;
    this.acquiredAt = Date.now();
    return { ok: true, holder: taskId };
  }

  public release(taskId: string): boolean {
    if (this.holderTaskId !== taskId) return false;
    this.holderTaskId = null;
    this.acquiredAt = 0;
    return true;
  }

  public forceRelease(): void {
    this.holderTaskId = null;
    this.acquiredAt = 0;
  }

  public isLocked(): boolean {
    return this.holderTaskId !== null;
  }

  public getHolder(): { taskId: string; acquiredAt: number } | null {
    if (!this.holderTaskId) return null;
    return { taskId: this.holderTaskId, acquiredAt: this.acquiredAt };
  }
}

export const desktopExecutionLock = new ExecutionLock();
