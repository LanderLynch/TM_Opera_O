import test from "node:test";
import assert from "node:assert/strict";

import { evaluateToolPermission } from "../dist/tools/permissions.js";
import { guardScreenCoordinates, isProtectedPath } from "../dist/safety/actionGuard.js";
import { sendShortcut } from "../dist/desktop/keyboard.js";
import { listOpenWindows } from "../dist/desktop/windowManager.js";
import { createDefaultToolRegistry } from "../dist/tools/registry.js";

test("evaluateToolPermission enforces confirmation on sensitive tools", () => {
  const auto = evaluateToolPermission("list_open_windows", "autonomous");
  assert.equal(auto.allowed, true);
  assert.equal(auto.requiresApproval, false);

  const confirm = evaluateToolPermission("send_external_message", "autonomous");
  assert.equal(confirm.requiresApproval, true);
});

test("actionGuard protects Windows system directories and out-of-bounds coordinates", () => {
  assert.equal(isProtectedPath("C:\\Windows\\System32\\cmd.exe"), true);
  assert.equal(isProtectedPath("C:\\Users\\Jona\\Downloads\\test.txt"), false);

  assert.equal(guardScreenCoordinates(500, 300).ok, true);
  assert.equal(guardScreenCoordinates(99999, 100).ok, false);
});

test("sendShortcut rejects arbitrary/unsafe shortcut strings", async () => {
  const res = await sendShortcut("win+r");
  assert.equal(res.ok, false);
  assert.match(res.error || "", /not in the allowed/);
});

test("listOpenWindows enumerates Windows desktop windows without crashing", async () => {
  const wins = await listOpenWindows();
  assert.equal(Array.isArray(wins), true);
});

test("ToolRegistry registers all Milestone 2 hybrid desktop control tools", () => {
  const reg = createDefaultToolRegistry({
    getActiveWindowTitle: async () => "Test",
    openExternalUrl: async () => {},
  });
  for (const name of [
    "list_open_windows",
    "focus_window",
    "inspect_ui_tree",
    "ui_click_element",
    "mouse_click",
    "mouse_scroll",
    "keyboard_type",
    "keyboard_shortcut",
  ]) {
    assert.ok(reg.get(name), `Expected tool ${name} to be registered`);
  }
});
