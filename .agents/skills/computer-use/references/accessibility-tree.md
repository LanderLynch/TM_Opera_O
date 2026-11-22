# Accessibility Tree (Windows UI Automation)

- Use `inspect_ui_tree` to discover interactive controls (`Button`, `Edit`, `TabItem`, `MenuItem`) by Name and AutomationId.
- Use `ui_click_element` to invoke buttons directly through UIA patterns (`InvokePattern` / bounding-box fallback).
- Prefer UIA names over fixed `(x, y)` coordinates so workflows survive window resizing and minor UI shifts.
