import { ApplicationStatsSummary } from "../../applications/applicationStatistics";
import { WorkflowVerificationResult } from "./taskVerifier";

export class StellaSoraReportGenerator {
  public buildSessionSummary(
    results: WorkflowVerificationResult[],
    statsSummary?: ApplicationStatsSummary
  ): string {
    if (results.length === 0) {
      if (statsSummary && statsSummary.totalSessions > 0) {
        return `Ringkasan Stella Sora: ${statsSummary.completedSessions}/${statsSummary.totalSessions} sesi selesai. Hasil terverifikasi terakhir: ${statsSummary.recentVerifiedResults.join("; ") || "belum ada"}.`;
      }
      return "Belum ada eksekusi workflow Stella Sora yang terverifikasi.";
    }

    const passed = results.filter((r) => r.verified);
    const failed = results.filter((r) => !r.verified);
    const lines = [
      `Laporan Stella Sora: ${passed.length} terverifikasi, ${failed.length} gagal/belum selesai.`,
      ...results.map((r) => `- [${r.verified ? "VERIFIED" : "UNVERIFIED"}] ${r.workflowId}: ${r.evidence}`),
    ];
    return lines.join("\n");
  }
}
