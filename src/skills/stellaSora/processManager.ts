import { listOpenWindows } from "../../desktop/windowManager";
import { findInstalledAppMatches, InstalledApp, scanInstalledApps } from "../../pcController";

export interface StellaSoraProcessState {
  desktopAccessible: boolean;
  visibleWindowCount: number;
  installedInSteam: boolean;
  installedMatches: InstalledApp[];
  isRunning: boolean;
  windowTitle: string | null;
  windowHwnd: string | null;
}

const STELLA_SORA_TITLE_RE = /stella\s*sora|xtlr|星塔旅人|ステラソラ/i;

export class StellaSoraProcessManager {
  public async detect(): Promise<StellaSoraProcessState> {
    const [apps, windows] = await Promise.all([
      scanInstalledApps().catch(() => [] as InstalledApp[]),
      listOpenWindows().catch(() => []),
    ]);

    const installedMatches = apps.filter((a) => STELLA_SORA_TITLE_RE.test(a.name));
    const runningWin = windows.find((w) => STELLA_SORA_TITLE_RE.test(w.title));

    return {
      desktopAccessible: windows.length > 0,
      visibleWindowCount: windows.length,
      installedInSteam: installedMatches.some((m) => m.source === "steam"),
      installedMatches,
      isRunning: Boolean(runningWin),
      windowTitle: runningWin ? runningWin.title : null,
      windowHwnd: runningWin ? runningWin.hwnd : null,
    };
  }

  public async launchViaSteam(): Promise<{ launched: boolean; message: string }> {
    const res = await findInstalledAppMatches("stella sora", "open stella sora steam");
    if (res.status === "launched" && res.chosen) {
      return { launched: true, message: `Launched ${res.chosen.label}.` };
    }
    if (res.status === "multiple" && res.options && res.options.length > 0) {
      return {
        launched: false,
        message: `Multiple Stella Sora installations found: ${res.options.map((o) => o.label).join(", ")}.`,
      };
    }
    return {
      launched: false,
      message: "Stella Sora is not installed in Steam or Windows StartApps yet.",
    };
  }
}
