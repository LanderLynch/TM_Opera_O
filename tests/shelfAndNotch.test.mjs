import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ShelfStore, MAX_SHELF_FILE_BYTES } = require("../dist/shelf/shelfStore.js");
const { getSystemMetrics } = require("../dist/notch/systemMonitor.js");
const { NotificationHub } = require("../dist/notch/notificationHub.js");
const { createDefaultToolRegistry } = require("../dist/tools/registry.js");
const { selectMediaSession, resolveAppMatches } = require("../dist/pcController.js");
const { selectModelForTier } = require("../dist/ai/toolCalling.js");

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("ShelfStore imports images/docs/text, handles duplicates, search, persistence, delete, and missing files", () => {
  const baseDir = makeTempDir("tm-shelf-store-");
  const srcDir = makeTempDir("tm-shelf-src-");
  const store = new ShelfStore(baseDir);

  try {
    // 1. Import image, PDF, DOCX
    const pngPath = path.join(srcDir, "cover.png");
    const pdfPath = path.join(srcDir, "report.pdf");
    const docxPath = path.join(srcDir, "notes.docx");
    fs.writeFileSync(pngPath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    fs.writeFileSync(pdfPath, Buffer.from("%PDF-1.4\n"));
    fs.writeFileSync(docxPath, Buffer.from("PK\x03\x04"));

    const r1 = store.importFile(pngPath);
    const r2 = store.importFile(pdfPath);
    const r3 = store.importFile(docxPath);
    assert.equal(r1.ok, true);
    assert.equal(r1.item.type, "image");
    assert.equal(r2.ok, true);
    assert.equal(r2.item.type, "document");
    assert.equal(r3.ok, true);
    assert.equal(r3.item.type, "document");

    // 2. Duplicate filename produces distinct internal path
    const r1Dup = store.importFile(pngPath);
    assert.equal(r1Dup.ok, true);
    assert.notEqual(r1Dup.item.filePath, r1.item.filePath);

    // 3. Add text snippet
    const rText = store.addText("Meeting reminder at 3pm", "Reminder");
    assert.equal(rText.ok, true);
    assert.equal(rText.item.type, "text");

    // 4. Search & type filter
    assert.equal(store.search("", "all").length, 5);
    assert.equal(store.search("", "image").length, 2);
    assert.equal(store.search("", "document").length, 2);
    assert.equal(store.search("Meeting", "text").length, 1);
    assert.equal(store.search("report", "document").length, 1);

    // 5. Persistence across reopen
    store.close();
    const reopened = new ShelfStore(baseDir);
    try {
      assert.equal(reopened.list().length, 5);

      // 6. Delete removes internal copy without touching original source file
      assert.equal(reopened.delete(r1.item.id), true);
      assert.equal(fs.existsSync(r1.item.filePath), false);
      assert.equal(fs.existsSync(pngPath), true);
      assert.equal(reopened.list().length, 4);

      // 7. Missing internal file resilience
      fs.unlinkSync(r2.item.filePath);
      assert.equal(reopened.list().length, 3);
    } finally {
      reopened.close();
    }
  } finally {
    store.close();
    fs.rmSync(baseDir, { recursive: true, force: true });
    fs.rmSync(srcDir, { recursive: true, force: true });
  }
});

test("ShelfStore rejects payloads over 50 MB limit", () => {
  const baseDir = makeTempDir("tm-shelf-limit-");
  const store = new ShelfStore(baseDir);
  try {
    const oversized = Buffer.alloc(MAX_SHELF_FILE_BYTES + 1);
    const res = store.addImageBuffer(oversized, ".png", "huge.png");
    assert.equal(res.ok, false);
    assert.match(res.error || "", /50 MB/i);
  } finally {
    store.close();
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("getSystemMetrics returns valid CPU and memory metrics", () => {
  const m = getSystemMetrics();
  assert.equal(typeof m.cpuPercent, "number");
  assert.ok(m.cpuPercent >= 0 && m.cpuPercent <= 100);
  assert.ok(m.ramTotalGb > 0);
  assert.ok(m.ramAvailableGb >= 0);
  assert.ok(m.appMemoryMb > 0);
});

test("NotificationHub tracks unread count, prevents duplicates, and supports dismiss", () => {
  const hub = new NotificationHub();
  const n1 = hub.push("agent", "Task Started", "Opening Discord");
  assert.ok(n1);
  assert.equal(hub.unreadCount(), 1);

  // Duplicate within 8s is suppressed
  const dup = hub.push("agent", "Task Started", "Opening Discord");
  assert.equal(dup, null);
  assert.equal(hub.unreadCount(), 1);

  const n2 = hub.push("approval", "Confirm", "Send message");
  assert.ok(n2);
  assert.equal(hub.unreadCount(), 2);

  hub.markRead(n1.id);
  assert.equal(hub.unreadCount(), 1);

  assert.equal(hub.dismiss(n2.id), true);
  assert.equal(hub.unreadCount(), 0);
  assert.equal(hub.listActive().length, 1);
});

test("ToolRegistry registers Shelf tools with confirm gate on shelf_delete", async () => {
  const baseDir = makeTempDir("tm-shelf-tools-");
  const store = new ShelfStore(baseDir);
  try {
    const registry = createDefaultToolRegistry({
      pcController: {},
      screenObserver: {},
      shelfStore: store,
      openFilePath: async () => ({ ok: true }),
    });

    const saveTool = registry.get("shelf_save_text");
    const searchTool = registry.get("shelf_search");
    const openTool = registry.get("shelf_open");
    const deleteTool = registry.get("shelf_delete");

    assert.ok(saveTool);
    assert.ok(searchTool);
    assert.ok(openTool);
    assert.ok(deleteTool);
    assert.equal(deleteTool.permissionLevel, "confirm");

    const saved = await saveTool.execute({ text: "Agent saved note", name: "AgentNote" });
    assert.equal(saved.success, true);

    const found = await searchTool.execute({ query: "Agent", type: "text" });
    assert.equal(found.success, true);
    assert.equal(found.output.length, 1);
  } finally {
    store.close();
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("selectMediaSession filters strictly by spotify, youtube, or any focus mode", () => {
  const spotifySession = {
    app: "Spotify.exe",
    title: "Song A",
    artist: "Artist A",
    album: "Album A",
    status: "Paused",
    positionSec: 10,
    durationSec: 180,
    updatedAtMs: Date.now(),
  };
  const youtubeSession = {
    app: "chrome.exe",
    title: "YouTube Video B",
    artist: "Channel B",
    album: "",
    status: "Playing",
    positionSec: 20,
    durationSec: 600,
    updatedAtMs: Date.now(),
  };

  assert.equal(selectMediaSession([youtubeSession], "spotify"), null);
  assert.equal(selectMediaSession([spotifySession, youtubeSession], "spotify")?.app, "Spotify.exe");
  assert.equal(selectMediaSession([spotifySession], "youtube"), null);
  assert.equal(selectMediaSession([spotifySession, youtubeSession], "youtube")?.app, "chrome.exe");
  assert.equal(selectMediaSession([spotifySession, youtubeSession], "any")?.app, "chrome.exe");
});

test("resolveAppMatches keeps Steam and local launcher distinct for Strinova", () => {
  const apps = [
    { name: "Strinova", source: "app", target: "C:\\Strinova\\Strinova.exe", label: "Strinova (Launcher Lokal)" },
    { name: "Strinova", source: "steam", target: "steam://rungameid/1282270", label: "Strinova (Steam)" },
  ];

  const askBoth = resolveAppMatches(apps, "strinova", "buka strinova");
  assert.equal(askBoth.status, "multiple");
  assert.equal(askBoth.options?.length, 2);

  const pickSteam = resolveAppMatches(apps, "strinova", "buka strinova steam");
  assert.equal(pickSteam.status, "launched");
  assert.equal(pickSteam.chosen?.source, "steam");

  const pickLauncher = resolveAppMatches(apps, "strinova", "buka strinova biasa");
  assert.equal(pickLauncher.status, "launched");
  assert.equal(pickLauncher.chosen?.source, "app");
});

test("selectModelForTier routes fast, standard, and chief tiers cleanly", () => {
  assert.equal(selectModelForTier("gemini-2.5-pro", "fast"), "gemini-2.5-flash-lite");
  assert.equal(selectModelForTier("gemini-2.5-pro", "standard"), "gemini-2.5-pro");
  assert.equal(selectModelForTier("gemini-2.5-flash-lite", "chief"), "gemini-2.5-flash");
  assert.equal(selectModelForTier("deepseek-reasoner", "fast"), "deepseek-chat");
  assert.equal(selectModelForTier("local:qwen2.5:1.5b", "fast"), "local:qwen2.5:1.5b");
});
