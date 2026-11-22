import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";

export interface InstalledApp {
  name: string;
  source: "app" | "steam";
  target: string; // shell:AppsFolder\... or exe path or steam://rungameid/...
  label: string;
}

let cachedApps: InstalledApp[] = [];
let lastScanTime = 0;
let pendingChoices: InstalledApp[] | null = null;

function runPowerShell(script: string, timeoutMs = 20_000): Promise<string> {
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

export async function scanInstalledApps(force = false): Promise<InstalledApp[]> {
  if (!force && cachedApps.length > 0 && Date.now() - lastScanTime < 120_000) {
    return cachedApps;
  }

  const apps: InstalledApp[] = [];

  // 1. Scan Windows StartApps (UWP, Store Apps like Spotify, Desktop Launchers like C:\Strinova\Strinova.exe)
  const rawStartApps = await runPowerShell(
    "Get-StartApps | ForEach-Object { \"$($_.Name)|$($_.AppID)\" }"
  );
  for (const line of rawStartApps.split(/\r?\n/)) {
    const idx = line.indexOf("|");
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim();
    const appId = line.slice(idx + 1).trim();
    if (!name || !appId) continue;
    // Skip web help links or uninstallers
    if (/^https?:\/\//i.test(appId) || /uninstall/i.test(name)) continue;

    const isExePath = /^[A-Za-z]:\\/.test(appId) && fs.existsSync(appId);
    apps.push({
      name,
      source: "app",
      target: isExePath ? appId : `shell:AppsFolder\\${appId}`,
      label: isExePath ? `${name} (Launcher Lokal)` : `${name} (Aplikasi Terinstal)`,
    });
  }

  // 1B. Ensure Microsoft Office apps (Word, Excel, PowerPoint) from App Paths are registered with friendly names
  const officeApps: Array<[string, string]> = [
    ["C:\\Program Files\\Microsoft Office\\Root\\Office16\\WINWORD.EXE", "Microsoft Word"],
    ["C:\\Program Files\\Microsoft Office\\Root\\Office16\\EXCEL.EXE", "Microsoft Excel"],
    ["C:\\Program Files\\Microsoft Office\\Root\\Office16\\POWERPNT.EXE", "Microsoft PowerPoint"],
  ];
  for (const [exePath, friendlyName] of officeApps) {
    if (fs.existsSync(exePath)) {
      apps.push({
        name: friendlyName,
        source: "app",
        target: exePath,
        label: `${friendlyName} (Terinstal di PC)`,
      });
    }
  }

  // 2. Scan Steam installed games across drives
  const steamDirs = [
    "C:\\Program Files (x86)\\Steam\\steamapps",
    "C:\\Program Files\\Steam\\steamapps",
    "D:\\SteamLibrary\\steamapps",
    "E:\\SteamLibrary\\steamapps",
    "F:\\SteamLibrary\\steamapps",
  ];

  for (const dir of steamDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir).filter((f) => /^appmanifest_\d+\.acf$/i.test(f));
      for (const file of files) {
        const content = fs.readFileSync(path.join(dir, file), "utf-8");
        const idMatch = content.match(/"appid"\s+"(\d+)"/i);
        const nameMatch = content.match(/"name"\s+"([^"]+)"/i);
        if (!idMatch || !nameMatch) continue;
        const appId = idMatch[1];
        const gameName = nameMatch[1];
        if (/Steamworks Common Redistributables/i.test(gameName)) continue;
        apps.push({
          name: gameName,
          source: "steam",
          target: `steam://rungameid/${appId}`,
          label: `${gameName} (Steam)`,
        });
      }
    } catch {}
  }

  cachedApps = apps;
  lastScanTime = Date.now();
  return apps;
}

export function launchTarget(item: InstalledApp): void {
  if (item.target.startsWith("steam://") || item.target.startsWith("shell:AppsFolder\\")) {
    execFile("explorer.exe", [item.target], () => {});
  } else {
    execFile("cmd.exe", ["/c", "start", "", item.target], { cwd: path.dirname(item.target) }, () => {});
  }
}

export function checkPendingAppChoice(pesan: string): InstalledApp | null {
  if (!pendingChoices || pendingChoices.length === 0) return null;
  const lower = pesan.toLowerCase().trim();

  // Check by number (1, 2, ...)
  const numMatch = lower.match(/\b([1-9])\b/);
  if (numMatch) {
    const idx = parseInt(numMatch[1], 10) - 1;
    if (pendingChoices[idx]) {
      const chosen = pendingChoices[idx];
      pendingChoices = null;
      return chosen;
    }
  }

  // Check by variant keyword ("steam" vs "launcher" / "lokal")
  if (lower.includes("steam")) {
    const found = pendingChoices.find((c) => c.source === "steam" || /steam/i.test(c.label));
    if (found) {
      pendingChoices = null;
      return found;
    }
  }
  if (lower.includes("launcher") || lower.includes("lokal") || lower.includes("biasa")) {
    const found = pendingChoices.find((c) => c.source === "app");
    if (found) {
      pendingChoices = null;
      return found;
    }
  }

  return null;
}

export async function findInstalledAppMatches(
  appQuery: string,
  fullUserMessage: string
): Promise<{ status: "launched" | "multiple" | "not_found"; chosen?: InstalledApp; options?: InstalledApp[] }> {
  const apps = await scanInstalledApps();
  const q = appQuery.toLowerCase().trim();
  const msgLower = fullUserMessage.toLowerCase();

  // Find apps whose name matches query
  let matches = apps.filter((a) => {
    const n = a.name.toLowerCase();
    return n === q || n.includes(q) || q.includes(n);
  });

  if (matches.length === 0) {
    return { status: "not_found" };
  }

  // Deduplicate identical targets
  const seen = new Set<string>();
  matches = matches.filter((m) => {
    const key = `${m.source}:${m.name.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Prefer exact name matches if multiple unrelated apps matched (e.g. "Steam" vs "Steam Support")
  const exactMatches = matches.filter((m) => {
    const n = m.name.toLowerCase();
    return n === q || (q === "word" && n === "microsoft word") || (q === "microsoft word" && (n === "word" || n === "microsoft word"));
  });
  if (exactMatches.length > 0) {
    // If both "Word" (StartApps) and "Microsoft Word" (Office16 exe) matched, deduplicate to the Office16 exe
    const officeExe = exactMatches.find((m) => m.target.toLowerCase().endsWith(".exe"));
    matches = officeExe ? [officeExe] : [exactMatches[0]];
  }

  // Check if user already specified "steam" or "launcher" in the initial request
  if (matches.length > 1) {
    if (msgLower.includes("steam")) {
      const steamOnly = matches.filter((m) => m.source === "steam");
      if (steamOnly.length === 1) {
        launchTarget(steamOnly[0]);
        return { status: "launched", chosen: steamOnly[0] };
      }
    }
    if (msgLower.includes("launcher") || msgLower.includes("lokal")) {
      const launcherOnly = matches.filter((m) => m.source === "app");
      if (launcherOnly.length === 1) {
        launchTarget(launcherOnly[0]);
        return { status: "launched", chosen: launcherOnly[0] };
      }
    }
    pendingChoices = matches;
    return { status: "multiple", options: matches };
  }

  launchTarget(matches[0]);
  return { status: "launched", chosen: matches[0] };
}

// ---------------------------------------------------------
// 2. KENDALI MEDIA (STOP/PLAY MUSIK DI WEB / SPOTIFY) & KLIK
// ---------------------------------------------------------
export type MediaAction = "play_pause" | "next" | "prev" | "mute" | "vol_up" | "vol_down";

export async function triggerMediaKey(action: MediaAction): Promise<void> {
  const keyMap: Record<MediaAction, number> = {
    play_pause: 0xb3, // VK_MEDIA_PLAY_PAUSE
    next: 0xb0,       // VK_MEDIA_NEXT_TRACK
    prev: 0xb1,       // VK_MEDIA_PREV_TRACK
    mute: 0xad,       // VK_VOLUME_MUTE
    vol_up: 0xaf,     // VK_VOLUME_UP
    vol_down: 0xae,   // VK_VOLUME_DOWN
  };
  const vk = keyMap[action];
  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Media {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
[Win32Media]::keybd_event(${vk}, 0, 0, [UIntPtr]::Zero)
[Win32Media]::keybd_event(${vk}, 0, 2, [UIntPtr]::Zero)
`;
  await runPowerShell(ps);
}

export async function seekMediaToSeconds(targetSec: number): Promise<boolean> {
  const sec = Math.max(0, Number(targetSec || 0));
  if (latestMedia) {
    latestMedia.positionSec = sec;
    latestMedia.updatedAtMs = Date.now();
  }
  const ticks = Math.round(sec * 10_000_000);
  const ps = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$sessions = $mgr.GetSessions()
$musicPattern = 'Spotify|AppleMusic|Tidal|Deezer|AmazonMusic|SoundCloud|MusicBee|foobar2000|AIMP|iTunes|YouTubeMusic'
$browserPattern = 'chrome|msedge|firefox|brave|opera|vivaldi|arc'
$chosen = $null
foreach ($s in $sessions) {
  if ($s.SourceAppUserModelId -match 'Spotify' -and [string]$s.GetPlaybackInfo().PlaybackStatus -eq 'Playing') { $chosen = $s; break }
}
if (-not $chosen) {
  foreach ($s in $sessions) {
    if ($s.SourceAppUserModelId -match 'Spotify') { $chosen = $s; break }
  }
}
if (-not $chosen) {
  foreach ($s in $sessions) {
    $id = [string]$s.SourceAppUserModelId
    if ($id -match $musicPattern -and $id -notmatch $browserPattern -and [string]$s.GetPlaybackInfo().PlaybackStatus -eq 'Playing') { $chosen = $s; break }
  }
}
if (-not $chosen) {
  foreach ($s in $sessions) {
    $id = [string]$s.SourceAppUserModelId
    if ($id -match $musicPattern -and $id -notmatch $browserPattern) { $chosen = $s; break }
  }
}
if ($chosen) {
  [void](Await ($chosen.TryChangePlaybackPositionAsync([long]${ticks})) ([bool]))
}
`;
  await runPowerShell(ps, 4000);
  return true;
}

// ---------------------------------------------------------
// 3. RAPIHKAN FOLDER DI PC
// ---------------------------------------------------------
const CATEGORY_EXTS: Array<{ folder: string; exts: string[] }> = [
  { folder: "Gambar", exts: [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".ico"] },
  { folder: "Dokumen", exts: [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv", ".md", ".rtf"] },
  { folder: "Video_Audio", exts: [".mp4", ".mkv", ".avi", ".mov", ".mp3", ".wav", ".flac", ".ogg", ".m4a"] },
  { folder: "Arsip", exts: [".zip", ".rar", ".7z", ".tar", ".gz"] },
  { folder: "Program_Installer", exts: [".exe", ".msi", ".bat", ".vbs"] },
];

export function resolveUserFolder(rawTarget: string): string | null {
  const home = os.homedir();
  const lower = rawTarget.toLowerCase().trim();
  if (lower.includes("download") || lower.includes("unduhan")) return path.join(home, "Downloads");
  if (lower.includes("desktop") || lower.includes("layar utama")) return path.join(home, "Desktop");
  if (lower.includes("document") || lower.includes("dokumen")) return path.join(home, "Documents");
  if (lower.includes("picture") || lower.includes("gambar")) return path.join(home, "Pictures");
  if (fs.existsSync(rawTarget) && fs.statSync(rawTarget).isDirectory()) return rawTarget;
  return null;
}

export function organizeFolder(folderPath: string): { movedCount: number; summary: string } {
  if (!fs.existsSync(folderPath)) {
    return { movedCount: 0, summary: `Folder ${folderPath} tidak ditemukan.` };
  }
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  const counts: Record<string, number> = {};
  let totalMoved = 0;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith(".") || entry.name.toLowerCase() === "desktop.ini") continue;

    const ext = path.extname(entry.name).toLowerCase();
    const cat = CATEGORY_EXTS.find((c) => c.exts.includes(ext))?.folder || "Lainnya";
    const destDir = path.join(folderPath, cat);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const srcFile = path.join(folderPath, entry.name);
    let destFile = path.join(destDir, entry.name);
    if (fs.existsSync(destFile)) {
      const base = path.basename(entry.name, ext);
      destFile = path.join(destDir, `${base}_${Date.now()}${ext}`);
    }

    try {
      fs.renameSync(srcFile, destFile);
      counts[cat] = (counts[cat] || 0) + 1;
      totalMoved++;
    } catch {}
  }

  const parts = Object.entries(counts).map(([k, v]) => `${k}: ${v} file`);
  const summary =
    totalMoved > 0
      ? `Berhasil merapikan ${totalMoved} file di ${folderPath} (${parts.join(", ")}).`
      : `Folder ${folderPath} sudah rapi, tidak ada file lepas yang perlu dipindahkan.`;
  return { movedCount: totalMoved, summary };
}

// ---------------------------------------------------------
// 5. LIVE MEDIA SESSION (SMTC DAEMON) & SYNCED LYRICS (LRCLIB)
// ---------------------------------------------------------
export interface MediaSessionInfo {
  app: string;
  title: string;
  artist: string;
  album: string;
  status: string; // "Playing" | "Paused" | "Stopped"
  positionSec: number;
  durationSec: number;
  updatedAtMs: number;
}

export interface LyricLine {
  timeSec: number;
  text: string;
}

let latestMedia: MediaSessionInfo | null = null;
let mediaWatcherStarted = false;
let lastLyricsKey = "";
let cachedLyrics: LyricLine[] = [];
let cachedPlainLyrics: string[] = [];
let cachedCoverUrl = "";
let lyricsFetching = false;

export function startMediaWatcher(): void {
  if (mediaWatcherStarted) return;
  mediaWatcherStarted = true;

  const ps = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

while ($true) {
  try {
    $sessions = $mgr.GetSessions()
    $musicPattern = 'Spotify|AppleMusic|Tidal|Deezer|AmazonMusic|SoundCloud|MusicBee|foobar2000|AIMP|iTunes|YouTubeMusic'
    $browserPattern = 'chrome|msedge|firefox|brave|opera|vivaldi|arc'
    $chosen = $null
    # 1. Prioritaskan Spotify yang sedang Playing
    foreach ($s in $sessions) {
      if ($s.SourceAppUserModelId -match 'Spotify' -and [string]$s.GetPlaybackInfo().PlaybackStatus -eq 'Playing') {
        $chosen = $s; break
      }
    }
    # 2. Kalau tidak ada, prioritaskan aplikasi Spotify meskipun Paused
    if (-not $chosen) {
      foreach ($s in $sessions) {
        if ($s.SourceAppUserModelId -match 'Spotify') {
          $chosen = $s; break
        }
      }
    }
    # 3. Kalau Spotify tidak buka, ambil aplikasi musik lain yang sedang Playing (abaikan browser/YouTube)
    if (-not $chosen) {
      foreach ($s in $sessions) {
        $id = [string]$s.SourceAppUserModelId
        if ($id -match $musicPattern -and $id -notmatch $browserPattern -and [string]$s.GetPlaybackInfo().PlaybackStatus -eq 'Playing') {
          $chosen = $s; break
        }
      }
    }
    # 4. Fallback hanya ke aplikasi musik lain (abaikan browser/YouTube)
    if (-not $chosen) {
      foreach ($s in $sessions) {
        $id = [string]$s.SourceAppUserModelId
        if ($id -match $musicPattern -and $id -notmatch $browserPattern) {
          $chosen = $s; break
        }
      }
    }

    if ($chosen) {
      $info = Await ($chosen.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $tl = $chosen.GetTimelineProperties()
      $pb = $chosen.GetPlaybackInfo()
      $livePos = $tl.Position.TotalSeconds
      if ([string]$pb.PlaybackStatus -eq 'Playing' -and $tl.LastUpdatedTime.Year -gt 2000) {
        $elapsed = ([DateTimeOffset]::UtcNow - $tl.LastUpdatedTime).TotalSeconds
        if ($elapsed -ge 0 -and $elapsed -lt 3600) {
          $livePos += $elapsed
        }
      }
      $obj = [PSCustomObject]@{
        app = [string]$chosen.SourceAppUserModelId
        title = [string]$info.Title
        artist = [string]$info.Artist
        album = [string]$info.AlbumTitle
        status = [string]$pb.PlaybackStatus
        positionSec = [double]$livePos
        durationSec = [double]$tl.EndTime.TotalSeconds
      }
      Write-Output ("MEDIA:" + ($obj | ConvertTo-Json -Compress))
    } else {
      Write-Output "MEDIA:NONE"
    }
  } catch {}
  Start-Sleep -Milliseconds 350
}
`;

  const child = execFile("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps]);
  let buffer = "";
  child.stdout?.on("data", (chunk: Buffer | string) => {
    buffer += String(chunk);
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("MEDIA:")) continue;
      const payload = line.slice(6).trim();
      if (payload === "NONE" || !payload.startsWith("{")) {
        latestMedia = null;
        continue;
      }
      try {
        const parsed = JSON.parse(payload);
        if (parsed && parsed.title) {
          latestMedia = {
            ...parsed,
            updatedAtMs: Date.now(),
          };
          ensureLyricsAndCoverLoaded(
            parsed.title,
            parsed.artist || "",
            parsed.album || "",
            Number(parsed.durationSec || 0)
          );
        }
      } catch {}
    }
  });
  child.on("exit", () => {
    mediaWatcherStarted = false;
    setTimeout(() => startMediaWatcher(), 2000);
  });
}

function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const m = raw.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)$/);
    if (!m) continue;
    const min = parseInt(m[1], 10);
    const sec = parseInt(m[2], 10);
    const msStr = (m[3] || "0").padEnd(3, "0");
    const ms = parseInt(msStr, 10);
    const text = m[4].trim();
    if (!text) continue;
    lines.push({ timeSec: min * 60 + sec + ms / 1000, text });
  }
  return lines.sort((a, b) => a.timeSec - b.timeSec);
}

async function ensureLyricsAndCoverLoaded(
  title: string,
  artist: string,
  album: string,
  durationSec: number
): Promise<void> {
  const cleanTitle = title.replace(/\s*[-–]\s*.*$/, "").replace(/\(.*?\)|\[.*?\]/g, "").trim() || title.trim();
  const cleanArtist = artist.replace(/\(.*?\)|\[.*?\]/g, "").trim();
  const key = `${cleanTitle}__${cleanArtist}`.toLowerCase();
  if (key === lastLyricsKey || lyricsFetching) return;

  lastLyricsKey = key;
  cachedLyrics = [];
  cachedPlainLyrics = [];
  cachedCoverUrl = "";
  lyricsFetching = true;

  try {
    // Fetch Album Cover Art from iTunes API in parallel
    const coverPromise = fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(`${cleanTitle} ${cleanArtist}`.trim())}&entity=song&limit=1`
    )
      .then((r) => r.json())
      .then((d: { results?: Array<{ artworkUrl100?: string }> }) => {
        const art = d.results?.[0]?.artworkUrl100;
        if (art) cachedCoverUrl = art.replace("100x100bb", "300x300bb");
      })
      .catch(() => {});

    // 1. Try exact duration-matched LRCLIB /api/get first if artist is present
    let loaded = false;
    if (cleanArtist && durationSec > 0) {
      try {
        const getUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}&duration=${Math.round(durationSec)}`;
        const rGet = await fetch(getUrl);
        if (rGet.ok) {
          const item = (await rGet.json()) as { syncedLyrics?: string; plainLyrics?: string };
          if (item.syncedLyrics) {
            cachedLyrics = parseLrc(item.syncedLyrics);
            loaded = cachedLyrics.length > 0;
          }
        }
      } catch {}
    }

    // 2. Fallback to /api/search sorted by closest duration to Spotify track
    if (!loaded) {
      const q = `${cleanTitle} ${cleanArtist}`.trim();
      const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const list = (await res.json()) as Array<{
          duration?: number;
          syncedLyrics?: string;
          plainLyrics?: string;
        }>;
        const syncedList = list.filter((item) => item.syncedLyrics && item.syncedLyrics.trim().length > 0);
        if (syncedList.length > 0) {
          if (durationSec > 0) {
            syncedList.sort(
              (a, b) => Math.abs((a.duration || 0) - durationSec) - Math.abs((b.duration || 0) - durationSec)
            );
          }
          cachedLyrics = parseLrc(syncedList[0].syncedLyrics!);
        } else if (list[0]?.plainLyrics) {
          cachedPlainLyrics = list[0].plainLyrics
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
        }
      }
    }

    await coverPromise;
  } catch {} finally {
    lyricsFetching = false;
  }
}

export async function getMediaWithLyrics(): Promise<{
  hasMedia: boolean;
  app: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  status: string;
  positionSec: number;
  durationSec: number;
  syncedLines: LyricLine[];
  prevLine: string;
  currentLine: string;
  nextLine: string;
}> {
  startMediaWatcher();
  const media = latestMedia;
  if (!media) {
    return {
      hasMedia: false,
      app: "",
      title: "",
      artist: "",
      album: "",
      coverUrl: "",
      status: "Stopped",
      positionSec: 0,
      durationSec: 0,
      syncedLines: [],
      prevLine: "",
      currentLine: "",
      nextLine: "",
    };
  }

  let livePos = media.positionSec;
  if (media.status === "Playing") {
    livePos += (Date.now() - media.updatedAtMs) / 1000;
  }
  if (media.durationSec > 0 && livePos > media.durationSec) {
    livePos = media.durationSec;
  }

  let prevLine = "";
  let currentLine = "";
  let nextLine = "";

  if (cachedLyrics.length > 0) {
    let activeIdx = 0;
    for (let i = 0; i < cachedLyrics.length; i++) {
      if (livePos + 0.25 >= cachedLyrics[i].timeSec) {
        activeIdx = i;
      } else {
        break;
      }
    }
    prevLine = cachedLyrics[activeIdx - 1]?.text || "";
    currentLine = cachedLyrics[activeIdx]?.text || "♪ ...";
    nextLine = cachedLyrics[activeIdx + 1]?.text || "";
  } else if (cachedPlainLyrics.length > 0) {
    const ratio = media.durationSec > 0 ? Math.min(0.99, Math.max(0, livePos / media.durationSec)) : 0;
    const idx = Math.floor(ratio * cachedPlainLyrics.length);
    prevLine = cachedPlainLyrics[idx - 1] || "";
    currentLine = cachedPlainLyrics[idx] || "";
    nextLine = cachedPlainLyrics[idx + 1] || "";
  } else {
    currentLine = lyricsFetching ? "Menyinkronkan lirik..." : "♪ Lirik belum tersedia";
  }

  return {
    hasMedia: true,
    app: media.app,
    title: media.title,
    artist: media.artist,
    album: media.album,
    coverUrl: cachedCoverUrl,
    status: media.status,
    positionSec: livePos,
    durationSec: media.durationSec,
    syncedLines: cachedLyrics,
    prevLine,
    currentLine,
    nextLine,
  };
}

export interface WordDocSpec {
  mode?: "kop_surat" | "freeform";
  append?: boolean; // true = lanjut di dokumen Word yang sedang terbuka, false = dokumen baru
  instansi: string;
  subInstansi: string;
  alamat: string;
  judul: string;
  isi: string[];
}

export function createLiveWordDocument(
  spec: WordDocSpec,
  onStep?: (step: string) => void
): Promise<boolean> {
  const payloadB64 = Buffer.from(JSON.stringify(spec), "utf-8").toString("base64");
  const ps = `
$json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${payloadB64}'))
$data = ConvertFrom-Json $json

Write-Output "STEP:Menghubungkan ke Microsoft Word di PC..."
$word = $null
try {
  $word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
} catch {}
if (-not $word) {
  $word = New-Object -ComObject Word.Application
}
$word.Visible = $true

if ($data.append -and $word.Documents.Count -gt 0) {
  $doc = $word.ActiveDocument
  $sel = $word.Selection
  $sel.EndKey(6) | Out-Null # wdStory (pindah ke bagian paling bawah dokumen aktif)
  $sel.TypeParagraph()
} else {
  $doc = $word.Documents.Add()
  $sel = $word.Selection
}
try { $word.Activate() } catch {}

function Type-Live([string]$text, [int]$delayMs = 16) {
  foreach ($ch in $text.ToCharArray()) {
    $sel.TypeText([string]$ch)
    Start-Sleep -Milliseconds $delayMs
  }
}

if ($data.mode -eq "freeform") {
  Write-Output "STEP:Mengetik teks lanjutan di Microsoft Word..."
  $sel.Font.Name = "Calibri"
  $sel.Font.Size = 12
  if ($data.judul) {
    $sel.Font.Size = 15
    $sel.Font.Bold = 1
    Type-Live ([string]$data.judul) 20
    $sel.Font.Bold = 0
    $sel.Font.Size = 12
    $sel.TypeParagraph()
    $sel.TypeParagraph()
  }
  foreach ($p in $data.isi) {
    Type-Live ([string]$p) 12
    $sel.TypeParagraph()
    $sel.TypeParagraph()
  }
  Write-Output "STEP:DONE"
  exit 0
}

Write-Output "STEP:Membuat Kop Surat di Microsoft Word..."
# 1. Kop Surat (Centered, Bold)
$sel.ParagraphFormat.Alignment = 1 # wdAlignParagraphCenter
$sel.Font.Name = "Times New Roman"
$sel.Font.Size = 16
$sel.Font.Bold = 1
Type-Live ([string]$data.instansi).ToUpper() 22
$sel.TypeParagraph()

if ($data.subInstansi) {
  $sel.Font.Size = 13
  $sel.Font.Bold = 1
  Type-Live ([string]$data.subInstansi).ToUpper() 18
  $sel.TypeParagraph()
}

$sel.Font.Size = 10
$sel.Font.Bold = 0
$sel.Font.Italic = 1
Type-Live ([string]$data.alamat) 14
$sel.Font.Italic = 0

# Garis Bawah Kop Surat
$sel.ParagraphFormat.Borders.Item(-3).LineStyle = 7 # wdBorderBottom double line
$sel.TypeParagraph()
$sel.ParagraphFormat.Borders.Item(-3).LineStyle = 0
$sel.TypeParagraph()

Write-Output "STEP:Mengetik isi laporan secara live di Microsoft Word..."
# 2. Judul Laporan / Surat
$sel.Font.Size = 14
$sel.Font.Bold = 1
$sel.Font.Underline = 1
Type-Live ([string]$data.judul).ToUpper() 22
$sel.Font.Underline = 0
$sel.Font.Bold = 0
$sel.TypeParagraph()
$sel.TypeParagraph()

# 3. Isi Paragraf (Rata Kiri-Kanan / Justify)
$sel.ParagraphFormat.Alignment = 3 # wdAlignParagraphJustify
$sel.Font.Size = 12
foreach ($p in $data.isi) {
  Type-Live ("    " + [string]$p) 10
  $sel.TypeParagraph()
  $sel.TypeParagraph()
}
Write-Output "STEP:DONE"
`;
  return new Promise((resolve) => {
    const child = execFile("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps]);
    child.stdout?.on("data", (chunk: Buffer | string) => {
      const lines = String(chunk).split(/\r?\n/);
      for (const l of lines) {
        if (l.startsWith("STEP:")) {
          const stepText = l.slice(5).trim();
          if (stepText === "DONE") {
            if (onStep) onStep("");
          } else if (onStep) {
            onStep(stepText);
          }
        }
      }
    });
    // Resolve once Word has opened and started typing so the chat reply doesn't hang forever, while onStep keeps tracking until DONE!
    setTimeout(() => resolve(true), 2200);
    child.on("exit", () => {
      if (onStep) onStep("");
      resolve(true);
    });
  });
}

// ---------------------------------------------------------
// 6. PINTEREST IMAGE DOWNLOADER & SMART WORD GRID / GAP-PER-GAP
// ---------------------------------------------------------
export type GridAspect = "square" | "tall" | "wide" | "any";

export async function downloadPinterestImages(
  query: string,
  count: number,
  aspect: GridAspect = "any",
  onStep?: (step: string) => void
): Promise<{ files: string[]; folder: string }> {
  const outDir = path.join(os.homedir(), "Downloads", "Opera_Pinterest");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  let qft = "";
  if (aspect === "square") qft = "&qft=+filterui:aspect-square";
  else if (aspect === "tall") qft = "&qft=+filterui:aspect-tall";
  else if (aspect === "wide") qft = "&qft=+filterui:aspect-wide";

  if (onStep) onStep(`Mencari ${count} gambar "${query}" di Pinterest (${aspect})...`);

  const searchQ = /pinterest/i.test(query) ? query : `${query} pinterest aesthetic`;
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(searchQ)}&form=HDRSC2${qft}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  });
  const html = await res.text();
  const matches = [
    ...html.matchAll(/murl&quot;:&quot;(https?:\/\/[^&]+?\.(?:jpg|jpeg|png))&quot;/gi),
  ].map((m) => m[1]);

  const savedFiles: string[] = [];
  const safeSlug = query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24) || "pin";

  for (let i = 0; i < matches.length && savedFiles.length < count; i++) {
    const imgUrl = matches[i];
    try {
      if (onStep) {
        onStep(`Mengunduh gambar ${savedFiles.length + 1}/${count} dari Pinterest...`);
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 7000);
      const rImg = await fetch(imgUrl, {
        signal: ctrl.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        },
      });
      clearTimeout(timer);
      if (!rImg.ok) continue;
      const buf = Buffer.from(await rImg.arrayBuffer());
      if (buf.length < 6000) continue; // skip broken/tiny thumbnails
      const ext = imgUrl.toLowerCase().endsWith(".png") ? ".png" : ".jpg";
      const filePath = path.join(outDir, `${safeSlug}_${Date.now()}_${savedFiles.length + 1}${ext}`);
      fs.writeFileSync(filePath, buf);
      savedFiles.push(filePath);
    } catch {}
  }

  return { files: savedFiles, folder: outDir };
}

export interface WordImageLayoutSpec {
  title: string;
  files: string[];
  useGrid: boolean; // Default: false (Grid OFF unless user explicitly asked for grid)
  append?: boolean; // true = tambahkan ke dokumen Word yang sedang aktif
  withExplanation: boolean;
  explanations: string[]; // One explanation per photo for gap-per-gap mode
}

export function insertImagesIntoWordLive(
  spec: WordImageLayoutSpec,
  onStep?: (step: string) => void
): Promise<boolean> {
  const n = spec.files.length;
  // Tentukan ukuran grid & dimensi foto (dalam points) agar pas dengan grid
  let rows = 1;
  let cols = 1;
  let imgW = 330;
  let imgH = 230;

  if (spec.useGrid && n >= 2) {
    if (n === 2) {
      rows = 1;
      cols = 2;
      imgW = 215;
      imgH = 215;
    } else if (n === 3) {
      rows = 1;
      cols = 3;
      imgW = 142;
      imgH = 190;
    } else if (n === 4) {
      rows = 2;
      cols = 2;
      imgW = 215;
      imgH = 160;
    } else {
      cols = 3;
      rows = Math.ceil(n / 3);
      imgW = 142;
      imgH = 142;
    }
  }

  const payload = {
    ...spec,
    rows,
    cols,
    imgW,
    imgH,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64");

  const ps = `
$json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${payloadB64}'))
$data = ConvertFrom-Json $json

Write-Output "STEP:Menghubungkan ke Microsoft Word di PC..."
$word = $null
try {
  $word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
} catch {}
if (-not $word) {
  $word = New-Object -ComObject Word.Application
}
$word.Visible = $true
if ($data.append -and $word.Documents.Count -gt 0) {
  $doc = $word.ActiveDocument
  $sel = $word.Selection
  $sel.EndKey(6) | Out-Null # wdStory (lanjut di bawah dokumen aktif)
  $sel.TypeParagraph()
} else {
  $doc = $word.Documents.Add()
  $sel = $word.Selection
}
try { $word.Activate() } catch {}

function Type-Live([string]$text, [int]$delayMs = 14) {
  foreach ($ch in $text.ToCharArray()) {
    $sel.TypeText([string]$ch)
    Start-Sleep -Milliseconds $delayMs
  }
}

# Judul
if ($data.title) {
  $sel.ParagraphFormat.Alignment = 1 # Center
  $sel.Font.Name = "Calibri"
  $sel.Font.Size = 16
  $sel.Font.Bold = 1
  Type-Live ([string]$data.title) 20
  $sel.Font.Bold = 0
  $sel.TypeParagraph()
  $sel.TypeParagraph()
}

if ($data.useGrid -and $data.files.Count -ge 2) {
  Write-Output ("STEP:Menyusun Grid " + $data.rows + "x" + $data.cols + " untuk " + $data.files.Count + " foto di Microsoft Word...")
  $table = $doc.Tables.Add($sel.Range, [int]$data.rows, [int]$data.cols)
  $table.Borders.Enable = 0
  $idx = 0
  for ($r = 1; $r -le [int]$data.rows; $r++) {
    for ($c = 1; $c -le [int]$data.cols; $c++) {
      if ($idx -lt $data.files.Count) {
        $imgPath = [string]$data.files[$idx]
        if (Test-Path $imgPath) {
          $cell = $table.Cell($r, $c)
          $cell.Range.ParagraphFormat.Alignment = 1
          $shape = $cell.Range.InlineShapes.AddPicture($imgPath)
          $shape.LockAspectRatio = 0
          $shape.Width = [single]$data.imgW
          $shape.Height = [single]$data.imgH
        }
        $idx++
        Start-Sleep -Milliseconds 250
      }
    }
  }
  $sel.EndKey(6) | Out-Null # wdStory
  $sel.TypeParagraph()
  if ($data.withExplanation -and $data.explanations.Count -gt 0) {
    Write-Output "STEP:Mengetik penjelasan gambar di bawah Grid..."
    $sel.ParagraphFormat.Alignment = 3 # Justify
    $sel.Font.Size = 12
    foreach ($exp in $data.explanations) {
      Type-Live ([string]$exp) 12
      $sel.TypeParagraph()
    }
  }
} else {
  # Mode Default (Grid OFF): Masukkan foto satu per satu dengan gap & penjelasan per foto
  for ($i = 0; $i -lt $data.files.Count; $i++) {
    $imgPath = [string]$data.files[$i]
    if (Test-Path $imgPath) {
      Write-Output ("STEP:Memasukkan foto " + ($i + 1) + "/" + $data.files.Count + " ke Microsoft Word (Grid: OFF)...")
      $sel.ParagraphFormat.Alignment = 1 # Center
      $shape = $sel.InlineShapes.AddPicture($imgPath)
      $shape.LockAspectRatio = -1
      $shape.Width = 310
      $sel.TypeParagraph()
      Start-Sleep -Milliseconds 250

      if ($data.withExplanation -and $i -lt $data.explanations.Count -and $data.explanations[$i]) {
        Write-Output ("STEP:Mengetik penjelasan untuk foto " + ($i + 1) + " (gap per gap)...")
        $sel.ParagraphFormat.Alignment = 3 # Justify
        $sel.Font.Size = 12
        Type-Live ([string]$data.explanations[$i]) 12
        $sel.TypeParagraph()
      }
      # Gap antar foto
      $sel.TypeParagraph()
    }
  }
}
Write-Output "STEP:DONE"
`;

  return new Promise((resolve) => {
    const child = execFile("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps]);
    child.stdout?.on("data", (chunk: Buffer | string) => {
      const lines = String(chunk).split(/\r?\n/);
      for (const l of lines) {
        if (l.startsWith("STEP:")) {
          const stepText = l.slice(5).trim();
          if (stepText === "DONE") {
            if (onStep) onStep("");
          } else if (onStep) {
            onStep(stepText);
          }
        }
      }
    });
    setTimeout(() => resolve(true), 2400);
    child.on("exit", () => {
      if (onStep) onStep("");
      resolve(true);
    });
  });
}
