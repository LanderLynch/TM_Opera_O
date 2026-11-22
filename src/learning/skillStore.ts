import * as fs from "fs";
import * as path from "path";
import { ApplicationSkill, SkillStatus, SkillStep, SkillVersionEntry } from "./skillTypes";

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
 * Persistent SQLite + Markdown store for learned application skills and version history.
 * Never silently overwrites an approved skill with an unverified proposal.
 */
export class SkillStore {
  public readonly rootDir: string;
  private db: SqliteLike | null = null;
  private readonly jsonFallbackPath: string;
  private readonly versionsFallbackPath: string;

  constructor(baseDataDir: string) {
    this.rootDir = path.join(baseDataDir, "learning");
    if (!fs.existsSync(this.rootDir)) fs.mkdirSync(this.rootDir, { recursive: true });
    this.jsonFallbackPath = path.join(this.rootDir, "skills.json");
    this.versionsFallbackPath = path.join(this.rootDir, "skill_versions.json");

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { DatabaseSync } = require("node:sqlite") as {
        DatabaseSync: new (file: string) => SqliteLike;
      };
      this.db = new DatabaseSync(path.join(this.rootDir, "skills.db"));
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS application_skills (
          id TEXT PRIMARY KEY,
          application_id TEXT NOT NULL,
          name TEXT NOT NULL,
          status TEXT NOT NULL,
          version INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          payload_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS skill_versions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          skill_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          reason TEXT NOT NULL,
          status TEXT NOT NULL,
          steps_json TEXT NOT NULL
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

  public save(skill: ApplicationSkill, versionReason = "Created or updated"): ApplicationSkill {
    if (this.db) {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO application_skills
           (id, application_id, name, status, version, updated_at, payload_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          skill.id,
          skill.applicationId.toLowerCase(),
          skill.name,
          skill.status,
          skill.version,
          skill.updatedAt,
          JSON.stringify(skill)
        );
      this.db
        .prepare(
          `INSERT INTO skill_versions (skill_id, version, updated_at, reason, status, steps_json)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          skill.id,
          skill.version,
          skill.updatedAt,
          versionReason,
          skill.status,
          JSON.stringify(skill.steps)
        );
    } else {
      const all = this.listAll().filter((s) => s.id !== skill.id);
      all.unshift(skill);
      fs.writeFileSync(this.jsonFallbackPath, JSON.stringify(all, null, 2), "utf-8");

      const versions = this.readVersionsFallback();
      const arr = versions[skill.id] || [];
      arr.push({
        version: skill.version,
        updatedAt: skill.updatedAt,
        reason: versionReason,
        status: skill.status,
        steps: skill.steps,
      });
      versions[skill.id] = arr;
      fs.writeFileSync(this.versionsFallbackPath, JSON.stringify(versions, null, 2), "utf-8");
    }

    if (skill.status === "approved") {
      this.exportSkillMarkdown(skill);
    }
    return skill;
  }

  public get(id: string): ApplicationSkill | null {
    if (this.db) {
      const row = this.db
        .prepare("SELECT payload_json FROM application_skills WHERE id = ?")
        .get(id);
      if (!row?.payload_json) return null;
      return JSON.parse(String(row.payload_json)) as ApplicationSkill;
    }
    return this.listAll().find((s) => s.id === id) || null;
  }

  public listAll(applicationId?: string, status?: SkillStatus): ApplicationSkill[] {
    let items: ApplicationSkill[] = [];
    if (this.db) {
      const rows = this.db
        .prepare("SELECT payload_json FROM application_skills ORDER BY updated_at DESC")
        .all();
      items = rows.map((r) => JSON.parse(String(r.payload_json)) as ApplicationSkill);
    } else if (fs.existsSync(this.jsonFallbackPath)) {
      try {
        items = JSON.parse(fs.readFileSync(this.jsonFallbackPath, "utf-8")) as ApplicationSkill[];
      } catch {}
    }

    return items.filter((s) => {
      if (applicationId && s.applicationId.toLowerCase() !== applicationId.toLowerCase()) {
        return false;
      }
      if (status && s.status !== status) return false;
      return true;
    });
  }

  public getVersionHistory(skillId: string): SkillVersionEntry[] {
    if (this.db) {
      const rows = this.db
        .prepare("SELECT version, updated_at, reason, status, steps_json FROM skill_versions WHERE skill_id = ? ORDER BY version ASC")
        .all(skillId);
      return rows.map((r) => ({
        version: Number(r.version),
        updatedAt: Number(r.updated_at),
        reason: String(r.reason),
        status: String(r.status) as SkillStatus,
        steps: JSON.parse(String(r.steps_json)) as SkillStep[],
      }));
    }
    return this.readVersionsFallback()[skillId] || [];
  }

  public approve(skillId: string): ApplicationSkill | null {
    const existing = this.get(skillId);
    if (!existing) return null;

    const now = Date.now();
    const updatedSteps = existing.pendingProposal ? existing.pendingProposal.steps : existing.steps;
    const nextVersion = existing.pendingProposal ? existing.version + 1 : existing.version;
    const reason = existing.pendingProposal
      ? `Approved adaptive update: ${existing.pendingProposal.reason}`
      : "User approved draft skill";

    const approved: ApplicationSkill = {
      ...existing,
      steps: updatedSteps,
      version: nextVersion,
      updatedAt: now,
      status: "approved",
      pendingProposal: undefined,
    };
    return this.save(approved, reason);
  }

  /**
   * Proposes an update without overwriting the currently approved steps until reviewed.
   */
  public proposeUpdate(
    skillId: string,
    reason: string,
    proposedSteps: SkillStep[]
  ): ApplicationSkill | null {
    const existing = this.get(skillId);
    if (!existing) return null;

    const now = Date.now();
    if (existing.status === "approved") {
      const flagged: ApplicationSkill = {
        ...existing,
        updatedAt: now,
        status: "needs-review",
        pendingProposal: {
          proposedAt: now,
          reason,
          steps: proposedSteps,
        },
      };
      return this.save(flagged, `Proposed update (needs-review): ${reason}`);
    }

    const updated: ApplicationSkill = {
      ...existing,
      steps: proposedSteps,
      version: existing.version + 1,
      updatedAt: now,
      status: "draft",
      pendingProposal: undefined,
    };
    return this.save(updated, reason);
  }

  private readVersionsFallback(): Record<string, SkillVersionEntry[]> {
    try {
      if (fs.existsSync(this.versionsFallbackPath)) {
        return JSON.parse(fs.readFileSync(this.versionsFallbackPath, "utf-8")) as Record<string, SkillVersionEntry[]>;
      }
    } catch {}
    return {};
  }

  private exportSkillMarkdown(skill: ApplicationSkill): void {
    try {
      const appSlug = skill.applicationId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
      const skillSlug = skill.name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
      const dir = path.join(this.rootDir, "skills", appSlug);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const lines = [
        `# ${skill.name} (v${skill.version})`,
        ``,
        `- **Application**: ${skill.applicationId}`,
        `- **Status**: ${skill.status}`,
        `- **Description**: ${skill.description}`,
        ``,
        `## Steps`,
        ...skill.steps.map(
          (s, i) =>
            `${i + 1}. **${s.description}** (${s.preferredMethod}) — Verify: ${s.verificationCondition}`
        ),
        ``,
        `## Expected Results`,
        ...skill.expectedResults.map((r) => `- ${r}`),
      ];
      fs.writeFileSync(path.join(dir, `${skillSlug}.md`), lines.join("\n"), "utf-8");
    } catch {}
  }
}
