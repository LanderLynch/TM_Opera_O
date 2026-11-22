# Mouse & Keyboard Operations

- Use `keyboard_shortcut` only with allowlisted shortcuts (`enter`, `tab`, `esc`, `ctrl+c`, `ctrl+v`, `ctrl+s`, `alt+tab`, `alt+f4`, etc.).
- Use `type_text` after confirming the target window and input field have focus.
- Validate all `mouse_click` coordinates against screen bounds via `actionGuard`.
