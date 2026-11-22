import * as fs from "fs";
import * as path from "path";

export type SessionStatus = "running" | "completed" | "partial" | "failed" | "cancelled";

export interface ApplicationSession {
  id: string;
  applicationId: string;
  startedAt: number;
  endedAt?: number;
  taskName: string;
  completedActivities: string[];
  pendingActivities: string[];
  verifiedResults: string[];
  status: SessionStatus;
}

export interface ApplicationStatsSummary {
  applicationId: string;
  totalSessions: number;
  completedSessions: number;
  partialOrFailedSessions: number;
  lastSessionAt: number | null;
  recentVerifiedResults: string[];
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
 * Tracks verified historical application sessions and statistics, strictly
 * separated from personal long-term memory.
 */
export class ApplicationStatisticsStore {
  public readonly rootDir: string;
  private db: SqliteLike | null = null;
  private readonly jsonFallbackPath: string;

  constructor(baseDataDir: string) {
    this.rootDir = path.join(baseDataDir, "applications");
    if (!fs.existsSync(this.rootDir)) fs.mkdirSync(this.rootDir, { recursive: true });
    this.jsonFallbackPath = path.join(this.rootDir, "statistics.json");

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { DatabaseSync } = require("node:sqlite") as {
        DatabaseSync: new (file: string) => SqliteLike;
      };
      this.db = new DatabaseSync(path.join(this.rootDir, "statistics.db"));
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS application_sessions (
          id TEXT PRIMARY KEY,
          application_id TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          status TEXT NOT NULL,
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

  public startSession(applicationId: string, taskName: string): ApplicationSession {
    const now = Date.now();
    const session: ApplicationSession = {
      id: `sess_${now}_${Math.random().toString(36).slice(2, 6)}`,
      applicationId: applicationId.toLowerCase().trim(),
      startedAt: now,
      taskName: taskName.trim(),
      completedActivities: [],
      pendingActivities: [],
      verifiedResults: [],
      status: "running",
    };
    return this.save(session);
  }

  public finishSession(
    id: string,
    update: {
      status: Exclude<SessionStatus, "running">;
      completedActivities?: string[];
      pendingActivities?: string[];
      verifiedResults?: string[];
    }
  ): ApplicationSession | null {
    const existing = this.get(id);
    if (!existing) return null;
    const updated: ApplicationSession = {
      ...existing,
      endedAt: Date.now(),
      status: update.status,
      completedActivities: update.completedActivities ?? existing.completedActivities,
      pendingActivities: update.pendingActivities ?? existing.pendingActivities,
      verifiedResults: update.verifiedResults ?? existing.verifiedResults,
    };
    return this.save(updated);
  }

  public correctSession(
    id: string,
    patch: Partial<Pick<ApplicationSession, "status" | "completedActivities" | "pendingActivities" | "verifiedResults">>
  ): ApplicationSession | null {
    const existing = this.get(id);
    if (!existing) return null;
    return this.save({ ...existing, ...patch });
  }

  public get(id: string): ApplicationSession | null {
    return this.listSessions().find((s) => s.id === id) || null;
  }

  public listSessions(applicationId?: string, sinceMs?: number): ApplicationSession[] {
    let items: ApplicationSession[] = [];
    if (this.db) {
      const rows = this.db
        .prepare("SELECT payload_json FROM application_sessions ORDER BY started_at DESC")
        .all();
      items = rows.map((r) => JSON.parse(String(r.payload_json)) as ApplicationSession);
    } else if (fs.existsSync(this.jsonFallbackPath)) {
      try {
        items = JSON.parse(fs.readFileSync(this.jsonFallbackPath, "utf-8")) as ApplicationSession[];
      } catch {}
    }

    return items.filter((s) => {
      if (applicationId && s.applicationId !== applicationId.toLowerCase().trim()) return false;
      if (sinceMs && s.startedAt < sinceMs) return false;
      return true;
    });
  }

  public getSummary(applicationId: string, windowMs?: number): ApplicationStatsSummary {
    const since = windowMs ? Date.now() - windowMs : undefined;
    const sessions = this.listSessions(applicationId, since);
    const completed = sessions.filter((s) => s.status === "completed").length;
    const partialOrFailed = sessions.filter((s) => s.status === "partial" || s.status === "failed").length;
    const recentVerifiedResults = sessions
      .slice(0, 5)
      .flatMap((s) => s.verifiedResults)
      .slice(0, 10);

    return {
      applicationId: applicationId.toLowerCase().trim(),
      totalSessions: sessions.length,
      completedSessions: completed,
      partialOrFailedSessions: partialOrFailed,
      lastSessionAt: sessions[0]?.startedAt ?? null,
      recentVerifiedResults,
    };
  }

  private save(session: ApplicationSession): ApplicationSession {
    if (this.db) {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO application_sessions
           (id, application_id, started_at, status, payload_json)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          session.id,
          session.applicationId,
          session.startedAt,
          session.status,
          JSON.stringify(session)
        );
    } else {
      const all = this.listSessions().filter((s) => s.id !== session.id);
      all.unshift(session);
      fs.writeFileSync(this.jsonFallbackPath, JSON.stringify(all, null, 2), "utf-8");
    }
    return session;
  }
}
