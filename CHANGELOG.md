# Changelog

Notable changes to Yurei. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

### Added

- Yurei browses in a window of its own. Tabs the AI opens go there, tools called without a tab id stay there, and
  the user's tabs are only touched when named by id. The window comes back where the user last put it.
- Cookie banners are dismissed on the AI's behalf: the one-click reject when there is one, otherwise accept.
- `computer(action="scroll_to_bottom")` scrolls through a page screen by screen so lazy lists and feeds load, and
  stops when the page stops growing.
- `get_page_text` reads the main content by default and takes a CSS `selector` or a `ref` to read one part;
  `read_page` takes a `selector` too.

### Changed

- The AI is refused more than three tabs on one site, or eight in all, and told to reuse or close tabs instead.
  Search engines get a slower page-load budget than other sites. The skill steers models toward reading narrowly
  and working in one tab.
- The CLI wears the website's look: the `幽霊 yurei` brand row and ghost, brush numerals for the setup steps,
  a real menu for picking AI tools, and a spinner with a countdown for every wait, so nothing looks hung.

### Fixed

- Adding Yurei to pi no longer freezes the wizard: installing pi-mcp-adapter now shows its progress live and
  gives up after two minutes with the command to run by hand.

- The native host accepts the Chrome Web Store build. The store assigns its own extension id rather than
  honouring the manifest `key`, so a whitelist pinned to the unpacked id refused the connection and left
  every tool call failing. Both ids are whitelisted now.

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
