import { focusWindowByTitle, listOpenWindows, WindowInfo } from "./windowManager";

export async function ensureForegroundWindow(
  titleQuery: string,
  retries = 2
): Promise<{ ok: boolean; window?: WindowInfo; reason?: string }> {
  for (let i = 0; i <= retries; i++) {
    const res = await focusWindowByTitle(titleQuery);
    if (res.focused && res.window) {
      await new Promise((r) => setTimeout(r, 250));
      return { ok: true, window: res.window };
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  const open = await listOpenWindows();
  return {
    ok: false,
    reason: `Window matching "${titleQuery}" not found among ${open.length} open windows.`,
  };
}
