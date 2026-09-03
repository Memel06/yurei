# Changelog

Notable changes to Yurei. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
versions follow [Semantic Versioning](https://semver.org).

## [0.1.0] - 2026-09-04

First public release.

- Chrome extension (Manifest V3) that drives tabs through Chrome's debugging protocol, with an in-page glow,
  cursor and Stop button while the AI works.
- `yurei-chrome` CLI: native messaging host, MCP server over stdio and a setup wizard for opencode, pi,
  Cursor, Windsurf, Codex CLI, plus a generic snippet for any other MCP client.
- Thirteen browser tools: tabs, navigation, clicks and typing by ref or coordinate, page outline and text,
  find, forms, JavaScript, console and network logs, window resize. Iframes included, with frame-qualified refs.
- Screenshots on demand for models that see images. Text views for everyone else.

[0.1.0]: https://github.com/memel06/yurei/releases/tag/v0.1.0
