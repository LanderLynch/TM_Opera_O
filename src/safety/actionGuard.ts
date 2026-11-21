import * as path from "path";

const PROTECTED_DIRS = [
  "c:\\windows",
  "c:\\program files",
  "c:\\program files (x86)",
  "c:\\programdata",
];

export function isProtectedPath(targetPath: string): boolean {
  const norm = path.resolve(targetPath).toLowerCase();
  return PROTECTED_DIRS.some((dir) => norm === dir || norm.startsWith(`${dir}\\`));
}

export function guardScreenCoordinates(x: number, y: number): { ok: boolean; reason?: string } {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, reason: "Coordinates must be finite numbers." };
  }
  // Support multi-monitor negative/positive bounds within reasonable desktop limits
  if (x < -4000 || x > 8000 || y < -4000 || y > 8000) {
    return { ok: false, reason: `Coordinates (${x}, ${y}) are outside safe desktop bounds.` };
  }
  return { ok: true };
}
