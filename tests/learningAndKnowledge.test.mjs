import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ExecutionLock } = require("../dist/agent/executionLock.js");
const { InteractionRouter } = require("../dist/computerUse/interactionRouter.js");
const { SkillStore } = require("../dist/learning/skillStore.js");
const { LearningEngine } = require("../dist/learning/learningEngine.js");
const { ApplicationKnowledgeStore } = require("../dist/applications/applicationKnowledge.js");
const { ApplicationStatisticsStore } = require("../dist/applications/applicationStatistics.js");
const { createDefaultToolRegistry } = require("../dist/tools/registry.js");

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("ExecutionLock enforces single active desktop task lock", () => {
  const lock = new ExecutionLock();
  assert.equal(lock.acquire("task-1").ok, true);
  assert.equal(lock.isLocked(), true);

  const conflict = lock.acquire("task-2");
  assert.equal(conflict.ok, false);
  assert.equal(conflict.holder, "task-1");

  assert.equal(lock.release("task-2"), false);
  assert.equal(lock.release("task-1"), true);
  assert.equal(lock.isLocked(), false);
  assert.equal(lock.acquire("task-2").ok, true);
});

test("InteractionRouter selects highest-priority method per application", () => {
  const router = new InteractionRouter();
  assert.equal(router.selectMethod({ applicationId: "Microsoft Word" }).method, "office_com");
  assert.equal(router.selectMethod({ applicationId: "Spotify" }).method, "native_api");
  assert.equal(router.selectMethod({ applicationId: "WhatsApp Web" }).method, "browser_dom");
  assert.equal(router.selectMethod({ applicationId: "Stella Sora" }).method, "windows_uia");
});

test("LearningEngine & SkillStore support instruction, demonstration, approval gate, and adaptive versioning", async () => {
  const dir = makeTempDir("tm-learn-");
  const store = new SkillStore(dir);
  const engine = new LearningEngine(store);
  try {
    // 1. Instruction-based learning creates draft
    const draft = await engine.learnFromInstruction(
      "stella-sora",
      "daily-routine",
      "Open Stella Sora, then close any event popup, then claim daily rewards."
    );
    assert.equal(draft.status, "draft");
    assert.equal(draft.version, 1);
    assert.ok(draft.steps.length >= 2);

    // 2. Approve skill
    const approved = store.approve(draft.id);
    assert.equal(approved.status, "approved");

    // 3. Adaptive update must NOT overwrite approved steps until reviewed
    const originalStepCount = approved.steps.length;
    const proposed = engine.proposeAdaptiveUpdate(draft.id, "New event popup button", [
      {
        description: "Dismiss new winter event popup",
        preferredMethod: "windows_uia",
        expectedResult: "Popup closed",
        verificationCondition: "Main menu visible",
      },
    ]);
    assert.equal(proposed.status, "needs-review");
    assert.equal(proposed.steps.length, originalStepCount);
    assert.equal(proposed.pendingProposal.steps.length, 1);

    // 4. Approve adaptive update -> v2
    const v2 = store.approve(draft.id);
    assert.equal(v2.status, "approved");
    assert.equal(v2.version, 2);
    assert.equal(v2.steps.length, 1);
    assert.ok(store.getVersionHistory(draft.id).length >= 3);

    // 5. Demonstration recorder
    engine.recorder.start("discord", "check-channel");
    engine.recorder.recordAction({
      windowTitle: "Discord",
      actionType: "click",
      targetName: "#general",
    });
    const demoSkill = engine.recorder.stopAndPropose(store);
    assert.equal(demoSkill.status, "draft");
    assert.equal(demoSkill.applicationId, "discord");
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ApplicationKnowledgeStore supports contextual retrieval, expiry, and archiving", () => {
  const dir = makeTempDir("tm-know-");
  const ks = new ApplicationKnowledgeStore(dir);
  try {
    const now = Date.now();
    const active = ks.add({
      applicationId: "stella-sora",
      category: "event",
      title: "Spring Event",
      content: "Double drop until Sunday",
      expiryDate: now + 60_000,
    });
    ks.add({
      applicationId: "stella-sora",
      category: "maintenance",
      title: "Old Maint",
      content: "Expired notice",
      expiryDate: now - 10_000,
    });
    ks.add({
      applicationId: "discord",
      category: "personal-note",
      title: "Server",
      content: "Check announcements",
    });

    const relevant = ks.getRelevant("stella-sora", now);
    assert.equal(relevant.length, 1);
    assert.equal(relevant[0].id, active.id);

    assert.equal(ks.updateStatus(active.id, "archived"), true);
    assert.equal(ks.getRelevant("stella-sora", now).length, 0);
  } finally {
    ks.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ApplicationStatisticsStore tracks verified sessions, summaries, and corrections", () => {
  const dir = makeTempDir("tm-stats-");
  const stats = new ApplicationStatisticsStore(dir);
  try {
    const s = stats.startSession("stella-sora", "Daily Routine");
    stats.finishSession(s.id, {
      status: "partial",
      completedActivities: ["Login", "Daily Quest 1"],
      pendingActivities: ["Event Stage"],
      verifiedResults: ["Login verified"],
    });
    stats.correctSession(s.id, { status: "completed", pendingActivities: [] });

    const summary = stats.getSummary("stella-sora");
    assert.equal(summary.totalSessions, 1);
    assert.equal(summary.completedSessions, 1);
    assert.equal(summary.recentVerifiedResults[0], "Login verified");
  } finally {
    stats.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ToolRegistry registers learning, knowledge, and stats tools with confirm gate on skill_approve", async () => {
  const dir = makeTempDir("tm-reg-learn-");
  const skillStore = new SkillStore(dir);
  const learningEngine = new LearningEngine(skillStore);
  const knowledgeStore = new ApplicationKnowledgeStore(dir);
  const statisticsStore = new ApplicationStatisticsStore(dir);
  try {
    const registry = createDefaultToolRegistry({
      getActiveWindowTitle: async () => "Desktop",
      openExternalUrl: async () => {},
      skillStore,
      learningEngine,
      knowledgeStore,
      statisticsStore,
    });

    const approveTool = registry.get("skill_approve");
    assert.ok(approveTool);
    assert.equal(approveTool.permissionLevel, "confirm");

    const learnRes = await registry.get("skill_learn_instruction").execute({
      applicationId: "stella-sora",
      name: "event-check",
      instruction: "Open event tab, then read reward status",
    });
    assert.equal(learnRes.success, true);

    const kRes = await registry.get("knowledge_add").execute({
      applicationId: "stella-sora",
      category: "reminder",
      title: "Claim shop",
      content: "Event shop closes Friday",
    });
    assert.equal(kRes.success, true);

    const qRes = await registry.get("knowledge_query").execute({ applicationId: "stella-sora" });
    assert.equal(qRes.success, true);
    assert.equal(qRes.output.length, 1);
  } finally {
    skillStore.close();
    knowledgeStore.close();
    statisticsStore.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
