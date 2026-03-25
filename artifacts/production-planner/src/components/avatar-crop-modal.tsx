import { useState, useRef, useCallback, useEffect } from "react";
import { Loader2, ZoomIn, ZoomOut, Check, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AvatarCropModalProps {
  file: File;
  onUpload: (croppedBlob: Blob) => Promise<void>;
  onClose: () => void;
}

function drawCircularCrop(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  offsetX: number,
  offsetY: number,
  zoom: number,
  previewSize: number
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, previewSize, previewSize);

  ctx.save();
  ctx.beginPath();
  ctx.arc(previewSize / 2, previewSize / 2, previewSize / 2, 0, Math.PI * 2);
  ctx.clip();

  const scaledW = img.naturalWidth * zoom;
  const scaledH = img.naturalHeight * zoom;
  const drawX = (previewSize - scaledW) / 2 + offsetX;
  const drawY = (previewSize - scaledH) / 2 + offsetY;

  ctx.drawImage(img, drawX, drawY, scaledW, scaledH);
  ctx.restore();
}

export function AvatarCropModal({ file, onUpload, onClose }: AvatarCropModalProps) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragStartOffset, setDragStartOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const PREVIEW_SIZE = 256;

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImgSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !img.complete) return;
    drawCircularCrop(canvas, img, offset.x, offset.y, zoom, PREVIEW_SIZE);
  }, [offset, zoom]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const handleImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    imgRef.current = e.currentTarget;
    const img = e.currentTarget;
    const minDim = Math.min(img.naturalWidth, img.naturalHeight);
    const initialZoom = PREVIEW_SIZE / minDim;
    setZoom(initialZoom);
    setOffset({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setDragStartOffset({ ...offset });
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    setOffset({ x: dragStartOffset.x + dx, y: dragStartOffset.y + dy });
  }, [dragging, dragStart, dragStartOffset]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  useEffect(() => {
    if (dragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, handleMouseMove, handleMouseUp]);

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    setDragging(true);
    setDragStart({ x: touch.clientX, y: touch.clientY });
    setDragStartOffset({ ...offset });
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragging) return;
    const touch = e.touches[0];
    const dx = touch.clientX - dragStart.x;
    const dy = touch.clientY - dragStart.y;
    setOffset({ x: dragStartOffset.x + dx, y: dragStartOffset.y + dy });
  };

  const handleConfirm = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving(true);
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => b ? resolve(b) : reject(new Error("Canvas to blob failed")), "image/jpeg", 0.9);
      });
      await onUpload(blob);
    } catch (err) {
      console.error("Crop upload failed:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Crop your photo</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground text-center -mt-1">
          Drag to reposition · Adjust zoom to fit
        </p>

        <div className="flex flex-col items-center gap-4">
          <div
            className={cn(
              "relative overflow-hidden rounded-full border-4 border-primary/20",
              "w-64 h-64 bg-muted",
              dragging ? "cursor-grabbing" : "cursor-grab"
            )}
            style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={() => setDragging(false)}
          >
            <canvas
              ref={canvasRef}
              width={PREVIEW_SIZE}
              height={PREVIEW_SIZE}
              className="w-full h-full"
            />
          </div>

          {imgSrc && (
            <img
              src={imgSrc}
              alt=""
              className="hidden"
              onLoad={handleImgLoad}
            />
          )}

          <div className="w-full flex items-center gap-3">
            <ZoomOut className="w-4 h-4 text-muted-foreground shrink-0" />
            <input
              type="range"
              min={0.1}
              max={5}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 accent-primary"
            />
            <ZoomIn className="w-4 h-4 text-muted-foreground shrink-0" />
          </div>

          <div className="flex gap-3 w-full">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>
              <X className="w-4 h-4 mr-1.5" /> Cancel
            </Button>
            <Button className="flex-1" onClick={handleConfirm} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Check className="w-4 h-4 mr-1.5" />}
              Use photo
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
