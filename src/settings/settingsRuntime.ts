import * as fs from "fs";
import * as path from "path";
import { PrivacySettings, ReminderSettings } from "./settingsSchema";

const SCREENSHOT_TOOLS = new Set(["capture_screen", "lihat_layar"]);
const CLIPBOARD_TOOLS = new Set(["read_clipboard", "write_clipboard"]);
const FILESYSTEM_TOOLS = new Set([
  "list_files",
  "read_file",
  "write_file",
  "delete_file",
  "move_file",
  "execute_folder_organization",
  "organize_downloads",
]);
const APP_CONTROL_TOOLS = new Set([
  "launch_app",
  "focus_window",
  "click_at",
  "type_text",
  "press_key",
  "scroll_at",
  "stella_sora_command",
  "run_skill",
]);
const BROWSER_TOOLS = new Set(["open_url", "search_web", "browser_navigate"]);

export function checkPrivacyToolAccess(
  toolName: string,
  privacy: PrivacySettings
): { allowed: boolean; reason?: string } {
  if (privacy.pausedGlobally) {
    return { allowed: false, reason: "Automation & tool execution is paused globally in Privacy & Permissions." };
  }
  if (SCREENSHOT_TOOLS.has(toolName) && !privacy.allowScreenshots) {
    return { allowed: false, reason: "Screen capture is disabled in Privacy & Permissions." };
  }
  if (CLIPBOARD_TOOLS.has(toolName) && !privacy.allowClipboard) {
    return { allowed: false, reason: "Clipboard access is disabled in Privacy & Permissions." };
  }
  if (FILESYSTEM_TOOLS.has(toolName) && !privacy.allowFilesystem) {
    return { allowed: false, reason: "Filesystem tools are disabled in Privacy & Permissions." };
  }
  if (APP_CONTROL_TOOLS.has(toolName) && !privacy.allowAppControl) {
    return { allowed: false, reason: "Application control is disabled in Privacy & Permissions." };
  }
  if (BROWSER_TOOLS.has(toolName) && !privacy.allowBrowser) {
    return { allowed: false, reason: "Browser & web tools are disabled in Privacy & Permissions." };
  }
  return { allowed: true };
}

function parseMinutesOfDay(hhmm: string): number {
  const parts = hhmm.split(":");
  if (parts.length !== 2) return 0;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

export function isReminderSuppressed(
  now: Date,
  activeWindowTitle: string,
  reminder: ReminderSettings
): { suppressed: boolean; reason?: string } {
  if (!reminder.reminderEnabled) {
    return { suppressed: true, reason: "Reminders disabled" };
  }
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const startMin = parseMinutesOfDay(reminder.activeHoursStart);
  const endMin = parseMinutesOfDay(reminder.activeHoursEnd);
  const inWindow =
    startMin <= endMin
      ? nowMin >= startMin && nowMin <= endMin
      : nowMin >= startMin || nowMin <= endMin;
  if (!inWindow) {
    return { suppressed: true, reason: `Outside active hours (${reminder.activeHoursStart}-${reminder.activeHoursEnd})` };
  }

  const lowerTitle = (activeWindowTitle || "").toLowerCase();
  if (lowerTitle && reminder.excludedApps.length > 0) {
    for (const app of reminder.excludedApps) {
      const token = app.trim().toLowerCase();
      if (token && lowerTitle.includes(token)) {
        return { suppressed: true, reason: `Active window matches excluded app "${app}"` };
      }
    }
  }
  return { suppressed: false };
}

function getPathSizeBytes(targetPath: string): number {
  try {
    if (!fs.existsSync(targetPath)) return 0;
    const stat = fs.statSync(targetPath);
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) return 0;
    let total = 0;
    for (const entry of fs.readdirSync(targetPath)) {
      total += getPathSizeBytes(path.join(targetPath, entry));
    }
    return total;
  } catch {
    return 0;
  }
}

export interface StorageBreakdown {
  settingsBytes: number;
  memoryBytes: number;
  shelfBytes: number;
  skillsBytes: number;
  logsBytes: number;
  cacheBytes: number;
  totalBytes: number;
}

export function getStorageBreakdown(userDataDir: string, baseDir: string): StorageBreakdown {
  const settingsBytes = getPathSizeBytes(path.join(baseDir, "settings.json"));
  const memoryBytes = getPathSizeBytes(path.join(baseDir, "memory.json"));
  const shelfBytes = getPathSizeBytes(path.join(userDataDir, "shelf"));
  const skillsBytes =
    getPathSizeBytes(path.join(userDataDir, "skills.json")) +
    getPathSizeBytes(path.join(userDataDir, "app-knowledge.json")) +
    getPathSizeBytes(path.join(userDataDir, "app-stats.json"));
  const logsBytes =
    getPathSizeBytes(path.join(baseDir, "logs")) +
    getPathSizeBytes(path.join(userDataDir, "logs"));
  const cacheBytes =
    getPathSizeBytes(path.join(userDataDir, "Cache")) +
    getPathSizeBytes(path.join(userDataDir, "Code Cache")) +
    getPathSizeBytes(path.join(baseDir, "tmp"));

  const totalBytes = settingsBytes + memoryBytes + shelfBytes + skillsBytes + logsBytes + cacheBytes;
  return { settingsBytes, memoryBytes, shelfBytes, skillsBytes, logsBytes, cacheBytes, totalBytes };
}

export function clearSafeCache(userDataDir: string, baseDir: string): { clearedBytes: number } {
  const targets = [
    path.join(userDataDir, "Cache"),
    path.join(userDataDir, "Code Cache"),
    path.join(baseDir, "tmp"),
  ];
  let clearedBytes = 0;
  for (const dir of targets) {
    if (!fs.existsSync(dir)) continue;
    clearedBytes += getPathSizeBytes(dir);
    try {
      for (const entry of fs.readdirSync(dir)) {
        fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
      }
    } catch {}
  }
  return { clearedBytes };
}

export function clearSafeLogs(userDataDir: string, baseDir: string): { clearedBytes: number } {
  const targets = [path.join(baseDir, "logs"), path.join(userDataDir, "logs")];
  let clearedBytes = 0;
  for (const dir of targets) {
    if (!fs.existsSync(dir)) continue;
    clearedBytes += getPathSizeBytes(dir);
    try {
      for (const entry of fs.readdirSync(dir)) {
        fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
      }
    } catch {}
  }
  return { clearedBytes };
}

export interface ProviderStatusInfo {
  id: "pecut" | "gemini" | "elevenlabs" | "ollama";
  label: string;
  configured: boolean;
  endpoint: string;
}

export function getProviderStatuses(ollamaUrl: string): ProviderStatusInfo[] {
  return [
    {
      id: "pecut",
      label: "Pecut / DeepSeek API",
      configured: Boolean(process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY.trim().length > 0),
      endpoint: "https://api.pecutopus.web.id/v1",
    },
    {
      id: "gemini",
      label: "Google Gemini API",
      configured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0),
      endpoint: "https://generativelanguage.googleapis.com",
    },
    {
      id: "elevenlabs",
      label: "ElevenLabs TTS",
      configured: Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY.trim().length > 0),
      endpoint: "https://api.elevenlabs.io",
    },
    {
      id: "ollama",
      label: "Ollama Local",
      configured: Boolean(ollamaUrl && ollamaUrl.trim().length > 0),
      endpoint: ollamaUrl || "http://localhost:11434/api/chat",
    },
  ];
}
