# yurei-chrome

The command-line half of [Yurei](https://yurei.web.app), which lets your AI browse in your own Chrome. It
registers the native messaging host the Yurei extension talks to, runs the MCP server your AI tool launches
and adds Yurei to the tools you pick: opencode, pi, Cursor, Windsurf, Codex CLI or any other MCP client.

```sh
npx yurei-chrome setup
```

Requires Node.js 18 or newer and the [Yurei Chrome extension](https://chromewebstore.google.com/detail/acgjkkmeekbcbpknmackieajkcmbllhm).
Source, issues and documentation: [github.com/memel06/yurei](https://github.com/memel06/yurei).
