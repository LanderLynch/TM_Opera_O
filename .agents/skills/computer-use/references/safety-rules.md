# Safety Rules

- Never send passwords, cookies, API keys, or auth tokens to the AI model.
- Never bypass login screens, MFA, CAPTCHAs, or OS UAC prompts.
- Require explicit user confirmation via Approval Center (`confirm` permission level) for external sends, deletions, purchases, or system changes.
- Respect `ExecutionLock` and `emergencyStop` at all times.
