import { ToolResult } from "../tools/toolTypes";
import { DesktopSnapshot, StateDiff } from "./observer";

export interface StepVerificationRecord {
  requested: boolean;
  executed: boolean;
  observed: boolean;
  verified: boolean;
  evidence: string;
  stateDiff?: StateDiff;
}

export class ActionVerifier {
  public verifyOutcome(
    toolResult: ToolResult,
    toolVerifyResult: { verified: boolean; evidence: string } | null,
    before: DesktopSnapshot,
    after: DesktopSnapshot,
    diff: StateDiff
  ): StepVerificationRecord {
    const executed = true;
    const observed = after.timestamp >= before.timestamp;
    const verified = toolVerifyResult ? toolVerifyResult.verified : toolResult.success;
    const baseEvidence = toolVerifyResult ? toolVerifyResult.evidence : toolResult.evidence;

    const diffNote = diff.activeWindowChanged
      ? ` | Window changed: "${diff.previousWindow}" -> "${diff.currentWindow}"`
      : "";

    return {
      requested: true,
      executed,
      observed,
      verified,
      evidence: `${baseEvidence}${diffNote}`,
      stateDiff: diff,
    };
  }
}
