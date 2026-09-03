import { DEFAULT_ACCENT, isIndicatorMessage } from "../messages";

(() => {
  if (window.__yureiIndicator) return;
  window.__yureiIndicator = true;

  const STYLE = `
    :host { --c: ${DEFAULT_ACCENT}; }
    .wrap { position: fixed; inset: 0; pointer-events: none; }
    .frame { position: absolute; inset: 0; opacity: 0; transition: opacity .35s ease; }
    .glow {
      position: absolute; inset: 0; will-change: opacity;
      box-shadow:
        inset 0 0 0 1.5px color-mix(in srgb, var(--c) 55%, transparent),
        inset 0 0 22px color-mix(in srgb, var(--c) 22%, transparent),
        inset 0 0 70px color-mix(in srgb, var(--c) 10%, transparent);
      animation: yurei-breathe 3.2s ease-in-out infinite;
    }
    .cursor {
      position: absolute; left: 0; top: 0; width: 24px; height: 30px; opacity: 0;
      transform: translate3d(-100px, -100px, 0);
      transition: transform .18s cubic-bezier(.2, 0, 0, 1), opacity .2s ease;
      will-change: transform;
      filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .35)) drop-shadow(0 0 8px color-mix(in srgb, var(--c) 35%, transparent));
    }
    .cursor svg { display: block; overflow: visible; }
    .pill {
      position: absolute; left: 50%; bottom: 16px; transform: translate(-50%, 100px); opacity: 0;
      display: inline-flex; align-items: center; gap: 8px; pointer-events: auto; cursor: pointer; padding: 10px 16px; border-radius: 999px;
      border: 0; background: #f2ecdf; color: #1b1a22;
      font: 600 13px/1 system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; white-space: nowrap;
      box-shadow: 0 6px 20px rgba(0, 0, 0, .3), 0 0 0 4px color-mix(in srgb, var(--c) 22%, transparent);
      transition: transform .3s cubic-bezier(.4, 0, .2, 1), opacity .3s ease, background .2s ease;
    }
    .pill i { width: 10px; height: 10px; border-radius: 2px; background: #c73a27; }
    .pill:hover { background: #fff; }
    .on .frame { opacity: 1; }
    .on .cursor { opacity: 1; }
    .on .pill { transform: translate(-50%, 0); opacity: 1; }
    .capturing .frame, .capturing .cursor, .capturing .pill { visibility: hidden; }
    @keyframes yurei-breathe { 0%, 100% { opacity: .7; } 50% { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .glow { animation: none; } }
  `;

  const CURSOR_SVG = `<svg width="24" height="30" viewBox="0 0 24 30" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 2.5 L3 22 L8 17.6 L11.4 25.5 L15.2 23.8 L11.8 16.2 L18.5 16.2 Z" style="fill: rgba(255, 255, 255, .92); stroke: var(--c); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round;"/>
  </svg>`;

  let host: HTMLElement | null = null;
  let wrap: HTMLElement | null = null;
  let cursor: HTMLElement | null = null;
  let positioned = false;

  const ensure = (): HTMLElement => {
    if (wrap && host?.isConnected) return wrap;
    host?.remove();
    host = document.createElement("yurei-overlay");
    host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>${STYLE}</style><div class="wrap"><div class="frame"><div class="glow"></div></div><div class="cursor">${CURSOR_SVG}</div><button class="pill" type="button"><i></i>Stop Yurei</button></div>`;
    wrap = root.querySelector<HTMLElement>(".wrap");
    cursor = root.querySelector<HTMLElement>(".cursor");
    root.querySelector(".pill")?.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      hide();
      try {
        void chrome.runtime.sendMessage({ type: "yurei:stop" }).catch(() => undefined);
      } catch {
        // After the extension reloads, this orphaned script's runtime is gone and sendMessage throws instead of rejecting.
      }
    });
    (document.body ?? document.documentElement).appendChild(host);
    if (!wrap) throw new Error("Yurei overlay failed to mount");
    return wrap;
  };

  const show = (color: string): void => {
    const el = ensure();
    el.style.setProperty("--c", color);
    if (!positioned) moveCursor(Math.round(window.innerWidth / 2), Math.round(window.innerHeight / 2));
    el.classList.add("on");
  };

  const hide = (): void => {
    wrap?.classList.remove("on");
  };

  const moveCursor = (x: number, y: number): void => {
    ensure();
    positioned = true;
    if (cursor) cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isIndicatorMessage(message)) return false;
    switch (message.type) {
      case "yurei:show":
        show(message.color);
        break;
      case "yurei:hide":
        hide();
        break;
      case "yurei:cursor":
        moveCursor(message.x, message.y);
        if (!wrap?.classList.contains("on")) show(getComputedStyle(ensure()).getPropertyValue("--c") || DEFAULT_ACCENT);
        break;
      case "yurei:hide-for-capture":
        wrap?.classList.add("capturing");
        break;
      case "yurei:show-after-capture":
        wrap?.classList.remove("capturing");
        break;
    }
    sendResponse({ ok: true });
    return false;
  });
})();
