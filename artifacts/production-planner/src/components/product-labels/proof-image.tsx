/**
 * A label proof: the server's 1-bit PNG at printer resolution (exactly what
 * prints), with optional outlines over the parts that changed, and — when
 * the label doesn't fit — the taller drawing showing the words that run off
 * the bottom, below a red "label edge" line.
 */
import { useState } from "react";
import type { FieldKey, Rect } from "@workspace/product-labels";
import { cn } from "@/lib/utils";
import type { Proof } from "./api";

export type Area = FieldKey | "barcode" | "all";

export function ProofImage({ proof, highlight = [], showOverflow = true, className, caption }: {
  proof: Proof;
  highlight?: Area[];
  showOverflow?: boolean;
  className?: string;
  caption?: string;
}) {
  const useOverflow = showOverflow && !proof.fits && !!proof.overflowPng;
  const src = useOverflow ? proof.overflowPng! : proof.png;
  const [naturalH, setNaturalH] = useState<number | null>(null);
  const totalH = useOverflow ? (naturalH ?? proof.heightDots) : proof.heightDots;
  const all = highlight.includes("all");
  const overflowFields = new Set(proof.fitProblems.map(p => p.field));

  const boxes: Array<{ rect: Rect; tone: "change" | "overflow" }> = [];
  for (const f of proof.fields) {
    const tone = overflowFields.has(f.key) ? "overflow" : highlight.includes(f.key) ? "change" : null;
    if (!tone) continue;
    for (const b of f.boxes) boxes.push({ rect: { ...b, h: Math.max(b.h, 6) }, tone });
  }
  if (highlight.includes("barcode") || overflowFields.has("barcode")) {
    boxes.push({ rect: proof.barcode.box, tone: overflowFields.has("barcode") ? "overflow" : "change" });
  }
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  return (
    <figure className={cn("space-y-1.5", className)}>
      <div
        className={cn(
          "relative w-full bg-white rounded-lg overflow-hidden shadow-sm",
          all ? "ring-4 ring-amber-400" : "ring-1 ring-border",
        )}
        style={{ aspectRatio: `${proof.widthDots} / ${totalH}` }}
      >
        <img
          src={src}
          alt={caption ?? "Label proof"}
          onLoad={e => setNaturalH((e.target as HTMLImageElement).naturalHeight)}
          className="absolute inset-0 w-full h-full select-none"
          style={{ imageRendering: "pixelated" }}
          draggable={false}
        />
        {useOverflow && (
          <>
            <div className="absolute left-0 right-0 bg-rose-500/10" style={{ top: pct(proof.heightDots, totalH), bottom: 0 }} />
            <div className="absolute left-0 right-0 border-t-2 border-dashed border-rose-600" style={{ top: pct(proof.heightDots, totalH) }}>
              <span className="absolute right-1 -top-5 text-[11px] font-bold text-rose-700 bg-white/90 px-1 rounded">label edge — below here doesn't print</span>
            </div>
          </>
        )}
        {boxes.map((b, i) => (
          <div
            key={i}
            className={cn(
              "absolute rounded-sm pointer-events-none",
              b.tone === "overflow" ? "ring-2 ring-rose-600 bg-rose-500/10" : "ring-2 ring-amber-500 bg-amber-400/15",
            )}
            style={{
              left: pct(b.rect.x, proof.widthDots), width: pct(b.rect.w, proof.widthDots),
              top: pct(b.rect.y, totalH), height: pct(b.rect.h, totalH),
            }}
          />
        ))}
      </div>
      {caption && <figcaption className="text-xs text-muted-foreground">{caption}</figcaption>}
    </figure>
  );
}
