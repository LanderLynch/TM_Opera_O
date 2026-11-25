# TM Opera O — Electron to Tauri v2 Migration

## Goal

Reduce idle and active RAM usage while preserving every existing TM Opera O feature. The Electron implementation remains the production fallback until the Tauri implementation reaches feature parity and passes comparative benchmarks.

## Branch and safety

- Migration branch: `migration/tauri-v2-foundation`
- Production reference: `main`
- Do not remove or rewrite Electron entry points during migration.
- Do not commit `.env`, API keys, user memory, usage data, or local settings.
- Each phase must end with a reviewable checkpoint before proceeding.

## Architecture decision

Use a hybrid architecture:

- Existing HTML/CSS/TypeScript remains the UI and domain/AI layer where browser-compatible.
- Tauri v2 + Rust handles desktop lifecycle, Windows APIs, process management, and privileged local I/O.
- No permanently running Node.js sidecar.
- Python MaaFramework and other heavy engines remain on-demand external processes.
- Existing AI features and providers must be preserved; credentials must not be exposed to WebView JavaScript.

## Checkpoint plan

| Checkpoint | Scope | Required exit criteria |
| --- | --- | --- |
| A0 | Isolated Tauri foundation | Rust project structure and smoke-test page added without changing Electron startup |
| A1 | Local toolchain/build validation | Tauri dev build succeeds on target Windows machine; toolchain versions recorded |
| B | Window and tray parity | Notch, chat, settings, tray, transparency, always-on-top, and click-through verified |
| C | Native backend | Win32 control, monitoring, screenshots, storage, and process lifecycle migrated with tests |
| D | TypeScript bridge | Existing frontend API contract mapped to Tauri commands/events; no UI feature removed |
| E | Feature parity and performance | Feature checklist passes; RAM benchmark compared under equivalent conditions |

## RAM benchmark protocol

Use the same Windows machine, power mode, display scaling, and workload for Electron and Tauri.

Record at minimum:

- Cold startup: 5 seconds after launch.
- Idle: 5 and 10 minutes, with the same windows visible.
- Chat interaction and one AI request.
- Screenshot capture.
- TTS playback.
- Stella Sora / MaaFramework task.
- Idle recovery after each workload.

Record both Working Set (resident physical memory) and Private Bytes (private committed memory). For multi-process apps, include the full application process tree. Exclude unrelated WebView2 processes belonging to other applications. Record Python/model-worker memory separately and also record an application-total figure that includes it.

Do not compare a Tauri Notch-only state against an Electron Chat+Notch state. Every comparison must use equivalent feature states.

### Baseline supplied by the initial audit

- Electron startup Working Set: 330.4–450.5 MB.
- Electron startup Private Bytes: 108.5–256.6 MB.

These are audit-provided reference values, not independently reproduced measurements. Capture a fresh baseline on the target PC before replacing any runtime component.

## Current checkpoint A0

Added:

- `src-tauri/`: minimal Tauri v2 Rust application scaffold.
- `web/tauri-smoke.html`: isolated static smoke-test page.
- `src-tauri/capabilities/default.json`: least-privilege preview capability.

Intentionally not changed:

- `package.json` and `package-lock.json`.
- Electron main process and preload.
- Existing UI pages and their runtime contracts.
- AI providers, persistence, reminders, desktop control, TTS, and Python integrations.

The smoke-test window is not the migrated application. The existing frontend depends on Electron/preload APIs and must not be pointed at the Tauri runtime until the compatibility bridge is implemented.

## Known validation limitation

The initial repository audit reported that Rust/Cargo was not installed on the target machine. Therefore this scaffold cannot be considered build-verified until the user installs the Windows Rust/MSVC toolchain and runs the validation commands in the project instructions.

## Next commands on Windows

Install the Rust MSVC toolchain and Tauri prerequisites first. Then, from the repository root:

```powershell
rustc --version
cargo --version
cargo tauri --version
cargo tauri dev --config src-tauri/tauri.conf.json
```

If the Tauri CLI is not installed, install it as a development tool using the official Tauri v2 instructions before running the last command.

## Rollback

To return to the current Electron app, check out `main`. Do not merge the migration branch into `main` until the relevant checkpoint is reviewed and accepted.
