# Changelog

Notable changes to Yurei. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
versions follow [Semantic Versioning](https://semver.org).

## [0.2.0] - 2026-09-04

Yurei now works at a human pace instead of an instant one.

### Added

- A per-site budget on interactions and page loads. When it is spent, Yurei waits for its turn rather than
  firing back to back, which is what earns rate limits and bans.

### Changed

- Pointer moves travel to their target across several eased mousemove events instead of jumping there.
- Delays between actions are spread around their nominal value instead of being identical every time.
- Keys are held briefly, and the parts of a key sequence no longer fire with no gap between them.

## [0.1.0] - 2026-09-04

First public release.

- Chrome extension (Manifest V3) that drives tabs through Chrome's debugging protocol, with an in-page glow,
  cursor and Stop button while the AI works.
- `yurei-chrome` CLI: native messaging host, MCP server over stdio and a setup wizard for opencode, pi,
  Cursor, Windsurf, Codex CLI, plus a generic snippet for any other MCP client.
- Thirteen browser tools: tabs, navigation, clicks and typing by ref or coordinate, page outline and text,
  find, forms, JavaScript, console and network logs, window resize. Iframes included, with frame-qualified refs.
- Screenshots on demand for models that see images. Text views for everyone else.

[0.2.0]: https://github.com/memel06/yurei/releases/tag/v0.2.0
[0.1.0]: https://github.com/memel06/yurei/releases/tag/v0.1.0
