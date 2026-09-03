export const MAX_FIND_RESULTS = 20;

export type TreeFilter = "interactive" | "all";

export type Rect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
export type Viewport = { readonly width: number; readonly height: number };

export type TreeOptions = {
  readonly filter: TreeFilter;
  readonly ref: string | null;
  readonly maxChars: number;
  readonly viewportOnly: boolean;
  /** Part of this frame that is actually on screen, in its own coordinates; null means the whole viewport. */
  readonly clip: Rect | null;
};

/** An iframe element in a document, described so the service worker can tell which frame it hosts. */
export type FrameSlot = {
  readonly ref: string;
  readonly depth: number;
  readonly label: string;
  /** Where the hosted document is drawn, in this document's viewport coordinates. */
  readonly box: Rect;
  /** Resolved src, "about:srcdoc" for srcdoc frames, "about:blank" when empty. */
  readonly src: string;
  readonly name: string;
};

/** How a frame sees itself; matched against the parent's FrameSlots. */
export type FrameSelf = { readonly href: string; readonly name: string; readonly width: number; readonly height: number };

export type FindHit = {
  readonly ref: string;
  readonly role: string;
  readonly name: string;
  readonly href: string | null;
  readonly inView: boolean;
  readonly score: number;
};

type Fail = { readonly ok: false; readonly error: string };
export type TreeResult = { readonly ok: true; readonly text: string; readonly viewport: Viewport; readonly frames: ReadonlyArray<FrameSlot> } | Fail;
export type FindResult = { readonly ok: true; readonly hits: ReadonlyArray<FindHit>; readonly total: number } | Fail;
export type TextResult = { readonly ok: true; readonly text: string; readonly total: number } | Fail;
export type FramesResult = { readonly ok: true; readonly viewport: Viewport; readonly frames: ReadonlyArray<FrameSlot>; readonly self: FrameSelf } | Fail;
/** Centre of the element in this frame's viewport, after scrolling it into view. */
export type RectResult = { readonly ok: true; readonly x: number; readonly y: number; readonly label: string } | Fail;
export type SetValueResult = { readonly ok: true; readonly description: string } | Fail;

/**
 * Runs inside one frame and knows nothing about other frames: refs are plain ref_N and coordinates are relative to
 * that frame's viewport. The service worker qualifies refs per frame and composes the frames.
 */
export type PageApi = {
  tree(options: TreeOptions): TreeResult;
  find(query: string, clip: Rect | null): FindResult;
  text(maxChars: number): TextResult;
  rect(ref: string): RectResult;
  scrollTo(ref: string): RectResult;
  setValue(ref: string, value: string | boolean): SetValueResult;
  /** Every visible iframe in this document; the one with ref `scrollToRef` is scrolled into view first. */
  frames(scrollToRef: string | null): FramesResult;
};

export type PageMethod = keyof PageApi;
