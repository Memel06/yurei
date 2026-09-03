# Security

Yurei hands an AI tool the keys to your own Chrome: your tabs, your logged-in sessions, your cookies.
That is the point of it, and it is also why security reports matter here.

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub's security advisories](https://github.com/memel06/yurei/security/advisories/new).
Do not open a public issue for them.

You will get an acknowledgement within a week. Fixes ship as a new release with credit to the reporter,
unless you prefer to stay anonymous.

## What counts

- Another extension, website or local process talking to the native host or the extension.
- Anything that lets a page escape the tab the AI is working in, or read data it should not.
- The setup wizard writing outside the config files it announces, or breaking an existing config.
- Secrets or page contents ending up in `~/.yurei/native-host.log`.

## What does not

- The AI doing what the user asked it to do in their own browser, including on sites with prompt-injection
  content. Yurei tells models to ask before paying, sending or deleting, and shows a Stop button, but the
  user is responsible for what they let an AI do.
- Issues in the AI tools or models themselves.

## Supported versions

Only the latest release receives fixes.
