/**
 * A stored document shown in-app: a PDF in a frame (the frame points straight
 * at the same-origin file, which CSP frame-src 'self' allows), a photo as an
 * image, plus "Open full screen" (iPad Safari only renders the first page of
 * a framed PDF) and "Download". The server decides who may load the file —
 * this only shows it. Shared by uploaded contracts and person documents.
 */
import { useState } from "react";
import { Download, ExternalLink, ImageOff } from "lucide-react";

export function InlineDocument({ src, downloadSrc, mime, title }: {
  src: string;
  downloadSrc: string;
  mime: string;
  title: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border-2 border-border bg-secondary/30 overflow-hidden">
        {mime === "application/pdf" ? (
          <iframe src={src} title={title} className="w-full h-[55dvh] border-0 bg-white" />
        ) : imageFailed ? (
          // e.g. a HEIC photo in a browser that can't draw one.
          <div className="flex flex-col items-center justify-center gap-2 py-12 px-4 text-center text-muted-foreground">
            <ImageOff className="w-8 h-8" />
            <p className="text-base font-semibold">This browser can't preview this photo — use Download to open it.</p>
          </div>
        ) : (
          <img src={src} alt={title} onError={() => setImageFailed(true)} className="w-full max-h-[55dvh] object-contain bg-white" />
        )}
      </div>
      <div className="grid gap-2 grid-cols-2">
        <a href={src} target="_blank" rel="noopener noreferrer"
          className="h-12 rounded-xl border-2 border-border font-bold flex items-center justify-center gap-2 hover:bg-secondary/50">
          <ExternalLink className="w-4 h-4" /> Open full screen
        </a>
        <a href={downloadSrc}
          className="h-12 rounded-xl border-2 border-border font-bold flex items-center justify-center gap-2 hover:bg-secondary/50">
          <Download className="w-4 h-4" /> Download
        </a>
      </div>
    </div>
  );
}
