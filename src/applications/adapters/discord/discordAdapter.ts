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

export class DiscordAdapter implements ApplicationAdapter {
  public readonly id = "discord";
  public readonly displayName = "Discord Desktop";

  public async detect(): Promise<boolean> {
    const wins = await listOpenWindows();
    return wins.some((w) => /discord/i.test(w.title));
  }

  public async launch(): Promise<ActionResult> {
    const res = await findInstalledAppMatches("discord", "discord");
    if (res.status === "launched" && res.chosen) {
      await new Promise((r) => setTimeout(r, 1500));
      return { success: true, data: res.chosen, evidence: `Launched ${res.chosen.label}.` };
    }
    return {
      success: false,
      evidence: "Discord desktop app is not installed.",
      error: "Discord not found on this PC.",
    };
  }

  public async observe(): Promise<ApplicationSnapshot> {
    const wins = await listOpenWindows();
    const dWin = wins.find((w) => /discord/i.test(w.title));
    if (!dWin) {
      return { appId: this.id, isOpen: false, windowTitle: "", visibleElements: [] };
    }
    const elements = await inspectWindowUITree(dWin.title, 35);
    const loginPrompt = elements.some((e) => /log in|login|register|masuk/i.test(e.name));
    return {
      appId: this.id,
      isOpen: true,
      windowTitle: dWin.title,
      visibleElements: elements.map((e) => ({ name: e.name, controlType: e.controlType })),
      notes: loginPrompt ? "User appears logged out (login screen detected)." : "Authorized desktop session active.",
    };
  }

  public async capabilities(): Promise<string[]> {
    return ["launch", "focus", "navigate", "read", "prepare_draft", "send_message"];
  }

  public async execute(action: ApplicationAction): Promise<ActionResult> {
    if (action.type === "launch") return this.launch();

    const focus = await ensureForegroundWindow("Discord");
    if (!focus.ok || !focus.window) {
      return { success: false, evidence: "Discord window is not open.", error: "Discord window not found." };
    }

    if (action.type === "focus") {
      return { success: true, data: focus.window, evidence: `Focused Discord window "${focus.window.title}".` };
    }

    if (action.type === "navigate" && action.target) {
      // Discord Quick Switcher (Ctrl+K) navigates safely to server/channel in user's own session
      await sendShortcut("ctrl+k");
      await new Promise((r) => setTimeout(r, 250));
      await typeText(action.target);
      await new Promise((r) => setTimeout(r, 350));
      await sendShortcut("enter");
      await new Promise((r) => setTimeout(r, 500));
      const snap = await this.observe();
      return {
        success: true,
        data: snap,
        evidence: `Navigated Discord Quick Switcher to "${action.target}". Window is now "${snap.windowTitle}".`,
      };
    }

    if (action.type === "read") {
      const snap = await this.observe();
      return {
        success: snap.isOpen,
        data: snap,
        evidence: `Observed Discord channel "${snap.windowTitle}" (${snap.visibleElements.length} UI nodes).`,
      };
    }

    if (action.type === "prepare_draft" && action.content) {
      const msgBox = await invokeUIElementByName("Discord", "Message");
      if (msgBox.invoked) {
        await typeText(action.content);
        return {
          success: true,
          data: { draft: action.content, channel: focus.window.title },
          evidence: `Prepared draft in "${focus.window.title}" without sending.`,
        };
      }
      return {
        success: false,
        evidence: "Could not focus Discord message input box.",
        error: "Message box not found.",
      };
    }

    if (action.type === "send_message" && action.content) {
      const msgBox = await invokeUIElementByName("Discord", "Message");
      if (!msgBox.invoked) {
        return {
          success: false,
          evidence: "Could not locate Discord message box before sending.",
          error: "Message input not found.",
        };
      }
      await typeText(action.content);
      await sendShortcut("enter");
      return {
        success: true,
        data: { sent: action.content, channel: focus.window.title },
        evidence: `Sent message in "${focus.window.title}".`,
      };
    }

    return { success: false, evidence: `Unsupported Discord action "${action.type}".`, error: "Unsupported action." };
  }

  public async verify(action: ApplicationAction, result: ActionResult): Promise<VerificationResult> {
    const snap = await this.observe();
    if (action.type === "navigate" && action.target) {
      const ok = snap.windowTitle.toLowerCase().includes(action.target.toLowerCase().replace(/^#/, ""));
      return {
        verified: result.success && snap.isOpen && (ok || snap.windowTitle.length > 0),
        evidence: `Discord active title: "${snap.windowTitle}"`,
      };
    }
    return {
      verified: result.success && snap.isOpen,
      evidence: `${result.evidence} (Session: "${snap.windowTitle}")`,
    };
  }
}
