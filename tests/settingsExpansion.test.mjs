import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SettingsStore } from "../dist/settings/settingsStore.js";
import {
  checkPrivacyToolAccess,
  getProviderStatuses,
  isReminderSuppressed,
} from "../dist/settings/settingsRuntime.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tm-opera-settings-"));
}

test("SettingsStore persists updates atomically across reload", () => {
  const dir = makeTempDir();
  const file = path.join(dir, "settings.json");

  const store1 = new SettingsStore(file);
  store1.update({
    ai: { fallbackModel: "pecut/claude-sonnet-5", timeoutMs: 30000, retryLimit: 3 },
    privacy: { allowScreenshots: false },
    reminder: { excludedApps: ["VALORANT", "StellaSora_steam"] },
  });

  const store2 = new SettingsStore(file);
  const loaded = store2.get();
  assert.equal(loaded.schemaVersion, 2);
  assert.equal(loaded.ai.fallbackModel, "pecut/claude-sonnet-5");
  assert.equal(loaded.ai.timeoutMs, 30000);
  assert.equal(loaded.ai.retryLimit, 3);
  assert.equal(loaded.privacy.allowScreenshots, false);
  assert.deepEqual(loaded.reminder.excludedApps, ["VALORANT", "StellaSora_steam"]);
});

test("SettingsStore migrates v1 settings.json to v2 and creates v1 backup", () => {
  const dir = makeTempDir();
  const file = path.join(dir, "settings.json");
  const v1 = {
    colorAlbumFocus: false,
    customAccentColor: "#6366f1",
    mediaPriority: "youtube",
    compactLyric: false,
    lyricOffsetSec: 1.5,
    personaPreset: "tsundere",
    customPersona: "Panggil kapten",
    reminderEnabled: false,
    reminderMinutes: 60,
    focusModeEnabled: false,
  };
  fs.writeFileSync(file, JSON.stringify(v1, null, 2), "utf-8");

  const store = new SettingsStore(file);
  assert.equal(store.wasMigratedFromV1(), true);
  assert.equal(fs.existsSync(path.join(dir, "settings.v1.bak.json")), true);

  const v2 = store.get();
  assert.equal(v2.schemaVersion, 2);
  assert.equal(v2.media.colorAlbumFocus, false);
  assert.equal(v2.media.customAccentColor, "#6366f1");
  assert.equal(v2.media.mediaPriority, "youtube");
  assert.equal(v2.media.lyricOffsetSec, 1.5);
  assert.equal(v2.opera.personaPreset, "tsundere");
  assert.equal(v2.opera.customPersona, "Panggil kapten");
  assert.equal(v2.reminder.reminderEnabled, false);
  assert.equal(v2.reminder.reminderMinutes, 60);
});

test("SettingsStore importConfig rejects malformed JSON and unknown keys", () => {
  const dir = makeTempDir();
  const store = new SettingsStore(path.join(dir, "settings.json"));

  const badJson = store.importConfig("{not-json");
  assert.equal(badJson.ok, false);

  const badUnknown = store.importConfig(JSON.stringify({ settings: { unknownKey: { a: 1 } } }));
  assert.equal(badUnknown.ok, false);

  const badType = store.importConfig(JSON.stringify({ settings: { ai: "not-an-object" } }));
  assert.equal(badType.ok, false);
});

test("SettingsStore resetSection resets only target section", () => {
  const dir = makeTempDir();
  const store = new SettingsStore(path.join(dir, "settings.json"));
  store.update({
    media: { customAccentColor: "#10b981" },
    ai: { timeoutMs: 90000, retryLimit: 5 },
  });

  const afterReset = store.resetSection("ai");
  assert.equal(afterReset.ai.timeoutMs, 45000);
  assert.equal(afterReset.ai.retryLimit, 2);
  assert.equal(afterReset.media.customAccentColor, "#10b981");
});

test("Exported config and provider statuses never leak plaintext API keys", () => {
  const prevDeepseek = process.env.DEEPSEEK_API_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;
  process.env.DEEPSEEK_API_KEY = "sk-secret-test-deepseek";
  process.env.GEMINI_API_KEY = "AIza-secret-test-gemini";
  try {
    const dir = makeTempDir();
    const store = new SettingsStore(path.join(dir, "settings.json"));
    const exported = store.exportConfig();
    assert.equal(exported.includes("sk-secret-test-deepseek"), false);
    assert.equal(exported.includes("AIza-secret-test-gemini"), false);

    const statuses = getProviderStatuses("http://localhost:11434/api/chat");
    const serialized = JSON.stringify(statuses);
    assert.equal(serialized.includes("sk-secret-test-deepseek"), false);
    assert.equal(serialized.includes("AIza-secret-test-gemini"), false);
    assert.equal(statuses.find((s) => s.id === "pecut")?.configured, true);
    assert.equal(statuses.find((s) => s.id === "gemini")?.configured, true);
  } finally {
    if (prevDeepseek === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prevDeepseek;
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
  }
});

test("Runtime privacy gate and reminder suppression enforce settings", () => {
  const paused = checkPrivacyToolAccess("capture_screen", {
    allowScreenshots: true,
    allowClipboard: true,
    allowFilesystem: true,
    allowAppControl: true,
    allowBrowser: true,
    requireSensitiveConfirm: true,
    pausedGlobally: true,
  });
  assert.equal(paused.allowed, false);

  const noScreen = checkPrivacyToolAccess("capture_screen", {
    allowScreenshots: false,
    allowClipboard: true,
    allowFilesystem: true,
    allowAppControl: true,
    allowBrowser: true,
    requireSensitiveConfirm: true,
    pausedGlobally: false,
  });
  assert.equal(noScreen.allowed, false);

  const remCfg = {
    reminderEnabled: true,
    reminderMinutes: 120,
    focusModeEnabled: true,
    activeHoursStart: "09:00",
    activeHoursEnd: "18:00",
    snoozeMinutes: 15,
    excludedApps: ["StellaSora_steam"],
  };
  const quiet = isReminderSuppressed(new Date("2026-01-01T22:00:00"), "Notepad", remCfg);
  assert.equal(quiet.suppressed, true);

  const excluded = isReminderSuppressed(new Date("2026-01-01T12:00:00"), "StellaSora_steam.exe", remCfg);
  assert.equal(excluded.suppressed, true);

  const active = isReminderSuppressed(new Date("2026-01-01T12:00:00"), "Visual Studio Code", remCfg);
  assert.equal(active.suppressed, false);
});
