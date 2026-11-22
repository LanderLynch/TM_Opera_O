import { ApplicationStatsSummary } from "../../applications/applicationStatistics";
import { WorkflowVerificationResult } from "./taskVerifier";

export interface DailySkippedItem {
  workflowId: string;
  reason: string;
}

export class StellaSoraReportGenerator {
  public buildSessionSummary(
    results: WorkflowVerificationResult[],
    statsSummary?: ApplicationStatsSummary,
    skipped: DailySkippedItem[] = [],
    durationMs?: number
  ): string {
    if (results.length === 0 && skipped.length === 0) {
      if (statsSummary && statsSummary.totalSessions > 0) {
        return `Ringkasan Stella Sora: ${statsSummary.completedSessions}/${statsSummary.totalSessions} sesi selesai. Hasil terverifikasi terakhir: ${statsSummary.recentVerifiedResults.join("; ") || "belum ada"}.`;
      }
      return "Belum ada eksekusi workflow Stella Sora yang terverifikasi.";
    }

    const passed = results.filter((r) => r.verified);
    const failed = results.filter((r) => !r.verified);
    const durText = typeof durationMs === "number" ? ` (${(durationMs / 1000).toFixed(1)} dtk)` : "";
    const lines = [
      `Laporan Stella Sora${durText}: ${passed.length} terverifikasi, ${skipped.length} dilewati, ${failed.length} gagal/belum selesai.`,
      ...results.map((r) => `- [${r.verified ? "VERIFIED" : "FAILED"}] ${r.workflowId}: ${r.evidence}`),
      ...skipped.map((s) => `- [SKIPPED] ${s.workflowId}: ${s.reason}`),
    ];
    return lines.join("\n");
  }
}
