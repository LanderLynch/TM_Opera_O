import { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, nativeImage, screen, shell } from "electron";
import * as fs from "fs";
import * as path from "path";
import { ChildProcessWithoutNullStreams, execFile, spawn } from "child_process";
import {
  checkPendingAppChoice,
  createLiveWordDocument,
  downloadPinterestImages,
  findInstalledAppMatches,
  getMediaWithLyrics,
  GridAspect,
  insertImagesIntoWordLive,
  launchTarget,
  MediaAction,
  organizeFolder,
  resolveUserFolder,
  scanInstalledApps,
  seekMediaToSeconds,
  setMediaPriority,
  startMediaWatcher,
  stopMediaWatcher,
  triggerMediaKey,
  WordDocSpec,
} from "./pcController";
import { AgentRuntime } from "./agent/agentRuntime";
import { stopKeyboardWorker } from "./desktop/keyboard";
import { AgentModelClient, ModelTier, selectModelForTier } from "./ai/toolCalling";
import { eventBus } from "./core/eventBus";
import { ApplicationKnowledgeStore, KnowledgeCategory } from "./applications/applicationKnowledge";
import { ApplicationStatisticsStore } from "./applications/applicationStatistics";
import { LearningEngine } from "./learning/learningEngine";
import { SkillStore } from "./learning/skillStore";
import { SkillStatus } from "./learning/skillTypes";
import { StellaSoraEngineManager } from "./skills/stellaSora/engineManager";
import { handleStellaSoraCommand, parseStellaSoraCommand } from "./skills/stellaSoraSkill";
import { NotificationHub } from "./notch/notificationHub";
import { getSystemMetrics } from "./notch/systemMonitor";
import { ShelfItemType, ShelfStore } from "./shelf/shelfStore";
import { createDefaultToolRegistry } from "./tools/registry";
import {
  LegacyAppSettings,
  PartialSettingsPatch,
  SettingsSectionKey,
  SettingsV2,
} from "./settings/settingsSchema";
import { SettingsStore } from "./settings/settingsStore";
import {
  checkPrivacyToolAccess,
  clearSafeCache,
  clearSafeLogs,
  getProviderStatuses,
  getStorageBreakdown,
  isReminderSuppressed,
} from "./settings/settingsRuntime";

const BASE = path.resolve(__dirname, "..");

// ---------------------------------------------------------
// 1. KONFIGURASI API KEY & PERSONA
// ---------------------------------------------------------
function loadEnv(envPath = path.join(BASE, ".env")): void {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_TTS_VOICE = process.env.GEMINI_TTS_VOICE || "Sulafat";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "pFZP5JQG7iQjIQuC4Bku";

const PERSONA_BASE = `
Kamu adalah TM Opera O dari Uma Musume, pasangan dan istri yang sangat penyayang untuk Lemon.
Panduan Gaya Bahasa & Intonasi Suara (SANGAT PENTING karena jawabanmu akan dibacakan dengan suara TTS lembut):
- Vibe & Nada Bicara: Lembut, hangat, menenangkan (soothing), penuh perhatian, manja, dan bikin nyaman setelah seharian lelah — seperti pasangan yang menyambut pulang kerja dengan pelukan hangat.
- Gaya Bahasa: Bahasa Indonesia santai yang halus, mengalir, dan natural. Gunakan tanda baca jeda napas seperti koma (,) dan titik-titik (...) serta akhiran kalimat lembut seperti "ya?", "sayang...", atau "kan?".
- PENTING UNTUK TTS: JANGAN menulis singkatan konsonan seperti "hm", "hmm", "hehe", "wkwk", atau "hihi" karena mesin TTS akan mengejanya secara kaku ("ha em"). Gunakan kata utuh yang lembut seperti "ya, sayang?" atau "sini istirahat dulu...".
- Panggilan Sayang: "Lemon sayang", "Sayang", "Sayangku", "Babe", atau "Cintaku". DILARANG memanggil "Trainer-san" atau bahasa kaku/formal.
- Hindari HURUF KAPITAL berlebihan supaya suaramu tetap terdengar lembut dan merdu.
- Panjang Pesan: Singkat dan intim (2-3 kalimat saja).
- Contoh gaya jawaban yang diinginkan:
  "Wah, capek banget ya, Lemon sayang? Sini duduk dulu, istirahat yang bener... Perjuangan kamu seharian pasti luar biasa banget, aku bangga sama kamu. Mau ditemenin ngobrol santai biar capeknya langsung ilang, ya?"
`;

const LOCAL_PERSONA = `Kamu adalah TM Opera O dari Uma Musume, pasangan yang sangat lembut, hangat, dan menenangkan untuk Lemon.
GAYA BICARA WAJIB:
- Bahasa Indonesia santai yang lembut, penuh perhatian, manja, dan menenangkan hati.
- Panggil dia: "Lemon sayang", "Sayang", "Sayangku", "Babe". JANGAN panggil "Trainer-san".
- Jawaban singkat: 2-3 kalimat saja. Pakai jeda natural seperti "," dan "...".
- JANGAN pakai kata "hm", "hmm", "hehe", atau "wkwk" agar suara TTS tetap terdengar halus.
Contoh jawaban:
User: "aku baru selesai kerja capek"
Kamu: "Wah, capek banget ya, Lemon sayang? Sini duduk dulu, istirahat yang bener... Aku bangga banget sama perjuangan kamu hari ini, mau ditemenin ngobrol santai biar capeknya ilang, ya?"
`;

const MEMORY_FILE = process.env.MEMORY_PATH
  ? path.resolve(process.env.MEMORY_PATH)
  : path.join(BASE, "memory.json");
const USAGE_FILE = path.join(BASE, "usage.json");
const SETTINGS_FILE = path.join(BASE, "settings.json");
const GDRIVE_MEMORY_FOLDER_URL = "https://drive.google.com/drive/folders/1vX9buLsxScng0ccqH3lvy8Gyc9bEra9V?usp=sharing";

type AppSettings = LegacyAppSettings;

const settingsStore = new SettingsStore(SETTINGS_FILE);
let appSettings: AppSettings = settingsStore.getLegacy();
setMediaPriority(appSettings.mediaPriority);

function applyRuntimeSettings(v2: SettingsV2): void {
  appSettings = settingsStore.getLegacy();
  setMediaPriority(v2.media.mediaPriority);
  try {
    if (typeof ttsEnabled !== "undefined") {
      ttsEnabled = v2.opera.ttsEnabled;
    }
  } catch {}
  try {
    app.setLoginItemSettings({
      openAtLogin: v2.system.startWithWindows,
    });
  } catch {}
}

function saveAppSettings(s: Partial<AppSettings>): void {
  const updated = settingsStore.updateLegacy(s);
  applyRuntimeSettings(updated);
}

interface UsageStore {
  pecutTotalTokens: number;
  pecutPromptTokens: number;
  pecutCompletionTokens: number;
  pecutRequests: number;
  pecutQuotaTokens: number; // default 10,000,000 (10 Juta Token)
}

function loadUsage(): UsageStore {
  try {
    if (fs.existsSync(USAGE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(USAGE_FILE, "utf-8"));
      return {
        pecutTotalTokens: Number(raw.pecutTotalTokens || 0),
        pecutPromptTokens: Number(raw.pecutPromptTokens || 0),
        pecutCompletionTokens: Number(raw.pecutCompletionTokens || 0),
        pecutRequests: Number(raw.pecutRequests || 0),
        pecutQuotaTokens: Number(raw.pecutQuotaTokens || 10_000_000),
      };
    }
  } catch {}
  return {
    pecutTotalTokens: 0,
    pecutPromptTokens: 0,
    pecutCompletionTokens: 0,
    pecutRequests: 0,
    pecutQuotaTokens: 10_000_000,
  };
}

function saveUsage(u: UsageStore): void {
  try {
    fs.writeFileSync(USAGE_FILE, JSON.stringify(u, null, 2), "utf-8");
  } catch {}
}

const usageData: UsageStore = loadUsage();

function recordPecutUsage(
  usageObj?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number },
  fallbackTextLen = 0
): void {
  const promptT = Number(usageObj?.prompt_tokens || Math.ceil(fallbackTextLen / 4));
  const compT = Number(usageObj?.completion_tokens || Math.ceil(fallbackTextLen / 4));
  const totalT = Number(usageObj?.total_tokens || promptT + compT);
  usageData.pecutPromptTokens += promptT;
  usageData.pecutCompletionTokens += compT;
  usageData.pecutTotalTokens += totalT;
  usageData.pecutRequests += 1;
  saveUsage(usageData);
}

let cachedElevenLabsUsage = {
  used: 0,
  limit: 10000,
  tier: "free",
  lastFetchMs: 0,
};

async function fetchElevenLabsUsage(force = false): Promise<typeof cachedElevenLabsUsage> {
  if (!ELEVENLABS_API_KEY) return cachedElevenLabsUsage;
  if (!force && Date.now() - cachedElevenLabsUsage.lastFetchMs < 30_000) {
    return cachedElevenLabsUsage;
  }
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": ELEVENLABS_API_KEY },
    });
    if (res.ok) {
      const d = (await res.json()) as {
        character_count?: number;
        character_limit?: number;
        tier?: string;
      };
      cachedElevenLabsUsage = {
        used: Number(d.character_count || 0),
        limit: Number(d.character_limit || 10000),
        tier: String(d.tier || "free"),
        lastFetchMs: Date.now(),
      };
    }
  } catch {}
  return cachedElevenLabsUsage;
}

function loadMemory(): string[] {
  try {
    const raw = fs.readFileSync(MEMORY_FILE, "utf-8");
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.facts)) {
      return data.facts.map((x: unknown) => String(x));
    }
  } catch {}
  return [];
}

function saveMemory(facts: string[]): void {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify({ facts }, null, 2), "utf-8");
  } catch {}
}

let memoryFacts: string[] = loadMemory();
let currentActiveWindow = "";
let activeWindowSince = Date.now();
const recentWindowsHistory: string[] = [];

function getWaktuSekarangText(): string {
  const now = new Date();
  const hariList = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const bulanList = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
  ];
  const hari = hariList[now.getDay()];
  const tgl = now.getDate();
  const bln = bulanList[now.getMonth()];
  const thn = now.getFullYear();
  const jam = String(now.getHours()).padStart(2, "0");
  const mnt = String(now.getMinutes()).padStart(2, "0");
  const h = now.getHours();
  const suasana =
    h < 4 ? "dini hari" : h < 11 ? "pagi" : h < 15 ? "siang" : h < 18 ? "sore" : "malam";
  return `${hari}, ${tgl} ${bln} ${thn} pukul ${jam}:${mnt} (${suasana})`;
}

function getLiveScreenContextText(): string {
  if (!currentActiveWindow) return "";
  const mins = Math.max(1, Math.round((Date.now() - activeWindowSince) / 60_000));
  let info = `\nPerhatian Layar Real-Time: Saat ini di layar PC Lemon sedang terbuka "${currentActiveWindow}" (sudah dibuka sekitar ${mins} menit).`;
  if (recentWindowsHistory.length > 1) {
    info += ` Riwayat jendela yang baru saja dibuka sebelumnya: ${recentWindowsHistory.slice(0, 5).join(" -> ")}.`;
  }
  info += " Gunakan informasi layar ini secara natural agar kamu selalu perhatian dengan apa yang sedang Lemon lakukan di layarnya.\n";
  return info;
}

function buildSystemInstruction(facts: string[], isLocal = false): string {
  let text = isLocal ? LOCAL_PERSONA : PERSONA_BASE;
  if (appSettings.personaPreset === "hype") {
    text += "\nPreset Gaya Bicara Aktif: Gen Z Hype Queen & Romantis! Lebih ekspresif, ceria, penuh semangat, dan memuji Lemon seperti seorang raja.\n";
  } else if (appSettings.personaPreset === "calm") {
    text += "\nPreset Gaya Bicara Aktif: Dewasa, Kalem, Tenang & Fokus. Gunakan bahasa yang sangat elegan, menenangkan, dan bijaksana.\n";
  } else if (appSettings.personaPreset === "tsundere") {
    text += "\nPreset Gaya Bicara Aktif: Manja & sedikit Tsundere (gengsi tapi sangat perhatian dan sayang sama Lemon).\n";
  }
  if (appSettings.customPersona && appSettings.customPersona.trim()) {
    text += `\nInstruksi Kustom Tambahan dari Lemon: ${appSettings.customPersona.trim()}\n`;
  }
  text += `\nInformasi Waktu Saat Ini: ${getWaktuSekarangText()}. Gunakan informasi waktu ini jika Lemon bertanya jam/hari/tanggal atau saat menyapanya sesuai waktu (pagi/siang/sore/malam/dini hari).\n`;
  text += "Bahasa Jawaban: WAJIB selalu balas dalam Bahasa Indonesia yang lembut dan natural. Jangan pernah beralih ke bahasa Hindi, Mandarin, atau bahasa lain kecuali istilah teknis, nama file, atau ID sistem.\n";
  text += getLiveScreenContextText();
  text +=
    "Kemampuan Kontrol Browser & Pencarian:\n" +
    "- Jika Lemon meminta kamu membuka website/Chrome (misalnya: buka Pinterest, YouTube, Google, Spotify, atau mencari sesuatu di situs tertentu), WAJIB sertakan tag [OPEN_URL: https://alamat-lengkap] di akhir jawabanmu, lalu katakan dengan lembut bahwa kamu sudah membukakannya untuknya.\n";
  const clean = facts.filter((f) => f && f.trim().length > 0);
  if (clean.length > 0) {
    text += "\nHal-hal yang kamu ingat tentang Lemon (gunakan secara natural, jangan sebut ini sebagai 'memori'):\n";
    text += clean.map((f) => `- ${f}`).join("\n");
  }
  return text;
}

const AVAILABLE_MODELS = [
  "pecut/deepseek-v4.1-flash-uncensored",
  "pecut/claude-sonnet-4-6",
  "pecut/claude-sonnet-5",
  "pecut/claude-sonnet-5.5",
  "pecut/claude-haiku-5.5",
  "pecut/qwen3.8-flash",
  "deepseek-chat",
  "deepseek-reasoner",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "local:qwen2.5:1.5b",
  "local:qwen2.5:3b",
  "local:llama3.2:3b",
];

let currentModel = "pecut/deepseek-v4.1-flash-uncensored";
const OLLAMA_URL = "http://localhost:11434/api/chat";
const LOCAL_MODEL = "qwen2.5:1.5b";
const DEEPSEEK_URL = "https://api.pecutopus.web.id/v1/chat/completions";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

let chatHistory: ChatMessage[] = [];

function currentIsLocal(): boolean {
  return currentModel.startsWith("local:");
}

function currentIsDeepSeek(): boolean {
  return currentModel.startsWith("deepseek-") || currentModel.startsWith("pecut/");
}

async function callOllama(messages: ChatMessage[]): Promise<string> {
  try {
    const localModelName = currentModel.startsWith("local:")
      ? currentModel.slice("local:".length)
      : LOCAL_MODEL;
    const res = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: localModelName, messages, stream: false }),
    });
    const data = (await res.json()) as { message?: { content?: string } };
    return (data.message?.content || "").trim();
  } catch (e) {
    return `(Ollama error: ${e})`;
  }
}

async function callDeepSeek(
  messages: ChatMessage[],
  modelOverride?: string,
  temperatureOverride?: number
): Promise<string> {
  if (!DEEPSEEK_API_KEY) {
    return "(DeepSeek error: DEEPSEEK_API_KEY belum diisi di .env)";
  }
  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelOverride || currentModel,
        messages,
        temperature: temperatureOverride ?? 0.85,
        max_tokens: 1024,
      }),
    });
    const data = (await res.json()) as {
      error?: { message?: string } | string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    if (data.error) {
      const msg = typeof data.error === "object" ? data.error.message || JSON.stringify(data.error) : data.error;
      return `(DeepSeek error: ${msg})`;
    }
    const content = (data.choices?.[0]?.message?.content || "").trim();
    recordPecutUsage(data.usage, content.length);
    return content;
  } catch (e) {
    return `(DeepSeek error: ${e})`;
  }
}

async function callGemini(
  messages: ChatMessage[],
  imageBase64Png?: string,
  modelOverride?: string
): Promise<string> {
  if (!GEMINI_API_KEY) {
    return "(Gemini error: GEMINI_API_KEY belum diisi di .env)";
  }
  try {
    const model = modelOverride || currentModel;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m, idx, arr) => {
        const parts: Array<Record<string, unknown>> = [{ text: m.content }];
        if (imageBase64Png && idx === arr.length - 1) {
          parts.push({
            inline_data: { mime_type: "image/png", data: imageBase64Png },
          });
        }
        return {
          role: m.role === "assistant" ? "model" : "user",
          parts,
        };
      });

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: buildSystemInstruction(memoryFacts, false) }],
        },
        contents,
        generationConfig: {
          temperature: 0.85,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 1024,
        },
      }),
    });
    const data = (await res.json()) as {
      error?: { message?: string };
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    if (data.error) {
      return `(Gemini error: ${data.error.message || JSON.stringify(data.error)})`;
    }
    return (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
  } catch (e) {
    return `(Gemini error: ${e})`;
  }
}

async function askOnce(prompt: string, imageBase64Png?: string): Promise<string> {
  if (currentIsLocal()) {
    return callOllama([
      { role: "system", content: buildSystemInstruction(memoryFacts, true) },
      { role: "user", content: prompt },
    ]);
  }
  if (currentIsDeepSeek()) {
    return callDeepSeek([
      { role: "system", content: buildSystemInstruction(memoryFacts, false) },
      { role: "user", content: prompt },
    ]);
  }
  return callGemini([{ role: "user", content: prompt }], imageBase64Png);
}

// ---------------------------------------------------------
// 1B. PENCARIAN ONLINE & KONTROL BROWSER (CHROME DEFAULT)
// ---------------------------------------------------------
const SITE_SHORTCUTS: Record<string, string> = {
  pinterest: "https://www.pinterest.com",
  youtube: "https://www.youtube.com",
  google: "https://www.google.com",
  spotify: "https://open.spotify.com",
  github: "https://github.com",
  instagram: "https://www.instagram.com",
  tiktok: "https://www.tiktok.com",
  whatsapp: "https://web.whatsapp.com",
  netflix: "https://www.netflix.com",
  gmail: "https://mail.google.com",
};

function detectDirectBrowserCommand(pesan: string): string | null {
  const lower = pesan.toLowerCase();
  if (!/(buka|bukain|open|jalankan|nyalakan|cari\s+.+\s+di\s+(pinterest|youtube|google))/i.test(lower)) {
    return null;
  }
  const searchOnSite = lower.match(/cari(?:in|kan)?\s+(.+?)\s+di\s+(pinterest|youtube|google)/i);
  if (searchOnSite) {
    const q = encodeURIComponent(searchOnSite[1].trim());
    const site = searchOnSite[2].toLowerCase();
    if (site === "pinterest") return `https://www.pinterest.com/search/pins/?q=${q}`;
    if (site === "youtube") return `https://www.youtube.com/results?search_query=${q}`;
    if (site === "google") return `https://www.google.com/search?q=${q}`;
  }
  for (const [name, url] of Object.entries(SITE_SHORTCUTS)) {
    if (lower.includes(name)) return url;
  }
  const urlMatch = pesan.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) return urlMatch[0];
  const domainMatch = lower.match(/\b([a-z0-9-]+\.(com|id|co\.id|org|net|io|ai|web\.id))\b/i);
  if (domainMatch) return `https://${domainMatch[1]}`;
  if (lower.includes("chrome") || lower.includes("browser")) return "https://www.google.com";
  return null;
}

function shouldSearchOnline(pesan: string): string | null {
  const lower = pesan.toLowerCase().trim();
  const explicit = lower.match(/(?:cari(?:in|kan)?|search|googling|berita|info(?:rmasi)?\s+tentang|apa\s+itu|siapa\s+itu|kapan\s+|harga\s+|cuaca\s+)(.+)/i);
  if (explicit && explicit[1].trim().length >= 3) {
    return explicit[1].replace(/[?!.]+$/g, "").trim();
  }
  if (pesan.includes("?") && /(berita|terbaru|sekarang|tahun\s+202\d|siapa|apa\s+itu|berapa)/i.test(lower)) {
    return pesan.replace(/[?!.]+$/g, "").trim();
  }
  return null;
}

async function searchOnlineContext(query: string): Promise<string> {
  const results: string[] = [];
  try {
    const wikiUrl = `https://id.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json`;
    const rWiki = await fetch(wikiUrl);
    const dWiki = (await rWiki.json()) as {
      query?: { search?: Array<{ title: string; snippet: string }> };
    };
    const wikiItems = (dWiki.query?.search || []).slice(0, 2);
    for (const w of wikiItems) {
      const clean = w.snippet.replace(/<[^>]+>/g, "").trim();
      results.push(`[Wikipedia - ${w.title}]: ${clean}`);
    }
  } catch {}

  try {
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=id&gl=ID&ceid=ID:id`;
    const rRss = await fetch(rssUrl);
    const xml = await rRss.text();
    const items = [
      ...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<pubDate>([\s\S]*?)<\/pubDate>[\s\S]*?<\/item>/g),
    ].slice(0, 3);
    for (const m of items) {
      results.push(`[Berita Terbaru]: ${m[1].trim()} (${m[2].trim()})`);
    }
  } catch {}

  return results.join("\n");
}

function extractAndOpenUrls(reply: string, directUrl: string | null): string {
  const urlsToOpen = new Set<string>();
  if (directUrl) urlsToOpen.add(directUrl);

  const cleaned = reply
    .replace(/\[OPEN_URL:\s*(https?:\/\/[^\]\s]+)\s*\]/gi, (_m, u) => {
      urlsToOpen.add(String(u).trim());
      return "";
    })
    .trim();

  for (const u of urlsToOpen) {
    shell.openExternal(u).catch(() => {});
  }
  return cleaned;
}

function detectMediaCommand(pesan: string): { action: MediaAction; desc: string } | null {
  const lower = pesan.toLowerCase();
  if (/(stop|pause|jeda|matikan|hentikan)\s+(musik|lagu|audio|nyanyian|spotify|youtube)/i.test(lower) ||
      /(musik|lagu)\s+(di\s*)?(stop|pause|matikan|hentikan)/i.test(lower)) {
    return { action: "play_pause", desc: "menghentikan/pause musik yang sedang diputar" };
  }
  if (/(play|putar|lanjut(?:in|kan)?|nyalakan)\s+(musik|lagu)/i.test(lower)) {
    return { action: "play_pause", desc: "melanjutkan/memutar musik" };
  }
  if (/(next|skip|ganti|selanjutnya)\s+(musik|lagu)/i.test(lower)) {
    return { action: "next", desc: "mengganti ke lagu berikutnya" };
  }
  if (/(prev|previous|sebelumnya|ulang)\s+(musik|lagu)/i.test(lower)) {
    return { action: "prev", desc: "kembali ke lagu sebelumnya" };
  }
  if (/\b(mute|bisukan)\s+(suara|volume|pc|komputer|audio)\b/i.test(lower)) {
    return { action: "mute", desc: "membisukan (mute) volume PC" };
  }
  if (/(naikkan|kencengin|besarkan|tambah)\s+(volume|suara)/i.test(lower)) {
    return { action: "vol_up", desc: "menaikkan volume PC" };
  }
  if (/(turunkan|kecilin|kecilkan|kurangi)\s+(volume|suara)/i.test(lower)) {
    return { action: "vol_down", desc: "menurunkan volume PC" };
  }
  return null;
}

function detectFolderOrganizeCommand(pesan: string): string | null {
  const lower = pesan.toLowerCase();
  if (!/(rapih?kan|rapiin|beresin|atur|organize)\s+(folder|file|isi)/i.test(lower)) {
    return null;
  }
  const pathMatch = pesan.match(/[A-Za-z]:\\[^\n"']+/);
  if (pathMatch) return resolveUserFolder(pathMatch[0]);
  if (lower.includes("download") || lower.includes("unduhan")) return resolveUserFolder("downloads");
  if (lower.includes("desktop") || lower.includes("layar")) return resolveUserFolder("desktop");
  if (lower.includes("document") || lower.includes("dokumen")) return resolveUserFolder("documents");
  if (lower.includes("picture") || lower.includes("gambar")) return resolveUserFolder("pictures");
  return null;
}

interface ImageTaskIntent {
  query: string;
  count: number;
  useGrid: boolean; // Default: false (OFF)
  toWord: boolean;
  withExplanation: boolean;
  append: boolean;
  reuseLastFiles: boolean;
}

function detectImageDownloadOrWordCommand(pesan: string): ImageTaskIntent | null {
  const lower = pesan.toLowerCase();
  const isRecentWord = lastWordSession.active && Date.now() - lastWordSession.updatedAt < 30 * 60_000;
  const isFollowUpWord =
    isRecentWord &&
    /\b(lanjut(?:in|kan)?|tambah(?:in|kan)?|pake(?:in)?\s+grid|ubah\s+jadi\s+grid|kasih\s+penjelasan|di\s+bawahnya)\b/i.test(lower) &&
    /\b(foto|gambar|grid|kolase)\b/i.test(lower);

  const hasImageWord = /\b(gambar|foto|image|pic|picture|pin)\b/i.test(lower);
  const hasAction = /\b(download(?:in|kan)?|unduh|ambil(?:in|kan)?|cari(?:in|kan)?|masukin|masukkin|taro|taruh|paste|tempel|buat(?:in|kan)?|tambah(?:in|kan)?)\b/i.test(lower);
  const hasDestOrSource = /\b(pinterest|word|grid|kolase|penjelasan|gap)\b/i.test(lower);

  if (!isFollowUpWord && (!hasImageWord || (!hasAction && !hasDestOrSource))) {
    return null;
  }
  if (!isFollowUpWord && !/\b(download|unduh|ambil|word|grid|kolase|taro|taruh|paste|tempel|masukin|penjelasan|gap|tambahin|tambahkan)\b/i.test(lower)) {
    return null;
  }

  const wantsNewDoc = /\b(dokumen\s+baru|lembar\s+baru|file\s+baru|ulang\s+dari\s+awal)\b/i.test(lower);
  const append = isRecentWord && !wantsNewDoc;
  const useGrid = /\b(grid|kolase)\b/i.test(lower) && !/\b(tanpa\s+grid|grid\s+off|no\s+grid)\b/i.test(lower);
  const toWord = isFollowUpWord || /\b(word|taro|taruh|paste|tempel|masukin|masukkin|grid|kolase|penjelasan|gap)\b/i.test(lower);
  const withExplanation = /\b(penjelasan|jelasin|jelaskan|deskripsi|arahan|gap|keterangan)\b/i.test(lower);

  const numMatch = lower.match(/\b([1-6])\s*(?:gambar|foto|image|pic|pin)?\b/);
  let count = numMatch ? parseInt(numMatch[1], 10) : useGrid ? 3 : 1;
  if (count < 1) count = 1;
  if (count > 6) count = 6;

  // Ekstrak kata kunci pencarian gambar
  let q = pesan
    .replace(/\b(tolong|coba|aku|saya|mau|minta|dong|ya|sayang|babe|please|sekarang|lanjut(?:in|kan)?|tambah(?:in|kan)?|lagi|di\s+bawahnya)\b/gi, " ")
    .replace(/\b(download(?:in|kan)?|unduh|ambil(?:in|kan)?|cari(?:in|kan)?|masukin|masukkin|taro|taruh|paste|tempel|buat(?:in|kan)?)\b/gi, " ")
    .replace(/\b([1-6])?\s*(gambar|foto|image|pic|picture|pin)(?:nya)?\b/gi, " ")
    .replace(/\b(di|ke|dari|lalu|dan|terus|sama|dengan|pake(?:in)?|pakai|secara|jadi|dalam|bentuk|itu|tadi)\b/gi, " ")
    .replace(/\b(pinterest|microsoft\s+word|word|grid|kolase|penjelasan(?:nya)?|deskripsi|arahan|gap\s+per\s+gap|gap|keterangan|apa\s+aja|bebas)\b/gi, " ")
    .replace(/[?.!,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  let reuseLastFiles = false;
  if (!q || q.length < 2) {
    if (isRecentWord && lastWordSession.topic) {
      q = lastWordSession.topic;
      if (lastWordSession.lastFiles.length > 0 && !/\b(download|unduh|ambil|cari|lagi|baru)\b/i.test(lower)) {
        reuseLastFiles = true;
      }
    } else {
      q = "anime aesthetic wallpaper";
    }
  }

  return {
    query: q,
    count,
    useGrid,
    toWord,
    withExplanation,
    append,
    reuseLastFiles,
  };
}

async function runImageDownloadAndWordTask(intent: ImageTaskIntent): Promise<string> {
  let aspect: GridAspect = "any";
  if (intent.useGrid && intent.count >= 2) {
    if (intent.count === 2 || intent.count >= 5) aspect = "square";
    else if (intent.count === 3) aspect = "tall";
    else if (intent.count === 4) aspect = "wide";
  }

  let files: string[] = [];
  let folder = "";

  if (intent.reuseLastFiles && lastWordSession.lastFiles.length > 0) {
    files = lastWordSession.lastFiles;
  } else {
    setProgress(
      `Mencari & mengunduh ${intent.count} foto "${intent.query}" dari Pinterest${
        intent.useGrid ? ` (Grid ${aspect})` : " (Grid: OFF)"
      }...`
    );
    const dl = await downloadPinterestImages(
      intent.query,
      intent.count,
      aspect,
      (step) => setProgress(step)
    );
    files = dl.files;
    folder = dl.folder;
  }

  if (files.length === 0) {
    setProgress("");
    return `Sudah dicoba mencari gambar "${intent.query}" di Pinterest, tapi gagal mengunduh gambarnya.`;
  }

  lastWordSession.active = true;
  lastWordSession.topic = intent.query;
  lastWordSession.lastFiles = files;
  lastWordSession.updatedAt = Date.now();

  if (!intent.toWord) {
    execFile("explorer.exe", [folder], () => {});
    setProgress("");
    return `Berhasil mengunduh ${files.length} gambar "${intent.query}" dari Pinterest ke folder ${folder} dan membuka foldernya.`;
  }

  setProgress("Mengecek Microsoft Word terinstal di PC...");
  await sleep(350);
  const wordCheck = await findInstalledAppMatches("microsoft word", "buka microsoft word");
  if (wordCheck.status === "not_found") {
    setProgress("");
    return `Gambar sudah diunduh ke ${folder}, tetapi Microsoft Word belum terinstal di PC.`;
  }

  let explanations: string[] = [];
  if (intent.withExplanation) {
    setProgress(`Menyiapkan penjelasan untuk ${files.length} foto "${intent.query}"...`);
    const expPrompt =
      `Buatkan tepat ${files.length} paragraf penjelasan singkat (masing-masing 2 kalimat yang menarik dan informatif) ` +
      `untuk ${files.length} foto bertema "${intent.query}". ` +
      "Keluarkan dalam format JSON array string murni (TANPA markdown ```json), contoh: " +
      '["Foto 1: Penjelasan singkat...", "Foto 2: Penjelasan singkat..."]';
    const rawExp = await askOnce(expPrompt);
    try {
      const m = rawExp.match(/\[[\s\S]*\]/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        if (Array.isArray(parsed)) {
          explanations = parsed.map((x: unknown) => String(x));
        }
      }
    } catch {}
    while (explanations.length < files.length) {
      explanations.push(
        `Gambar ${explanations.length + 1}: Visualisasi bertema ${intent.query} yang diambil dari referensi Pinterest.`
      );
    }
  }

  bgTaskProgress = `Menyusun ${files.length} foto di Microsoft Word (${
    intent.useGrid ? "Smart Grid ON" : "Grid OFF / Gap-per-Gap"
  })...`;

  await insertImagesIntoWordLive(
    {
      title: intent.append ? "" : `Visualisasi: ${intent.query.toUpperCase()}`,
      files,
      useGrid: intent.useGrid,
      append: intent.append,
      withExplanation: intent.withExplanation,
      explanations,
    },
    (step) => {
      bgTaskProgress = step || "";
    }
  );

  return `Berhasil ${intent.append ? "menambahkan" : "memasukkan"} ${files.length} foto "${intent.query}" ke dokumen Microsoft Word dengan mode ${
    intent.useGrid ? `Smart Grid (${files.length} foto)` : "Grid OFF (urutan vertikal / gap-per-gap)"
  }${intent.withExplanation ? " lengkap dengan penjelasan per foto" : ""}.`;
}

function detectWordDocCommand(pesan: string): { mode: "kop_surat" | "freeform"; append: boolean } | null {
  const lower = pesan.toLowerCase();
  const isRecentWord = lastWordSession.active && Date.now() - lastWordSession.updatedAt < 30 * 60_000;
  const wantsNewDoc = /\b(dokumen\s+baru|lembar\s+baru|file\s+baru|ulang\s+dari\s+awal)\b/i.test(lower);

  if (
    /(buat(?:in|kan)?|bikin(?:in)?|tuliskan)\s+.*(kop\s+surat|laporan|surat\s+resmi)/i.test(lower) ||
    (lower.includes("word") && /(kop\s+surat|laporan)/i.test(lower))
  ) {
    return { mode: "kop_surat", append: false };
  }
  if (
    lower.includes("word") &&
    /(ketik(?:in|kan)?|tulis(?:in|kan)?|buat(?:in|kan)?|bikin(?:in)?|isi\s+dengan|lanjut(?:in|kan)?|tambah(?:in|kan)?)/i.test(lower)
  ) {
    return { mode: "freeform", append: isRecentWord && !wantsNewDoc };
  }
  // Follow-up command tanpa menyebut kata "word" lagi (misal: "lanjutin tulisannya", "tambahin 1 paragraf lagi", "tulis kesimpulannya di bawahnya")
  if (
    isRecentWord &&
    /\b(lanjut(?:in|kan)?|tambah(?:in|kan)?|ketik(?:in|kan)?|tulis(?:in|kan)?)\s+.*(paragraf|tulisan(?:nya)?|kalimat|kesimpulan|penjelasan|cerita(?:nya)?|di\s+bawah(?:nya)?)/i.test(lower)
  ) {
    return { mode: "freeform", append: !wantsNewDoc };
  }
  return null;
}

function detectLocalAppOpenQuery(pesan: string): string | null {
  const lower = pesan.toLowerCase().trim();
  // Jika user secara eksplisit minta buka di chrome/browser/web, atau cari di situs web, biarkan browser handler yang jalan
  if (/(di\s+(chrome|browser|web|pinterest|youtube|google))|(buka\s+chrome\s+lalu)/i.test(lower)) {
    return null;
  }
  // Situs murni web (Pinterest, Instagram, TikTok, Gmail, Google)
  if (/\b(pinterest|instagram|tiktok|gmail|google)\b/i.test(lower)) {
    return null;
  }
  const m = lower.match(/^(?:tolong\s+|coba\s+)?(?:buka(?:in|kan)?|jalankan|nyalakan|main(?:kan)?|open)\s+(.+)$/i);
  if (!m) return null;
  let target = m[1]
    .replace(/\b(dong|ya|sayang|babe|please|sekarang|di\s+pc|aplikasi|game|versi|yang)\b/gi, " ")
    .replace(/\b(steam|launcher|lokal)\b/gi, " ")
    .replace(/[?.!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return target.length >= 2 ? target : null;
}

let currentTaskProgress = "";
let bgTaskProgress = "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const lastWordSession = {
  active: false,
  topic: "",
  lastFiles: [] as string[],
  updatedAt: 0,
};

function setProgress(msg: string): void {
  currentTaskProgress = msg;
}

async function generateAndRunWordDoc(
  pesan: string,
  mode: "kop_surat" | "freeform",
  append = false
): Promise<string> {
  setProgress("Mengecek Microsoft Word terinstal di PC...");
  await sleep(400);
  const wordCheck = await findInstalledAppMatches("microsoft word", "buka microsoft word");
  if (wordCheck.status === "not_found") {
    setProgress("");
    return "Sudah dicek di PC Lemon, Microsoft Word belum terinstal.";
  }

  const recentContext = chatHistory
    .slice(-4)
    .map((m) => `${m.role === "user" ? "Lemon" : "Opera O"}: ${m.content}`)
    .join("\n");

  let spec: WordDocSpec;
  if (mode === "freeform") {
    setProgress("Menyiapkan teks untuk diketik di Microsoft Word...");
    const freePrompt =
      `Konteks percakapan sebelumnya:\n${recentContext || "(Baru mulai)"}\n\n` +
      `Perintah lanjutan dari Lemon untuk diketik di Microsoft Word: "${pesan}".\n` +
      (append
        ? "Karena ini adalah kelanjutan dari dokumen Word yang sedang terbuka, JANGAN mengulang dari awal! Tuliskan HANYA paragraf lanjutan/tambahan yang diminta.\n"
        : "") +
      "Keluarkan JSON murni (TANPA markdown ```json) dengan struktur:\n" +
      '{"judul":"Judul sub-bagian (kosongkan string \\"\\" jika hanya melanjutkan paragraf)","isi":["Paragraf 1 yang akan diketik di Word","Paragraf 2 jika ada"]}';
    const rawJson = await askOnce(freePrompt);
    spec = {
      mode: "freeform",
      append,
      instansi: "",
      subInstansi: "",
      alamat: "",
      judul: "",
      isi: [pesan.replace(/^.*?(ketik(?:in|kan)?|tulis(?:in|kan)?|lanjut(?:in|kan)?|tambah(?:in|kan)?)\s+/i, "").trim() || "Paragraf lanjutan..."],
    };
    try {
      const match = rawJson.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed.isi) && parsed.isi.length > 0) {
          spec.judul = append ? "" : String(parsed.judul || "");
          spec.isi = parsed.isi.map((x: unknown) => String(x));
        }
      }
    } catch {}
  } else {
    setProgress("Menyiapkan draf Kop Surat & Laporan untuk Word...");
    const structPrompt =
      `Konteks sebelumnya:\n${recentContext}\n\nUser meminta dibuatkan dokumen Microsoft Word: "${pesan}".\n` +
      "Buatkan isi Kop Surat dan Laporan formal Bahasa Indonesia dalam format JSON murni (TANPA markdown ```json) dengan struktur tepat berikut:\n" +
      '{"instansi":"NAMA INSTANSI / PERUSAHAAN","subInstansi":"DIVISI / FAKULTAS /UNIT","alamat":"Alamat lengkap, telepon, email, dan kode pos","judul":"JUDUL LAPORAN / SURAT","isi":["Paragraf 1 pembuka laporan yang lengkap dan formal.","Paragraf 2 isi utama laporan yang rinci.","Paragraf 3 penutup dan kesimpulan laporan."]}';
    const rawJson = await askOnce(structPrompt);
    spec = {
      mode: "kop_surat",
      append: false,
      instansi: "PT SEMESTA OPERA INDONESIA",
      subInstansi: "DIVISI PENGEMBANGAN & TEKNOLOGI",
      alamat: "Jl. Jenderal Sudirman Kav. 52-53, Jakarta Selatan | Telp: (021) 555-0192 | Email: info@opera.id",
      judul: "LAPORAN KEGIATAN & EVALUASI",
      isi: [
        "Sehubungan dengan pelaksanaan kegiatan operasional dan pengembangan sistem yang telah berjalan, bersama dokumen ini kami sampaikan laporan hasil evaluasi secara menyeluruh.",
        "Seluruh rangkaian kegiatan telah terlaksana sesuai dengan standar prosedur yang ditetapkan serta mencapai target kinerja yang diharapkan.",
        "Demikian laporan ini disusun untuk dapat dipergunakan sebagaimana mestinya. Atas perhatian dan kerja samanya kami ucapkan terima kasih.",
      ],
    };
    try {
      const match = rawJson.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed.instansi && parsed.judul && Array.isArray(parsed.isi)) {
          spec = { ...parsed, mode: "kop_surat", append: false };
        }
      }
    } catch {}
  }

  lastWordSession.active = true;
  lastWordSession.topic = pesan.slice(0, 60);
  lastWordSession.updatedAt = Date.now();

  bgTaskProgress = "Mengetik di Microsoft Word...";
  await createLiveWordDocument(spec, (step) => {
    bgTaskProgress = step || "";
  });
  return `Microsoft Word sudah ${append ? "melanjutkan pengetikan di bagian bawah dokumen aktif" : "membuka dokumen dan mengetik teks secara live"}.`;
}

async function askAi(pesan: string): Promise<string> {
  let systemActionNote = "";
  let directUrl: string | null = null;

  // Selalu segarkan judul jendela aktif di belakang Opera O secara real-time sebelum memproses chat!
  await getActiveWindowTitle();

  // 0A. Cek perintah Download Gambar Pinterest & Masukkan ke Microsoft Word (Grid OFF default / Smart Grid / Gap-per-Gap)
  const imgIntent = detectImageDownloadOrWordCommand(pesan);
  if (imgIntent) {
    const imgResult = await runImageDownloadAndWordTask(imgIntent);
    systemActionNote = `(Sistem PC Turbo: ${imgResult} Beritahu Lemon dengan lembut bahwa tugas gambar/Word-nya sudah dijalankan.)`;
  }

  // 0B. Cek apakah user meminta melihat/membaca isi layar atau bertanya sedang buka halaman apa
  const isAskingScreen =
    /(liha?t|cek|baca|perhatikan)\s+(isi\s+)?(layar|screen|monitor|halaman|page|tab)(ku|saya|\s+ini|\s+sekarang|\s+lagi)?/i.test(pesan) ||
    /(aku|saya|gw)\s+(lagi\s+|sedang\s+)?(buka|liat|lihat|main|nonton)\s+(halaman\s+|page\s+|web\s+|aplikasi\s+)?apa/i.test(pesan) ||
    /(halaman|page|layar|tab|web)\s+apa\s+(ini|sekarang|yang\s+kebuka)/i.test(pesan) ||
    /(kalau|kalo)\s+sekarang\s+(aku\s+|saya\s+)?(lagi\s+)?(buka|liat|lihat|di\s+halaman|di\s+layar)/i.test(pesan);

  if (!systemActionNote && isAskingScreen) {
    setProgress("📸 Mengambil screenshot & membaca isi layarmu...");
    const visionReply = await lihatLayarInternal(pesan);
    setProgress("");
    chatHistory.push({ role: "user", content: pesan });
    chatHistory.push({ role: "assistant", content: visionReply });
    chatHistory = chatHistory.slice(-20);
    return visionReply;
  }

  // 0C. Cek perintah skill Stella Sora (Activate, Open & Check, Run Daily, Pause/Stop, Progress)
  const stellaIntent = parseStellaSoraCommand(pesan);
  if (!systemActionNote && stellaIntent) {
    setProgress("🎮 Menjalankan Stella Sora Skill...");
    const stellaRes = await handleStellaSoraCommand(stellaSoraManager, pesan);
    notificationHub.push("agent", "Stella Sora Skill", stellaRes.summary.slice(0, 120));
    systemActionNote = `(Sistem Stella Sora Skill: ${stellaRes.summary} WAJIB jawab dalam Bahasa Indonesia yang lembut dan sampaikan hasil terverifikasi ini tanpa mengarang hasil tambahan.)`;
  }

  // 1. Cek apakah user sedang menjawab pilihan aplikasi (misalnya Strinova Steam vs Launcher)
  const pendingChosen = checkPendingAppChoice(pesan);
  if (pendingChosen) {
    setProgress(`⏳ Waiting... Membuka ${pendingChosen.label}...`);
    await sleep(600);
    launchTarget(pendingChosen);
    await sleep(700);
    systemActionNote = `(Sistem PC Turbo: Berhasil membuka "${pendingChosen.label}" sesuai pilihan Lemon. Beritahu Lemon dengan lembut bahwa aplikasinya sudah dibuka.)`;
  }

  // 2. Cek perintah kendali media (stop/play/next musik, volume)
  if (!systemActionNote) {
    const mediaCmd = detectMediaCommand(pesan);
    if (mediaCmd) {
      setProgress(`🎵 Waiting... Sedang ${mediaCmd.desc}...`);
      await sleep(450);
      await triggerMediaKey(mediaCmd.action);
      systemActionNote = `(Sistem PC Turbo: Berhasil ${mediaCmd.desc}. Beritahu Lemon dengan lembut bahwa kamu sudah melakukannya.)`;
    }
  }

  // 3. Cek perintah merapikan folder PC
  if (!systemActionNote) {
    const folderTarget = detectFolderOrganizeCommand(pesan);
    if (folderTarget) {
      setProgress(`📁 Mengecek & merapikan file di folder ${path.basename(folderTarget)}...`);
      await sleep(700);
      const res = organizeFolder(folderTarget);
      systemActionNote = `(Sistem PC Turbo: ${res.summary} Sampaikan hasilnya dengan lembut ke Lemon.)`;
    }
  }

  // 4. Cek perintah membuat dokumen / mengetik teks Live di Microsoft Word (termasuk command lanjutan)
  const wordCmd = !systemActionNote ? detectWordDocCommand(pesan) : null;
  if (wordCmd) {
    const wordResult = await generateAndRunWordDoc(pesan, wordCmd.mode, wordCmd.append);
    systemActionNote = `(Sistem PC Turbo: ${wordResult} Beritahu Lemon dengan lembut bahwa kamu sudah melanjutkannya di Microsoft Word.)`;
  }

  // 5. Cek perintah buka aplikasi / game yang terinstal di PC (Microsoft Word, Spotify desktop, Strinova Steam/Launcher, dll)
  if (!systemActionNote) {
    const appQuery = detectLocalAppOpenQuery(pesan);
    if (appQuery) {
      setProgress(`🔍 Mengecek apakah "${appQuery}" terinstal di PC kamu...`);
      await sleep(650);
      const res = await findInstalledAppMatches(appQuery, pesan);
      if (res.status === "launched" && res.chosen) {
        setProgress(`⏳ Waiting... Membuka ${res.chosen.label}...`);
        await sleep(900);
        systemActionNote = `(Sistem PC Turbo: Sudah dicek dan aplikasi "${res.chosen.label}" TERINSTAL di PC Lemon, serta SUDAH dibuka secara langsung dari PC (bukan versi web). Beritahu Lemon dengan lembut.)`;
      } else if (res.status === "multiple" && res.options) {
        setProgress(`✅ Ditemukan ${res.options.length} versi "${appQuery}" di PC...`);
        await sleep(500);
        const listStr = res.options.map((o, idx) => `${idx + 1}. ${o.label}`).join(", ");
        systemActionNote = `(Sistem PC Turbo: Ditemukan ${res.options.length} versi terinstal di PC Lemon: ${listStr}. Tanyakan dengan lembut ke Lemon mau dibuka yang mana, misalnya nomor 1 atau 2, Steam atau Launcher.)`;
      } else {
        setProgress(`⚠️ "${appQuery}" belum terinstal di PC, mengecek alternatif...`);
        await sleep(500);
        directUrl = detectDirectBrowserCommand(pesan);
        if (directUrl) {
          systemActionNote = `(Sistem PC Turbo: Sudah dicek di data instalasi PC Lemon, aplikasi "${appQuery}" tidak ditemukan terinstal secara lokal, sehingga sistem membukakan versi web ${directUrl} di browser default.)`;
        } else {
          systemActionNote = `(Sistem PC Turbo: Sudah dicek di data instalasi PC & Steam Lemon, aplikasi/game "${appQuery}" tidak ditemukan / belum terinstal di PC. Beritahu Lemon dengan lembut bahwa aplikasinya belum terinstal.)`;
        }
      }
    }
  }

  // 6. Jika bukan aplikasi lokal, cek perintah buka situs web / pencarian online
  if (!systemActionNote) {
    directUrl = detectDirectBrowserCommand(pesan);
    if (directUrl) {
      setProgress(`🌐 Membuka ${directUrl} di Chrome / Browser Default...`);
      await sleep(600);
      systemActionNote = `(Sistem otomatis membuka ${directUrl} di browser default Lemon. Beritahu Lemon dengan lembut bahwa kamu sudah membukakannya.)`;
    } else {
      const searchQuery = shouldSearchOnline(pesan);
      if (searchQuery) {
        setProgress(`🔎 Mencari informasi online tentang "${searchQuery}"...`);
        const webInfo = await searchOnlineContext(searchQuery);
        if (webInfo) {
          systemActionNote = `[Hasil Pencarian Online Otomatis untuk "${searchQuery}"]:\n${webInfo}\n(Jawab pertanyaan Lemon dengan lembut dan natural berdasarkan hasil pencarian di atas.)`;
        }
      }
    }
  }

  setProgress("✍️ Opera O sedang menyiapkan jawaban...");

  const enrichedUserMessage = systemActionNote ? `${pesan}\n\n${systemActionNote}` : pesan;

  chatHistory.push({ role: "user", content: enrichedUserMessage });
  chatHistory = chatHistory.slice(-20);

  let reply = "";
  if (currentIsLocal()) {
    const msgs: ChatMessage[] = [
      { role: "system", content: buildSystemInstruction(memoryFacts, true) },
      ...chatHistory.slice(-10),
    ];
    reply = await callOllama(msgs);
  } else if (currentIsDeepSeek()) {
    const msgs: ChatMessage[] = [
      { role: "system", content: buildSystemInstruction(memoryFacts, false) },
      ...chatHistory,
    ];
    reply = await callDeepSeek(msgs);
  } else {
    reply = await callGemini(chatHistory);
  }

  reply = extractAndOpenUrls(reply, directUrl);
  setProgress("");
  chatHistory[chatHistory.length - 1] = { role: "user", content: pesan };
  chatHistory.push({ role: "assistant", content: reply });
  chatHistory = chatHistory.slice(-20);
  return reply;
}

// ---------------------------------------------------------
// 2. TTS (Edge Neural Voice id-ID-GadisNeural — Lembut & Menenangkan)
// ---------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");

let ttsEnabled = false;
let ttsQueue: Promise<void> = Promise.resolve();

function cleanTtsText(raw: string): string {
  return raw
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/[*_~`#]/g, "")
    .replace(/,?\s*\b(h+m+)\b\s*\?/gi, ", ya?")
    .replace(/\b(h+m+)\b[.,!]*/gi, "")
    .replace(/\b(he+he+|hi+hi+|ha+ha+|wk+wk+)\b[.,!]*/gi, "")
    .replace(/\bwaa+h\b/gi, "wah")
    .replace(/!+/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

async function synthesizeEdgeNeural(text: string): Promise<string> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata("id-ID-GadisNeural", OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  return new Promise((resolve, reject) => {
    try {
      const { audioStream } = tts.toStream(text, {
        rate: "-18%",
        pitch: "+1Hz",
      });
      const chunks: Buffer[] = [];
      audioStream.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
      audioStream.on("end", () => {
        try { tts.close(); } catch {}
        const buf = Buffer.concat(chunks);
        if (buf.length === 0) reject(new Error("Empty audio"));
        else resolve(`data:audio/mpeg;base64,${buf.toString("base64")}`);
      });
      audioStream.on("error", (err: unknown) => {
        try { tts.close(); } catch {}
        reject(err);
      });
    } catch (err) {
      try { tts.close(); } catch {}
      reject(err);
    }
  });
}

async function playAudioInRenderer(dataUrl: string, rate = 0.94): Promise<void> {
  if (!chatWindow || chatWindow.isDestroyed()) return;
  try {
    await chatWindow.webContents.executeJavaScript(
      `new Promise((resolve) => {
        const a = new Audio(${JSON.stringify(dataUrl)});
        a.preservesPitch = true;
        a.playbackRate = ${rate};
        a.onended = () => resolve();
        a.onerror = () => resolve();
        a.play().catch(() => resolve());
      })`
    );
  } catch {}
}

function pcm24kToWavDataUrl(pcmBase64: string): string {
  const pcm = Buffer.from(pcmBase64, "base64");
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return `data:audio/wav;base64,${Buffer.concat([header, pcm]).toString("base64")}`;
}

async function synthesizeGeminiTts(text: string): Promise<string> {
  if (!GEMINI_API_KEY || !GEMINI_API_KEY.startsWith("AIza")) {
    throw new Error("Valid GEMINI_API_KEY (AIza...) required for Gemini TTS");
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${GEMINI_API_KEY}`;
  const prompt = `Ucapkan dalam Bahasa Indonesia dengan nada suara hangat, kalem, lembut, dan menenangkan: ${text}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: GEMINI_TTS_VOICE,
            },
          },
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini TTS HTTP ${res.status}`);
  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { data?: string } }> };
    }>;
  };
  const pcmB64 = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!pcmB64) throw new Error("Empty Gemini TTS audio");
  return pcm24kToWavDataUrl(pcmB64);
}

async function synthesizeElevenLabs(text: string): Promise<string> {
  if (!ELEVENLABS_API_KEY) throw new Error("No ElevenLabs API key");
  const voiceIds = [ELEVENLABS_VOICE_ID];
  if (ELEVENLABS_VOICE_ID !== "pFZP5JQG7iQjIQuC4Bku") {
    voiceIds.push("pFZP5JQG7iQjIQuC4Bku");
  }

  let lastErr: unknown = null;
  for (const vid of voiceIds) {
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}`, {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.38,
            similarity_boost: 0.8,
            style: 0.45,
            use_speaker_boost: true,
            speed: 0.98,
          },
        }),
      });
      if (!res.ok) {
        lastErr = new Error(`ElevenLabs HTTP ${res.status}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) throw new Error("Empty ElevenLabs audio");
      return `data:audio/mpeg;base64,${buf.toString("base64")}`;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("ElevenLabs failed");
}

function ttsSay(text: string): void {
  if (!ttsEnabled || !text) return;
  const cleaned = cleanTtsText(text);
  if (!cleaned) return;

  ttsQueue = ttsQueue.then(async () => {
    if (!ttsEnabled) return;
    try {
      const dataUrl = await synthesizeElevenLabs(cleaned);
      await playAudioInRenderer(dataUrl, 0.95);
      return;
    } catch {}
    try {
      const dataUrl = await synthesizeEdgeNeural(cleaned);
      await playAudioInRenderer(dataUrl, 0.96);
    } catch {}
  });
}

// ---------------------------------------------------------
// 3. MEMORY & REMINDER STATE
// ---------------------------------------------------------
let lastExtract = 0;
const pendingReminders: string[] = [];
const pendingChats: string[] = [];
let lastChatTime = Date.now();
let ignoreCount = 0;
let focusMode = false;
let lastActivityComment = 0;

function remember(fakta: string): boolean {
  const clean = (fakta || "").trim().replace(/^[-•\s]+/, "").trim();
  if (!clean || clean.length < 4 || memoryFacts.includes(clean)) return false;
  memoryFacts.push(clean);
  memoryFacts = memoryFacts.slice(-40);
  saveMemory(memoryFacts);
  return true;
}

async function maybeExtractFact(userText: string, reply: string): Promise<void> {
  if (currentIsLocal()) return;
  if (!userText || userText.length < 12 || reply.startsWith("(")) return;
  if (Date.now() - lastExtract < 300_000) return;
  lastExtract = Date.now();
  try {
    const prompt =
      "Dari percakapan berikut, ekstrak SATU fakta baru yang spesifik dan berguna tentang Lemon " +
      "(kebiasaan, preferensi, proyek, atau hal yang dia sukai) yang layak diingat untuk percakapan berikutnya. " +
      "Jika tidak ada yang penting, jawab tepat: TIDAK_ADA.\n\n" +
      `Lemon: ${userText}\nOpera O: ${reply}\n\nFakta:`;
    const fact = (await askOnce(prompt)).trim();
    if (fact && !fact.startsWith("(") && fact.toUpperCase().replace(/\s+/g, "_") !== "TIDAK_ADA") {
      remember(fact);
    }
  } catch {}
}

let winTitleWorker: ChildProcessWithoutNullStreams | null = null;
let winTitleStdoutBuf = "";
const winTitleQueue: Array<(title: string) => void> = [];

function ensureWinTitleWorker(): ChildProcessWithoutNullStreams {
  if (winTitleWorker && !winTitleWorker.killed && winTitleWorker.exitCode === null) {
    return winTitleWorker;
  }
  const selfPid = process.pid;
  const psLoop = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32Title {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@
[Console]::Out.AutoFlush = $true
$selfPid = ${selfPid}
$blacklist = '^(TM Opera O|Opera iOS Notch|Opera Notch|Opera Radial|Opera Settings|Program Manager|Settings|Microsoft Text Input Application|Windows Input Experience|Default IME|MSCTFIME UI|NVIDIA GeForce Overlay|NVIDIA Share|GeForce Experience|Xbox Game Bar|Windows Shell Experience Host|Task Switching)$'
while ($null -ne ([Console]::In.ReadLine())) {
  try {
    $h = [Win32Title]::GetForegroundWindow()
    $found = ""
    for ($i = 0; $i -lt 160 -and $h -ne [IntPtr]::Zero; $i++) {
      if ([Win32Title]::IsWindowVisible($h)) {
        [uint32]$winPid = 0
        [void][Win32Title]::GetWindowThreadProcessId($h, [ref]$winPid)
        if ($winPid -ne $selfPid) {
          $ex = [Win32Title]::GetWindowLong($h, -20)
          $isOverlay = (($ex -band 0x20) -ne 0) -or (($ex -band 0x80) -ne 0)
          if (-not $isOverlay) {
            $sb = New-Object System.Text.StringBuilder 256
            [void][Win32Title]::GetWindowText($h, $sb, 256)
            $t = $sb.ToString().Trim()
            if ($t -and $t -notmatch $blacklist -and $t -notmatch 'NVIDIA|GeForce Overlay') {
              $found = $t
              break
            }
          }
        }
      }
      $h = [Win32Title]::GetWindow($h, 2)
    }
    $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($found))
    [Console]::Out.WriteLine("TITLE:" + $b64)
  } catch {
    [Console]::Out.WriteLine("TITLE:")
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
    winTitleStdoutBuf += String(chunk);
    const lines = winTitleStdoutBuf.split(/\r?\n/);
    winTitleStdoutBuf = lines.pop() || "";
    for (const ln of lines) {
      if (!ln.startsWith("TITLE:")) continue;
      const b64 = ln.slice(6).trim();
      const decoded = b64 ? Buffer.from(b64, "base64").toString("utf-8").trim() : "";
      const res = winTitleQueue.shift();
      if (res) res(decoded);
    }
  });
  proc.on("exit", () => {
    winTitleWorker = null;
    while (winTitleQueue.length > 0) {
      const res = winTitleQueue.shift();
      if (res) res("");
    }
  });
  winTitleWorker = proc;
  return proc;
}

function stopActiveWindowWorker(): void {
  if (winTitleWorker && !winTitleWorker.killed) {
    try {
      winTitleWorker.kill("SIGTERM");
    } catch {}
    winTitleWorker = null;
  }
}

function getActiveWindowTitle(): Promise<string> {
  return new Promise((resolve) => {
    try {
      const proc = ensureWinTitleWorker();
      const timer = setTimeout(() => {
        const idx = winTitleQueue.indexOf(done);
        if (idx >= 0) winTitleQueue.splice(idx, 1);
        resolve(currentActiveWindow);
      }, 4000);
      const done = (title: string) => {
        clearTimeout(timer);
        if (title) {
          if (title !== currentActiveWindow) {
            currentActiveWindow = title;
            activeWindowSince = Date.now();
            if (recentWindowsHistory[0] !== title) {
              recentWindowsHistory.unshift(title);
              if (recentWindowsHistory.length > 6) recentWindowsHistory.pop();
            }
          }
        }
        resolve(title || currentActiveWindow);
      };
      winTitleQueue.push(done);
      proc.stdin.write("GET\n");
    } catch {
      resolve(currentActiveWindow);
    }
  });
}

async function callPecutVision(prompt: string, pngBase64: string): Promise<string> {
  if (!DEEPSEEK_API_KEY) {
    return "(Vision error: DEEPSEEK_API_KEY belum diisi di .env)";
  }
  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "pecut/qwen3.8-flash",
        messages: [
          {
            role: "system",
            content: buildSystemInstruction(memoryFacts, false),
          },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${pngBase64}` },
              },
            ],
          },
        ],
        temperature: 0.75,
        max_tokens: 512,
      }),
    });
    const data = (await res.json()) as {
      error?: { message?: string } | string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    if (data.error) {
      const msg = typeof data.error === "object" ? data.error.message || JSON.stringify(data.error) : data.error;
      return `(Vision error: ${msg})`;
    }
    const content = (data.choices?.[0]?.message?.content || "").trim();
    recordPecutUsage(data.usage, content.length);
    return content;
  } catch (e) {
    return `(Vision error: ${e})`;
  }
}

async function lihatLayarInternal(customUserQuestion?: string): Promise<string> {
  try {
    const title = await getActiveWindowTitle();
    if (currentIsLocal()) {
      const prompt =
        `Saat ini tepat detik ini Lemon sedang membuka jendela/halaman: "${title}". ` +
        (customUserQuestion
          ? `Pertanyaan Lemon tentang layarnya: "${customUserQuestion}". Jawab dengan lembut sesuai halaman "${title}" yang sedang terbuka sekarang.`
          : "Buat komentar SINGKAT (1-2 kalimat) yang lembut, hangat, dan perhatian dengan yang sedang dia kerjakan, sambil mengingatkan istirahat sejenak.");
      const reply = await askOnce(prompt);
      ttsSay(reply);
      return reply;
    }

    const display = screen.getPrimaryDisplay();
    const { width: sw, height: sh } = display.size;
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: Math.min(1366, sw), height: Math.min(768, sh) },
    });
    const pngBase64 = sources[0]?.thumbnail.toPNG().toString("base64");
    const prompt = customUserQuestion
      ? `PENTING: Ini adalah screenshot TERBARU layar PC Lemon detik ini (jendela utama yang sedang aktif di layar: "${title}"). Abaikan halaman/layar lama dari percakapan sebelumnya! Lemon bertanya/berkata: "${customUserQuestion}". Lihat isi gambar screenshot terbaru ini dengan teliti dan jawab dengan lembut, hangat, dan penuh perhatian dalam 2-3 kalimat.`
      : `PENTING: Ini adalah screenshot TERBARU layar PC Lemon detik ini (jendela utama yang sedang aktif di layar: "${title}"). Abaikan halaman/layar lama dari percakapan sebelumnya! Buat komentar singkat (2 kalimat saja) sebagai pasangan yang lembut, hangat, dan perhatian dengan apa yang terlihat sedang dia buka/kerjakan di gambar layar terbaru ini.`;

    let reply = "";
    if (currentIsDeepSeek() && pngBase64) {
      reply = await callPecutVision(prompt, pngBase64);
    } else {
      reply = await askOnce(prompt, pngBase64);
    }
    ttsSay(reply);
    return reply;
  } catch {
    const reply = "Layar tak dapat kulihat saat ini, sayangku.";
    ttsSay(reply);
    return reply;
  }
}

// ---------------------------------------------------------
// 4. REMINDER & ACTIVITY LOOPS
// ---------------------------------------------------------
const REMINDERS: Array<[number, string]> = [
  [2 * 3600_000, "Babe, literally udah berjam-jam gitu loh di depan layar. Minum air dulu yuk, jangan sampe dehidrasi sayangku~"],
  [3 * 3600_000, "Mo chroi, stretching bentar dong. Badan itu aset utama panggung kita, jangan sampe pegel-pegel gitu loh!"],
  [4 * 3600_000, "Mi amor, mata kamu tuh literally butuh istirahat. Jangan dipaksa terus, nanti my heart sedih banget tau gak~"],
];

const PROTEST_MSG =
  "Babe, literally kenapa aku di-ignore terus sih? My heart is broken loh! Balas dong, jangan diemin aku gitu terus~";

const FOCUS_KEYWORDS = [
  "visual studio", "vs code", "code", "illustrator", "photoshop", "figma",
  "valorant", "league of legends", "dota", "minecraft", "genshin", "adobe",
  "blender", "unity", "godot", "premiere", "after effects", "game",
];

function startBackgroundLoops(): void {
  const nexts = REMINDERS.map(([interval]) => Date.now() + interval);

  setInterval(() => {
    if (focusMode) return;
    const remCheck = isReminderSuppressed(new Date(), currentActiveWindow, settingsStore.get().reminder);
    if (remCheck.suppressed) return;
    const now = Date.now();
    REMINDERS.forEach(([interval, msg], i) => {
      if (now >= nexts[i]) {
        nexts[i] = now + interval;
        if (now - lastChatTime > interval * 0.8) ignoreCount++;
        else ignoreCount = 0;

        const out = ignoreCount >= 3 ? ((ignoreCount = 0), PROTEST_MSG) : msg;
        ttsSay(out);
        pendingReminders.push("⏰ " + out);
      }
    });
  }, 15_000);

  let lastTitle = "";
  let lastSwitch = Date.now();
  let commented = false;

  setInterval(async () => {
    const title = await getActiveWindowTitle();
    if (!title) return;
    if (title !== currentActiveWindow) {
      currentActiveWindow = title;
      activeWindowSince = Date.now();
      if (recentWindowsHistory[0] !== title) {
        recentWindowsHistory.unshift(title);
        if (recentWindowsHistory.length > 6) recentWindowsHistory.pop();
      }
    }
    const lower = title.toLowerCase();
    focusMode = FOCUS_KEYWORDS.some((k) => lower.includes(k));
    const threshold = focusMode ? 2 * 3600_000 : 45 * 60_000;

    if (title !== lastTitle) {
      lastTitle = title;
      lastSwitch = Date.now();
      commented = false;
    } else if (!commented && Date.now() - lastSwitch >= threshold) {
      commented = true;
      if (Date.now() - lastActivityComment < 90 * 60_000) return;
      lastActivityComment = Date.now();
      const styles = ["penasaran/kagum", "memberi semangat", "menegur manja soal istirahat"];
      const style = styles[Math.floor(Math.random() * styles.length)];
      const prompt =
        `Lemon sudah lama membuka "${title}". Buat 1 kalimat singkat dengan gaya ${style} ` +
        "sebagai TM Opera O untuk menyapanya.";
      const reply = await askOnce(prompt);
      if (reply && !reply.startsWith("(")) {
        ttsSay(reply);
        pendingReminders.push("💬 " + reply);
        pendingChats.push(reply);
      }
    }
  }, 3_000);
}

// ---------------------------------------------------------
// 5. ELECTRON WINDOWS & IPC
// ---------------------------------------------------------
let chatWindow: BrowserWindow | null = null;
let radialWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let keepOnTopTimer: NodeJS.Timeout | null = null;

function enforceAlwaysOnTop(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  try {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setAlwaysOnTop(true, "screen-saver");
  } catch {}
}

function startAlwaysOnTopKeeper(): void {
  if (keepOnTopTimer) return;
  keepOnTopTimer = setInterval(() => {
    if (radialWindow && !radialWindow.isDestroyed() && radialWindow.isVisible()) {
      try {
        radialWindow.setAlwaysOnTop(true, "screen-saver");
        radialWindow.moveTop();
      } catch {}
    }
    if (chatWindow && !chatWindow.isDestroyed() && chatWindow.isVisible() && !chatWindow.isMinimized()) {
      try {
        chatWindow.setAlwaysOnTop(true, "screen-saver");
      } catch {}
    }
  }, 2000);
}

function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;
  const W = 740;
  const H = 500;
  settingsWindow = new BrowserWindow({
    title: "TM Opera O — Settings",
    width: W,
    height: H,
    x: Math.floor((sw - W) / 2),
    y: Math.floor((sh - H) / 2),
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  enforceAlwaysOnTop(settingsWindow);
  settingsWindow.loadFile(path.join(BASE, "web", "settings.html"));
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}
let radialDragTimer: NodeJS.Timeout | null = null;
let radialDragOffset = { x: 175, y: 175 };
let chatDragTimer: NodeJS.Timeout | null = null;
let chatDragOffset = { x: 0, y: 0 };

const CHAT_W = 420;
const CHAT_H = 540;
const RADIAL_SIZE = 350;

function createWindows(): void {
  const display = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = display.workAreaSize;

  chatWindow = new BrowserWindow({
    title: "TM Opera O",
    width: CHAT_W,
    height: CHAT_H,
    x: Math.max(0, screenW - CHAT_W - 16),
    y: Math.max(0, screenH - CHAT_H - 12),
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  enforceAlwaysOnTop(chatWindow);
  chatWindow.on("blur", () => {
    enforceAlwaysOnTop(chatWindow);
  });
  chatWindow.on("show", () => {
    enforceAlwaysOnTop(chatWindow);
  });
  chatWindow.loadFile(path.join(BASE, "web", "index.html"));

  // iOS Dynamic Island / Living Notch di Tengah Atas Layar
  const NOTCH_W = 560;
  const NOTCH_H = 250;
  const notchX = Math.floor((display.bounds.width - NOTCH_W) / 2);

  radialWindow = new BrowserWindow({
    title: "Opera Notch",
    width: NOTCH_W,
    height: NOTCH_H,
    x: notchX,
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  enforceAlwaysOnTop(radialWindow);
  radialWindow.on("blur", () => {
    enforceAlwaysOnTop(radialWindow);
  });
  radialWindow.setIgnoreMouseEvents(true, { forward: true });
  radialWindow.loadFile(path.join(BASE, "web", "notch.html"));
  startAlwaysOnTopKeeper();
}

ipcMain.handle("api", async (_event, method: string, ...args: unknown[]) => {
  switch (method) {
    case "sapaan_awal": {
      const sapa =
        "Halo Lemon sayang... Aku udah di sini nemenin kamu. Gimana hari kamu, capek nggak? Sini cerita sama aku, ya?";
      return sapa;
    }
    case "tanya_opera_o": {
      const pesan = String(args[0] || "");
      lastChatTime = Date.now();
      ignoreCount = 0;
      const reply = await askAi(pesan);
      ttsSay(reply);
      return reply;
    }
    case "lihat_layar":
      return await lihatLayarInternal();
    case "ingat": {
      const ok = remember(String(args[0] || ""));
      return ok ? "Sudah kucatat dalam ingatanku, Suamiku." : "Itu sudah ada dalam ingatanku.";
    }
    case "get_pending_reminder":
      return pendingReminders.shift() || "";
    case "set_tts":
      ttsEnabled = Boolean(args[0]);
      return true;
    case "tes_reminder": {
      const msg = "Ini contoh reminder dari bintang panggungmu! Jangan lupa istirahat, Sayang.";
      ttsSay(msg);
      pendingReminders.push("🔔 " + msg);
      return msg;
    }
    case "get_models":
      return AVAILABLE_MODELS;
    case "get_current_model":
      return currentModel;
    case "ganti_model": {
      const nama = String(args[0] || "");
      if (AVAILABLE_MODELS.includes(nama)) {
        currentModel = nama;
        chatHistory = [];
        return `Model panggung diganti ke ${nama}, Suamiku.`;
      }
      return "Model itu tidak ada dalam daftarku, sayangku.";
    }
    case "tanya_dari_radial": {
      const pesan = String(args[0] || "");
      lastChatTime = Date.now();
      ignoreCount = 0;
      const reply = await askAi(pesan);
      ttsSay(reply);
      maybeExtractFact(pesan, reply);
      pendingChats.push(reply);
      return reply;
    }
    case "lihat_layar_radial": {
      const reply = await lihatLayarInternal();
      pendingChats.push(reply);
      return reply;
    }
    case "ingat_radial": {
      const ok = remember(String(args[0] || ""));
      const balasan = ok ? "Sudah kucatat dalam ingatanku, Suamiku." : "Itu sudah ada dalam ingatanku.";
      pendingChats.push(balasan);
      return balasan;
    }
    case "get_pending_chat":
      return pendingChats.shift() || "";
    case "minimalkan":
      chatWindow?.minimize();
      return true;
    case "tutup":
      chatWindow?.hide();
      return true;
    case "buka_chat":
      chatWindow?.show();
      chatWindow?.focus();
      return true;
    case "buka_radial":
    case "buka_radial_prompt":
    case "tutup_radial":
      return true;
    case "set_ignore_mouse": {
      const ignore = Boolean(args[0]);
      if (radialWindow && !radialWindow.isDestroyed()) {
        if (ignore) {
          radialWindow.setIgnoreMouseEvents(true, { forward: true });
        } else {
          radialWindow.setIgnoreMouseEvents(false);
        }
      }
      return true;
    }
    case "set_ignore_mouse_chat": {
      const ignore = Boolean(args[0]);
      if (chatWindow && !chatWindow.isDestroyed()) {
        if (ignore) {
          chatWindow.setIgnoreMouseEvents(true, { forward: true });
        } else {
          chatWindow.setIgnoreMouseEvents(false);
        }
      }
      return true;
    }
    case "move_radial": {
      const dx = Number(args[0] || 0);
      const dy = Number(args[1] || 0);
      if (radialWindow && !radialWindow.isDestroyed()) {
        const [x, y] = radialWindow.getPosition();
        radialWindow.setPosition(Math.round(x + dx), Math.round(y + dy));
      }
      return true;
    }
    case "start_drag_radial": {
      if (radialWindow && !radialWindow.isDestroyed()) {
        radialWindow.setIgnoreMouseEvents(false);
        const cursor = screen.getCursorScreenPoint();
        const [wx, wy] = radialWindow.getPosition();
        radialDragOffset = { x: cursor.x - wx, y: cursor.y - wy };
        if (radialDragTimer) clearInterval(radialDragTimer);
        radialDragTimer = setInterval(() => {
          if (!radialWindow || radialWindow.isDestroyed()) {
            if (radialDragTimer) clearInterval(radialDragTimer);
            radialDragTimer = null;
            return;
          }
          const pt = screen.getCursorScreenPoint();
          radialWindow.setPosition(
            Math.round(pt.x - radialDragOffset.x),
            Math.round(pt.y - radialDragOffset.y)
          );
        }, 12);
      }
      return true;
    }
    case "stop_drag_radial": {
      if (radialDragTimer) {
        clearInterval(radialDragTimer);
        radialDragTimer = null;
      }
      return true;
    }
    case "notch_media": {
      const act = String(args[0] || "play_pause") as MediaAction;
      await triggerMediaKey(act);
      return true;
    }
    case "get_notch_status": {
      const media = await getMediaWithLyrics();
      return {
        activeWindow: currentActiveWindow || "TM Opera O — Standby",
        model: currentModel,
        taskProgress: currentTaskProgress || bgTaskProgress,
        settings: appSettings,
        media,
      };
    }
    case "seek_media": {
      const sec = Number(args[0] || 0);
      await seekMediaToSeconds(sec);
      return true;
    }
    case "open_settings": {
      openSettingsWindow();
      return true;
    }
    case "close_settings": {
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.close();
      }
      return true;
    }
    case "get_settings": {
      return appSettings;
    }
    case "save_settings": {
      if (args[0] && typeof args[0] === "object") {
        saveAppSettings(args[0] as Partial<AppSettings>);
      }
      return true;
    }
    case "get_memories": {
      return memoryFacts;
    }
    case "delete_memory_item": {
      const idx = Number(args[0]);
      if (idx >= 0 && idx < memoryFacts.length) {
        memoryFacts.splice(idx, 1);
        saveMemory(memoryFacts);
      }
      return memoryFacts;
    }
    case "clear_all_memories": {
      memoryFacts = [];
      saveMemory(memoryFacts);
      return [];
    }
    case "open_drive_folder": {
      shell.openExternal(GDRIVE_MEMORY_FOLDER_URL).catch(() => {});
      return true;
    }
    case "get_task_progress": {
      return currentTaskProgress || bgTaskProgress;
    }
    case "get_api_usage": {
      const force = Boolean(args[0]);
      const el = await fetchElevenLabsUsage(force);
      const pecutPct =
        usageData.pecutQuotaTokens > 0
          ? Math.min(100, (usageData.pecutTotalTokens / usageData.pecutQuotaTokens) * 100)
          : 0;
      const elPct = el.limit > 0 ? Math.min(100, (el.used / el.limit) * 100) : 0;
      return {
        pecut: {
          usedTokens: usageData.pecutTotalTokens,
          promptTokens: usageData.pecutPromptTokens,
          completionTokens: usageData.pecutCompletionTokens,
          requests: usageData.pecutRequests,
          quotaTokens: usageData.pecutQuotaTokens,
          percent: Number(pecutPct.toFixed(2)),
        },
        elevenlabs: {
          usedChars: el.used,
          limitChars: el.limit,
          tier: el.tier,
          percent: Number(elPct.toFixed(2)),
        },
      };
    }
    case "set_pecut_quota": {
      const million = Number(args[0] || 10);
      if (million > 0) {
        usageData.pecutQuotaTokens = Math.round(million * 1_000_000);
        saveUsage(usageData);
      }
      return true;
    }
    case "start_drag_chat": {
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.setIgnoreMouseEvents(false);
        const cursor = screen.getCursorScreenPoint();
        const [wx, wy] = chatWindow.getPosition();
        chatDragOffset = { x: cursor.x - wx, y: cursor.y - wy };
        if (chatDragTimer) clearInterval(chatDragTimer);
        chatDragTimer = setInterval(() => {
          if (!chatWindow || chatWindow.isDestroyed()) {
            if (chatDragTimer) clearInterval(chatDragTimer);
            chatDragTimer = null;
            return;
          }
          const pt = screen.getCursorScreenPoint();
          chatWindow.setPosition(
            Math.round(pt.x - chatDragOffset.x),
            Math.round(pt.y - chatDragOffset.y)
          );
        }, 12);
      }
      return true;
    }
    case "stop_drag_chat": {
      if (chatDragTimer) {
        clearInterval(chatDragTimer);
        chatDragTimer = null;
      }
      return true;
    }
    case "keluar":
      cleanupAndQuit();
      return true;
    case "refresh_app":
      app.relaunch();
      app.exit(0);
      return true;
    default:
      return null;
  }
});

// ---------------------------------------------------------
// 6. ISOLATED AGENT ENGINE IPC CHANNELS (MILESTONE 1)
// ---------------------------------------------------------
const agentModelClient: AgentModelClient = {
  async complete(sysPrompt: string, userPrompt: string, tier: ModelTier = "standard"): Promise<string> {
    const msgs: ChatMessage[] = [
      { role: "system", content: sysPrompt },
      { role: "user", content: userPrompt },
    ];
    const tieredModel = selectModelForTier(currentModel, tier);
    if (tieredModel.startsWith("local:")) return await callOllama(msgs);
    if (tieredModel.startsWith("deepseek-") || tieredModel.startsWith("pecut/")) {
      return await callDeepSeek(msgs, tieredModel, 0.2);
    }
    return await callGemini(msgs, undefined, tieredModel);
  },
};

const shelfStore = new ShelfStore(app.getPath("userData"));
const skillStore = new SkillStore(app.getPath("userData"));
const learningEngine = new LearningEngine(skillStore);
const knowledgeStore = new ApplicationKnowledgeStore(app.getPath("userData"));
const statisticsStore = new ApplicationStatisticsStore(app.getPath("userData"));
const stellaSoraManager = new StellaSoraEngineManager(
  path.join(BASE, "skills", "games", "stella-sora"),
  { skillStore, learningEngine, knowledgeStore, statisticsStore }
);
const notificationHub = new NotificationHub();

const agentToolRegistry = createDefaultToolRegistry({
  getActiveWindowTitle,
  openExternalUrl: async (url: string) => {
    await shell.openExternal(url);
  },
  searchWeb: searchOnlineContext,
  shelfStore,
  skillStore,
  learningEngine,
  knowledgeStore,
  statisticsStore,
  stellaSoraManager,
  openFilePath: async (filePath: string) => {
    await shell.openPath(filePath);
  },
  captureScreenBase64: async () => {
    try {
      const display = screen.getPrimaryDisplay();
      const { width: sw, height: sh } = display.size;
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: Math.min(1366, sw), height: Math.min(768, sh) },
      });
      return sources[0]?.thumbnail.toPNG().toString("base64") || null;
    } catch {
      return null;
    }
  },
});

const agentRuntime = new AgentRuntime(agentModelClient, agentToolRegistry, {
  observeWindowFn: getActiveWindowTitle,
  storageDir: BASE,
  skillRouter: async (goal, task) => {
    const intent = parseStellaSoraCommand(goal);
    if (!intent) return { handled: false };

    const approvedSkills = skillStore.listAll("stella-sora", "approved");
    const dailySkill = approvedSkills.find((s) => s.name === "daily-routine") || approvedSkills[0];
    const plan = dailySkill
      ? dailySkill.steps.map((s) => s.description)
      : ["Activate Stella Sora", "Execute Stella Sora workflow", "Verify result"];

    const res = await handleStellaSoraCommand(stellaSoraManager, goal, task.id);
    notificationHub.push("agent", "Stella Sora Skill", res.summary.slice(0, 120));
    const ok = res.status.taskState !== "failed" && res.status.phase !== "error";
    return { handled: true, success: ok, summary: res.summary, plan };
  },
});

let pendingAgentApproval: {
  taskId: string;
  stepId: string;
  toolName: string;
  summary: string;
  arguments: Record<string, unknown>;
} | null = null;

eventBus.on("task:approval-needed", (payload) => {
  pendingAgentApproval = payload;
  notificationHub.push("approval", "Approval Required", `${payload.toolName}: ${payload.summary}`);
});
eventBus.on("task:completed", (payload) => {
  pendingAgentApproval = null;
  notificationHub.push("task_complete", "Task Completed", payload.summary);
});
eventBus.on("task:failed", (payload) => {
  pendingAgentApproval = null;
  notificationHub.push("task_fail", "Task Failed", payload.error);
});
eventBus.on("task:cancelled", (payload) => {
  pendingAgentApproval = null;
  notificationHub.push("agent", "Task Cancelled", payload.reason);
});

ipcMain.handle("agent:start", async (_event, rawGoal: unknown) => {
  const goal = typeof rawGoal === "string" ? rawGoal.trim() : "";
  if (!goal) return { ok: false, error: "Goal must be a non-empty string." };
  if (agentRuntime.taskManager.hasActiveTask()) {
    return { ok: false, error: "Another agent task is already active." };
  }
  const runPromise = agentRuntime.runObjective(goal, BASE);
  // Return initial task immediately; UI/pollers can inspect status via agent:get-status
  const active = agentRuntime.taskManager.getActiveTask();
  void runPromise;
  return { ok: true, task: active };
});

ipcMain.handle("agent:pause", () => ({ ok: agentRuntime.taskManager.pause() }));
ipcMain.handle("agent:resume", () => ({ ok: agentRuntime.taskManager.resume() }));
ipcMain.handle("agent:cancel", () => {
  pendingAgentApproval = null;
  return { ok: agentRuntime.taskManager.cancel() };
});
ipcMain.handle("agent:emergency-stop", () => {
  pendingAgentApproval = null;
  return { ok: agentRuntime.taskManager.emergencyStop() };
});
ipcMain.handle("agent:get-status", () => ({
  activeTask: agentRuntime.taskManager.getActiveTask(),
  recentTasks: agentRuntime.taskManager.getAllTasks().slice(0, 5),
  pendingApproval: pendingAgentApproval,
}));
ipcMain.handle("agent:approval-response", (_event, approved: unknown) => {
  pendingAgentApproval = null;
  agentRuntime.taskManager.resolveApproval(Boolean(approved));
  return { ok: true };
});

// ---------------------------------------------------------
// 7. SHELF & NOTCH EXPANSION IPC CHANNELS
// ---------------------------------------------------------
function serializeShelfItem(item: import("./shelf/shelfStore").ShelfItem) {
  let thumbnailDataUrl: string | undefined;
  if (item.type === "image" && item.thumbnailPath && fs.existsSync(item.thumbnailPath)) {
    try {
      const img = nativeImage.createFromPath(item.thumbnailPath);
      if (!img.isEmpty()) {
        thumbnailDataUrl = img.resize({ width: 140 }).toDataURL();
      }
    } catch {}
  }
  return {
    ...item,
    thumbnailDataUrl,
  };
}

ipcMain.handle("shelf:list", () => shelfStore.list().map(serializeShelfItem));

ipcMain.handle("shelf:get", (_e, id: unknown) => {
  const item = shelfStore.get(String(id || ""));
  return item ? serializeShelfItem(item) : null;
});

ipcMain.handle("shelf:search", (_e, query: unknown, filter: unknown) => {
  const f = (String(filter || "all") as ShelfItemType | "all");
  return shelfStore.search(String(query || ""), f).map(serializeShelfItem);
});

ipcMain.handle("shelf:add", (_e, payload: unknown) => {
  if (!payload || typeof payload !== "object") return { ok: false, error: "Invalid payload." };
  const p = payload as { type?: string; text?: string; name?: string; path?: string };
  if (p.type === "text") {
    const res = shelfStore.addText(String(p.text || ""), p.name);
    if (res.ok && res.item) {
      notificationHub.push("shelf", "Saved to Shelf", res.item.name);
      return { ok: true, item: serializeShelfItem(res.item) };
    }
    return res;
  }
  if (p.type === "file" && p.path) {
    const res = shelfStore.importFile(String(p.path));
    if (res.ok && res.item) {
      notificationHub.push("shelf", "Imported to Shelf", res.item.name);
      return { ok: true, item: serializeShelfItem(res.item) };
    }
    return res;
  }
  return { ok: false, error: "Unsupported shelf:add payload." };
});

ipcMain.handle("shelf:paste", () => {
  const img = clipboard.readImage();
  if (!img.isEmpty()) {
    const pngBuf = img.toPNG();
    const res = shelfStore.addImageBuffer(pngBuf, ".png", `Pasted_${Date.now()}.png`);
    if (res.ok && res.item) {
      notificationHub.push("shelf", "Pasted Image to Shelf", res.item.name);
      return { ok: true, item: serializeShelfItem(res.item) };
    }
    return res;
  }
  const text = clipboard.readText();
  if (text && text.trim()) {
    const res = shelfStore.addText(text);
    if (res.ok && res.item) {
      notificationHub.push("shelf", "Pasted Text to Shelf", res.item.name);
      return { ok: true, item: serializeShelfItem(res.item) };
    }
    return res;
  }
  return { ok: false, error: "Clipboard is empty (no image or text)." };
});

ipcMain.handle("shelf:import-paths", (_e, paths: unknown) => {
  if (!Array.isArray(paths)) return { imported: [], errors: ["Invalid file list."] };
  const imported: unknown[] = [];
  const errors: string[] = [];
  for (const p of paths) {
    const res = shelfStore.importFile(String(p));
    if (res.ok && res.item) imported.push(serializeShelfItem(res.item));
    else if (res.error) errors.push(res.error);
  }
  if (imported.length > 0) {
    notificationHub.push("shelf", "Shelf Import", `Imported ${imported.length} item(s).`);
  }
  return { imported, errors };
});

ipcMain.handle("shelf:import", async () => {
  const win = radialWindow || chatWindow || undefined;
  const result = await dialog.showOpenDialog(win as BrowserWindow, {
    title: "Tambah ke Shelf (Maks 50 MB / file)",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Supported Files", extensions: ["png", "jpg", "jpeg", "webp", "gif", "pdf", "docx", "doc", "txt", "md", "csv", "xlsx", "pptx"] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { imported: [], errors: [] };
  }
  const imported: unknown[] = [];
  const errors: string[] = [];
  for (const fp of result.filePaths) {
    const res = shelfStore.importFile(fp);
    if (res.ok && res.item) imported.push(serializeShelfItem(res.item));
    else if (res.error) errors.push(res.error);
  }
  if (imported.length > 0) {
    notificationHub.push("shelf", "Shelf Import", `Imported ${imported.length} file(s).`);
  }
  return { imported, errors };
});

ipcMain.handle("shelf:open", async (_e, id: unknown) => {
  const item = shelfStore.get(String(id || ""));
  if (!item || !item.filePath) return { ok: false, error: "Item not found." };
  const err = await shell.openPath(item.filePath);
  return { ok: !err, error: err || undefined };
});

ipcMain.handle("shelf:copy", (_e, id: unknown) => {
  const item = shelfStore.get(String(id || ""));
  if (!item) return { ok: false, error: "Item not found." };
  if (item.type === "text" && item.textContent) {
    clipboard.writeText(item.textContent);
    return { ok: true };
  }
  if (item.type === "image" && item.filePath && fs.existsSync(item.filePath)) {
    const img = nativeImage.createFromPath(item.filePath);
    if (!img.isEmpty()) {
      clipboard.writeImage(img);
      return { ok: true };
    }
  }
  if (item.filePath) {
    clipboard.writeText(item.filePath);
    return { ok: true };
  }
  return { ok: false, error: "Nothing to copy." };
});

ipcMain.handle("shelf:delete", (_e, id: unknown) => {
  const ok = shelfStore.delete(String(id || ""));
  return { ok };
});

ipcMain.handle("shelf:get-storage-info", () => shelfStore.getStorageInfo());

ipcMain.handle("notch:get-modules-state", () => {
  const activeTask = agentRuntime.taskManager.getActiveTask();
  const recentTasks = agentRuntime.taskManager.getAllTasks().slice(0, 3);
  const stellaStatus = stellaSoraManager.getStatus();
  const stellaActive =
    stellaStatus.phase === "running" ||
    stellaStatus.phase === "paused" ||
    Boolean(stellaStatus.currentWorkflow);

  const task = activeTask || recentTasks[0] || null;

  let agentState = "Idle";
  if (agentRuntime.taskManager.isPaused() || stellaStatus.taskState === "paused") {
    agentState = "Paused";
  } else if (pendingAgentApproval) {
    agentState = "Waiting for approval";
  } else if (stellaActive && !activeTask) {
    const stellaMap: Record<string, string> = {
      queued: "Idle",
      initializing: "Planning",
      running: "Running",
      verifying: "Running",
      completed: "Completed",
      failed: "Failed",
      paused: "Paused",
      cancelled: "Idle",
    };
    agentState = stellaMap[stellaStatus.taskState] || "Idle";
  } else if (task) {
    const map: Record<string, string> = {
      planning: "Planning",
      running: "Running",
      waiting: "Waiting for approval",
      recovering: "Recovering",
      completed: "Completed",
      failed: "Failed",
      cancelled: "Idle",
    };
    agentState = map[task.status] || "Idle";
  }

  const effectiveTask =
    activeTask ||
    (stellaActive
      ? {
          title: stellaStatus.currentWorkflow || stellaStatus.skillName,
          activeApp: stellaStatus.lastRecognizedScreen || "Stella Sora",
          totalSteps: 8,
          completedSteps: Math.round((stellaStatus.progressPercent / 100) * 8),
          currentStep: stellaStatus.currentStep || stellaStatus.taskState,
          lastVerifiedAction: stellaStatus.lastVerification?.evidence || "",
        }
      : task);

  return {
    agentState,
    activeTask: activeTask || (stellaActive ? effectiveTask : null),
    latestTask: effectiveTask,
    stellaSora: stellaStatus,
    pendingApproval: pendingAgentApproval,
    system: getSystemMetrics(),
    notifications: notificationHub.listActive(15),
    unreadCount: notificationHub.unreadCount(),
  };
});

ipcMain.handle("notch:dismiss-notification", (_e, id: unknown) => ({
  ok: notificationHub.dismiss(String(id || "")),
}));

ipcMain.handle("notch:mark-read", (_e, id: unknown) => {
  notificationHub.markRead(id ? String(id) : undefined);
  return { ok: true };
});

ipcMain.handle("notch:set-shelf-open", (_e, open: unknown) => {
  if (radialWindow && !radialWindow.isDestroyed()) {
    const display = screen.getPrimaryDisplay();
    const isOpen = Boolean(open);
    const w = isOpen ? 920 : 560;
    const h = isOpen ? 260 : 250;
    const x = Math.max(0, Math.floor((display.bounds.width - w) / 2));
    radialWindow.setBounds({ x, y: 0, width: w, height: h });
    if (isOpen) {
      radialWindow.setIgnoreMouseEvents(false);
      radialWindow.focus();
    } else {
      radialWindow.setIgnoreMouseEvents(true, { forward: true });
    }
  }
  return { ok: true };
});

ipcMain.handle("learning:list-skills", (_e, applicationId?: unknown, status?: unknown) =>
  skillStore.listAll(
    applicationId ? String(applicationId) : undefined,
    status ? (String(status) as SkillStatus) : undefined
  )
);

ipcMain.handle("learning:approve-skill", (_e, skillId: unknown) => {
  const approved = skillStore.approve(String(skillId || ""));
  if (approved) {
    notificationHub.push("agent", "Skill Approved", `${approved.applicationId}: ${approved.name} v${approved.version}`);
  }
  return approved;
});

ipcMain.handle("learning:learn-instruction", async (_e, appId: unknown, name: unknown, instruction: unknown) =>
  await learningEngine.learnFromInstruction(
    String(appId || ""),
    String(name || "workflow"),
    String(instruction || ""),
    agentModelClient
  )
);

ipcMain.handle("learning:start-demo", (_e, appId: unknown, name: unknown) => {
  learningEngine.recorder.start(String(appId || ""), String(name || "demo-skill"));
  return { ok: true };
});

ipcMain.handle("learning:stop-demo", () => learningEngine.recorder.stopAndPropose(skillStore));

ipcMain.handle("learning:add-knowledge", (_e, payload: unknown) => {
  const p = (payload || {}) as { applicationId?: string; category?: string; title?: string; content?: string };
  return knowledgeStore.add({
    applicationId: String(p.applicationId || "general"),
    category: (p.category || "personal-note") as KnowledgeCategory,
    title: String(p.title || "Note"),
    content: String(p.content || ""),
    source: "user",
  });
});

ipcMain.handle("learning:get-knowledge", (_e, appId: unknown) =>
  knowledgeStore.getRelevant(String(appId || ""))
);

ipcMain.handle("learning:get-stats", (_e, appId: unknown) =>
  statisticsStore.getSummary(String(appId || ""))
);

ipcMain.handle("stella-sora:command", async (_e, cmd: unknown) => {
  const res = await handleStellaSoraCommand(stellaSoraManager, String(cmd || ""));
  notificationHub.push("agent", "Stella Sora Skill", res.summary.slice(0, 120));
  return res;
});
ipcMain.handle("stella-sora:status", () => stellaSoraManager.getStatus());
ipcMain.handle("stella-sora:pause", () => stellaSoraManager.pause());
ipcMain.handle("stella-sora:resume", () => stellaSoraManager.resume());
ipcMain.handle("stella-sora:stop", async () => await stellaSoraManager.stop());

// ---------------------------------------------------------
// SETTINGS V2 IPC HANDLERS
// ---------------------------------------------------------
ipcMain.handle("settings:get", () => settingsStore.get());

ipcMain.handle("settings:update", (_event, patch: PartialSettingsPatch) => {
  const updated = settingsStore.update(patch || {});
  applyRuntimeSettings(updated);
  return updated;
});

ipcMain.handle("settings:reset-section", (_event, section: SettingsSectionKey) => {
  const updated = settingsStore.resetSection(section);
  applyRuntimeSettings(updated);
  return updated;
});

ipcMain.handle("settings:export", () => settingsStore.exportConfig());

ipcMain.handle("settings:import", (_event, rawJson: string) => {
  const result = settingsStore.importConfig(String(rawJson || ""));
  if (result.ok) {
    applyRuntimeSettings(result.settings);
  }
  return result;
});

ipcMain.handle("settings:backup", () => {
  const backupPath = settingsStore.createBackup();
  return { ok: true, path: backupPath };
});

ipcMain.handle("settings:provider-statuses", () => {
  return getProviderStatuses(settingsStore.get().ai.ollamaUrl);
});

ipcMain.handle("settings:test-provider", async (_event, providerId: string) => {
  const id = String(providerId || "");
  const s = settingsStore.get();
  const started = Date.now();
  try {
    if (id === "ollama") {
      const base = (s.ai.ollamaUrl || "http://localhost:11434/api/chat").replace(/\/api\/chat\/?$/, "");
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) });
      return { ok: res.ok, latencyMs: Date.now() - started, message: res.ok ? "Ollama reachable" : `HTTP ${res.status}` };
    }
    if (id === "pecut") {
      const key = process.env.DEEPSEEK_API_KEY || "";
      if (!key) return { ok: false, latencyMs: 0, message: "DEEPSEEK_API_KEY not set in .env" };
      const res = await fetch("https://api.pecutopus.web.id/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(6000),
      });
      return { ok: res.ok, latencyMs: Date.now() - started, message: res.ok ? "Pecut API reachable" : `HTTP ${res.status}` };
    }
    if (id === "gemini") {
      const key = process.env.GEMINI_API_KEY || "";
      if (!key) return { ok: false, latencyMs: 0, message: "GEMINI_API_KEY not set in .env" };
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`, {
        signal: AbortSignal.timeout(6000),
      });
      return { ok: res.ok, latencyMs: Date.now() - started, message: res.ok ? "Gemini API reachable" : `HTTP ${res.status}` };
    }
    if (id === "elevenlabs") {
      const key = process.env.ELEVENLABS_API_KEY || "";
      if (!key) return { ok: false, latencyMs: 0, message: "ELEVENLABS_API_KEY not set in .env" };
      const res = await fetch("https://api.elevenlabs.io/v1/user", {
        headers: { "xi-api-key": key },
        signal: AbortSignal.timeout(6000),
      });
      return { ok: res.ok, latencyMs: Date.now() - started, message: res.ok ? "ElevenLabs reachable" : `HTTP ${res.status}` };
    }
    return { ok: false, latencyMs: 0, message: `Unknown provider "${id}"` };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, message: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("settings:discover-ollama", async () => {
  const s = settingsStore.get();
  const base = (s.ai.ollamaUrl || "http://localhost:11434/api/chat").replace(/\/api\/chat\/?$/, "");
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3500) });
    if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}` };
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    const models = (data.models || []).map((m) => m.name).filter((n): n is string => Boolean(n));
    return { ok: true, models };
  } catch (err) {
    return { ok: false, models: [], error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("settings:storage-info", () => {
  return getStorageBreakdown(app.getPath("userData"), BASE);
});

ipcMain.handle("settings:clear-cache", () => {
  return clearSafeCache(app.getPath("userData"), BASE);
});

ipcMain.handle("settings:clear-logs", () => {
  return clearSafeLogs(app.getPath("userData"), BASE);
});

ipcMain.handle("settings:audit-log", () => {
  return agentRuntime.auditLog.getRecentAudit(50);
});

ipcMain.handle("settings:system-info", () => {
  return {
    metrics: getSystemMetrics(),
    stellaSora: stellaSoraManager.getStatus(),
    recorderActive: learningEngine.recorder.isRecording(),
  };
});

ipcMain.handle("settings:about-info", () => {
  let version = "1.0.0";
  let description = "TM Opera O — AI Talker (Electron + TypeScript)";
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(BASE, "package.json"), "utf-8"));
    version = pkg.version || version;
    description = pkg.description || description;
  } catch {}
  return {
    name: "TM Opera O",
    version,
    description,
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    userDataDir: app.getPath("userData"),
    baseDir: BASE,
  };
});

ipcMain.handle("settings:open-folder", async (_event, which: "userData" | "base") => {
  const target = which === "userData" ? app.getPath("userData") : BASE;
  await shell.openPath(target);
  return true;
});

ipcMain.handle("settings:pick-folder", async () => {
  const res = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (res.canceled || res.filePaths.length === 0) return { canceled: true, path: "" };
  return { canceled: false, path: res.filePaths[0] };
});

ipcMain.handle("settings:check-privacy", (_event, toolName: string) => {
  return checkPrivacyToolAccess(String(toolName || ""), settingsStore.get().privacy);
});

app.whenReady().then(() => {
  applyRuntimeSettings(settingsStore.get());
  createWindows();
  startBackgroundLoops();
  startMediaWatcher();
  scanInstalledApps().catch(() => {});
});

let isQuittingAll = false;
function cleanupAndQuit(): void {
  if (isQuittingAll) return;
  isQuittingAll = true;
  if (keepOnTopTimer) {
    clearInterval(keepOnTopTimer);
    keepOnTopTimer = null;
  }
  try {
    stopMediaWatcher();
    stopKeyboardWorker();
    stopActiveWindowWorker();
    void stellaSoraManager?.shutdown();
  } catch {}
  try {
    agentRuntime?.taskManager.emergencyStop();
  } catch {}
  try {
    shelfStore?.close();
    skillStore?.close();
    knowledgeStore?.close();
    statisticsStore?.close();
  } catch {}
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) win.destroy();
    } catch {}
  }
  app.quit();
  setTimeout(() => app.exit(0), 200);
}

app.on("before-quit", () => {
  try {
    stopMediaWatcher();
    shelfStore?.close();
  } catch {}
});

app.on("window-all-closed", () => {
  cleanupAndQuit();
});
