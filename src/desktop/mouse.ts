import { execFile } from "child_process";

export type MouseButton = "left" | "right" | "double";

function runPs(script: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-WindowStyle", "Hidden", "-Command", script],
      { timeout: 8000 },
      (err) => resolve(!err)
    );
  });
}

export async function moveMouse(x: number, y: number): Promise<boolean> {
  const rx = Math.round(x);
  const ry = Math.round(y);
  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Mouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
}
"@
[void][Win32Mouse]::SetCursorPos(${rx}, ${ry})
`;
  return await runPs(ps);
}

export async function clickMouse(
  x: number,
  y: number,
  button: MouseButton = "left"
): Promise<boolean> {
  const rx = Math.round(x);
  const ry = Math.round(y);
  const downFlag = button === "right" ? 0x0008 : 0x0002;
  const upFlag = button === "right" ? 0x0010 : 0x0004;
  const clicks = button === "double" ? 2 : 1;

  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32MouseClick {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
[void][Win32MouseClick]::SetCursorPos(${rx}, ${ry})
Start-Sleep -Milliseconds 40
for ($i = 0; $i -lt ${clicks}; $i++) {
  [Win32MouseClick]::mouse_event(${downFlag}, 0, 0, 0, [UIntPtr]::Zero)
  [Win32MouseClick]::mouse_event(${upFlag}, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 50
}
`;
  return await runPs(ps);
}

export async function scrollMouse(delta: number): Promise<boolean> {
  const wheelAmount = Math.round(delta);
  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Scroll {
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, UIntPtr dwExtraInfo);
}
"@
[Win32Scroll]::mouse_event(0x0800, 0, 0, ${wheelAmount}, [UIntPtr]::Zero)
`;
  return await runPs(ps);
}
