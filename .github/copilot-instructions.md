# Copilot Instructions

## Language

All user-facing UI text (labels, buttons, placeholders, tooltips, alerts, confirmation dialogs, error messages) **must always be written in English**.

This applies to:
- Vue template text content
- String literals shown to users (e.g. `alert()`, `confirm()`, modal titles)
- HTML attributes visible to users (`title`, `placeholder`, `alt`)
- Computed properties or methods that return display text

This does **not** apply to:
- Code comments (any language is fine)
- `console.log` / `console.warn` / `console.error` messages
- Variable names, function names, CSS class names
