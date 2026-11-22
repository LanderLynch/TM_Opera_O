# Desktop Observation

1. Check the active foreground window (`get_active_window` / `list_open_windows`) before acting.
2. Focus the target window (`focus_window`) and verify the foreground title matches.
3. Capture a screenshot (`capture_screen`) only when visual context is needed or UIA returns no elements.
4. Keep observations scoped to the task's target application.
