import { execFile } from "child_process";

function runPs(script: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-WindowStyle", "Hidden", "-Command", script],
      { timeout: 10_000 },
      (err) => resolve(!err)
    );
  });
}

export async function typeText(text: string): Promise<boolean> {
  const payloadB64 = Buffer.from(text, "utf-8").toString("base64");
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
$txt = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${payloadB64}'))
# Escape SendKeys special chars: + ^ % ~ ( ) { } [ ]
$escaped = $txt -replace '([+^%~(){}\\[\\]])', '{$1}'
[System.Windows.Forms.SendKeys]::SendWait($escaped)
`;
  return await runPs(ps);
}

const ALLOWED_SHORTCUTS: Record<string, string> = {
  "enter": "{ENTER}",
  "tab": "{TAB}",
  "esc": "{ESC}",
  "escape": "{ESC}",
  "backspace": "{BACKSPACE}",
  "ctrl+c": "^c",
  "ctrl+v": "^v",
  "ctrl+a": "^a",
  "ctrl+s": "^s",
  "ctrl+f": "^f",
  "ctrl+l": "^l",
  "ctrl+t": "^t",
  "ctrl+w": "^w",
  "alt+tab": "%{TAB}",
};

export async function sendShortcut(shortcut: string): Promise<{ ok: boolean; error?: string }> {
  const normalized = shortcut.toLowerCase().replace(/\s+/g, "");
  const sendKeyExpr = ALLOWED_SHORTCUTS[normalized];
  if (!sendKeyExpr) {
    return {
      ok: false,
      error: `Shortcut "${shortcut}" is not in the allowed safe shortcut list.`,
    };
  }
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${sendKeyExpr}')
`;
  const ok = await runPs(ps);
  return { ok };
}
