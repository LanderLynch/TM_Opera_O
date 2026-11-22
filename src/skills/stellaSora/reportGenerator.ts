import { ApplicationStatsSummary } from "../../applications/applicationStatistics";
import { WorkflowVerificationResult } from "./taskVerifier";

export class StellaSoraReportGenerator {
  public buildSessionSummary(
    results: WorkflowVerificationResult[],
    statsSummary?: ApplicationStatsSummary
  ): string {
    if (results.length === 0) {
      if (statsSummary && statsSummary.totalSessions > 0) {
        return `Stella Sora recorded ${statsSummary.completedSessions}/${statsSummary.totalSessions} completed session(s). Recent verified: ${statsSummary.recentVerifiedResults.join("; ") || "none"}.`;
      }
      return "No verified Stella Sora workflow executions recorded yet.";
    }

    const passed = results.filter((r) => r.verified);
    const failed = results.filter((r) => !r.verified);
    const lines = [
      `Stella Sora report: ${passed.length} verified, ${failed.length} incomplete/failed.`,
      ...results.map((r) => `- [${r.verified ? "VERIFIED" : "UNVERIFIED"}] ${r.workflowId}: ${r.evidence}`),
    ];
    return lines.join("\n");
  }
}
