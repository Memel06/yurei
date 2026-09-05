import { isRecord } from "../../shared/protocol";
import type { TabSession } from "./cdp";

const MAX_IMAGE_WIDTH = 1280;

export type Screenshot = { readonly data: string; readonly width: number; readonly height: number };
export type ViewportInfo = { readonly width: number; readonly height: number; readonly dpr: number };

export async function viewportInfo(session: TabSession): Promise<ViewportInfo> {
  const v = await session.evaluate(
    "({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio })",
  );
  if (
    !isRecord(v) ||
    typeof v["width"] !== "number" ||
    typeof v["height"] !== "number" ||
    typeof v["dpr"] !== "number"
  ) {
    throw new Error("Could not read the viewport size");
  }
  return { width: v["width"], height: v["height"], dpr: v["dpr"] };
}

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
};

async function resizeJpeg(base64: string, width: number, height: number): Promise<string> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("OffscreenCanvas 2d context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

/** Captures the viewport at most MAX_IMAGE_WIDTH wide and records the image→CSS pixel ratio on the session. */
export async function captureScreenshot(session: TabSession): Promise<Screenshot> {
  const vp = await viewportInfo(session);
  const res = await session.send("Page.captureScreenshot", {
    format: "jpeg",
    quality: 85,
    captureBeyondViewport: false,
    fromSurface: true,
  });
  if (!isRecord(res) || typeof res["data"] !== "string") throw new Error("Page.captureScreenshot returned no image");
  const width = Math.min(vp.width, MAX_IMAGE_WIDTH);
  const height = Math.round((vp.height * width) / vp.width);
  session.imageScale = width / vp.width;
  const needsResize = vp.dpr !== 1 || width !== vp.width;
  const data = needsResize ? await resizeJpeg(res["data"], width, height) : res["data"];
  return { data, width, height };
}
