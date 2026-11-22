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

    // If game is not running, runWorkflows must refuse safely rather than blind-clicking
    if (!act.status.gameState?.isRunning) {
      const runRes = await manager.runWorkflows(["daily-missions"]);
      assert.equal(runRes.ok, false);
      assert.match(runRes.report, /not installed|not currently running/i);
    }

    const stopped = await manager.stop();
    assert.equal(stopped.phase, "stopped");
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
