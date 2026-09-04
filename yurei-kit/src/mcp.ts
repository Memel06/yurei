import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { COMPUTER_ACTIONS, UPDATE_COMMAND, type ToolName, type ToolResult } from "../../shared/protocol";
import { isNewer } from "../../shared/semver";
import { GUIDE } from "./guide";
import type { HostClient } from "./host-client";

import { VERSION } from "./version";

type McpContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string };

const toMcp = (result: ToolResult): { content: McpContent[]; isError: boolean } => ({
  isError: result.isError,
  content: result.content.map((block): McpContent =>
    block.type === "text" ? { type: "text", text: block.text } : { type: "image", data: block.data, mimeType: block.mimeType },
  ),
});

const tabId = z.number().int().optional().describe("Tab id from tabs_context. Omit to use the active tab of Yurei's own window.");
const selector = z.string().optional().describe('CSS selector, e.g. "main", "article", "#search", "table.results"');
const coordinate = z.array(z.number()).min(2).max(2).describe("[x, y] in screenshot pixels");
const screenshot = z.boolean().optional().describe("Also return a screenshot of the page afterwards. Only if you can see images.");

export function createMcpServer(bridge: HostClient): McpServer {
  const server = new McpServer({ name: "yurei", version: VERSION }, { instructions: GUIDE });
  let updateMentioned = false;
  /** Once per session, the first result after the host learns of a newer version carries the suggestion for the user. */
  const updateNote = (): McpContent | null => {
    const latest = bridge.latest;
    if (updateMentioned || latest === null || !isNewer(latest, VERSION)) return null;
    updateMentioned = true;
    return { type: "text", text: `Note: Yurei v${latest} is available (this is v${VERSION}). Tell the user they can update with \`${UPDATE_COMMAND}\`.` };
  };
  const forward = (tool: ToolName) => async (args: Record<string, unknown>) => {
    const result = toMcp(await bridge.call(tool, args));
    const note = updateNote();
    return note ? { ...result, content: [...result.content, note] } : result;
  };

  server.registerTool(
    "tabs_context",
    { description: "List open Chrome tabs with id, title and url, saying which are in Yurei's own window and which are the user's. Call it before working in a tab the user already has open.", inputSchema: {} },
    () => forward("tabs_context")({}),
  );

  server.registerTool(
    "tabs_create",
    {
      description: "Open a new tab in Yurei's own window, optionally at a url. Returns the new tab id and a view of the loaded page. Reuse tabs when you can: at most 3 tabs per site and 8 in all are allowed, and page loads are paced.",
      inputSchema: { url: z.string().optional().describe("Address to open. Bare domains get https://, plain words become a Google search."), screenshot },
    },
    forward("tabs_create"),
  );

  server.registerTool(
    "tabs_close",
    { description: "Close a tab.", inputSchema: { tabId: z.number().int().describe("Tab id to close") } },
    forward("tabs_close"),
  );

  server.registerTool(
    "navigate",
    {
      description: "Load a url in a tab, or go back / forward / reload. Without tabId it uses Yurei's own window, opening it if needed. Waits for the page to load and returns a view of it.",
      inputSchema: {
        url: z.string().optional().describe("Address to open (bare domains get https://)."),
        action: z.enum(["back", "forward", "reload"]).optional().describe("History action, used when url is omitted."),
        screenshot,
        tabId,
      },
    },
    forward("navigate"),
  );

  server.registerTool(
    "computer",
    {
      description: `Mouse and keyboard control of a browser tab. Prefer targeting elements by ref (from the previous result, read_page or find); use coordinate only when no ref fits.
Actions:
* screenshot: capture the current view as an image (only useful if you can see images). Coordinates in later actions refer to that image.
* left_click / right_click / middle_click / double_click / triple_click: click at ref or coordinate. Optional modifiers e.g. "shift" or "cmd".
* hover: move the mouse over ref or coordinate (opens hover menus).
* type: type text into the focused element; pass ref or coordinate to click a field first. "\\n" presses Enter.
* key: press a key or chord given in text, e.g. "Enter", "Escape", "Tab", "cmd+a", "ctrl+shift+t"; a space-separated list presses them in sequence.
* scroll: scroll by scroll_amount ticks (default 3, 100px each) in scroll_direction at ref/coordinate or the viewport center.
* scroll_to: scroll the element with ref into view.
* scroll_to_bottom: scroll through the page screen by screen, waiting for lazy content, until it stops growing or scroll_amount screens (default 10) have passed. Use it before reading long lists and feeds.
* left_click_drag: drag from start_coordinate to coordinate.
* wait: pause duration seconds (max 10), then return the page state.
Every action returns the visible interactive elements with their refs afterwards; add screenshot=true to get an image too.`,
      inputSchema: {
        action: z.enum(COMPUTER_ACTIONS),
        ref: z.string().optional().describe("Element reference like ref_12 (or frame3_ref_4 inside an iframe) from read_page/find/previous results"),
        coordinate: coordinate.optional(),
        start_coordinate: coordinate.optional().describe("Drag start, for left_click_drag"),
        text: z.string().optional().describe("Text to type, or key(s) to press for the key action"),
        scroll_direction: z.enum(["up", "down", "left", "right"]).optional(),
        scroll_amount: z.number().optional().describe("For scroll: ticks of 100px, default 3. For scroll_to_bottom: most screens to scroll through, default 10"),
        duration: z.number().optional().describe("Seconds to wait, for the wait action"),
        modifiers: z.string().optional().describe('Held modifier keys for clicks, e.g. "shift" or "cmd+shift"'),
        screenshot,
        tabId,
      },
    },
    forward("computer"),
  );

  server.registerTool(
    "read_page",
    {
      description: `Outline of the page as an accessibility tree: one line per element with role, name, state and a [ref_N] id usable with computer (ref) and form_input.
filter="interactive" (default) lists only clickable/typeable elements currently in the viewport; filter="all" lists every meaningful element on the whole page including text and off-screen content. Pass ref or selector to read one element's subtree, which is far cheaper than the whole page. Elements inside iframes are included, indented under their iframe line; their refs look like frame12_ref_3 and work everywhere a ref is accepted.`,
      inputSchema: {
        filter: z.enum(["interactive", "all"]).optional(),
        ref: z.string().optional().describe("Limit output to this element's subtree"),
        selector,
        max_chars: z.number().optional().describe("Truncate output beyond this many characters (default 30000)"),
        tabId,
      },
    },
    forward("read_page"),
  );

  server.registerTool(
    "find",
    {
      description: 'Find elements by a natural-language description such as "search box", "add to cart button", "link to pricing" or "email field". Returns up to 20 candidates with [ref_N] ids and whether each is visible. Matching is a fast text heuristic, so use the words that appear on screen.',
      inputSchema: { query: z.string().describe("What to look for"), tabId },
    },
    forward("find"),
  );

  server.registerTool(
    "get_page_text",
    {
      description: 'The readable text of the page (like select-all and copy). By default the main content, without header, navigation and footer. Pass selector or ref to read one part, e.g. selector="article" or the ref of a search result list; selector="body" reads everything. Use it for articles, search results, tables and error messages.',
      inputSchema: {
        selector,
        ref: z.string().optional().describe("Read only this element, e.g. a ref from find or read_page"),
        max_chars: z.number().optional().describe("Default 20000"),
        tabId,
      },
    },
    forward("get_page_text"),
  );

  server.registerTool(
    "form_input",
    {
      description: "Set a form field directly by ref: text inputs and textareas (value text), checkboxes and radios (true/false), selects (option label or value), rich-text editors. More reliable than clicking and typing, and it fires the events web apps expect.",
      inputSchema: {
        ref: z.string().describe("Element reference like ref_12 or frame3_ref_4"),
        value: z.union([z.string(), z.boolean(), z.number()]).describe("Text, option, or true/false for checkboxes"),
        tabId,
      },
    },
    forward("form_input"),
  );

  server.registerTool(
    "javascript_tool",
    {
      description: "Run JavaScript inside the page and return the JSON-serialised result. Accepts an expression or statements with return; await is supported. Use it for data extraction or when the UI has no other handle.",
      inputSchema: { code: z.string().describe("JavaScript to run in the page"), tabId },
    },
    forward("javascript_tool"),
  );

  server.registerTool(
    "read_console_messages",
    {
      description: "Console output (log, warn, error, uncaught exceptions, auto-accepted dialogs) recorded since Yurei first touched the tab. Newest last.",
      inputSchema: {
        pattern: z.string().optional().describe("Case-insensitive regex filter"),
        limit: z.number().optional().describe("Max entries, default 50"),
        clear: z.boolean().optional().describe("Clear the buffer after reading"),
        tabId,
      },
    },
    forward("read_console_messages"),
  );

  server.registerTool(
    "read_network_requests",
    {
      description: "Network requests (method, status, type, url) recorded since Yurei first touched the tab. Useful for debugging APIs and failed loads.",
      inputSchema: {
        pattern: z.string().optional().describe("Case-insensitive regex filter on method, type or url"),
        limit: z.number().optional().describe("Max entries, default 50"),
        clear: z.boolean().optional().describe("Clear the buffer after reading"),
        tabId,
      },
    },
    forward("read_network_requests"),
  );

  server.registerTool(
    "resize_window",
    {
      description: "Resize the Chrome window that contains the tab (outer size in pixels). Handy to get a consistent viewport for screenshots.",
      inputSchema: { width: z.number(), height: z.number(), tabId },
    },
    forward("resize_window"),
  );

  return server;
}
