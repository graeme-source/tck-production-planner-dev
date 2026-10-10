/**
 * Print-ready PDF of back labels (pure, tested) — Stage 2, first cut.
 *
 * One label per page; the page is the label (140 × 94 mm, to the nearest
 * printer dot — see labelPageSizeMm) and
 * carries the renderer's own 1-bit bitmap, stretched edge to edge — the
 * bitmap is already at the label's size at the template's dpi, so nothing
 * is resampled into something different from the proof. Every label in one
 * run has the same dates and batch, so the image is stored once and every
 * page shows it: a 100-label PDF is barely bigger than a 1-label one.
 *
 * Printed from any computer to the label printer through its ordinary
 * driver ("actual size", no fit-to-page) — no print bridge needed. The same
 * bitmap can later go to the bridge as TSPL BITMAP / ZPL ^GF.
 */
import { mmToPt } from "@workspace/units";
import type { Bitmap } from "./raster";

const enc = new TextEncoder();

/** Points as PDF number text: 4 decimals, rounded DOWN, so a page sized to
 *  whole printer dots never comes out a hair wider than the bitmap (2-decimal
 *  rounding made 1119 dots render as 1120 and resample the whole label). */
function n(v: number): string {
  return (Math.floor(v * 10000) / 10000).toString();
}

export interface LabelsPdfInput {
  bitmap: Bitmap;
  /** The printer resolution the bitmap was drawn at (template dpi). */
  dpi: number;
  copies: number;
  /** Shown in the PDF's Title (plain ASCII; anything else becomes "-"). */
  title?: string;
}

/** The page size: the bitmap's WHOLE dots at its dpi, so one image pixel is
 *  exactly one printer dot. A 140 × 94 mm label at 203 dpi is 1119 × 751
 *  dots = 140.01 × 93.97 mm — within 0.03 mm of the label. Sizing the page to
 *  the nominal 94 mm instead (751.18 dots) makes every reader and driver
 *  stretch the image by a fraction of a dot and resample every row. */
export function labelPageSizeMm(bitmap: Bitmap, dpi: number): { widthMm: number; heightMm: number } {
  return { widthMm: (bitmap.width / dpi) * 25.4, heightMm: (bitmap.height / dpi) * 25.4 };
}

export function labelsPdf(input: LabelsPdfInput): Uint8Array {
  const { bitmap, copies } = input;
  if (!Number.isInteger(copies) || copies < 1) throw new Error("At least one label");
  const size = labelPageSizeMm(bitmap, input.dpi);
  const wPt = mmToPt(size.widthMm);
  const hPt = mmToPt(size.heightMm);
  const { bytes } = bitmap.packedRows();

  // Objects: 1 catalog, 2 pages, 3 image, 4 content stream, 5 info, then one page object per copy.
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Uint8Array) => { parts.push(b); length += b.length; };
  const text = (s: string) => push(enc.encode(s));
  const obj = (id: number, body: () => void) => {
    offsets[id] = length;
    text(`${id} 0 obj\n`);
    body();
    text(`\nendobj\n`);
  };

  const firstPageId = 6;
  const pageIds = Array.from({ length: copies }, (_, i) => firstPageId + i);

  text("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  obj(1, () => text("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, () => text(`<< /Type /Pages /Count ${copies} /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] >>`));
  obj(3, () => {
    // 1 = black in our bitmap; DeviceGray 1 = white, so the Decode array flips it.
    text(`<< /Type /XObject /Subtype /Image /Width ${bitmap.width} /Height ${bitmap.height} /ColorSpace /DeviceGray /BitsPerComponent 1 /Decode [1 0] /Interpolate false /Length ${bytes.length} >>\nstream\n`);
    push(bytes);
    text("\nendstream");
  });
  const content = `q ${n(wPt)} 0 0 ${n(hPt)} 0 0 cm /Im0 Do Q`;
  obj(4, () => text(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  const title = (input.title ?? "Back labels").replace(/[()\\]/g, "").replace(/[^\x20-\x7E]/g, "-");
  obj(5, () => text(`<< /Title (${title}) /Producer (TCK Production Planner) >>`));
  for (const id of pageIds) {
    obj(id, () => text(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(wPt)} ${n(hPt)}] /Resources << /XObject << /Im0 3 0 R >> >> /Contents 4 0 R >>`));
  }

  const xrefAt = length;
  const count = firstPageId + copies;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id++) xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  text(xref);
  text(`trailer\n<< /Size ${count} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
