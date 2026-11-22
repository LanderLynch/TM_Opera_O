# Stella Sora Skill Package (`skills/games/stella-sora`)

Modular Game Automation Skill for **TM Opera O**, extracted and adapted from [MaaStellaSora](https://github.com/MaaStellaSora/MaaStellaSora) (`v0.9.5`, MIT License — see [upstream/LICENSE.upstream](upstream/LICENSE.upstream)).

## Architecture

- `upstream/`: Isolated MIT-licensed MaaStellaSora resources (`base`, `en`, `windows`, `interface/tasks`, `agent/custom`).
- `engine/maa_runner.py`: Separate Python subprocess speaking JSON-lines over `stdin`/`stdout` to `MaaFw` (`Win32Controller`, `Resource`, `Tasker`, `Toolkit`).
- `engine/maaBridge.ts`: Electron/TypeScript bridge managing readiness checks, timeouts, and emergency stop.
- `engine/processManager.ts`: Steam / Windows process & window detection for Stella Sora.
- `engine/engineManager.ts`: 10-step activation lifecycle (`discover` → `checkCompatibility` → `checkEngine` → `detectGame` → `initialize` → `status` → `execute` → `verify` → `report` → `shutdown`). Activating never auto-executes workflows.
- `workflows/workflowCatalog.ts`: Extracted independent workflows (`login-check`, `daily-missions`, `mailbox`, `friend-gifts`, `shop`, `events`, `tower`, `combat`, `cataclysm-survivor`).
- `verification/taskVerifier.ts` & `reports/reportGenerator.ts`: Screenshot/evidence verification and verified-only daily summaries.

## Steam Global Verification Status

**Pending live verification** until the Steam Global client is installed locally.
