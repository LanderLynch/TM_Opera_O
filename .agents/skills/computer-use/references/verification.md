# Verification

- Every action should produce observable evidence (foreground window change, file created/updated, UI element state change, or screenshot confirmation).
- Distinguish between:
  - **Requested**: tool call issued
  - **Executed**: tool returned without error
  - **Observed**: desktop/app state inspected after execution
  - **Verified**: post-condition matches expected outcome
- Never report a step as completed unless it is verified.
