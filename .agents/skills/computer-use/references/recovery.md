# Recovery

- Never blind-retry external send or destructive tools.
- If a step fails or the UI changed unexpectedly:
  1. Re-observe the current active window and UI tree.
  2. Escalate planner tier (`fast` -> `standard` -> `chief`) when needed.
  3. Check if an unexpected pop-up/dialog is blocking the workflow and handle safely.
  4. If a saved skill is outdated, propose a `needs-review` update instead of overwriting the approved skill.
