import test from "node:test";
import assert from "node:assert/strict";

import { validateToolArguments } from "../dist/tools/validation.js";
import { createDefaultToolRegistry } from "../dist/tools/registry.js";
import { AgentRuntime } from "../dist/agent/agentRuntime.js";
import { parseStructuredTurn } from "../dist/ai/toolCalling.js";

test("validateToolArguments rejects missing required and unknown fields", () => {
  const schema = {
    type: "object",
    required: ["query"],
    properties: {
      query: { type: "string", minLength: 2, description: "Search query" },
    },
    additionalProperties: false,
  };

  assert.throws(() => validateToolArguments("search", schema, {}), /Missing required argument/);
  assert.throws(() => validateToolArguments("search", schema, { query: "a" }), /at least 2/);
  assert.throws(
    () => validateToolArguments("search", schema, { query: "ok", extra: 1 }),
    /Unexpected argument/
  );
  const valid = validateToolArguments("search", schema, { query: "hello" });
  assert.deepEqual(valid, { query: "hello" });
});

test("parseStructuredTurn extracts action and finalAnswer from JSON or fenced code", () => {
  const turn1 = parseStructuredTurn(
    '```json\n{"thought":"Check time","plan":["Get time"],"action":{"tool":"get_current_time","arguments":{}}}\n```'
  );
  assert.equal(turn1?.action?.tool, "get_current_time");

  const turn2 = parseStructuredTurn('{"thought":"Done","finalAnswer":"It is 06:00"}');
  assert.equal(turn2?.finalAnswer, "It is 06:00");
});

test("AgentRuntime completes multi-step plan -> execute -> observe -> verify loop", async () => {
  const registry = createDefaultToolRegistry({
    getActiveWindowTitle: async () => "Visual Studio Code",
    openExternalUrl: async () => {},
  });

  let callCount = 0;
  const mockModel = {
    async complete(_sys, _user) {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          thought: "First check the active window.",
          plan: ["Observe active window", "Report back"],
          action: { tool: "get_active_window", arguments: {} },
        });
      }
      if (callCount === 2) {
        return JSON.stringify({
          thought: "Now check current time.",
          action: { tool: "get_current_time", arguments: {} },
        });
      }
      return JSON.stringify({
        thought: "Both observed and verified.",
        finalAnswer: "Active window is Visual Studio Code and time was checked.",
      });
    },
  };

  const runtime = new AgentRuntime(mockModel, registry, {
    observeWindowFn: async () => "Visual Studio Code",
  });

  const task = await runtime.runObjective("Check my active window and time");
  assert.equal(task.status, "completed");
  assert.equal(task.steps.length, 2);
  assert.equal(task.steps[0].status, "completed");
  assert.equal(task.steps[1].status, "completed");
  assert.match(task.finalReport || "", /Visual Studio Code/);
});

test("AgentRuntime stops immediately on emergencyStop", async () => {
  const registry = createDefaultToolRegistry({
    getActiveWindowTitle: async () => "Desktop",
    openExternalUrl: async () => {},
  });

  registry.register({
    name: "slow_tool",
    description: "Simulates a slow action",
    permissionLevel: "autonomous",
    timeoutMs: 10_000,
    parameterSchema: { type: "object", properties: {}, additionalProperties: false },
    async execute(_args, ctx) {
      await new Promise((resolve) => {
        ctx.signal.addEventListener("abort", resolve, { once: true });
      });
      return { success: false, output: null, evidence: "Aborted" };
    },
  });

  const mockModel = {
    async complete() {
      return JSON.stringify({
        thought: "Run slow tool",
        action: { tool: "slow_tool", arguments: {} },
      });
    },
  };

  const runtime = new AgentRuntime(mockModel, registry);
  const runPromise = runtime.runObjective("Test emergency stop");
  await new Promise((r) => setTimeout(r, 80));
  const stopped = runtime.taskManager.emergencyStop();
  assert.equal(stopped, true);

  const task = await runPromise;
  assert.equal(task.status, "cancelled");
  assert.equal(runtime.taskManager.hasActiveTask(), false);
});
