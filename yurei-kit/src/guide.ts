/** How a model should drive the browser. Served as MCP instructions and installed as a skill. */
export const GUIDE = `Yurei gives you the user's real Chrome, with their logged-in sessions.
Workflow:
1. tabs_context lists open tabs. tabs_create or navigate opens a page.
2. Every action returns the page as text: URL, title and the visible interactive elements, each with a [ref_N] id. read_page gives the full outline, get_page_text the readable text, find locates an element from a description.
3. Act by ref: computer(action="left_click", ref="ref_12"), computer(action="type", ref="ref_12", text="..."), form_input(ref, value). Use coordinate=[x, y] only when no ref fits.
4. If you can see images, pass screenshot=true with an action, or call computer(action="screenshot"), whenever layout or visuals matter. If you cannot see images, never ask for a screenshot.
Rules: refs change when the page changes, so take them from the latest result and never guess. Ask the user before logging in, paying, sending messages or deleting anything. If a result says the user pressed Stop, stop and wait for them.`;

export const SKILL_NAME = "yurei";

export const SKILL_MD = `---
name: ${SKILL_NAME}
description: Browse the web in the user's own Chrome with the yurei tools (their tabs, logins and cookies). Use when the user asks to open a website, read or check a web page, search the web, fill a form, or do anything inside a web app they are logged into.
---

# Yurei

The yurei MCP server exposes the user's Chrome. Its tools are tabs_context, tabs_create, tabs_close, navigate, computer, read_page, find, get_page_text, form_input, javascript_tool, read_console_messages, read_network_requests and resize_window.

${GUIDE}
`;
