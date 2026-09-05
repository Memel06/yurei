<p align="center">
  <a href="https://yurei.web.app"><img src="assets/yurei.png" width="140" alt="Yurei, a friendly blue ghost"></a>
</p>

<h1 align="center">Yurei</h1>

<p align="center">
  <b>Your AI, haunting your browser.</b><br>
  A Chrome extension and a tiny CLI that give any AI coding tool the Chrome you already use.
</p>

<p align="center">
  <a href="https://yurei.web.app">yurei.web.app</a> ·
  <a href="#install">Install</a> ·
  <a href="#use">Use</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://github.com/memel06/yurei/actions/workflows/ci.yml"><img src="https://github.com/memel06/yurei/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-4274f2" alt="MIT license"></a>
</p>

---

Yurei (幽霊, a Japanese ghost) lets the AI coding tool you already use browse in your own Chrome: your tabs,
your logins, your cookies. It works with opencode, pi, Cursor, Windsurf, Codex CLI and anything else that
speaks [MCP](https://modelcontextprotocol.io), with any model. Models that see images take screenshots when
they need them. Text-only models read the page as text. There is nothing to configure when you switch.

## Install

1. Add [Yurei](https://chromewebstore.google.com/detail/fhdcknamidemigkgcfhlbdoibpfchffd) to Chrome.
2. In a terminal, with [Node.js](https://nodejs.org) 18 or newer:

   ```sh
   npx yurei-chrome setup
   ```

Setup registers the native host, waits for the extension to say hello and asks which of your AI tools to add
Yurei to. It also writes a short skill file, `~/.agents/skills/yurei/SKILL.md`, that teaches the AI how to use
the tools. Restart your AI tools. That's it, the ghost is in.

> The extension is not in the Chrome Web Store yet. Until it is, download `yurei-extension.zip` from the
> [latest release](https://github.com/memel06/yurei/releases/latest), unzip it and load the folder in `chrome://extensions`
> with Developer mode on. Step 2 works as written.

## Use

Ask your AI as you normally would. When a task needs a browser, it uses Yurei:

- "Open my news tab and summarise the five biggest stories."
- "In my inbox, find the unread message from the bank and tell me the amount."
- "Log in to staging as the test user and check the checkout page."

Say "in my browser" when you want to be explicit.

Yurei browses in a window of its own, so it never switches the tab you are reading. The first time, that
window comes to the front; put it wherever you like and it comes back there next time. Your own tabs are
touched only when you ask for one of them, like the news tab above.

While the ghost works, the tab glows and a **Stop Yurei** button appears at the bottom of the page. Cookie
banners are rejected for it when a reject button is one click away; a banner that only offers accept is left to
you, and the AI is told to ask before going on. The AI acts inside your logged-in accounts. It is told to ask
before paying, sending messages or deleting anything. Keep an eye on it anyway.

Want it further away still? Make a Chrome profile just for Yurei and add the extension to that profile only.
The setup command is the same.

## Commands

```
yurei setup [--yes]           add Yurei to your AI tools, or repair the installation
yurei update                  get the newest version of the command line tool
yurei doctor                  check that Chrome and the extension are connected
yurei config <tool>           print the MCP config for one tool: opencode, pi, cursor, windsurf, codex, generic
yurei call <tool> '<json>'    run one browser tool by hand, e.g. yurei call navigate '{"url":"example.com"}'
yurei reload-extension        reload the unpacked extension after a rebuild
```

Setup links `yurei` into `~/.local/bin`. If that is not on your PATH, `npx yurei-chrome <command>` works the same.

## Update

Chrome updates the extension by itself. The command line tool is a copy on your disk, so update it with:

```sh
yurei update
```

Yurei checks npm once a day. When a newer version is out, or the extension and the command line tool no longer
match, the toolbar icon shows an arrow, the popup and `yurei doctor` say what to run, and the AI is told to pass it
on. Set `YUREI_NO_UPDATE_CHECK=1` to turn the check off.

## What the AI gets

After every action the AI gets the page back as text: the address, the title and a numbered list of
everything it can click or type into. Buttons and fields inside embedded frames are listed too.

| Tool | What it does |
| --- | --- |
| `tabs_context`, `tabs_create`, `tabs_close` | List, open and close tabs |
| `navigate` | Go to a URL, back, forward, reload |
| `computer` | Click, type, press keys, scroll, scroll through a lazy page, drag, wait, take a screenshot |
| `read_page` | Outline of the page, of one element, or of everything |
| `find` | Locate an element from a plain-language description |
| `get_page_text` | The readable text of the page: its main content, or one part by selector |
| `form_input` | Set the value of a field |
| `javascript_tool` | Run code in the page and get the result back |
| `read_console_messages`, `read_network_requests` | What the page logged and requested |
| `resize_window` | Resize the window |

## Troubleshooting

- **The extension says "not connected".** Run `yurei setup` again, then reload the extension in `chrome://extensions`.
- **Your AI does not see Yurei.** Restart it after setup. `yurei config <tool>` shows what its config should contain.
- **"Tab is being debugged by something else".** Close Chrome DevTools on that tab.
- **Nothing happens on `chrome://` pages.** They cannot be controlled. Open a website first.

Logs are in `~/.yurei/native-host.log`.

## Install from source

```sh
git clone https://github.com/memel06/yurei.git
cd yurei
sh install.sh
```

When setup asks, load `yurei-extension/dist` in `chrome://extensions` (turn on Developer mode, then Load unpacked).

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup and
[SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

[MIT](LICENSE) © [Carmelo Ventimiglia](https://www.linkedin.com/in/carmelo-ventimiglia/)
