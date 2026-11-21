import * as fs from "fs";
import * as path from "path";
import { AgentTask } from "../agent/taskManager";

interface SqliteLike {
  exec(sql: string): void;
  close?(): void;
  prepare(sql: string): {
    run(...params: unknown[]): void;
    all(...params: unknown[]): Array<Record<string, unknown>>;
    get(...params: unknown[]): Record<string, unknown> | undefined;
  };
}

export class MemoryStore {
  private db: SqliteLike | null = null;
  private readonly jsonFallbackPath: string;

  constructor(storageDir: string) {
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    this.jsonFallbackPath = path.join(storageDir, "agent_tasks.json");
    const dbPath = path.join(storageDir, "agent_state.db");

    try {
      // Node 24 built-in SQLite (zero native rebuild required)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { DatabaseSync } = require("node:sqlite") as {
        DatabaseSync: new (file: string) => SqliteLike;
      };
      this.db = new DatabaseSync(dbPath);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS agent_tasks (
          id TEXT PRIMARY KEY,
          goal TEXT NOT NULL,
          status TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS execution_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT NOT NULL,
          step_id TEXT NOT NULL,
          tool_name TEXT NOT NULL,
          status TEXT NOT NULL,
          evidence TEXT,
          timestamp INTEGER NOT NULL
        );
      `);
    } catch {
      this.db = null;
    }
  }

  public saveTask(task: AgentTask): void {
    if (this.db) {
      const stmt = this.db.prepare(`
        INSERT INTO agent_tasks (id, goal, status, payload, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          payload = excluded.payload,
          updated_at = excluded.updated_at
      `);
      stmt.run(task.id, task.goal, task.status, JSON.stringify(task), task.createdAt, task.updatedAt);
      return;
    }
    const all = this.loadTasks(50).filter((t) => t.id !== task.id);
    all.unshift(task);
    try {
      fs.writeFileSync(this.jsonFallbackPath, JSON.stringify(all.slice(0, 50), null, 2), "utf-8");
    } catch {}
  }

  public recordStepHistory(
    taskId: string,
    stepId: string,
    toolName: string,
    status: string,
    evidence: string
  ): void {
    if (!this.db) return;
    try {
      const stmt = this.db.prepare(`
        INSERT INTO execution_history (task_id, step_id, tool_name, status, evidence, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(taskId, stepId, toolName, status, evidence, Date.now());
    } catch {}
  }

  public loadTasks(limit = 20): AgentTask[] {
    if (this.db) {
      const rows = this.db
        .prepare("SELECT payload FROM agent_tasks ORDER BY updated_at DESC LIMIT ?")
        .all(limit);
      return rows
        .map((r) => {
          try {
            return JSON.parse(String(r.payload)) as AgentTask;
          } catch {
            return null;
          }
        })
        .filter((x): x is AgentTask => x !== null);
    }
    try {
      if (fs.existsSync(this.jsonFallbackPath)) {
        return JSON.parse(fs.readFileSync(this.jsonFallbackPath, "utf-8")) as AgentTask[];
      }
    } catch {}
    return [];
  }

  public close(): void {
    try {
      this.db?.close?.();
    } catch {}
    this.db = null;
  }
}
