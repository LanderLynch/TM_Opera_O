import * as fs from "fs";

export interface FileMoveRecord {
  originalPath: string;
  newPath: string;
  timestamp: number;
  success: boolean;
  reversible: boolean;
}

export interface AuditEntry {
  timestamp: number;
  taskId: string;
  action: string;
  target: string;
  outcome: "allowed" | "blocked" | "executed" | "failed";
  details?: string;
}

export class AuditLog {
  private readonly entries: AuditEntry[] = [];
  private readonly fileJournal: FileMoveRecord[] = [];

  public recordAction(entry: Omit<AuditEntry, "timestamp">): void {
    this.entries.push({ ...entry, timestamp: Date.now() });
    if (this.entries.length > 500) this.entries.shift();
  }

  public recordFileMove(record: FileMoveRecord): void {
    this.fileJournal.push(record);
  }

  public getFileJournal(): FileMoveRecord[] {
    return [...this.fileJournal];
  }

  public getRecentAudit(limit = 50): AuditEntry[] {
    return this.entries.slice(-limit);
  }

  public undoLastFileBatch(count = 1): { undone: number; errors: string[] } {
    let undone = 0;
    const errors: string[] = [];
    for (let i = 0; i < count; i++) {
      const rec = this.fileJournal.pop();
      if (!rec) break;
      if (!rec.reversible || !rec.success) continue;
      try {
        if (fs.existsSync(rec.newPath) && !fs.existsSync(rec.originalPath)) {
          fs.renameSync(rec.newPath, rec.originalPath);
          undone++;
        }
      } catch (e) {
        errors.push(String(e));
      }
    }
    return { undone, errors };
  }
}
