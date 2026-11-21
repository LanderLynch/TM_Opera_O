import { listOpenWindows, WindowInfo } from "../desktop/windowManager";

export interface DesktopSnapshot {
  timestamp: number;
  activeWindow: string;
  openWindowCount: number;
  windowTitles: string[];
}

export interface StateDiff {
  activeWindowChanged: boolean;
  previousWindow: string;
  currentWindow: string;
  newlyOpenedWindows: string[];
}

export class DesktopObserver {
  constructor(private readonly getActiveWindowFn: () => Promise<string>) {}

  public async captureSnapshot(): Promise<DesktopSnapshot> {
    const [activeWindow, windows] = await Promise.all([
      this.getActiveWindowFn().catch(() => ""),
      listOpenWindows().catch(() => [] as WindowInfo[]),
    ]);
    return {
      timestamp: Date.now(),
      activeWindow: activeWindow || "",
      openWindowCount: windows.length,
      windowTitles: windows.map((w) => w.title),
    };
  }

  public compare(before: DesktopSnapshot, after: DesktopSnapshot): StateDiff {
    const beforeSet = new Set(before.windowTitles);
    const newlyOpenedWindows = after.windowTitles.filter((t) => !beforeSet.has(t));
    return {
      activeWindowChanged: before.activeWindow !== after.activeWindow,
      previousWindow: before.activeWindow,
      currentWindow: after.activeWindow,
      newlyOpenedWindows,
    };
  }
}
