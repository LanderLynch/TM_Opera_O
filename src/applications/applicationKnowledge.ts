import * as fs from "fs";
import * as path from "path";

export type KnowledgeCategory =
  | "event"
  | "maintenance"
  | "personal-note"
  | "application-update"
  | "gameplay"
  | "reminder";

export type KnowledgeSource = "user" | "observed" | "verified" | "external";
export type KnowledgeStatus = "active" | "expired" | "archived";

export interface ApplicationKnowledge {
  id: string;
  applicationId: string;
  category: KnowledgeCategory;
  title: string;
  content: string;
  source: KnowledgeSource;
  createdAt: number;
  updatedAt: number;
  startDate?: number;
  expiryDate?: number;
  status: KnowledgeStatus;
}

interface SqliteLike {
  exec(sql: string): void;
  close?(): void;
  prepare(sql: string): {
    run(...params: unknown[]): void;
    all(...params: unknown[]): Array<Record<string, unknown>>;
    get(...params: unknown[]): Record<string, unknown> | undefined;
  };
}

/**
 * Stores application-specific events, maintenance notices, notes, and reminders
 * with source provenance and contextual retrieval.
 */
export class ApplicationKnowledgeStore {
  public readonly rootDir: string;
  private db: SqliteLike | null = null;
  private readonly jsonFallbackPath: string;

  constructor(baseDataDir: string) {
    this.rootDir = path.join(baseDataDir, "applications");
    if (!fs.existsSync(this.rootDir)) fs.mkdirSync(this.rootDir, { recursive: true });
    this.jsonFallbackPath = path.join(this.rootDir, "knowledge.json");

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { DatabaseSync } = require("node:sqlite") as {
        DatabaseSync: new (file: string) => SqliteLike;
      };
      this.db = new DatabaseSync(path.join(this.rootDir, "knowledge.db"));
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS application_knowledge (
          id TEXT PRIMARY KEY,
          application_id TEXT NOT NULL,
          category TEXT NOT NULL,
          status TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          payload_json TEXT NOT NULL
        );
      `);
    } catch {
      this.db = null;
    }
  }

  public close(): void {
    try {
      this.db?.close?.();
    } catch {}
    this.db = null;
  }

  public add(input: {
    applicationId: string;
    category: KnowledgeCategory;
    title: string;
    content: string;
    source?: KnowledgeSource;
    startDate?: number;
    expiryDate?: number;
  }): ApplicationKnowledge {
    const now = Date.now();
    const record: ApplicationKnowledge = {
      id: `kn_${now}_${Math.random().toString(36).slice(2, 6)}`,
      applicationId: input.applicationId.toLowerCase().trim(),
      category: input.category,
      title: input.title.trim(),
      content: input.content.trim(),
      source: input.source || "user",
      createdAt: now,
      updatedAt: now,
      startDate: input.startDate,
      expiryDate: input.expiryDate,
      status: "active",
    };
    return this.saveRecord(record);
  }

  private saveRecord(record: ApplicationKnowledge): ApplicationKnowledge {
    if (this.db) {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO application_knowledge
           (id, application_id, category, status, updated_at, payload_json)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          record.id,
          record.applicationId,
          record.category,
          record.status,
          record.updatedAt,
          JSON.stringify(record)
        );
    } else {
      const all = this.listAll().filter((x) => x.id !== record.id);
      all.unshift(record);
      fs.writeFileSync(this.jsonFallbackPath, JSON.stringify(all, null, 2), "utf-8");
    }
    return record;
  }

  public listAll(applicationId?: string): ApplicationKnowledge[] {
    let items: ApplicationKnowledge[] = [];
    if (this.db) {
      const rows = this.db
        .prepare("SELECT payload_json FROM application_knowledge ORDER BY updated_at DESC")
        .all();
      items = rows.map((r) => JSON.parse(String(r.payload_json)) as ApplicationKnowledge);
    } else if (fs.existsSync(this.jsonFallbackPath)) {
      try {
        items = JSON.parse(fs.readFileSync(this.jsonFallbackPath, "utf-8")) as ApplicationKnowledge[];
      } catch {}
    }

    if (!applicationId) return items;
    const target = applicationId.toLowerCase().trim();
    return items.filter((i) => i.applicationId === target);
  }

  /**
   * Contextual retrieval: returns only active, non-expired entries for the target application.
   */
  public getRelevant(applicationId: string, now = Date.now()): ApplicationKnowledge[] {
    return this.listAll(applicationId).filter((item) => {
      if (item.status !== "active") return false;
      if (item.expiryDate && item.expiryDate < now) return false;
      if (item.startDate && item.startDate > now) return false;
      return true;
    });
  }

  public updateStatus(id: string, status: KnowledgeStatus): boolean {
    const found = this.listAll().find((x) => x.id === id);
    if (!found) return false;
    this.saveRecord({ ...found, status, updatedAt: Date.now() });
    return true;
  }
}
