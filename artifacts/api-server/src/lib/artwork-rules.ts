/**
 * Rules for artwork files kept against an item (Graeme, 24 Nov 2026 —
 * print-ready artwork sent with supply orders). Pure, unit-tested.
 */

/** Print-ready PDFs run large; one file per upload request keeps memory sane. */
export const ARTWORK_MAX_BYTES = 150 * 1024 * 1024;

/** What printers take: PDF first, plus the usual artwork formats. */
const EXTENSIONS: Record<string, string> = {
  pdf: "application/pdf",
  ai: "application/illustrator",
  eps: "application/postscript",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  tif: "image/tiff",
  tiff: "image/tiff",
  psd: "image/vnd.adobe.photoshop",
  indd: "application/x-indesign",
  zip: "application/zip",
};

export const ARTWORK_ACCEPT = Object.keys(EXTENSIONS).map(e => `.${e}`).join(",");

/** The stored MIME type for a file, judged by its name (browsers often send
 *  application/octet-stream for .ai/.eps/.indd); null when not artwork. */
export function artworkMime(fileName: string): string | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  return EXTENSIONS[ext] ?? null;
}

/** A file name safe to store and to send back in Content-Disposition. */
export function cleanArtworkName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f"]/g, "").trim().slice(0, 200);
  return cleaned || "artwork";
}

/** Content-Disposition for a download that keeps the original name. */
export function artworkDisposition(fileName: string, inline: boolean): string {
  const name = cleanArtworkName(fileName);
  const ascii = name.replace(/[^\x20-\x7e]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
