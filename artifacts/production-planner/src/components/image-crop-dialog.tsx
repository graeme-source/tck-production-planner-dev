// Crop a photo to the shape the meeting slide actually shows
// (Graeme, 2026-08-28: "If I do have a portrait image, I can just crop it
// and get the bit that I want").
//
// A phone photo is portrait and the slide is landscape, so something has to
// give — and letting the host choose which part survives beats the app
// guessing. Drag to move, pinch or slide to zoom, and what's inside the
// frame is exactly what gets saved.
//
// The clamping and output maths live in lib/image-crop.ts with tests: a
// sliver of empty frame down one edge of a photo is the sort of thing you
// only notice on a wall-mounted screen, mid-meeting.

import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, X, Check, ZoomIn } from "lucide-react";
import { coverScale, clampOffset, computeDrawRect, type Size } from "@/lib/image-crop";

/** 16:9 — the shape of the meeting screen. */
export const SLIDE_ASPECT = 16 / 9;
const OUTPUT_WIDTH = 1600;

export function ImageCropDialog({ file, onCancel, onCropped }: {
  file: File;
  onCancel: () => void;
  onCropped: (cropped: File) => void | Promise<void>;
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState<Size>({ width: 0, height: 0 });
  const [frame, setFrame] = useState<Size>({ width: 640, height: 360 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  // Load the picked file into an <img> we can draw from later.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setImage(img);
      setNatural({ width: img.naturalWidth, height: img.naturalHeight });
      setOffset({ x: 0, y: 0 });
      setZoom(1);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // The frame is however wide the dialog ends up; its height follows the
  // slide's shape. Measured rather than assumed so the crop matches on any
  // screen the host happens to be using.
  useEffect(() => {
    const measure = () => {
      const width = frameRef.current?.clientWidth ?? 640;
      setFrame({ width, height: width / SLIDE_ASPECT });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [image]);

  const base = coverScale(natural, frame);
  const scale = base * zoom;

  // Re-clamp whenever the zoom changes: zooming out can leave the picture
  // parked somewhere that no longer covers the frame.
  useEffect(() => {
    setOffset(o => clampOffset(o, natural, frame, base * zoom));
  }, [zoom, natural, frame, base]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const next = {
      x: drag.current.ox + (e.clientX - drag.current.x),
      y: drag.current.oy + (e.clientY - drag.current.y),
    };
    setOffset(clampOffset(next, natural, frame, scale));
  };
  const endDrag = () => { drag.current = null; };

  const save = useCallback(async () => {
    if (!image) return;
    setSaving(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT_WIDTH;
      canvas.height = Math.round(OUTPUT_WIDTH / SLIDE_ASPECT);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Couldn't prepare the image");
      // Black behind, so any rounding at the very edge reads as intentional
      // rather than as a transparent gap.
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const { dx, dy, dw, dh } = computeDrawRect(natural, frame, scale, offset, canvas.width);
      ctx.drawImage(image, dx, dy, dw, dh);

      const blob: Blob | null = await new Promise(resolve =>
        canvas.toBlob(b => resolve(b), "image/jpeg", 0.9),
      );
      if (!blob) throw new Error("Couldn't prepare the image");
      const name = file.name.replace(/\.[^.]+$/, "") || "photo";
      await onCropped(new File([blob], `${name}-cropped.jpg`, { type: "image/jpeg" }));
    } finally {
      setSaving(false);
    }
  }, [image, natural, frame, scale, offset, file.name, onCropped]);

  return (
    <div className="fixed inset-0 z-[220] bg-black/80 flex items-center justify-center p-4">
      <div className="bg-background w-full max-w-2xl rounded-3xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-bold">Choose what's shown</h2>
          <button onClick={onCancel} className="w-11 h-11 rounded-2xl bg-secondary flex items-center justify-center" aria-label="Cancel">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-base text-muted-foreground">
          Drag the photo to move it. Everything inside the frame is what the team will see.
        </p>

        <div
          ref={frameRef}
          className="relative w-full overflow-hidden rounded-2xl bg-black touch-none select-none cursor-grab active:cursor-grabbing"
          style={{ aspectRatio: String(SLIDE_ASPECT) }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={endDrag}
        >
          {image ? (
            <img
              src={image.src}
              alt=""
              draggable={false}
              className="absolute left-1/2 top-1/2 max-w-none pointer-events-none"
              style={{
                width: natural.width * scale,
                height: natural.height * scale,
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
              }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-white/60">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <ZoomIn className="w-5 h-5 text-muted-foreground flex-shrink-0" />
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={e => setZoom(Number(e.target.value))}
            className="flex-1 h-3 accent-primary"
            aria-label="Zoom"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={onCancel}
            className="h-14 rounded-2xl border-2 border-border text-lg font-bold hover:bg-secondary/50 transition-colors sm:order-1"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!image || saving}
            className="h-16 sm:h-14 rounded-2xl bg-primary text-primary-foreground text-xl sm:text-lg font-bold flex items-center justify-center gap-3 disabled:opacity-50 active:scale-[0.99] transition-all shadow-lg shadow-primary/20 sm:order-2"
          >
            {saving ? <Loader2 className="w-6 h-6 animate-spin" /> : <Check className="w-6 h-6" />}
            Use this
          </button>
        </div>
      </div>
    </div>
  );
}
