import { TOOL_NAMES } from "../../shared/protocol";

/** How a model should drive the browser. Served as MCP instructions and installed as a skill. */
export const GUIDE = `Yurei gives you the user's real Chrome, with their logged-in sessions. It browses in a window of its own, so the user can keep using theirs.
Workflow:
1. tabs_create(url) opens a page in Yurei's window; plain words become a web search. navigate(url) loads the next page in the same tab. Every action returns the page as text: URL, title and the interactive elements in view, each with a [ref_N] id.
2. Read narrowly. get_page_text returns the main content of the page; pass selector (CSS) or ref to read one part, find to locate an element by description, read_page(ref or selector) for one element's outline. Whole-page dumps cost the user tokens, so switch to a selector or ref as soon as you know where the content is.
3. Act by ref: computer(action="left_click", ref="ref_12"), computer(action="type", ref="ref_12", text="..."), form_input(ref, value). Use coordinate=[x, y] only when no ref fits.
4. Long lists and feeds load as you scroll: computer(action="scroll_to_bottom") scrolls through the page until it stops growing, then read it.
5. Reuse tabs. Open a second tab only to keep the current page; close tabs you are done with using tabs_close. Yurei allows a few tabs per site and paces page loads like a person, so a call may take a moment.
6. If you can see images, pass screenshot=true with an action, or call computer(action="screenshot"), whenever layout or visuals matter. If you cannot see images, never ask for a screenshot.
Rules: refs change when the page changes, so take them from the latest result and never guess. Cookie banners are dismissed for you; if something else covers the page, look for its close button. To work in a tab the user already has open, call tabs_context and pass its tabId. Ask the user before logging in, paying, sending messages or deleting anything. If a result says the user pressed Stop, stop and wait for them.`;

export const SKILL_NAME = "yurei";

export const SKILL_MD = `---
name: ${SKILL_NAME}
description: Browse the web in the user's own Chrome with the yurei tools (their tabs, logins and cookies). Use when the user asks to open a website, read or check a web page, search the web, research a topic, fill a form, or do anything inside a web app they are logged into.
---

# Yurei

The yurei MCP server exposes the user's Chrome. Its tools are ${TOOL_NAMES.slice(0, -1).join(", ")} and ${TOOL_NAMES.at(-1)}.

${GUIDE}
`;
