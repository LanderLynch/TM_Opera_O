import { shell } from "electron";
import { ensureForegroundWindow } from "../../../desktop/foregroundManager";
import { sendShortcut, typeText } from "../../../desktop/keyboard";
import { listOpenWindows } from "../../../desktop/windowManager";
import { inspectWindowUITree } from "../../../desktop/windowsUIAutomation";
import {
  ActionResult,
  ApplicationAction,
  ApplicationAdapter,
  ApplicationSnapshot,
  VerificationResult,
} from "../../applicationTypes";

export class BrowserAdapter implements ApplicationAdapter {
  public readonly id = "chrome";
  public readonly displayName = "Google Chrome / Browser";

  constructor(private readonly searchWebFn?: (q: string) => Promise<string>) {}

  public async detect(): Promise<boolean> {
    const wins = await listOpenWindows();
    return wins.some((w) => /chrome|edge|firefox|brave/i.test(w.title));
  }

  public async launch(): Promise<ActionResult> {
    await shell.openExternal("https://www.google.com");
    await new Promise((r) => setTimeout(r, 900));
    const open = await this.detect();
    return {
      success: open,
      evidence: open ? "Default browser opened and visible." : "Browser launch requested.",
    };
  }

  public async observe(): Promise<ApplicationSnapshot> {
    const wins = await listOpenWindows();
    const browserWin = wins.find((w) => /chrome|edge|firefox|brave/i.test(w.title));
    if (!browserWin) {
      return { appId: this.id, isOpen: false, windowTitle: "", visibleElements: [] };
    }
    const elements = await inspectWindowUITree(browserWin.title, 20);
    return {
      appId: this.id,
      isOpen: true,
      windowTitle: browserWin.title,
      visibleElements: elements.map((e) => ({ name: e.name, controlType: e.controlType })),
    };
  }

  public async capabilities(): Promise<string[]> {
    return ["launch", "focus", "navigate", "read", "research"];
  }

  public async execute(action: ApplicationAction): Promise<ActionResult> {
    if (action.type === "launch") return this.launch();

    if (action.type === "focus") {
      const f = await ensureForegroundWindow("Chrome");
      return {
        success: f.ok,
        data: f.window,
        evidence: f.ok ? `Focused "${f.window?.title}".` : f.reason || "Chrome not found.",
        error: f.ok ? undefined : f.reason,
      };
    }

    if (action.type === "navigate" && action.target) {
      const target = action.target.trim();
      if (/^https?:\/\//i.test(target)) {
        await shell.openExternal(target);
        await new Promise((r) => setTimeout(r, 1000));
        return { success: true, data: { url: target }, evidence: `Opened "${target}" in browser.` };
      }
      const f = await ensureForegroundWindow("Chrome");
      if (!f.ok) await this.launch();
      await sendShortcut("ctrl+l");
      await typeText(`https://www.google.com/search?q=${encodeURIComponent(target)}`);
      await sendShortcut("enter");
      return { success: true, data: { query: target }, evidence: `Searched "${target}" in Chrome.` };
    }

    if (action.type === "read") {
      const snap = await this.observe();
      let researchSummary = "";
      if (action.target && this.searchWebFn) {
        researchSummary = await this.searchWebFn(action.target);
      }
      return {
        success: snap.isOpen || Boolean(researchSummary),
        data: { snapshot: snap, researchSummary },
        evidence: `Browser title: "${snap.windowTitle}"${researchSummary ? " + web research extracted" : ""}.`,
      };
    }

    return { success: false, evidence: `Unsupported browser action "${action.type}".`, error: "Unsupported action." };
  }

  public async verify(action: ApplicationAction, result: ActionResult): Promise<VerificationResult> {
    const snap = await this.observe();
    return {
      verified: result.success && (snap.isOpen || action.type === "read"),
      evidence: `${result.evidence} (Browser tab: "${snap.windowTitle || "none"}")`,
    };
  }
}
