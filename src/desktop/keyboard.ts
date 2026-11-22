import { ChildProcessWithoutNullStreams, spawn } from "child_process";

let worker: ChildProcessWithoutNullStreams | null = null;
let stdoutBuf = "";
const pendingQueue: Array<(ok: boolean) => void> = [];

function ensureWorker(): ChildProcessWithoutNullStreams {
  if (worker && !worker.killed && worker.exitCode === null) {
    return worker;
  }
  const psLoop = `
Add-Type -AssemblyName System.Windows.Forms
[Console]::Out.AutoFlush = $true
while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    if ($line.StartsWith("KEY:")) {
      $expr = $line.Substring(4)
      [System.Windows.Forms.SendKeys]::SendWait($expr)
      [Console]::Out.WriteLine("OK")
    } elseif ($line.StartsWith("TYPE:")) {
      $b64 = $line.Substring(5)
      $txt = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($b64))
      $escaped = $txt -replace '([+^%~(){}\\[\\]])', '{$1}'
      [System.Windows.Forms.SendKeys]::SendWait($escaped)
      [Console]::Out.WriteLine("OK")
    } else {
      [Console]::Out.WriteLine("ERR")
    }
  } catch {
    [Console]::Out.WriteLine("ERR")
  }
}
`;
  const proc = spawn(
    "powershell.exe",
    ["-NoProfile", "-WindowStyle", "Hidden", "-Command", psLoop],
    { stdio: "pipe" }
  );
  proc.unref();
  proc.stdout.on("data", (chunk: Buffer | string) => {
    stdoutBuf += String(chunk);
    const lines = stdoutBuf.split(/\r?\n/);
    stdoutBuf = lines.pop() || "";
    for (const ln of lines) {
      const t = ln.trim();
      if (!t) continue;
      const resolve = pendingQueue.shift();
      if (resolve) resolve(t === "OK");
    }
  });
  proc.on("exit", () => {
    worker = null;
    while (pendingQueue.length > 0) {
      const resolve = pendingQueue.shift();
      if (resolve) resolve(false);
    }
  });
  worker = proc;
  return proc;
}

function sendWorkerCommand(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const proc = ensureWorker();
      const timer = setTimeout(() => {
        const idx = pendingQueue.indexOf(done);
        if (idx >= 0) pendingQueue.splice(idx, 1);
        resolve(false);
      }, 8000);
      const done = (ok: boolean) => {
        clearTimeout(timer);
        resolve(ok);
      };
      pendingQueue.push(done);
      proc.stdin.write(cmd + "\n");
    } catch {
      resolve(false);
    }
  });
}

export function stopKeyboardWorker(): void {
  if (worker && !worker.killed) {
    try {
      worker.kill("SIGTERM");
    } catch {}
    worker = null;
  }
}

export async function typeText(text: string): Promise<boolean> {
  const payloadB64 = Buffer.from(text, "utf-8").toString("base64");
  return await sendWorkerCommand(`TYPE:${payloadB64}`);
}

const ALLOWED_SHORTCUTS: Record<string, string> = {
  "enter": "{ENTER}",
  "tab": "{TAB}",
  "esc": "{ESC}",
  "escape": "{ESC}",
  "backspace": "{BACKSPACE}",
  "delete": "{DELETE}",
  "space": " ",
  "up": "{UP}",
  "down": "{DOWN}",
  "left": "{LEFT}",
  "right": "{RIGHT}",
  "home": "{HOME}",
  "end": "{END}",
  "pgup": "{PGUP}",
  "pgdn": "{PGDN}",
  "f5": "{F5}",
  "ctrl+c": "^c",
  "ctrl+v": "^v",
  "ctrl+x": "^x",
  "ctrl+z": "^z",
  "ctrl+y": "^y",
  "ctrl+a": "^a",
  "ctrl+s": "^s",
  "ctrl+f": "^f",
  "ctrl+l": "^l",
  "ctrl+n": "^n",
  "ctrl+r": "^r",
  "ctrl+t": "^t",
  "ctrl+w": "^w",
  "ctrl+tab": "^{TAB}",
  "ctrl+shift+tab": "^+{TAB}",
  "alt+tab": "%{TAB}",
  "alt+f4": "%{F4}",
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
  const ok = await sendWorkerCommand(`KEY:${sendKeyExpr}`);
  return { ok };
}
