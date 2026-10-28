/**
 * Draws a nutrition-image layout (nutrition-image.ts) onto a <canvas> and
 * returns it as a PNG data URL — in the browser, so the server needs no
 * image library. Kept to drawing only; every position is decided (and
 * tested) in the layout.
 */
import type { NutritionImageLayout } from "./nutrition-image";

/** Anything with a 2D canvas: the page's document, or a test double. */
export interface CanvasMaker { createElement(tag: "canvas"): HTMLCanvasElement }

export function drawNutritionPng(layout: NutritionImageLayout, doc: CanvasMaker = document): string | null {
  const canvas = doc.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, layout.width, layout.height);
  const b = layout.border;
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = b.lineWidth;
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.fillStyle = "#111111";
  ctx.textBaseline = "alphabetic";
  for (const t of layout.texts) {
    ctx.font = `${t.bold ? "700" : "400"} ${t.size}px ${layout.font}`;
    ctx.textAlign = t.align;
    ctx.fillText(t.text, t.x, t.y);
  }
  return canvas.toDataURL("image/png");
}
