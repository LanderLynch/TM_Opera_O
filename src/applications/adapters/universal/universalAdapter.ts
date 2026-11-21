import { ensureForegroundWindow } from "../../../desktop/foregroundManager";
import { sendShortcut, typeText } from "../../../desktop/keyboard";
import { listOpenWindows } from "../../../desktop/windowManager";
import { inspectWindowUITree, invokeUIElementByName } from "../../../desktop/windowsUIAutomation";
import { findInstalledAppMatches } from "../../../pcController";
import {
  ActionResult,
  ApplicationAction,
  ApplicationAdapter,
  ApplicationSnapshot,
  VerificationResult,
} from "../../applicationTypes";

export class UniversalAdapter implements ApplicationAdapter {
  public readonly id = "universal";
  public readonly displayName = "Universal Windows Application";

  constructor(private readonly targetName = "") {}

  public async detect(): Promise<boolean> {
    if (!this.targetName) return true;
    const wins = await listOpenWindows();
    return wins.some((w) => w.title.toLowerCase().includes(this.targetName.toLowerCase()));
  }

  public async launch(): Promise<ActionResult> {
    if (!this.targetName) {
      return { success: false, evidence: "No target application specified.", error: "Missing targetName." };
    }
    const res = await findInstalledAppMatches(this.targetName, this.targetName);
    if (res.status === "launched" && res.chosen) {
      return { success: true, data: res.chosen, evidence: `Launched "${res.chosen.label}".` };
    }
    return {
      success: false,
      data: res.options,
      evidence: `Could not uniquely launch "${this.targetName}".`,
      error: res.status === "multiple" ? "Multiple installed variants found." : "Application not found.",
    };
  }

  public async observe(): Promise<ApplicationSnapshot> {
    const wins = await listOpenWindows();
    const matched = this.targetName
      ? wins.find((w) => w.title.toLowerCase().includes(this.targetName.toLowerCase()))
      : wins[0];
    if (!matched) {
      return { appId: this.id, isOpen: false, windowTitle: "", visibleElements: [] };
    }
    const elements = await inspectWindowUITree(matched.title, 25);
    return {
      appId: this.id,
      isOpen: true,
      windowTitle: matched.title,
      visibleElements: elements.map((e) => ({ name: e.name, controlType: e.controlType })),
    };
  }

  public async capabilities(): Promise<string[]> {
    return ["launch", "focus", "click", "type", "read"];
  }

  public async execute(action: ApplicationAction): Promise<ActionResult> {
    if (action.type === "launch") return this.launch();
    const targetWin = action.target || this.targetName;

    if (action.type === "focus" && targetWin) {
      const f = await ensureForegroundWindow(targetWin);
      return {
        success: f.ok,
        data: f.window,
        evidence: f.ok ? `Focused "${f.window?.title}".` : f.reason || "Focus failed.",
        error: f.ok ? undefined : f.reason,
      };
    }

    if (action.type === "read") {
      const snap = await this.observe();
      return {
        success: snap.isOpen,
        data: snap,
        evidence: snap.isOpen
          ? `Read ${snap.visibleElements.length} UI elements from "${snap.windowTitle}".`
          : "Target window is not open.",
      };
    }

    if (action.type === "click" && action.target) {
      const f = await ensureForegroundWindow(this.targetName || action.target);
      if (!f.ok || !f.window) {
        return { success: false, evidence: "Target window not in foreground.", error: "Window not found." };
      }
      const res = await invokeUIElementByName(f.window.title, action.target);
      return {
        success: res.invoked,
        data: res.element,
        evidence: res.invoked ? `Invoked "${action.target}" via ${res.method}.` : `Element "${action.target}" not found.`,
        error: res.invoked ? undefined : "Element not found.",
      };
    }

    if (action.type === "type" && action.content) {
      const ok = await typeText(action.content);
      return {
        success: ok,
        evidence: ok ? `Typed ${action.content.length} chars.` : "Typing failed.",
        error: ok ? undefined : "Typing failed.",
      };
    }

    if (action.type === "navigate" && action.target) {
      await sendShortcut("ctrl+l");
      await typeText(action.target);
      await sendShortcut("enter");
      return { success: true, evidence: `Navigated using address bar to "${action.target}".` };
    }

    return {
      success: false,
      evidence: `Unsupported action "${action.type}" for UniversalAdapter.`,
      error: "Unsupported action.",
    };
  }

  public async verify(_action: ApplicationAction, result: ActionResult): Promise<VerificationResult> {
    const snap = await this.observe();
    return {
      verified: result.success && (snap.isOpen || _action.type !== "launch"),
      evidence: `${result.evidence} (Window open: ${snap.isOpen}${snap.windowTitle ? ` "${snap.windowTitle}"` : ""})`,
    };
  }
}
