import * as fs from "fs";
import * as path from "path";
import {
  createDefaultSettings,
  LegacyAppSettings,
  migrateV1ToV2,
  normalizeSettingsV2,
  PartialSettingsPatch,
  SETTINGS_SCHEMA_VERSION,
  SettingsSectionKey,
  SettingsV2,
  toLegacyAppSettings,
  validateImportedSettingsPayload,
} from "./settingsSchema";

export class SettingsStore {
  private readonly filePath: string;
  private settings: SettingsV2;
  private migratedFromV1 = false;

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
    this.settings = this.load();
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public wasMigratedFromV1(): boolean {
    return this.migratedFromV1;
  }

  public get(): SettingsV2 {
    return JSON.parse(JSON.stringify(this.settings)) as SettingsV2;
  }

  public getLegacy(): LegacyAppSettings {
    return toLegacyAppSettings(this.settings);
  }

  public update(patch: PartialSettingsPatch): SettingsV2 {
    const merged: Record<string, unknown> = {
      ...this.settings,
    };
    const sections: SettingsSectionKey[] = [
      "media",
      "opera",
      "reminder",
      "turbo",
      "ai",
      "automation",
      "privacy",
      "system",
    ];
    for (const sec of sections) {
      if (patch[sec] && typeof patch[sec] === "object") {
        merged[sec] = {
          ...(this.settings[sec] as unknown as Record<string, unknown>),
          ...(patch[sec] as unknown as Record<string, unknown>),
        };
      }
    }
    this.settings = normalizeSettingsV2(merged);
    this.saveAtomic();
    return this.get();
  }

  public updateLegacy(legacyPatch: Partial<LegacyAppSettings>): SettingsV2 {
    const patch: PartialSettingsPatch = {};
    if (
      legacyPatch.colorAlbumFocus !== undefined ||
      legacyPatch.customAccentColor !== undefined ||
      legacyPatch.mediaPriority !== undefined ||
      legacyPatch.compactLyric !== undefined ||
      legacyPatch.lyricOffsetSec !== undefined
    ) {
      patch.media = {
        ...(legacyPatch.colorAlbumFocus !== undefined ? { colorAlbumFocus: legacyPatch.colorAlbumFocus } : {}),
        ...(legacyPatch.customAccentColor !== undefined ? { customAccentColor: legacyPatch.customAccentColor } : {}),
        ...(legacyPatch.mediaPriority !== undefined ? { mediaPriority: legacyPatch.mediaPriority } : {}),
        ...(legacyPatch.compactLyric !== undefined ? { compactLyric: legacyPatch.compactLyric } : {}),
        ...(legacyPatch.lyricOffsetSec !== undefined ? { lyricOffsetSec: legacyPatch.lyricOffsetSec } : {}),
      };
    }
    if (legacyPatch.personaPreset !== undefined || legacyPatch.customPersona !== undefined) {
      patch.opera = {
        ...(legacyPatch.personaPreset !== undefined ? { personaPreset: legacyPatch.personaPreset } : {}),
        ...(legacyPatch.customPersona !== undefined ? { customPersona: legacyPatch.customPersona } : {}),
      };
    }
    if (
      legacyPatch.reminderEnabled !== undefined ||
      legacyPatch.reminderMinutes !== undefined ||
      legacyPatch.focusModeEnabled !== undefined
    ) {
      patch.reminder = {
        ...(legacyPatch.reminderEnabled !== undefined ? { reminderEnabled: legacyPatch.reminderEnabled } : {}),
        ...(legacyPatch.reminderMinutes !== undefined ? { reminderMinutes: legacyPatch.reminderMinutes } : {}),
        ...(legacyPatch.focusModeEnabled !== undefined ? { focusModeEnabled: legacyPatch.focusModeEnabled } : {}),
      };
    }
    return this.update(patch);
  }

  public resetSection(section: SettingsSectionKey): SettingsV2 {
    const defaults = createDefaultSettings();
    const next = this.get();
    (next as unknown as Record<string, unknown>)[section] = defaults[section];
    this.settings = normalizeSettingsV2(next);
    this.saveAtomic();
    return this.get();
  }

  public exportConfig(): string {
    return JSON.stringify(
      {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        settings: this.get(),
      },
      null,
      2
    );
  }

  public importConfig(rawJson: string): { ok: true; settings: SettingsV2 } | { ok: false; error: string } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch (err) {
      return { ok: false, error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
    }
    const validation = validateImportedSettingsPayload(parsed);
    if (!validation.ok) {
      return validation;
    }
    this.settings = validation.settings;
    this.saveAtomic();
    return { ok: true, settings: this.get() };
  }

  public createBackup(targetDir?: string): string {
    const dir = targetDir ? path.resolve(targetDir) : path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(dir, `settings.backup.${stamp}.json`);
    fs.writeFileSync(backupPath, this.exportConfig(), "utf-8");
    return backupPath;
  }

  private load(): SettingsV2 {
    try {
      if (!fs.existsSync(this.filePath)) {
        return createDefaultSettings();
      }
      const rawText = fs.readFileSync(this.filePath, "utf-8");
      const raw = JSON.parse(rawText) as Record<string, unknown>;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return createDefaultSettings();
      }
      // Detect v1 flat schema (no schemaVersion or schemaVersion < 2)
      const version = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 1;
      if (version < SETTINGS_SCHEMA_VERSION) {
        const backupPath = path.join(path.dirname(this.filePath), "settings.v1.bak.json");
        try {
          if (!fs.existsSync(backupPath)) {
            fs.writeFileSync(backupPath, rawText, "utf-8");
          }
        } catch {}
        this.migratedFromV1 = true;
        const migrated = migrateV1ToV2(raw);
        this.settings = migrated;
        this.saveAtomic();
        return migrated;
      }
      return normalizeSettingsV2(raw);
    } catch {
      return createDefaultSettings();
    }
  }

  private saveAtomic(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.settings, null, 2), "utf-8");
    fs.renameSync(tmpPath, this.filePath);
  }
}
