import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DesktopObserver } from "../dist/agent/observer.js";
import { ActionVerifier } from "../dist/agent/verifier.js";
import { RecoveryManager } from "../dist/agent/recovery.js";
import { MemoryStore } from "../dist/memory/memoryStore.js";
import { AuditLog } from "../dist/safety/auditLog.js";
import { ApplicationManager } from "../dist/applications/applicationManager.js";
import { AgentRuntime } from "../dist/agent/agentRuntime.js";
import { createDefaultToolRegistry } from "../dist/tools/registry.js";
import { eventBus } from "../dist/core/eventBus.js";

test("DesktopObserver and ActionVerifier distinguish requested, executed, observed, and verified", async () => {
  let title = "Chrome";
  const observer = new DesktopObserver(async () => title);
  const before = await observer.captureSnapshot();
  title = "Microsoft Word";
  const after = await observer.captureSnapshot();
  const diff = observer.compare(before, after);

  assert.equal(diff.activeWindowChanged, true);
  assert.equal(diff.previousWindow, "Chrome");
  assert.equal(diff.currentWindow, "Microsoft Word");

  const verifier = new ActionVerifier();
  const rec = verifier.verifyOutcome(
    { success: true, output: {}, evidence: "Opened Word" },
    { verified: true, evidence: "Word window visible" },
    before,
    after,
    diff
  );
  assert.equal(rec.requested, true);
  assert.equal(rec.executed, true);
  assert.equal(rec.observed, true);
  assert.equal(rec.verified, true);
  assert.match(rec.evidence, /Window changed/);
});

test("RecoveryManager skips blind retry for send tools", async () => {
  const observer = new DesktopObserver(async () => "Discord");
  const recovery = new RecoveryManager(observer);
  const res = await recovery.attemptRecovery("send_external_message", {}, "timeout");
  assert.equal(res.recovered, false);
  assert.equal(res.shouldReplan, true);
  assert.match(res.note, /Skipped blind retry/);
});

test("MemoryStore persists and reloads AgentTask in SQLite", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opera-sqlite-"));
  const store = new MemoryStore(tmpDir);
  try {
    store.saveTask({
      id: "task_123",
      goal: "Test SQLite persistence",
      status: "completed",
      planSummary: ["Step 1"],
      steps: [],
      currentStep: 1,
      createdAt: 1000,
      updatedAt: 2000,
      context: { outputFiles: [] },
      finalReport: "Done",
    });
    store.recordStepHistory("task_123", "step_1", "get_current_time", "completed", "06:00");

    const loaded = store.loadTasks(5);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, "task_123");
    assert.equal(loaded[0].finalReport, "Done");
  } finally {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("AuditLog supports file move journaling and undo", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opera-undo-"));
  try {
    const orig = path.join(tmpDir, "test.txt");
    const sub = path.join(tmpDir, "Dokumen");
    const moved = path.join(sub, "test.txt");
    fs.mkdirSync(sub);
    fs.writeFileSync(orig, "hello");
    fs.renameSync(orig, moved);

    const audit = new AuditLog();
    audit.recordFileMove({
      originalPath: orig,
      newPath: moved,
      timestamp: Date.now(),
      success: true,
      reversible: true,
    });

    const undone = audit.undoLastFileBatch(1);
    assert.equal(undone.undone, 1);
    assert.equal(fs.existsSync(orig), true);
    assert.equal(fs.existsSync(moved), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("ApplicationManager resolves specialized adapters and Universal fallback", () => {
  const mgr = new ApplicationManager();
  assert.equal(mgr.resolveAdapter("Discord").id, "discord");
  assert.equal(mgr.resolveAdapter("WhatsApp Web").id, "whatsapp");
  assert.equal(mgr.resolveAdapter("Google Chrome").id, "chrome");
  assert.equal(mgr.resolveAdapter("Microsoft Word").id, "word");
  assert.equal(mgr.resolveAdapter("Notepad").id, "universal");
});

test("AgentRuntime requires user approval for confirm-level tools and rejects when denied", async () => {
  const registry = createDefaultToolRegistry({
    getActiveWindowTitle: async () => "Discord",
    openExternalUrl: async () => {},
  });

  let executed = false;
  registry.register({
    name: "send_external_message",
    description: "Mock approval-gated send",
    permissionLevel: "confirm",
    parameterSchema: {
      type: "object",
      required: ["app", "recipient", "message"],
      properties: {
        app: { type: "string", description: "app" },
        recipient: { type: "string", description: "recipient" },
        message: { type: "string", description: "message" },
      },
      additionalProperties: false,
    },
    async execute() {
      executed = true;
      return { success: true, output: null, evidence: "Sent" };
    },
  });

  let calls = 0;
  const mockModel = {
    async complete() {
      calls++;
      if (calls === 1) {
        return JSON.stringify({
          thought: "Send message after approval",
          action: {
            tool: "send_external_message",
            arguments: { app: "discord", recipient: "#general", message: "Hi!" },
          },
        });
      }
      return JSON.stringify({ finalAnswer: "Aborted" });
    },
  };

  const runtime = new AgentRuntime(mockModel, registry);
  const unsub = eventBus.on("task:approval-needed", () => {
    setTimeout(() => runtime.taskManager.resolveApproval(false), 30);
  });

  const task = await runtime.runObjective("Send hi on Discord");
  unsub();

  assert.equal(executed, false);
  assert.equal(task.status, "cancelled");
});
