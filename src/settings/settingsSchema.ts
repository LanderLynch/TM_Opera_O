export const SETTINGS_SCHEMA_VERSION = 2;

export type MediaPriority = "spotify" | "youtube" | "any";
export type PersonaPreset = "soft" | "hype" | "calm" | "tsundere";
export type PerformanceMode = "balanced" | "low-resource";

export type SettingsSectionKey =
  | "media"
  | "opera"
  | "reminder"
  | "turbo"
  | "ai"
  | "automation"
  | "privacy"
  | "system";

export interface MediaSettings {
  colorAlbumFocus: boolean;
  customAccentColor: string;
  mediaPriority: MediaPriority;
  compactLyric: boolean;
  lyricOffsetSec: number;
}

export interface OperaPersonaSettings {
  personaPreset: PersonaPreset;
  customPersona: string;
  ttsEnabled: boolean;
  ttsVoice: string;
}

export interface ReminderSettings {
  reminderEnabled: boolean;
  reminderMinutes: number;
  focusModeEnabled: boolean;
  activeHoursStart: string; // "HH:MM"
  activeHoursEnd: string;   // "HH:MM"
  snoozeMinutes: number;
  excludedApps: string[];
}

export interface TurboControlSettings {
  downloadsTargetDir: string;
  confirmFileOps: boolean;
}

export interface AiSettings {
  fallbackModel: string;
  timeoutMs: number;
  retryLimit: number;
  streaming: boolean;
  tokenBudget: number;
  warningThresholdPct: number;
  ollamaUrl: string;
}

export interface AutomationSettings {
  retryLimit: number;
  timeoutMs: number;
  maxSteps: number;
  requireApprovalForSkills: boolean;
  recorderEnabled: boolean;
}

export interface PrivacySettings {
  allowScreenshots: boolean;
  allowClipboard: boolean;
  allowFilesystem: boolean;
  allowAppControl: boolean;
  allowBrowser: boolean;
  requireSensitiveConfirm: boolean;
  pausedGlobally: boolean;
}

export interface SystemSettings {
  startWithWindows: boolean;
  startMinimized: boolean;
  runInBackground: boolean;
  closeToTray: boolean;
  performanceMode: PerformanceMode;
}

export interface SettingsV2 {
  schemaVersion: number;
  media: MediaSettings;
  opera: OperaPersonaSettings;
  reminder: ReminderSettings;
  turbo: TurboControlSettings;
  ai: AiSettings;
  automation: AutomationSettings;
  privacy: PrivacySettings;
  system: SystemSettings;
}

/** Legacy flat settings shape preserved for window.pywebview.api.get_settings / save_settings */
export interface LegacyAppSettings {
  colorAlbumFocus: boolean;
  customAccentColor: string;
  mediaPriority: MediaPriority;
  compactLyric: boolean;
  lyricOffsetSec: number;
  personaPreset: PersonaPreset;
  customPersona: string;
  reminderEnabled: boolean;
  reminderMinutes: number;
  focusModeEnabled: boolean;
}

export type PartialSettingsPatch = {
  [K in SettingsSectionKey]?: Partial<SettingsV2[K]>;
};

export function createDefaultSettings(): SettingsV2 {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    media: {
      colorAlbumFocus: true,
      customAccentColor: "#f472b6",
      mediaPriority: "spotify",
      compactLyric: true,
      lyricOffsetSec: 0,
    },
    opera: {
      personaPreset: "soft",
      customPersona: "",
      ttsEnabled: false,
      ttsVoice: "auto",
    },
    reminder: {
      reminderEnabled: true,
      reminderMinutes: 120,
      focusModeEnabled: true,
      activeHoursStart: "08:00",
      activeHoursEnd: "23:00",
      snoozeMinutes: 15,
      excludedApps: [],
    },
    turbo: {
      downloadsTargetDir: "",
      confirmFileOps: true,
    },
    ai: {
      fallbackModel: "gemini-2.5-flash",
      timeoutMs: 45000,
      retryLimit: 2,
      streaming: false,
      tokenBudget: 0,
      warningThresholdPct: 80,
      ollamaUrl: "http://localhost:11434/api/chat",
    },
    automation: {
      retryLimit: 2,
      timeoutMs: 60000,
      maxSteps: 18,
      requireApprovalForSkills: true,
      recorderEnabled: true,
    },
    privacy: {
      allowScreenshots: true,
      allowClipboard: true,
      allowFilesystem: true,
      allowAppControl: true,
      allowBrowser: true,
      requireSensitiveConfirm: true,
      pausedGlobally: false,
    },
    system: {
      startWithWindows: false,
      startMinimized: false,
      runInBackground: true,
      closeToTray: true,
      performanceMode: "balanced",
    },
  };
}

const VALID_MEDIA_PRIORITY = new Set<MediaPriority>(["spotify", "youtube", "any"]);
const VALID_PERSONA = new Set<PersonaPreset>(["soft", "hype", "calm", "tsundere"]);
const VALID_PERF = new Set<PerformanceMode>(["balanced", "low-resource"]);
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function clampNum(val: unknown, fallback: number, min: number, max: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function asBool(val: unknown, fallback: boolean): boolean {
  return typeof val === "boolean" ? val : fallback;
}

function asStr(val: unknown, fallback: string, maxLen = 2000): string {
  return typeof val === "string" ? val.slice(0, maxLen) : fallback;
}

/**
 * Normalizes and validates any partial/raw SettingsV2 structure against defaults.
 */
export function normalizeSettingsV2(raw: unknown): SettingsV2 {
  const def = createDefaultSettings();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return def;
  }
  const src = raw as Record<string, unknown>;
  const m = (src.media && typeof src.media === "object" ? src.media : {}) as Record<string, unknown>;
  const o = (src.opera && typeof src.opera === "object" ? src.opera : {}) as Record<string, unknown>;
  const r = (src.reminder && typeof src.reminder === "object" ? src.reminder : {}) as Record<string, unknown>;
  const t = (src.turbo && typeof src.turbo === "object" ? src.turbo : {}) as Record<string, unknown>;
  const a = (src.ai && typeof src.ai === "object" ? src.ai : {}) as Record<string, unknown>;
  const au = (src.automation && typeof src.automation === "object" ? src.automation : {}) as Record<string, unknown>;
  const p = (src.privacy && typeof src.privacy === "object" ? src.privacy : {}) as Record<string, unknown>;
  const s = (src.system && typeof src.system === "object" ? src.system : {}) as Record<string, unknown>;

  const accent = asStr(m.customAccentColor, def.media.customAccentColor, 16);
  const mediaPriority = VALID_MEDIA_PRIORITY.has(m.mediaPriority as MediaPriority)
    ? (m.mediaPriority as MediaPriority)
    : def.media.mediaPriority;
  const personaPreset = VALID_PERSONA.has(o.personaPreset as PersonaPreset)
    ? (o.personaPreset as PersonaPreset)
    : def.opera.personaPreset;
  const perfMode = VALID_PERF.has(s.performanceMode as PerformanceMode)
    ? (s.performanceMode as PerformanceMode)
    : def.system.performanceMode;

  const startStr = asStr(r.activeHoursStart, def.reminder.activeHoursStart, 8);
  const endStr = asStr(r.activeHoursEnd, def.reminder.activeHoursEnd, 8);
  const excludedApps = Array.isArray(r.excludedApps)
    ? r.excludedApps.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()).slice(0, 50)
    : def.reminder.excludedApps;

  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    media: {
      colorAlbumFocus: asBool(m.colorAlbumFocus, def.media.colorAlbumFocus),
      customAccentColor: HEX_COLOR_RE.test(accent) ? accent : def.media.customAccentColor,
      mediaPriority,
      compactLyric: asBool(m.compactLyric, def.media.compactLyric),
      lyricOffsetSec: Number(clampNum(m.lyricOffsetSec, def.media.lyricOffsetSec, -15, 15).toFixed(1)),
    },
    opera: {
      personaPreset,
      customPersona: asStr(o.customPersona, def.opera.customPersona, 1200),
      ttsEnabled: asBool(o.ttsEnabled, def.opera.ttsEnabled),
      ttsVoice: asStr(o.ttsVoice, def.opera.ttsVoice, 120),
    },
    reminder: {
      reminderEnabled: asBool(r.reminderEnabled, def.reminder.reminderEnabled),
      reminderMinutes: Math.round(clampNum(r.reminderMinutes, def.reminder.reminderMinutes, 5, 720)),
      focusModeEnabled: asBool(r.focusModeEnabled, def.reminder.focusModeEnabled),
      activeHoursStart: HHMM_RE.test(startStr) ? startStr : def.reminder.activeHoursStart,
      activeHoursEnd: HHMM_RE.test(endStr) ? endStr : def.reminder.activeHoursEnd,
      snoozeMinutes: Math.round(clampNum(r.snoozeMinutes, def.reminder.snoozeMinutes, 1, 120)),
      excludedApps,
    },
    turbo: {
      downloadsTargetDir: asStr(t.downloadsTargetDir, def.turbo.downloadsTargetDir, 500),
      confirmFileOps: asBool(t.confirmFileOps, def.turbo.confirmFileOps),
    },
    ai: {
      fallbackModel: asStr(a.fallbackModel, def.ai.fallbackModel, 120),
      timeoutMs: Math.round(clampNum(a.timeoutMs, def.ai.timeoutMs, 5000, 180000)),
      retryLimit: Math.round(clampNum(a.retryLimit, def.ai.retryLimit, 0, 5)),
      streaming: asBool(a.streaming, def.ai.streaming),
      tokenBudget: Math.round(clampNum(a.tokenBudget, def.ai.tokenBudget, 0, 100_000_000)),
      warningThresholdPct: Math.round(clampNum(a.warningThresholdPct, def.ai.warningThresholdPct, 10, 99)),
      ollamaUrl: asStr(a.ollamaUrl, def.ai.ollamaUrl, 300),
    },
    automation: {
      retryLimit: Math.round(clampNum(au.retryLimit, def.automation.retryLimit, 0, 5)),
      timeoutMs: Math.round(clampNum(au.timeoutMs, def.automation.timeoutMs, 10000, 300000)),
      maxSteps: Math.round(clampNum(au.maxSteps, def.automation.maxSteps, 1, 50)),
      requireApprovalForSkills: asBool(au.requireApprovalForSkills, def.automation.requireApprovalForSkills),
      recorderEnabled: asBool(au.recorderEnabled, def.automation.recorderEnabled),
    },
    privacy: {
      allowScreenshots: asBool(p.allowScreenshots, def.privacy.allowScreenshots),
      allowClipboard: asBool(p.allowClipboard, def.privacy.allowClipboard),
      allowFilesystem: asBool(p.allowFilesystem, def.privacy.allowFilesystem),
      allowAppControl: asBool(p.allowAppControl, def.privacy.allowAppControl),
      allowBrowser: asBool(p.allowBrowser, def.privacy.allowBrowser),
      requireSensitiveConfirm: asBool(p.requireSensitiveConfirm, def.privacy.requireSensitiveConfirm),
      pausedGlobally: asBool(p.pausedGlobally, def.privacy.pausedGlobally),
    },
    system: {
      startWithWindows: asBool(s.startWithWindows, def.system.startWithWindows),
      startMinimized: asBool(s.startMinimized, def.system.startMinimized),
      runInBackground: asBool(s.runInBackground, def.system.runInBackground),
      closeToTray: asBool(s.closeToTray, def.system.closeToTray),
      performanceMode: perfMode,
    },
  };
}

/**
 * Strict validation for imported settings JSON. Rejects malformed payloads or invalid field types.
 */
export function validateImportedSettingsPayload(raw: unknown): { ok: true; settings: SettingsV2 } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Import payload must be a JSON object." };
  }
  const obj = raw as Record<string, unknown>;
  const candidate = obj.settings && typeof obj.settings === "object" ? (obj.settings as Record<string, unknown>) : obj;

  const knownSections = new Set<string>([
    "schemaVersion",
    "media",
    "opera",
    "reminder",
    "turbo",
    "ai",
    "automation",
    "privacy",
    "system",
  ]);
  const keys = Object.keys(candidate);
  if (keys.length === 0) {
    return { ok: false, error: "Import settings object is empty." };
  }
  for (const k of keys) {
    if (!knownSections.has(k)) {
      return { ok: false, error: `Unknown settings key "${k}" in import payload.` };
    }
    if (k !== "schemaVersion" && (!candidate[k] || typeof candidate[k] !== "object" || Array.isArray(candidate[k]))) {
      return { ok: false, error: `Section "${k}" must be an object.` };
    }
  }
  if (candidate.schemaVersion !== undefined && typeof candidate.schemaVersion !== "number") {
    return { ok: false, error: "schemaVersion must be a number." };
  }

  return { ok: true, settings: normalizeSettingsV2(candidate) };
}

export function migrateV1ToV2(v1Raw: Record<string, unknown>): SettingsV2 {
  const def = createDefaultSettings();
  return normalizeSettingsV2({
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    media: {
      colorAlbumFocus: v1Raw.colorAlbumFocus !== false,
      customAccentColor: v1Raw.customAccentColor ?? def.media.customAccentColor,
      mediaPriority: v1Raw.mediaPriority ?? def.media.mediaPriority,
      compactLyric: v1Raw.compactLyric !== false,
      lyricOffsetSec: v1Raw.lyricOffsetSec ?? def.media.lyricOffsetSec,
    },
    opera: {
      ...def.opera,
      personaPreset: v1Raw.personaPreset ?? def.opera.personaPreset,
      customPersona: v1Raw.customPersona ?? def.opera.customPersona,
    },
    reminder: {
      ...def.reminder,
      reminderEnabled: v1Raw.reminderEnabled !== false,
      reminderMinutes: v1Raw.reminderMinutes ?? def.reminder.reminderMinutes,
      focusModeEnabled: v1Raw.focusModeEnabled !== false,
    },
  });
}

export function toLegacyAppSettings(v2: SettingsV2): LegacyAppSettings {
  return {
    colorAlbumFocus: v2.media.colorAlbumFocus,
    customAccentColor: v2.media.customAccentColor,
    mediaPriority: v2.media.mediaPriority,
    compactLyric: v2.media.compactLyric,
    lyricOffsetSec: v2.media.lyricOffsetSec,
    personaPreset: v2.opera.personaPreset,
    customPersona: v2.opera.customPersona,
    reminderEnabled: v2.reminder.reminderEnabled,
    reminderMinutes: v2.reminder.reminderMinutes,
    focusModeEnabled: v2.reminder.focusModeEnabled,
  };
}
