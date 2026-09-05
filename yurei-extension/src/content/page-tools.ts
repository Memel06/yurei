import {
  type FindHit,
  type FindResult,
  type FrameSlot,
  type FramesResult,
  MAX_FIND_RESULTS,
  type PageApi,
  type Rect,
  type RectResult,
  type SetValueResult,
  type TextResult,
  type TextScope,
  type TreeOptions,
  type TreeResult,
} from "../page-api";
import { clean, clip, quote, truncateText } from "../text-utils";

(() => {
  if (window.__yurei) return;

  const MAX_NODES = 10_000;
  const MAX_DEPTH = 80;

  const refs = new Map<string, WeakRef<Element>>();
  const reverse = new WeakMap<Element, string>();
  let counter = 0;

  const refFor = (el: Element): string => {
    const existing = reverse.get(el);
    if (existing && refs.get(existing)?.deref() === el) return existing;
    const id = `ref_${++counter}`;
    refs.set(id, new WeakRef(el));
    reverse.set(el, id);
    return id;
  };

  const resolve = (ref: string): Element | null => refs.get(ref.trim())?.deref() ?? null;

  const collectGarbage = (): void => {
    for (const [id, weak] of refs) if (!weak.deref()) refs.delete(id);
  };

  const notFound = (ref: string): { ok: false; error: string } => ({
    ok: false,
    error: `${ref} was not found or has been removed from the page. Call read_page or find again to get fresh refs.`,
  });

  const SKIP_TAGS = new Set([
    "script",
    "style",
    "meta",
    "link",
    "title",
    "noscript",
    "template",
    "head",
    "br",
    "wbr",
    "hr",
  ]);
  const NO_DESCEND_TAGS = new Set(["select", "svg", "iframe", "canvas", "video", "audio", "object", "embed"]);

  const ROLE_BY_TAG: Readonly<Record<string, string>> = {
    button: "button",
    select: "combobox",
    textarea: "textbox",
    h1: "heading",
    h2: "heading",
    h3: "heading",
    h4: "heading",
    h5: "heading",
    h6: "heading",
    img: "image",
    svg: "image",
    nav: "navigation",
    main: "main",
    header: "banner",
    footer: "contentinfo",
    section: "region",
    article: "article",
    aside: "complementary",
    form: "form",
    table: "table",
    ul: "list",
    ol: "list",
    li: "listitem",
    label: "label",
    option: "option",
    summary: "button",
    details: "group",
    dialog: "dialog",
    iframe: "iframe",
    video: "video",
    p: "paragraph",
  };

  const INPUT_ROLE: Readonly<Record<string, string>> = {
    submit: "button",
    button: "button",
    reset: "button",
    image: "button",
    checkbox: "checkbox",
    radio: "radio",
    file: "button",
    range: "slider",
    search: "searchbox",
    number: "spinbutton",
  };

  const INTERACTIVE_TAGS = new Set(["a", "button", "input", "select", "textarea", "summary", "option"]);
  const INTERACTIVE_ROLES = new Set([
    "button",
    "link",
    "checkbox",
    "radio",
    "switch",
    "tab",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "slider",
    "spinbutton",
    "textbox",
    "searchbox",
    "combobox",
    "listbox",
    "treeitem",
    "gridcell",
  ]);
  const LANDMARK_ROLES = new Set([
    "heading",
    "navigation",
    "main",
    "banner",
    "contentinfo",
    "region",
    "article",
    "complementary",
    "form",
    "dialog",
    "table",
    "list",
    "tablist",
    "menu",
    "menubar",
    "toolbar",
    "search",
    "alert",
    "status",
  ]);
  const FULL_TEXT_TAGS = new Set([
    "a",
    "button",
    "summary",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "label",
    "option",
    "legend",
    "caption",
    "th",
    "td",
    "li",
    "dt",
    "dd",
    "p",
    "span",
    "strong",
    "em",
    "b",
    "i",
    "small",
    "code",
    "pre",
    "blockquote",
    "figcaption",
    "time",
  ]);
  const FULL_TEXT_ROLES = new Set([
    "button",
    "link",
    "tab",
    "menuitem",
    "option",
    "heading",
    "checkbox",
    "radio",
    "switch",
    "cell",
    "gridcell",
    "columnheader",
    "rowheader",
    "treeitem",
    "listitem",
    "alert",
    "status",
    "tooltip",
  ]);
  const SENSITIVE_AUTOCOMPLETE = ["current-password", "new-password", "one-time-code", "cc-number", "cc-csc", "cc-exp"];

  const isHtml = (el: Element): el is HTMLElement => el instanceof HTMLElement;
  const isFormField = (el: Element): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;

  const roleOf = (el: Element): string => {
    const explicit = clean(el.getAttribute("role"));
    if (explicit) return explicit.split(" ")[0] ?? explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "input") return INPUT_ROLE[(el.getAttribute("type") ?? "text").toLowerCase()] ?? "textbox";
    if (tag === "a") return el.hasAttribute("href") ? "link" : "generic";
    if (isHtml(el) && el.isContentEditable && !ROLE_BY_TAG[tag]) return "textbox";
    return ROLE_BY_TAG[tag] ?? "generic";
  };

  const isSensitive = (el: Element): boolean => {
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    if (type === "password" || type === "hidden") return true;
    const autocomplete = (el.getAttribute("autocomplete") ?? "").toLowerCase();
    return SENSITIVE_AUTOCOMPLETE.some((s) => autocomplete.includes(s));
  };

  const ownText = (el: Element): string => {
    let text = "";
    for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? "";
    return clean(text);
  };

  const labelledBy = (el: Element): string => {
    const ids = clean(el.getAttribute("aria-labelledby"));
    if (!ids) return "";
    return clean(
      ids
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" "),
    );
  };

  const labelFor = (el: Element): string => {
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return clean(label.textContent);
    }
    const wrapper = el.closest("label");
    return wrapper ? clean(wrapper.textContent) : "";
  };

  const fieldValue = (el: Element): string => {
    if (!isFormField(el)) return "";
    if (isSensitive(el)) return el.value ? "[redacted]" : "";
    if (el instanceof HTMLSelectElement) return clean(el.options[el.selectedIndex]?.textContent);
    if (
      el instanceof HTMLInputElement &&
      ["checkbox", "radio", "submit", "button", "reset", "file", "image"].includes(el.type)
    )
      return "";
    return clip(el.value, 80);
  };

  // Accessible-name order: aria-labelledby/aria-label, then the <label>, then placeholder/title/alt.
  const nameOf = (el: Element, role: string): string => {
    const field = isFormField(el);
    const direct = [
      el.getAttribute("aria-label"),
      labelledBy(el),
      field ? labelFor(el) : "",
      el.getAttribute("placeholder"),
      el.getAttribute("title"),
      el.getAttribute("alt"),
    ];
    for (const candidate of direct) {
      const value = clean(candidate);
      if (value) return value;
    }
    if (field)
      return el instanceof HTMLInputElement && ["submit", "button", "reset"].includes(el.type) ? clean(el.value) : "";
    const tag = el.tagName.toLowerCase();
    if (tag === "img" || tag === "svg" || tag === "iframe" || tag === "video") return "";
    const text = FULL_TEXT_TAGS.has(tag) || FULL_TEXT_ROLES.has(role) ? clean(el.textContent) : ownText(el);
    return clip(text, 120);
  };

  const hostOf = (src: string | null): string => {
    if (!src) return "";
    try {
      return new URL(src, location.href).host;
    } catch {
      return "";
    }
  };

  const visibleArea = (clipRect: Rect | null): Rect =>
    clipRect ?? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };

  const inViewport = (rect: DOMRect, clipRect: Rect | null): boolean => {
    const area = visibleArea(clipRect);
    return (
      rect.bottom > area.y && rect.right > area.x && rect.top < area.y + area.height && rect.left < area.x + area.width
    );
  };

  const isInteractive = (el: Element, role: string, style: CSSStyleDeclaration): boolean => {
    const tag = el.tagName.toLowerCase();
    if (INTERACTIVE_TAGS.has(tag)) return tag !== "a" || el.hasAttribute("href") || el.hasAttribute("onclick");
    if (INTERACTIVE_ROLES.has(role)) return true;
    if (el.hasAttribute("onclick")) return true;
    const tabindex = el.getAttribute("tabindex");
    if (tabindex !== null && Number(tabindex) >= 0) return true;
    if (isHtml(el) && el.isContentEditable) return true;
    return (
      style.cursor === "pointer" && ownText(el).length > 0 && el.closest("a,button,[role=button],[role=link]") === null
    );
  };

  const isLandmark = (role: string): boolean => LANDMARK_ROLES.has(role);

  const describe = (el: Element, role: string, name: string, depth: number): string => {
    const parts = [`${" ".repeat(depth)}${role}`];
    if (name) parts.push(quote(name));
    parts.push(`[${refFor(el)}]`);
    const href = el.getAttribute("href");
    if (href && role === "link") parts.push(`href=${quote(clip(href, 120))}`);
    if (el instanceof HTMLIFrameElement) {
      const host = hostOf(el.getAttribute("src"));
      if (host) parts.push(`src=${quote(host)}`);
    }
    if (el instanceof HTMLInputElement) {
      parts.push(`type=${el.type}`);
      if (el.type === "checkbox" || el.type === "radio") parts.push(el.checked ? "(checked)" : "(unchecked)");
    }
    const value = fieldValue(el);
    if (value) parts.push(`value=${quote(value)}`);
    const placeholder = clean(el.getAttribute("placeholder"));
    if (placeholder && placeholder !== name) parts.push(`placeholder=${quote(placeholder)}`);
    if ((isFormField(el) && el.disabled) || el.getAttribute("aria-disabled") === "true") parts.push("(disabled)");
    const expanded = el.getAttribute("aria-expanded");
    if (expanded) parts.push(`(expanded=${expanded})`);
    if (el.getAttribute("aria-selected") === "true") parts.push("(selected)");
    const checked = el.getAttribute("aria-checked");
    if (checked) parts.push(`(checked=${checked})`);
    let line = parts.join(" ");
    if (el instanceof HTMLSelectElement && !isSensitive(el)) {
      const options = [...el.options];
      for (const option of options.slice(0, 50)) {
        const label = clean(option.textContent);
        line += `\n${" ".repeat(depth + 1)}option ${quote(label)}${option.selected ? " (selected)" : ""}${option.value !== label ? ` value=${quote(option.value)}` : ""}`;
      }
      if (options.length > 50) line += `\n${" ".repeat(depth + 1)}… ${options.length - 50} more options`;
    }
    return line;
  };

  /** Where the frame's document is drawn: inside the iframe's border and padding. */
  const contentBox = (el: HTMLIFrameElement): Rect => {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const padLeft = parseFloat(style.paddingLeft) || 0;
    const padTop = parseFloat(style.paddingTop) || 0;
    return {
      x: r.left + el.clientLeft + padLeft,
      y: r.top + el.clientTop + padTop,
      width: Math.max(0, el.clientWidth - padLeft - (parseFloat(style.paddingRight) || 0)),
      height: Math.max(0, el.clientHeight - padTop - (parseFloat(style.paddingBottom) || 0)),
    };
  };

  const frameLabel = (el: HTMLIFrameElement): string => {
    const name = clean(el.getAttribute("title") || el.getAttribute("aria-label") || el.getAttribute("name"));
    if (name) return quote(clip(name, 60));
    return hostOf(el.getAttribute("src")) || "iframe";
  };

  const frameSrc = (el: HTMLIFrameElement): string => {
    if (el.hasAttribute("srcdoc")) return "about:srcdoc";
    const src = el.getAttribute("src");
    if (!src) return "about:blank";
    try {
      return new URL(src, location.href).href;
    } catch {
      return src;
    }
  };

  const slotFor = (el: HTMLIFrameElement, depth: number): FrameSlot => ({
    ref: refFor(el),
    depth,
    label: frameLabel(el),
    box: contentBox(el),
    src: frameSrc(el),
    name: el.getAttribute("name") ?? "",
  });

  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

  const childrenOf = (el: Element): Element[] => {
    const list: Element[] = [];
    if (el.shadowRoot) list.push(...el.shadowRoot.children);
    list.push(...el.children);
    return list;
  };

  function tree(options: TreeOptions): TreeResult {
    const consent = options.dismissConsent ? dismissConsent() : null;
    const lines: string[] = [];
    const frames: FrameSlot[] = [];
    let count = 0;
    let truncated = false;

    const visit = (el: Element, depth: number, forced: boolean): void => {
      if (count >= MAX_NODES) {
        truncated = true;
        return;
      }
      if (depth > MAX_DEPTH) return;
      const tag = el.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) return;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return;
      if (el.getAttribute("aria-hidden") === "true" && options.filter !== "all") return;
      const rect = el.getBoundingClientRect();
      const zeroSize = rect.width === 0 && rect.height === 0;
      if (options.viewportOnly && !zeroSize && !inViewport(rect, options.clip)) return;
      const role = roleOf(el);
      const interactive = isInteractive(el, role, style);
      const name = nameOf(el, role);
      const isFrame = el instanceof HTMLIFrameElement;
      const wanted =
        options.filter === "interactive"
          ? interactive
          : interactive || isLandmark(role) || name.length > 0 || (role !== "generic" && role !== "image");
      // Iframes are always listed so their contents have a line to hang under.
      const emit = !zeroSize && (forced || wanted || isFrame);
      if (emit) {
        count++;
        lines.push(describe(el, role, name, depth));
        if (isFrame) frames.push(slotFor(el, depth));
      }
      if (NO_DESCEND_TAGS.has(tag)) return;
      for (const child of childrenOf(el)) visit(child, emit ? depth + 1 : depth, false);
    };

    if (options.ref) {
      const root = resolve(options.ref);
      if (!root) return notFound(options.ref);
      visit(root, 0, true);
    } else if (options.selector) {
      const roots = select(options.selector);
      if (!roots.ok) return roots;
      for (const root of roots.elements.slice(0, 50)) visit(root, 0, true);
    } else {
      visit(document.body ?? document.documentElement, 0, false);
    }
    collectGarbage();

    let text = lines.join("\n");
    if (truncated)
      text += `\n[stopped after ${MAX_NODES} elements; pass ref or selector to focus on a part of the page]`;
    return {
      ok: true,
      text: truncateText(text, options.maxChars, "pass a larger max_chars, or a ref or selector to focus"),
      viewport: viewport(),
      frames,
      consent,
    };
  }

  type Selected =
    | { readonly ok: true; readonly elements: ReadonlyArray<Element> }
    | { readonly ok: false; readonly error: string };

  const select = (selector: string): Selected => {
    let elements: Element[];
    try {
      elements = [...document.querySelectorAll(selector)];
    } catch {
      return { ok: false, error: `${quote(selector)} is not a valid CSS selector` };
    }
    const visible = elements.filter(isRendered);
    if (visible.length === 0)
      return {
        ok: false,
        error: `No visible element matches ${quote(selector)}. Use read_page or find to see what is on the page.`,
      };
    return { ok: true, elements: visible };
  };

  function* allElements(root: ParentNode): Generator<Element> {
    for (const el of root.children) {
      yield el;
      if (el.shadowRoot) yield* allElements(el.shadowRoot);
      yield* allElements(el);
    }
  }

  const isRendered = (el: Element): boolean => {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  };

  // Cookie banners: the one-click way past them, taking the choice that keeps the user's data private when it is offered.
  const CONSENT_HINT =
    /cookie|consent|gdpr|privacy|cmp|didomi|onetrust|usercentrics|iubenda|sp_message|qc-cmp|truste|cookiebot|notice/i;
  const REJECT_TEXT =
    /^(?:reject(?: all)?(?: cookies)?|decline(?: all)?|refuse(?: all)?|deny(?: all)?|disagree|(?:only |use )?(?:strictly )?(?:necessary|essential)(?: cookies)?(?: only)?|accept (?:only )?necessary(?: cookies)?|continue without (?:accepting|agreeing)|rifiuta(?: tutt[oi])?|solo (?:i )?(?:cookie )?(?:necessari|essenziali)|continua senza accettare|(?:tout )?refuser|continuer sans accepter|(?:alle )?ablehnen|nur (?:notwendige|erforderliche)(?: cookies)?|rechazar(?: tod[oa]s?)?|(?:alles )?weigeren|rejeitar(?: tudo)?)$/;
  const ACCEPT_TEXT =
    /^(?:accept(?: all)?(?: cookies)?|allow(?: all)?(?: cookies)?|(?:i )?agree(?: and close)?|i accept|ok(?:ay)?|got it|i understand|understood|yes i agree|consent|accetta(?: tutt[oi])?(?: i cookie)?|accetto|consenti|acconsento|ho capito|(?:tout )?accepter|j'accepte|(?:alle )?akzeptieren|zustimmen|einverstanden|aceptar(?: tod[oa]s?)?|permitir|(?:alles )?accepteren|aceitar(?: tudo)?)$/;
  let consentClicked = false;

  const isButtonLike = (el: Element): boolean => {
    const tag = el.tagName.toLowerCase();
    if (tag === "button" || tag === "a") return true;
    if (el instanceof HTMLInputElement) return el.type === "button" || el.type === "submit";
    return el.getAttribute("role") === "button";
  };

  const buttonText = (el: Element): string => {
    const raw = el instanceof HTMLInputElement ? el.value : el.textContent || el.getAttribute("aria-label") || "";
    return clean(raw)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}' ]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  };

  const parentOf = (node: Element): Element | null => {
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  };

  /** A consent dialog is named after cookies or consent and floats over the page; in a frame of its own, the frame is the dialog. */
  const inConsentBanner = (el: Element): boolean => {
    const framed = window !== window.top;
    const bodyText = framed ? (document.body?.innerText ?? "") : "";
    let hinted =
      framed &&
      (CONSENT_HINT.test(`${location.href} ${window.name}`) || (bodyText.length < 4000 && /cookie/i.test(bodyText)));
    let floating = framed;
    for (
      let node = parentOf(el), depth = 0;
      node && node !== document.body && node !== document.documentElement && depth < 12;
      node = parentOf(node), depth++
    ) {
      const style = getComputedStyle(node);
      const role = node.getAttribute("role") ?? "";
      if (
        style.position === "fixed" ||
        style.position === "sticky" ||
        Number(style.zIndex) >= 10 ||
        role === "dialog" ||
        role === "alertdialog" ||
        node.getAttribute("aria-modal") === "true"
      )
        floating = true;
      if (!hinted) {
        const label = `${node.id} ${node.getAttribute("class") ?? ""} ${node.getAttribute("aria-label") ?? ""} ${node.getAttribute("data-testid") ?? ""}`;
        const text = node.textContent ?? "";
        hinted = CONSENT_HINT.test(label) || (text.length < 4000 && /cookie/i.test(text));
      }
      if (hinted && floating) return true;
    }
    return hinted && floating;
  };

  const press = (el: Element): string => {
    consentClicked = true;
    const label = clip(clean(el.textContent || el.getAttribute("aria-label")), 40) || "the consent button";
    if (isHtml(el)) el.click();
    else el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return label;
  };

  /** Clicks a cookie banner's reject button, or failing that its accept button, once per document. Returns the button's label. */
  function dismissConsent(): string | null {
    if (consentClicked) return null;
    let accept: Element | null = null;
    let scanned = 0;
    for (const el of allElements(document.body ?? document.documentElement)) {
      if (++scanned > 30_000) break;
      if (!isButtonLike(el)) continue;
      const text = buttonText(el);
      if (!text || text.length > 40) continue;
      const rejects = REJECT_TEXT.test(text);
      if (!rejects && (accept !== null || !ACCEPT_TEXT.test(text))) continue;
      if (!isRendered(el) || !inViewport(el.getBoundingClientRect(), null) || !inConsentBanner(el)) continue;
      if (rejects) return press(el);
      accept = el;
    }
    return accept ? press(accept) : null;
  }

  const STOP_WORDS = new Set([
    "the",
    "a",
    "an",
    "to",
    "of",
    "for",
    "on",
    "in",
    "at",
    "with",
    "and",
    "or",
    "button",
    "link",
    "field",
    "input",
    "box",
    "bar",
    "icon",
    "element",
    "item",
    "menu",
    "text",
    "page",
    "that",
    "this",
    "says",
    "saying",
    "labeled",
    "labelled",
    "called",
    "named",
    "containing",
    "contains",
    "which",
    "where",
    "is",
    "are",
    "be",
    "click",
    "clickable",
    "main",
  ]);
  const ROLE_HINTS: ReadonlyArray<readonly [RegExp, ReadonlyArray<string>]> = [
    [/\bbuttons?\b/, ["button"]],
    [/\blinks?\b/, ["link"]],
    [/\b(input|field|textbox|text box|textarea|type)\b/, ["textbox", "searchbox", "combobox", "spinbutton"]],
    [/\bcheckbox(es)?\b/, ["checkbox"]],
    [/\bradio\b/, ["radio"]],
    [/\b(dropdown|select|combobox|picker)\b/, ["combobox", "listbox"]],
    [/\btabs?\b/, ["tab"]],
    [/\b(heading|title|header)\b/, ["heading"]],
    [/\b(image|img|logo|picture|photo|icon)\b/, ["image"]],
    [/\bmenu/, ["menuitem", "menu"]],
    [/\b(switch|toggle)\b/, ["switch", "checkbox"]],
    [/\bslider\b/, ["slider"]],
  ];

  type Candidate = {
    readonly el: Element;
    readonly role: string;
    readonly name: string;
    readonly interactive: boolean;
    readonly inView: boolean;
    readonly score: number;
  };

  function find(query: string, clipRect: Rect | null): FindResult {
    const q = clean(query).toLowerCase();
    if (!q) return { ok: false, error: "query is empty" };
    const wantedRoles = new Set<string>();
    for (const [pattern, roles] of ROLE_HINTS) if (pattern.test(q)) for (const r of roles) wantedRoles.add(r);
    // "search" alone means the search field; next to an explicit kind ("search button") it is just a word.
    if (wantedRoles.size === 0 && /\bsearch\b/.test(q))
      for (const r of ["textbox", "searchbox", "combobox"]) wantedRoles.add(r);
    const tokens = q.split(/[^a-z0-9@._'-]+/).filter((t) => t.length > 1 && !STOP_WORDS.has(t));
    const phrase = tokens.join(" ");
    const candidates: Candidate[] = [];
    let scanned = 0;

    for (const el of allElements(document.body ?? document.documentElement)) {
      if (++scanned > 30_000) break;
      const tag = el.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag) || el instanceof HTMLIFrameElement || !isRendered(el)) continue;
      const style = getComputedStyle(el);
      const role = roleOf(el);
      const interactive = isInteractive(el, role, style);
      const name = nameOf(el, role);
      if (!interactive && !name && role === "generic") continue;
      const labelText = [
        name,
        el.getAttribute("aria-label"),
        el.getAttribute("placeholder"),
        el.getAttribute("title"),
        el.getAttribute("alt"),
        fieldValue(el),
      ]
        .map(clean)
        .join(" ")
        .toLowerCase();
      // Attribute matches (ids, hrefs, test ids) are weaker evidence than what the user can read on screen.
      const attributeText = [
        el.getAttribute("name"),
        el.id,
        el.getAttribute("href"),
        el.getAttribute("data-testid"),
        role,
      ]
        .map(clean)
        .join(" ")
        .toLowerCase();
      let score = 0;
      if (phrase && labelText.includes(phrase)) score += 10;
      else if (phrase && attributeText.includes(phrase)) score += 3;
      for (const token of tokens) {
        if (labelText.includes(token)) score += 3;
        else if (attributeText.includes(token)) score += 1;
      }
      if (name.toLowerCase() === phrase && phrase) score += 5;
      // A role word in the query ("search box", "pay button") says what kind of element is wanted; that outranks
      // elements that merely mention the word, so a link saying "Search" loses to the actual search field.
      if (wantedRoles.size > 0) score += wantedRoles.has(role) ? 12 : -6;
      if (score <= 0) continue;
      if (interactive) score += 1;
      const inView = inViewport(el.getBoundingClientRect(), clipRect);
      if (inView) score += 1;
      if (name.length > 200) score -= 3;
      candidates.push({ el, role, name, interactive, inView, score });
    }

    const deduped = candidates.filter(
      (c) => c.interactive || !candidates.some((o) => o !== c && o.interactive && o.el.contains(c.el)),
    );
    deduped.sort((a, b) => b.score - a.score);
    const hits: FindHit[] = deduped.slice(0, MAX_FIND_RESULTS).map((c) => ({
      ref: refFor(c.el),
      role: c.role,
      name: clip(c.name, 100),
      href: c.role === "link" ? c.el.getAttribute("href") : null,
      inView: c.inView,
      score: c.score,
    }));
    collectGarbage();
    return { ok: true, hits, total: deduped.length };
  }

  function frames(scrollToRef: string | null): FramesResult {
    if (scrollToRef !== null) {
      const target = resolve(scrollToRef);
      if (!target) return notFound(scrollToRef);
      if (!inViewport(target.getBoundingClientRect(), null))
        target.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    }
    const iframes = [...allElements(document.body ?? document.documentElement)].filter(
      (el): el is HTMLIFrameElement => el instanceof HTMLIFrameElement && isRendered(el),
    );
    return {
      ok: true,
      viewport: viewport(),
      frames: iframes.map((el) => slotFor(el, 0)),
      self: { href: location.href, name: window.name, width: window.innerWidth, height: window.innerHeight },
    };
  }

  const BOILERPLATE =
    "header, footer, nav, aside, [role=banner], [role=contentinfo], [role=navigation], [role=complementary]";
  const MAIN = "main, [role=main], article";
  const innerTextOf = (el: Element): string => (isHtml(el) ? el.innerText : (el.textContent ?? ""));
  const tidy = (s: string): string =>
    s
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  /** The page without its furniture: the main landmark when it carries most of the text, else the body minus header, navigation, footer and asides. */
  const mainText = (): { readonly text: string; readonly scope: string } => {
    const body = document.body;
    if (!body) return { text: "", scope: "page" };
    const bodyText = innerTextOf(body);
    if (window !== window.top) return { text: bodyText, scope: "page" };
    const main = [...document.querySelectorAll(MAIN)].find(isRendered);
    if (main) {
      const text = innerTextOf(main);
      if (text.length >= 200 && text.length >= bodyText.length * 0.4) return { text, scope: "main content" };
    }
    let text = bodyText;
    for (const el of document.querySelectorAll(BOILERPLATE)) {
      if (!isRendered(el) || el.closest(MAIN)) continue;
      const part = innerTextOf(el).trim();
      if (part.length >= 20 && text.includes(part)) text = text.replace(part, "");
    }
    return { text, scope: text === bodyText ? "page" : "page without header, navigation and footer" };
  };

  function text(maxChars: number, scope: TextScope): TextResult {
    let picked: { readonly text: string; readonly scope: string };
    if (scope.ref) {
      const el = resolve(scope.ref);
      if (!el) return notFound(scope.ref);
      picked = { text: innerTextOf(el), scope: scope.ref };
    } else if (scope.selector) {
      const roots = select(scope.selector);
      if (!roots.ok) return roots;
      picked = {
        text: roots.elements.map(innerTextOf).join("\n\n"),
        scope: `${roots.elements.length} element${roots.elements.length === 1 ? "" : "s"} matching ${quote(scope.selector)}`,
      };
    } else picked = mainText();
    const full = tidy(picked.text);
    return {
      ok: true,
      text: truncateText(full, maxChars, "pass a larger max_chars, or a selector or ref to read one part"),
      total: full.length,
      scope: picked.scope,
    };
  }

  const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max);

  function rect(ref: string): RectResult {
    const el = resolve(ref);
    if (!el) return notFound(ref);
    let box = el.getBoundingClientRect();
    if (box.top < 0 || box.bottom > window.innerHeight || box.left < 0 || box.right > window.innerWidth) {
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      box = el.getBoundingClientRect();
    }
    const role = roleOf(el);
    return {
      ok: true,
      x: clamp(box.left + box.width / 2, 1, window.innerWidth - 1),
      y: clamp(box.top + box.height / 2, 1, window.innerHeight - 1),
      label: `${role} ${quote(clip(nameOf(el, role), 60))}`,
    };
  }

  function scrollTo(ref: string): RectResult {
    const el = resolve(ref);
    if (!el) return notFound(ref);
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    return rect(ref);
  }

  const fire = (el: Element, type: string): void => {
    el.dispatchEvent(new Event(type, { bubbles: true }));
  };

  function setValue(ref: string, value: string | boolean): SetValueResult {
    const el = resolve(ref);
    if (!el) return notFound(ref);
    const role = roleOf(el);
    const label = `${role} ${quote(clip(nameOf(el, role), 60))} [${ref}]`;

    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
      const want = typeof value === "boolean" ? value : !/^(false|0|no|off|unchecked)$/i.test(value);
      if (el.checked !== want) el.click();
      return { ok: true, description: `${label} is now ${el.checked ? "checked" : "unchecked"}` };
    }

    const str = typeof value === "boolean" ? String(value) : value;

    if (el instanceof HTMLSelectElement) {
      const options = [...el.options];
      const index = options.findIndex(
        (o) => o.value === str || clean(o.textContent).toLowerCase() === str.toLowerCase(),
      );
      if (index < 0) {
        return {
          ok: false,
          error: `${label}: no option matches ${quote(str)}. Options: ${options
            .map((o) => clean(o.textContent))
            .slice(0, 30)
            .join(" | ")}`,
        };
      }
      el.selectedIndex = index;
      fire(el, "input");
      fire(el, "change");
      return { ok: true, description: `${label} set to ${quote(clean(options[index]?.textContent))}` };
    }

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.focus();
      // Setting through the prototype setter keeps React/Vue controlled inputs in sync.
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, str);
      else el.value = str;
      fire(el, "input");
      fire(el, "change");
      return { ok: true, description: `${label} set to ${quote(isSensitive(el) ? "[redacted]" : clip(str, 80))}` };
    }

    if (isHtml(el) && el.isContentEditable) {
      el.focus();
      window.getSelection()?.selectAllChildren(el);
      if (!document.execCommand("insertText", false, str)) {
        el.textContent = str;
        fire(el, "input");
      }
      return { ok: true, description: `${label} text replaced` };
    }

    return {
      ok: false,
      error: `${label} is not an input, select, checkbox or editable element. Use computer left_click on it instead.`,
    };
  }

  const api: PageApi = { tree, find, text, rect, scrollTo, setValue, frames };
  window.__yurei = api;
})();
