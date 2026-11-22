import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MaaBridge } = require("../dist/skills/stellaSora/maaBridge.js");
const { StellaSoraEngineManager } = require("../dist/skills/stellaSora/engineManager.js");
const { parseStellaSoraCommand, handleStellaSoraCommand } = require("../dist/skills/stellaSoraSkill.js");
const { ApplicationStatisticsStore } = require("../dist/applications/applicationStatistics.js");
const { SkillStore } = require("../dist/learning/skillStore.js");
const { LearningEngine } = require("../dist/learning/learningEngine.js");
const { desktopExecutionLock } = require("../dist/agent/executionLock.js");
const { createDefaultToolRegistry } = require("../dist/tools/registry.js");
const { STELLA_PIPELINE_MAP, STELLA_SORA_DAILY_SEQUENCE, validatePipelineEntry } = require("../dist/skills/stellaSora/workflowCatalog.js");
const { StellaSoraReportGenerator } = require("../dist/skills/stellaSora/reportGenerator.js");
const { validatePecutModelId } = require("../dist/ai/toolCalling.js");

const SKILL_ROOT = path.resolve("skills/games/stella-sora");

test("Stella Sora skill package preserves manifest, compatibility status, and upstream MIT license", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, "manifest.json"), "utf-8"));
  const compat = JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, "compatibility.json"), "utf-8"));
  const license = fs.readFileSync(path.join(SKILL_ROOT, "upstream", "LICENSE.upstream"), "utf-8");

  assert.equal(manifest.id, "stella-sora");
  assert.equal(manifest.safety.autoExecuteOnActivate, false);
  assert.equal(compat.platforms.steam_global.status, "pending-live-verification");
  assert.match(license, /MIT License/);
});

test("MaaBridge initializes Python MaaFw subprocess and verifies readiness", async () => {
  const bridge = new MaaBridge(SKILL_ROOT);
  try {
    const res = await bridge.checkReadiness();
    assert.equal(res.ok, true);
    assert.equal(res.data.maafwInstalled, true);
    assert.equal(res.data.resourcesPresent, true);
  } finally {
    await bridge.shutdown();
  }
});

test("parseStellaSoraCommand routes all natural-language activation & control intents", () => {
  assert.equal(parseStellaSoraCommand("Activate Stella Sora Skill.")?.type, "activate");
  assert.equal(parseStellaSoraCommand("Open Stella Sora and check whether the game is running.")?.type, "open_and_check");
  const daily = parseStellaSoraCommand("Run Stella Sora Daily and inspect active events.");
  assert.equal(daily?.type, "run_workflows");
  assert.ok(daily.workflowIds.includes("events"));
  assert.equal(parseStellaSoraCommand("Start Stella Sora Adaptive Mode.")?.type, "adaptive_mode");
  assert.equal(parseStellaSoraCommand("Pause Stella Sora Automation.")?.type, "pause");
  assert.equal(parseStellaSoraCommand("Stop Stella Sora Automation.")?.type, "stop");
  assert.equal(parseStellaSoraCommand("Show Stella Sora Progress.")?.type, "progress");
  assert.deepEqual(parseStellaSoraCommand("Test A Stella Sora"), { type: "probe_click", mode: "maa_win32" });
  assert.deepEqual(parseStellaSoraCommand("Test B Stella Sora"), { type: "probe_click", mode: "win32_sendinput" });
  assert.deepEqual(parseStellaSoraCommand("Test Input Stella Sora"), { type: "probe_click", mode: "both" });
});

test("StellaSoraEngineManager activates without auto-executing, refuses blind run when closed, and supports stop", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tm-stella-"));
  const stats = new ApplicationStatisticsStore(tmpDir);
  const skillStore = new SkillStore(tmpDir);
  const learning = new LearningEngine(skillStore);
  const manager = new StellaSoraEngineManager(SKILL_ROOT, {
    statisticsStore: stats,
    skillStore,
    learningEngine: learning,
  });

  try {
    const act = await handleStellaSoraCommand(manager, "Activate Stella Sora Skill.");
    assert.equal(act.status.phase, "activated");
    assert.equal(act.status.engineReady, true);
    assert.equal(act.status.currentWorkflow, null);

    // If game is not running, runWorkflows (with autoLaunch: false) must refuse safely rather than blind-clicking
    if (!act.status.gameState?.isRunning) {
      const runRes = await manager.runWorkflows(["daily-missions"], { autoLaunch: false });
      assert.equal(runRes.ok, false);
      assert.equal(runRes.status.taskState, "failed");
      assert.equal(runRes.status.progressPercent, 0);
      assert.match(runRes.report, /belum terinstal|belum berjalan|belum muncul|tidak dapat mengakses/i);
    }

    const paused = manager.pause();
    assert.equal(paused.phase, "activated"); // only transitions to paused while running

    const stopped = await manager.stop();
    assert.equal(stopped.phase, "stopped");
    assert.equal(stopped.taskState, "cancelled");
    assert.equal(desktopExecutionLock.isLocked(), false);
  } finally {
    await manager.shutdown();
    stats.close();
    skillStore.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("ToolRegistry registers stella_sora_command and stella_sora_status", () => {
  const manager = new StellaSoraEngineManager(SKILL_ROOT);
  const registry = createDefaultToolRegistry({
    getActiveWindowTitle: async () => "Desktop",
    openExternalUrl: async () => {},
    stellaSoraManager: manager,
  });
  assert.ok(registry.get("stella_sora_command"));
  assert.ok(registry.get("stella_sora_status"));
});

test("validatePipelineEntry verifies upstream Chinese entries and rejects invalid English aliases", () => {
  assert.equal(STELLA_PIPELINE_MAP.mailbox, "邮箱_入口");
  assert.equal(STELLA_PIPELINE_MAP["daily-missions"], "任务_入口");
  assert.equal(STELLA_PIPELINE_MAP.dispatch, "委托_入口");
  assert.equal(STELLA_PIPELINE_MAP.grant, "基金_入口");
  for (const wfId of STELLA_SORA_DAILY_SEQUENCE) {
    const entry = STELLA_PIPELINE_MAP[wfId];
    assert.ok(entry, `Missing entry for ${wfId}`);
    assert.equal(validatePipelineEntry(SKILL_ROOT, entry).valid, true, `Upstream entry missing: ${entry}`);
  }

  const bad = validatePipelineEntry(SKILL_ROOT, "Mail");
  assert.equal(bad.valid, false);
  assert.match(bad.error || "", /does not exist/i);
});

test("validatePecutModelId accepts verified Sonnet IDs and rejects invalid ID", () => {
  const available = ["pecut/claude-sonnet-4-6", "pecut/claude-sonnet-5", "pecut/claude-sonnet-5.5"];
  assert.equal(validatePecutModelId("pecut/claude-sonnet-4-6", available).valid, true);
  const invalid = validatePecutModelId("pecut/claude-sonnet-4", available);
  assert.equal(invalid.valid, false);
  assert.match(invalid.error || "", /not listed/i);
});

test("StellaSoraReportGenerator outputs Bahasa Indonesia without Hindi/Devanagari drift", () => {
  const reporter = new StellaSoraReportGenerator();
  const emptyMsg = reporter.buildSessionSummary([]);
  assert.match(emptyMsg, /Belum ada eksekusi/i);
  assert.equal(/[\u0900-\u097F]/.test(emptyMsg), false);

  const summary = reporter.buildSessionSummary([
    { workflowId: "mailbox", verified: true, evidence: "Verified mailbox on Stella Sora", timestamp: Date.now() },
  ]);
  assert.match(summary, /Laporan Stella Sora: 1 terverifikasi/i);
  assert.equal(/[\u0900-\u097F]/.test(summary), false);
});
