# Changelog

Notable changes to Yurei. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

### Changed

- Cookie banners are only ever rejected. When a banner offers no reject button, nothing is clicked: the AI is told
  to ask the user to dismiss it, or to say which button to press, before it goes on. Before, the accept button was
  clicked in that case.

### Fixed

- `find` understands queries in any script and ignores Latin accents: "citta" finds "Città" and "検索" finds the search
  button. Before, letters outside a-z were treated as separators and dropped from the query.
- `yurei update` and the automatic `pi install` on Windows: commands that have to run through `cmd.exe` are quoted,
  so a Node.js under `C:\Program Files`, or a user folder with a space in it, no longer breaks them apart.

## [0.3.0] - 2026-09-04

Yurei gets a window of its own, dismisses cookie banners, reads pages more narrowly and learns to update itself.

### Added

- Yurei browses in a window of its own. Tabs the AI opens go there, tools called without a tab id stay there, and
  the user's tabs are only touched when named by id. The window comes back where the user last put it.
- Cookie banners are dismissed on the AI's behalf: the one-click reject when there is one, otherwise accept.
- `computer(action="scroll_to_bottom")` scrolls through a page screen by screen so lazy lists and feeds load, and
  stops when the page stops growing.
- `get_page_text` reads the main content by default and takes a CSS `selector` or a `ref` to read one part;
  `read_page` takes a `selector` too.
- `yurei update` fetches the newest command line tool through npx, installs it, refreshes the skill and restarts the
  native host, so the new version is in use without restarting Chrome.
- The native host asks npm once a day whether a newer version is out (`YUREI_NO_UPDATE_CHECK=1` turns it off). When
  it is, the toolbar icon shows an arrow, the popup, `yurei setup` and `yurei doctor` say what to run, and the first
  tool result of each AI session carries the suggestion.
- The extension and the command line tool tell each other their versions. Setup and `yurei doctor` report a native
  host that is still the old version, and a protocol mismatch after an update is explained in the popup and in tool
  results instead of failing silently.

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

[Unreleased]: https://github.com/memel06/yurei/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/memel06/yurei/releases/tag/v0.3.0
[0.2.0]: https://github.com/memel06/yurei/releases/tag/v0.2.0
[0.1.0]: https://github.com/memel06/yurei/releases/tag/v0.1.0
