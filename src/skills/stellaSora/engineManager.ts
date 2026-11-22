import * as fs from "fs";
import * as path from "path";
import { desktopExecutionLock } from "../../agent/executionLock";
import { ApplicationKnowledgeStore } from "../../applications/applicationKnowledge";
import { ApplicationStatisticsStore } from "../../applications/applicationStatistics";
import { LearningEngine } from "../../learning/learningEngine";
import { SkillStore } from "../../learning/skillStore";
import { StellaSoraReportGenerator, DailySkippedItem } from "./reportGenerator";
import { StellaSoraTaskVerifier, WorkflowVerificationResult } from "./taskVerifier";
import {
  STELLA_SORA_DAILY_SEQUENCE,
  STELLA_SORA_WORKFLOWS,
  StellaSoraWorkflowSpec,
  validatePipelineEntry,
} from "./workflowCatalog";
import { MaaBridge, MaaReadinessInfo } from "./maaBridge";
import { StellaSoraProcessManager, StellaSoraProcessState } from "./processManager";

export type StellaSoraSkillPhase =
  | "uninitialized"
  | "activated"
  | "running"
  | "paused"
  | "stopped"
  | "error";

export type StellaSoraTaskState =
  | "queued"
  | "initializing"
  | "running"
  | "verifying"
  | "completed"
  | "failed"
  | "paused"
  | "cancelled";

export interface StellaSoraStatusSnapshot {
  skillName: string;
  phase: StellaSoraSkillPhase;
  taskState: StellaSoraTaskState;
  engineReady: boolean;
  readiness: MaaReadinessInfo | null;
  compatibilityStatus: string;
  gameState: StellaSoraProcessState | null;
  currentWorkflow: string | null;
  currentStep: string | null;
  progressPercent: number;
  lastRecognizedScreen: string | null;
  lastVerification: WorkflowVerificationResult | null;
  lastError: string | null;
  adaptiveMode: boolean;
}

/**
 * Manages the 10-step activation & execution lifecycle for the Stella Sora skill:
 * discover -> checkCompatibility -> checkEngine -> detectGame -> initialize ->
 * status -> execute -> verify -> report -> shutdown.
 */
export class StellaSoraEngineManager {
  public readonly skillRootDir: string;
  public readonly bridge: MaaBridge;
  public readonly processManager = new StellaSoraProcessManager();
  public readonly verifier = new StellaSoraTaskVerifier();
  public readonly reporter = new StellaSoraReportGenerator();

  private phase: StellaSoraSkillPhase = "uninitialized";
  private taskState: StellaSoraTaskState = "queued";
  private readiness: MaaReadinessInfo | null = null;
  private gameState: StellaSoraProcessState | null = null;
  private compatibilityStatus = "unknown";
  private currentWorkflow: string | null = null;
  private currentStep: string | null = null;
  private progressPercent = 0;
  private lastRecognizedScreen: string | null = null;
  private lastVerification: WorkflowVerificationResult | null = null;
  private lastError: string | null = null;
  private adaptiveMode = false;
  private paused = false;
  private stopRequested = false;
  private readonly sessionResults: WorkflowVerificationResult[] = [];

  constructor(
    skillRootDir: string,
    private readonly deps: {
      skillStore?: SkillStore;
      learningEngine?: LearningEngine;
      knowledgeStore?: ApplicationKnowledgeStore;
      statisticsStore?: ApplicationStatisticsStore;
    } = {}
  ) {
    this.skillRootDir = skillRootDir;
    this.bridge = new MaaBridge(skillRootDir);
  }

  public getStatus(): StellaSoraStatusSnapshot {
    return {
      skillName: "Stella Sora Game Automation Skill",
      phase: this.phase,
      taskState: this.taskState,
      engineReady: Boolean(this.readiness?.maafwInstalled && this.readiness?.resourcesPresent),
      readiness: this.readiness,
      compatibilityStatus: this.compatibilityStatus,
      gameState: this.gameState,
      currentWorkflow: this.currentWorkflow,
      currentStep: this.currentStep,
      progressPercent: this.progressPercent,
      lastRecognizedScreen: this.lastRecognizedScreen,
      lastVerification: this.lastVerification,
      lastError: this.lastError,
      adaptiveMode: this.adaptiveMode,
    };
  }

  /**
   * Activates and verifies readiness WITHOUT executing any game workflow automatically.
   */
  public async activate(): Promise<StellaSoraStatusSnapshot> {
    this.lastError = null;
    this.taskState = "initializing";
    this.currentStep = "1. Discovering skill manifest";
    const manifestPath = path.join(this.skillRootDir, "manifest.json");
    const compatPath = path.join(this.skillRootDir, "compatibility.json");
    if (!fs.existsSync(manifestPath) || !fs.existsSync(compatPath)) {
      this.phase = "error";
      this.lastError = "Missing manifest.json or compatibility.json in Stella Sora skill package.";
      return this.getStatus();
    }

    this.currentStep = "2. Checking Steam Global compatibility";
    try {
      const compat = JSON.parse(fs.readFileSync(compatPath, "utf-8")) as {
        platforms?: { steam_global?: { status?: string } };
      };
      this.compatibilityStatus = compat.platforms?.steam_global?.status || "unknown";
    } catch {
      this.compatibilityStatus = "invalid-compatibility-json";
    }

    this.currentStep = "3. Checking MaaFramework engine availability";
    const readyRes = await this.bridge.checkReadiness();
    this.readiness = readyRes.data || null;

    this.currentStep = "4. Detecting Stella Sora process & Steam installation";
    this.gameState = await this.processManager.detect();
    this.lastRecognizedScreen = this.gameState.windowTitle;

    this.currentStep = "5-6. Skill initialized (standing by — no workflow executed)";
    this.phase = "activated";
    this.taskState = "queued";
    this.progressPercent = 0;
    return this.getStatus();
  }

  public setAdaptiveMode(enabled: boolean): StellaSoraStatusSnapshot {
    this.adaptiveMode = enabled;
    return this.getStatus();
  }

  public pause(): StellaSoraStatusSnapshot {
    this.paused = true;
    if (this.phase === "running") {
      this.phase = "paused";
      this.taskState = "paused";
    }
    return this.getStatus();
  }

  public resume(): StellaSoraStatusSnapshot {
    this.paused = false;
    if (this.phase === "paused") {
      this.phase = "running";
      this.taskState = "running";
    }
    return this.getStatus();
  }

  public async stop(): Promise<StellaSoraStatusSnapshot> {
    this.paused = false;
    this.stopRequested = true;
    this.phase = "stopped";
    this.taskState = "cancelled";
    this.currentStep = "Emergency stop triggered";
    await this.bridge.emergencyStop();
    desktopExecutionLock.forceRelease();
    return this.getStatus();
  }

  public async shutdown(): Promise<void> {
    await this.bridge.shutdown();
    this.phase = "uninitialized";
    this.currentWorkflow = null;
    this.currentStep = null;
  }

  public listWorkflows(): StellaSoraWorkflowSpec[] {
    return STELLA_SORA_WORKFLOWS;
  }

  public async runDailyWorkflow(
    options: { autoLaunch?: boolean; skipCompletedToday?: boolean } = {}
  ) {
    return await this.runWorkflows(STELLA_SORA_DAILY_SEQUENCE, options);
  }

  public async runWorkflows(
    workflowIds: string[],
    options: { autoLaunch?: boolean; skipCompletedToday?: boolean } = {}
  ): Promise<{
    ok: boolean;
    report: string;
    results: WorkflowVerificationResult[];
    status: StellaSoraStatusSnapshot;
  }> {
    const autoLaunch = options.autoLaunch !== false;
    const skipCompletedToday = options.skipCompletedToday !== false;

    if (this.phase === "uninitialized") {
      await this.activate();
    }

    const lockTaskId = `stella_sora_${Date.now()}`;
    const lock = desktopExecutionLock.acquire(lockTaskId);
    if (!lock.ok) {
      const msg = `Cannot run Stella Sora: desktop lock is held by "${lock.holder}".`;
      this.lastError = msg;
      return { ok: false, report: msg, results: [], status: this.getStatus() };
    }

    const runStartedAt = Date.now();
    const results: WorkflowVerificationResult[] = [];
    const skippedItems: DailySkippedItem[] = [];
    const session = this.deps.statisticsStore?.startSession("stella-sora", workflowIds.join(", "));

    try {
      this.stopRequested = false;
      this.phase = "running";
      this.taskState = "initializing";
      this.progressPercent = 0;
      this.lastError = null;
      this.gameState = await this.processManager.detect();
      const wasAlreadyRunning = this.gameState.isRunning;

      if (!this.gameState.isRunning && autoLaunch && this.gameState.installedInSteam) {
        this.currentStep = "Launching Stella Sora via Steam...";
        await this.processManager.launchViaSteam();
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline && !this.stopRequested) {
          await new Promise((r) => setTimeout(r, 1500));
          this.gameState = await this.processManager.detect();
          if (this.gameState.isRunning) break;
        }
      }

      if (!this.gameState.isRunning) {
        const msg = !this.gameState.desktopAccessible
          ? "Sesi background tidak dapat mengakses window desktop interaktif (visibleWindowCount=0). Jalankan melalui Electron Desktop Host."
          : this.gameState.installedInSteam
            ? "Stella Sora terinstal di Steam, tetapi window game belum muncul di desktop."
            : "Stella Sora belum terinstal atau belum berjalan di PC ini.";
        this.phase = "activated";
        this.taskState = "failed";
        this.progressPercent = 0;
        this.lastError = msg;
        this.deps.knowledgeStore?.add({
          applicationId: "stella-sora",
          category: "personal-note",
          title: "Launch/Window Detection Note",
          content: msg,
          source: "observed",
        });
        if (session) {
          this.deps.statisticsStore?.finishSession(session.id, {
            status: "failed",
            pendingActivities: workflowIds,
            verifiedResults: [msg],
          });
        }
        return { ok: false, report: msg, results, status: this.getStatus() };
      }

      // Skip login-check if already open, and skip workflows already verified completed today
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const completedToday = new Set<string>();
      if (skipCompletedToday && this.deps.statisticsStore) {
        for (const s of this.deps.statisticsStore.listSessions("stella-sora", startOfToday.getTime())) {
          for (const act of s.completedActivities || []) {
            completedToday.add(act);
          }
        }
      }
      const queueIds: string[] = [];
      for (const id of workflowIds) {
        if (wasAlreadyRunning && id === "login-check") {
          skippedItems.push({ workflowId: id, reason: "Game sudah terbuka di desktop" });
          continue;
        }
        if (completedToday.has(id)) {
          skippedItems.push({ workflowId: id, reason: "Sudah terverifikasi selesai hari ini" });
          continue;
        }
        queueIds.push(id);
      }

      if (queueIds.length === 0) {
        this.phase = "activated";
        this.taskState = "completed";
        this.currentStep = "Seluruh aktivitas harian sudah selesai hari ini";
        this.progressPercent = 100;
        const report = this.reporter.buildSessionSummary(
          results,
          this.deps.statisticsStore?.getSummary("stella-sora"),
          skippedItems,
          Date.now() - runStartedAt
        );
        if (session) {
          this.deps.statisticsStore?.finishSession(session.id, {
            status: "completed",
            completedActivities: workflowIds,
            verifiedResults: [report],
          });
        }
        return { ok: true, report, results, status: this.getStatus() };
      }

      // Check active knowledge notices before running workflows
      const activeNotices = this.deps.knowledgeStore?.getRelevant("stella-sora") || [];
      const maintNotice = activeNotices.find((k) => k.category === "maintenance");
      if (maintNotice) {
        const msg = `Maintenance notice active: ${maintNotice.title} — ${maintNotice.content}`;
        this.lastError = msg;
      }

      for (let i = 0; i < queueIds.length; i++) {
        if (this.stopRequested) break;
        while (this.paused && !this.stopRequested) {
          await new Promise((r) => setTimeout(r, 200));
        }

        const wfId = queueIds[i];
        const spec = STELLA_SORA_WORKFLOWS.find((w) => w.id === wfId);
        if (!spec) {
          const v = this.verifier.verifyExecution(wfId, false, null, `Unknown workflow "${wfId}".`);
          results.push(v);
          continue;
        }

        const entryCheck = validatePipelineEntry(this.skillRootDir, spec.pipelineEntry);
        if (!entryCheck.valid) {
          const v = this.verifier.verifyExecution(wfId, false, this.gameState.windowTitle, entryCheck.error);
          results.push(v);
          this.lastVerification = v;
          this.lastError = entryCheck.error || "Invalid pipeline entry.";
          continue;
        }

        this.taskState = "running";
        this.currentWorkflow = spec.name;
        this.currentStep = `Executing ${spec.pipelineEntry}`;

        let execRes = await this.bridge.runPipelineTask(spec.pipelineEntry, 0);
        if (!execRes.ok && this.adaptiveMode && !this.stopRequested) {
          this.currentStep = `Adaptive retry for ${spec.pipelineEntry}`;
          await this.bridge.captureScreenshot().catch(() => {});
          execRes = await this.bridge.runPipelineTask(spec.pipelineEntry, 0);
        }

        this.taskState = "verifying";
        const postState = await this.processManager.detect();
        this.lastRecognizedScreen = postState.windowTitle;

        const verified = this.verifier.verifyExecution(
          wfId,
          execRes.ok,
          postState.windowTitle,
          execRes.error
        );
        if (!verified.verified) {
          this.deps.knowledgeStore?.add({
            applicationId: "stella-sora",
            category: "application-update",
            title: `Workflow issue: ${wfId}`,
            content: verified.evidence,
            source: "observed",
          });
        }
        results.push(verified);
        this.sessionResults.push(verified);
        this.lastVerification = verified;
        const verifiedCount = results.filter((r) => r.verified).length;
        this.progressPercent = Math.round((verifiedCount / queueIds.length) * 100);
      }

      const completed = results.filter((r) => r.verified).map((r) => r.workflowId);
      const pending = results.filter((r) => !r.verified).map((r) => r.workflowId);

      if (this.stopRequested) {
        this.taskState = "cancelled";
      } else {
        this.phase = "activated";
        this.taskState = pending.length === 0 && completed.length > 0 ? "completed" : "failed";
      }
      this.currentStep = this.taskState === "completed" ? "Completed" : "Incomplete / Failed";
      if (session) {
        this.deps.statisticsStore?.finishSession(session.id, {
          status: pending.length === 0 ? "completed" : completed.length > 0 ? "partial" : "failed",
          completedActivities: completed,
          pendingActivities: pending,
          verifiedResults: results.map((r) => r.evidence),
        });
      }

      const report = this.reporter.buildSessionSummary(
        results,
        this.deps.statisticsStore?.getSummary("stella-sora"),
        skippedItems,
        Date.now() - runStartedAt
      );
      return { ok: pending.length === 0, report, results, status: this.getStatus() };
    } finally {
      desktopExecutionLock.release(lockTaskId);
    }
  }

  public getProgressReport(): string {
    return this.reporter.buildSessionSummary(
      this.sessionResults,
      this.deps.statisticsStore?.getSummary("stella-sora")
    );
  }

  public async runControlledClickTest(
    mode: "maa_win32" | "win32_sendinput",
    outDir?: string
  ): Promise<{ ok: boolean; report: string; data?: unknown }> {
    const lockTaskId = `stella_probe_${Date.now()}`;
    const lock = desktopExecutionLock.acquire(lockTaskId);
    if (!lock.ok) {
      return { ok: false, report: `Desktop lock sedang dipakai oleh "${lock.holder}".` };
    }
    try {
      const res = await this.bridge.probeClick(mode, outDir);
      if (!res.ok || !res.data) {
        return {
          ok: false,
          report: `Uji klik [${mode}] gagal: ${res.error || "Window Stella Sora tidak ditemukan."}`,
        };
      }
      const d = res.data;
      const report = [
        `Hasil Uji Klik [${d.mode}] pada "${d.windowTitle}" (HWND ${d.hwnd}):`,
        `- Target (client): (${d.targetClientXY.x}, ${d.targetClientXY.y})`,
        `- Foreground: sebelum=${d.foregroundBefore}, sesudah=${d.foregroundAfter}`,
        `- Posisi Cursor: (${d.cursorBefore.x},${d.cursorBefore.y}) -> (${d.cursorAfter.x},${d.cursorAfter.y})`,
        `- Dispatch sukses: ${d.dispatched}${d.mode === "win32_sendinput" ? ` (SendInput=${d.sendInputCount}/2)` : ""}`,
        `- Perubahan layar: ${d.pixelDiffPercent}% (berpindah=${d.screenChanged})`,
        `- Screenshot: ${d.beforePath} -> ${d.afterPath}`,
      ].join("\n");
      return { ok: d.dispatched, report, data: d };
    } finally {
      desktopExecutionLock.release(lockTaskId);
    }
  }

  public async proposeAdaptiveWorkflowUpdate(
    skillId: string,
    observedDifference: string,
    description: string
  ) {
    if (!this.deps.learningEngine) return null;
    return this.deps.learningEngine.proposeAdaptiveUpdate(skillId, observedDifference, [
      {
        description,
        preferredMethod: "windows_uia",
        expectedResult: "Adapted workflow succeeds on updated UI",
        verificationCondition: "Verify updated Stella Sora screen state",
      },
    ]);
  }
}
