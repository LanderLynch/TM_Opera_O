import { shell } from "electron";
import { ensureForegroundWindow } from "../../../desktop/foregroundManager";
import { sendShortcut, typeText } from "../../../desktop/keyboard";
import { listOpenWindows } from "../../../desktop/windowManager";
import { inspectWindowUITree, invokeUIElementByName } from "../../../desktop/windowsUIAutomation";
import {
  ActionResult,
  ApplicationAction,
  ApplicationAdapter,
  ApplicationSnapshot,
  VerificationResult,
} from "../../applicationTypes";

export class WhatsAppAdapter implements ApplicationAdapter {
  public readonly id = "whatsapp";
  public readonly displayName = "WhatsApp Web (Chrome)";

  public async detect(): Promise<boolean> {
    const wins = await listOpenWindows();
    return wins.some((w) => /whatsapp/i.test(w.title));
  }

  public async launch(): Promise<ActionResult> {
    const alreadyOpen = await this.detect();
    if (!alreadyOpen) {
      await shell.openExternal("https://web.whatsapp.com");
      await new Promise((r) => setTimeout(r, 1500));
    }
    await ensureForegroundWindow("WhatsApp");
    const open = await this.detect();
    return {
      success: open,
      evidence: open
        ? "WhatsApp Web tab is open in default browser."
        : "Opened https://web.whatsapp.com; waiting for browser tab.",
    };
  }

  public async observe(): Promise<ApplicationSnapshot> {
    const wins = await listOpenWindows();
    const waWin = wins.find((w) => /whatsapp/i.test(w.title));
    if (!waWin) {
      return { appId: this.id, isOpen: false, windowTitle: "", visibleElements: [] };
    }
    const elements = await inspectWindowUITree(waWin.title, 35);
    const needsQr = elements.some((e) => /link with phone|scan.*qr|tautkan/i.test(e.name));
    return {
      appId: this.id,
      isOpen: true,
      windowTitle: waWin.title,
      visibleElements: elements.map((e) => ({ name: e.name, controlType: e.controlType })),
      notes: needsQr ? "Login QR/pairing screen detected." : "Authorized WhatsApp Web session active.",
    };
  }

  public async capabilities(): Promise<string[]> {
    return ["launch", "focus", "navigate", "read", "prepare_draft", "send_message"];
  }

  public async execute(action: ApplicationAction): Promise<ActionResult> {
    if (action.type === "launch") return this.launch();

    const focus = await ensureForegroundWindow("WhatsApp");
    if (!focus.ok || !focus.window) {
      return { success: false, evidence: "WhatsApp Web window not found.", error: "WhatsApp Web is not open." };
    }

    if (action.type === "focus") {
      return { success: true, data: focus.window, evidence: `Focused "${focus.window.title}".` };
    }

    if (action.type === "navigate" && action.target) {
      // Search contact using UI Automation or WhatsApp Web search shortcut
      const searchEl = await invokeUIElementByName("WhatsApp", "Search");
      if (!searchEl.invoked) {
        await sendShortcut("ctrl+f");
      }
      await new Promise((r) => setTimeout(r, 250));
      await typeText(action.target);
      await new Promise((r) => setTimeout(r, 450));
      await sendShortcut("enter");
      return {
        success: true,
        evidence: `Searched and selected contact "${action.target}" in WhatsApp Web.`,
      };
    }

    if (action.type === "read") {
      const snap = await this.observe();
      return {
        success: snap.isOpen,
        data: snap,
        evidence: `Read ${snap.visibleElements.length} UI elements from WhatsApp Web.`,
      };
    }

    if (action.type === "prepare_draft" && action.content) {
      const inputEl = await invokeUIElementByName("WhatsApp", "Type a message");
      if (inputEl.invoked) {
        await typeText(action.content);
        return {
          success: true,
          data: { draft: action.content },
          evidence: "Prepared draft message in WhatsApp Web without sending.",
        };
      }
      return {
        success: false,
        evidence: "Could not locate WhatsApp Web message input.",
        error: "Message box not found.",
      };
    }

    if (action.type === "send_message" && action.content) {
      const inputEl = await invokeUIElementByName("WhatsApp", "Type a message");
      if (!inputEl.invoked) {
        return {
          success: false,
          evidence: "Could not locate WhatsApp Web message input before sending.",
          error: "Message box not found.",
        };
      }
      await typeText(action.content);
      await sendShortcut("enter");
      return {
        success: true,
        data: { sent: action.content },
        evidence: "Sent message in WhatsApp Web.",
      };
    }

    return { success: false, evidence: `Unsupported WhatsApp action "${action.type}".`, error: "Unsupported action." };
  }

  public async verify(_action: ApplicationAction, result: ActionResult): Promise<VerificationResult> {
    const snap = await this.observe();
    return {
      verified: result.success && snap.isOpen,
      evidence: `${result.evidence} (Window: "${snap.windowTitle || "none"}")`,
    };
  }
}
