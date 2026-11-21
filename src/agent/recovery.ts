import { ensureForegroundWindow } from "../desktop/foregroundManager";
import { logger } from "../core/logger";
import { DesktopObserver } from "./observer";

export interface RecoveryResult {
  recovered: boolean;
  shouldReplan: boolean;
  note: string;
}

export class RecoveryManager {
  constructor(private readonly observer: DesktopObserver) {}

  public async attemptRecovery(
    toolName: string,
    args: Record<string, unknown>,
    errorMsg: string
  ): Promise<RecoveryResult> {
    const lower = errorMsg.toLowerCase();
    logger.warn("recovery", `Attempting recovery for ${toolName}`, { errorMsg });

    // Never blindly retry external send actions if they timed out
    if (toolName.includes("send") || toolName.includes("delete")) {
      await this.observer.captureSnapshot();
      return {
        recovered: false,
        shouldReplan: true,
        note: `Skipped blind retry for sensitive tool "${toolName}". Re-observing state before replanning.`,
      };
    }

    // Recover lost foreground focus
    if (lower.includes("focus") || lower.includes("foreground")) {
      const target = String(args.titleQuery || args.windowTitle || args.appName || "");
      if (target) {
        const res = await ensureForegroundWindow(target, 2);
        if (res.ok) {
          return {
            recovered: true,
            shouldReplan: false,
            note: `Restored foreground focus to "${res.window?.title}".`,
          };
        }
      }
    }

    // Recover loading delay / timeout by waiting briefly and re-observing
    if (lower.includes("timeout") || lower.includes("loading")) {
      await new Promise((r) => setTimeout(r, 1200));
      const snap = await this.observer.captureSnapshot();
      return {
        recovered: false,
        shouldReplan: true,
        note: `Waited for UI to settle; current window is "${snap.activeWindow}". Replanning next step.`,
      };
    }

    return {
      recovered: false,
      shouldReplan: true,
      note: `Unrecovered error "${errorMsg}"; requesting planner to replan.`,
    };
  }
}
