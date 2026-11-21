# TM Opera O — Universal Autonomous Desktop Agent

Asisten AI desktop dan **Universal Autonomous Desktop Agent** untuk Windows berbasis **Electron 41 + TypeScript 6**, dilengkapi dengan iOS-style Dynamic Island Notch, chat transparan di sudut layar, kontrol media/lirik Spotify real-time, otomasi PC & Microsoft Word COM, serta arsitektur Agent Engine (`Plan -> Execute -> Observe -> Verify -> Recover`).

## Arsitektur & Struktur Folder

```text
TM_Opera_O/
├── src/
│   ├── main.ts                 # Electron main process, window manager, IPC & legacy bridge
│   ├── preload.ts              # Context-isolated preload (window.pywebview.api & window.agent)
│   ├── pcController.ts         # App/Steam scanner, Word COM live typing, SMTC & LRCLIB lyrics
│   ├── core/                   # errors.ts, logger.ts, eventBus.ts
│   ├── ai/                     # toolCalling.ts (normalized ModelResponse & structured parser)
│   ├── agent/                  # agentRuntime.ts, planner.ts, executor.ts, observer.ts, verifier.ts, recovery.ts, taskManager.ts
│   ├── applications/           # applicationManager.ts, applicationRegistry.ts + Discord, WhatsApp, Chrome, Word, Universal adapters
│   ├── desktop/                # windowManager.ts, foregroundManager.ts, mouse.ts, keyboard.ts, windowsUIAutomation.ts
│   ├── tools/                  # registry.ts, toolTypes.ts, validation.ts, permissions.ts
│   ├── memory/                 # memoryStore.ts (SQLite via node:sqlite), taskMemory.ts
│   └── safety/                 # actionGuard.ts, auditLog.ts
├── web/
│   ├── index.html              # Transparent corner chat + Agent Execution Monitor & Approval UI + 9 emotion stickers
│   ├── notch.html              # Top-bezel iOS Dynamic Island Notch (Synced Lyrics, Token Usage %, Quick Controls)
│   ├── settings.html           # Unslop split-view Settings (Media & Notch, TM Opera O, Reminder, PC Control)
│   └── stickers/               # 9 stiker emosi
├── tests/                      # Unit & integration tests (node --test)
├── package.json
├── tsconfig.json
└── Mulai Opera O.vbs           # Launcher Windows tanpa console
```

## Tech Stack

- **Desktop Runtime**: Electron 41 (`contextIsolation: true`, `transparent: true`, `alwaysOnTop`)
- **Language**: TypeScript 6 (`strict: true`, CommonJS build ke `dist/`)
- **AI Providers**: Pecut Opus (`pecut/deepseek-v4.1-flash-uncensored`, Vision `pecut/qwen3.8-flash`), Google Gemini, dan Ollama lokal (`qwen2.5:1.5b`)
- **Voice (TTS)**: ElevenLabs (`eleven_flash_v2_5`), Gemini 2.5 Native TTS (`Sulafat`), dan `msedge-tts` (`id-ID-GadisNeural`)
- **Desktop & Browser Control**: Win32 API (`user32.dll`), `.NET UIAutomationClient`, Word COM Automation (`Word.Application`), Windows SMTC + `lrclib.net`
- **Persistence**: `node:sqlite` (`agent_state.db` untuk task & riwayat eksekusi), `memory.json`, `settings.json`, `usage.json`

## Install & Jalankan

```bash
npm install
npm run build
npm start
```

Atau *double-click* `Mulai Opera O.vbs` di Windows.

## Menjalankan Pengujian

```bash
npx tsc --noEmit
npm test
```

## Mode Agent Otonom & Keamanan

- Aktifkan tombol **Agent** di bar chat (atau awali perintah dengan `/agent ...`) untuk menjalankan loop `Plan -> Execute -> Observe -> Verify`.
- **Execution Monitor** menampilkan status real-time, langkah yang selesai/berjalan/tertunda, bukti verifikasi, serta tombol **Pause**, **Resume**, **Cancel**, dan **Emergency Stop**.
- **Approval Gate**: Tindakan sensitif seperti mengirim pesan keluar (`send_external_message` di Discord/WhatsApp) atau merapikan folder (`execute_folder_organization`) otomatis meminta persetujuan **Approve / Reject** sebelum dieksekusi.
