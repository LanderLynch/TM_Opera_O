import { execFile } from "child_process";

export interface WindowInfo {
  hwnd: string;
  title: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

const OVERLAY_BLACKLIST =
  /^(TM Opera O|Opera iOS Notch|Opera Notch|Opera Radial|TM Opera O — Settings|Program Manager|Settings|Microsoft Text Input Application|Windows Input Experience|Default IME|MSCTFIME UI|NVIDIA GeForce Overlay|NVIDIA Share|GeForce Experience|Xbox Game Bar|Windows Shell Experience Host|Task Switching)$/i;

function runPs(script: string, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-WindowStyle", "Hidden", "-Command", script],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) resolve("");
        else resolve((stdout || "").trim());
      }
    );
  });
}

export async function listOpenWindows(): Promise<WindowInfo[]> {
  const ps = `
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class Win32Enum {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$list = New-Object System.Collections.ArrayList
[Win32Enum]::EnumWindows({
  param($hWnd, $lParam)
  if ([Win32Enum]::IsWindowVisible($hWnd)) {
    $ex = [Win32Enum]::GetWindowLong($hWnd, -20)
    if (($ex -band 0x20) -eq 0) {
      $sb = New-Object System.Text.StringBuilder 256
      [void][Win32Enum]::GetWindowText($hWnd, $sb, 256)
      $t = $sb.ToString().Trim()
      if ($t) {
        $r = New-Object Win32Enum+RECT
        [void][Win32Enum]::GetWindowRect($hWnd, [ref]$r)
        $w = $r.Right - $r.Left
        $h = $r.Bottom - $r.Top
        if ($w -gt 50 -and $h -gt 50) {
          [void]$list.Add([PSCustomObject]@{
            hwnd = $hWnd.ToString()
            title = $t
            left = $r.Left
            top = $r.Top
            width = $w
            height = $h
          })
        }
      }
    }
  }
  return $true
}, [IntPtr]::Zero) | Out-Null
$list | ConvertTo-Json -Compress
`;
  const out = await runPs(ps);
  if (!out) return [];
  try {
    const parsed = JSON.parse(out);
    const arr: WindowInfo[] = Array.isArray(parsed) ? parsed : [parsed];
    return arr.filter((w) => w.title && !OVERLAY_BLACKLIST.test(w.title) && !/NVIDIA|GeForce Overlay/i.test(w.title));
  } catch {
    return [];
  }
}

export async function focusWindowByTitle(titleQuery: string): Promise<{ focused: boolean; window?: WindowInfo }> {
  const q = titleQuery.trim();
  if (!q) return { focused: false };
  const payloadB64 = Buffer.from(q, "utf-8").toString("base64");

  const ps = `
$q = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${payloadB64}')).ToLower()
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32Focus {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$found = $null
[Win32Focus]::EnumWindows({
  param($hWnd, $lParam)
  if ([Win32Focus]::IsWindowVisible($hWnd)) {
    $sb = New-Object System.Text.StringBuilder 256
    [void][Win32Focus]::GetWindowText($hWnd, $sb, 256)
    $t = $sb.ToString().Trim()
    if ($t -and $t.ToLower().Contains($q) -and $t -notmatch 'TM Opera O|Opera iOS Notch') {
      if ([Win32Focus]::IsIconic($hWnd)) {
        [void][Win32Focus]::ShowWindow($hWnd, 9) # SW_RESTORE
      }
      [void][Win32Focus]::SetForegroundWindow($hWnd)
      $r = New-Object Win32Focus+RECT
      [void][Win32Focus]::GetWindowRect($hWnd, [ref]$r)
      $script:found = [PSCustomObject]@{
        hwnd = $hWnd.ToString()
        title = $t
        left = $r.Left
        top = $r.Top
        width = $r.Right - $r.Left
        height = $r.Bottom - $r.Top
      }
      return $false
    }
  }
  return $true
}, [IntPtr]::Zero) | Out-Null
if ($found) { $found | ConvertTo-Json -Compress }
`;
  const out = await runPs(ps);
  if (!out || !out.startsWith("{")) return { focused: false };
  try {
    return { focused: true, window: JSON.parse(out) as WindowInfo };
  } catch {
    return { focused: false };
  }
}
