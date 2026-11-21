import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { listOpenWindows } from "../../../desktop/windowManager";
import { createLiveWordDocument, findInstalledAppMatches } from "../../../pcController";
import {
  ActionResult,
  ApplicationAction,
  ApplicationAdapter,
  ApplicationSnapshot,
  VerificationResult,
} from "../../applicationTypes";

export class WordAdapter implements ApplicationAdapter {
  public readonly id = "word";
  public readonly displayName = "Microsoft Word (COM)";

  public async detect(): Promise<boolean> {
    const wins = await listOpenWindows();
    return wins.some((w) => /word/i.test(w.title));
  }

  public async launch(): Promise<ActionResult> {
    const res = await findInstalledAppMatches("microsoft word", "microsoft word");
    if (res.status === "launched" && res.chosen) {
      return { success: true, data: res.chosen, evidence: `Launched ${res.chosen.label}.` };
    }
    return { success: false, evidence: "Microsoft Word is not installed.", error: "Word not found." };
  }

  public async observe(): Promise<ApplicationSnapshot> {
    const wins = await listOpenWindows();
    const wWin = wins.find((w) => /word/i.test(w.title));
    return {
      appId: this.id,
      isOpen: Boolean(wWin),
      windowTitle: wWin?.title || "",
      visibleElements: [],
    };
  }

  public async capabilities(): Promise<string[]> {
    return ["launch", "create_document", "save_document", "read"];
  }

  public async execute(action: ApplicationAction): Promise<ActionResult> {
    if (action.type === "launch") return this.launch();

    if (action.type === "create_document") {
      const judul = String(action.target || "Laporan");
      const paragraphs = Array.isArray(action.options?.isi)
        ? (action.options?.isi as unknown[]).map((x) => String(x))
        : [String(action.content || "Dokumen dibuat oleh TM Opera O.")];

      await createLiveWordDocument({
        mode: action.options?.mode === "kop_surat" ? "kop_surat" : "freeform",
        append: Boolean(action.options?.append),
        instansi: String(action.options?.instansi || "PT SEMESTA OPERA INDONESIA"),
        subInstansi: String(action.options?.subInstansi || ""),
        alamat: String(action.options?.alamat || ""),
        judul,
        isi: paragraphs,
      });

      return {
        success: true,
        data: { judul, paragraphs: paragraphs.length },
        evidence: `Created Word document "${judul}" via COM.`,
      };
    }

    if (action.type === "save_document") {
      const fileName = String(action.target || `Opera_Report_${Date.now()}.docx`).replace(/[<>:"/\\|?*]/g, "_");
      const outPath = path.join(os.homedir(), "Documents", fileName.endsWith(".docx") ? fileName : `${fileName}.docx`);
      const outB64 = Buffer.from(outPath, "utf-8").toString("base64");
      const ps = `
$p = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${outB64}'))
$word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
if ($word -and $word.Documents.Count -gt 0) {
  $word.ActiveDocument.SaveAs2($p)
  Write-Output "SAVED"
}
`;
      const saved = await new Promise<boolean>((resolve) => {
        execFile("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], (err, stdout) => {
          resolve(!err && String(stdout).includes("SAVED"));
        });
      });
      const exists = fs.existsSync(outPath);
      return {
        success: saved && exists,
        data: { path: outPath, exists },
        evidence: exists ? `Saved and verified Word file at ${outPath}` : "Failed to save Word document.",
        error: exists ? undefined : "SaveAs2 failed or file not found.",
      };
    }

    return { success: false, evidence: `Unsupported Word action "${action.type}".`, error: "Unsupported action." };
  }

  public async verify(action: ApplicationAction, result: ActionResult): Promise<VerificationResult> {
    if (action.type === "save_document") {
      const filePath = (result.data as { path?: string } | undefined)?.path;
      const exists = Boolean(filePath && fs.existsSync(filePath));
      return {
        verified: result.success && exists,
        evidence: exists ? `Verified file exists on disk: ${filePath}` : "Saved file missing on disk.",
      };
    }
    const snap = await this.observe();
    return {
      verified: result.success && snap.isOpen,
      evidence: `${result.evidence} (Word open: ${snap.isOpen})`,
    };
  }
}
