---
name: computer-use
description: Internal computer-use methodology for TM Opera O. Guides the Agent Brain on how to observe Windows desktop state, select the highest-priority interaction method, execute one verified step at a time, and recover safely without guessing.
---

# TM Opera O — Computer Use Methodology

Fundamental interaction loop:

`OBSERVE → IDENTIFY → ACT → OBSERVE → VERIFY`

Never assume an action succeeded simply because a tool call returned `success: true`. Always verify the resulting desktop or application state.

## Interaction Priority

Select the highest-priority reliable method available via `InteractionRouter`:

1. **Native Application API** (e.g., Spotify SMTC / local Shelf API)
2. **Microsoft Office COM / Native Automation** (Word COM live automation)
3. **Browser DOM / Playwright** (for authorized web apps like WhatsApp Web)
4. **Windows UI Automation (UIA)** (`inspect_ui_tree`, `ui_click_element`)
5. **Background Interaction** (when supported without stealing focus)
6. **Vision / Screenshot + Mouse / Keyboard Fallback** (`capture_screen`, `mouse_click`, `type_text`, `keyboard_shortcut`)

Never allow multiple control engines to compete over the same desktop task; acquire `ExecutionLock` before executing desktop actions.

## Core Rules

- **Prefer UIA / structured selectors over raw coordinates.** Treat screen coordinates as a fallback when UIA elements are unavailable.
- **Confirm before destructive or outward-facing actions:** sending messages, deleting files/items, overwriting documents, purchases, admin commands, or approving learned skills.
- **Never bypass authentication, CAPTCHA, MFA, or security dialogs.** Stop and request user intervention.
- **Adapt when UI changes:** if a saved skill step no longer matches the observed UI, do not blindly repeat old coordinates; inspect the new screen and propose a skill update (`needs-review`).

## References

- [desktop-observation.md](references/desktop-observation.md)
- [accessibility-tree.md](references/accessibility-tree.md)
- [mouse-keyboard.md](references/mouse-keyboard.md)
- [safety-rules.md](references/safety-rules.md)
- [verification.md](references/verification.md)
- [recovery.md](references/recovery.md)
