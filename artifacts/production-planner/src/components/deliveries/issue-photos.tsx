/**
 * Photos of a delivery's problem items (Graeme, 2026-10-16). Objective D.
 *
 * "Today 8 bags of chicken with use-by the 17th came in; I took one picture
 * of all 8 bags showing the date and sent it to the account manager James.
 * Make that the process." Whenever a receive has a new short-shelf-life or
 * damaged line, this card asks for a photo of EVERY affected item (counted:
 * "Lay out all 8 packs…"), camera first, up to 4 photos if they don't fit
 * in one, each uploaded straight away (retry on failure), then a tick
 * "All 8 packs are in the photo(s) with their use-by dates showing". Saving
 * is blocked until then — the server refuses it too. The photos are
 * attached to the supplier email. Rules and wording: @workspace/goods-in
 * delivery-issues.ts. The dialog itself always stays closable.
 *
 * Photos are re-encoded to JPEG (1600px long edge, quality 0.8) before
 * upload — the same canvas approach as the expense receipts and label
 * photos — so a 5 MB iPad shot becomes a few hundred KB.
 */
import { useEffect, useRef } from "react";
import { AlertTriangle, Camera, Check, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { MAX_ISSUE_PHOTOS, photoConfirmationText, photoPromptText, type IssueLine } from "@workspace/goods-in";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const MAX_DIMENSION = 1600;

/** The photo as a small JPEG; falls back to the original file if the
 *  browser can't decode it into a canvas. */
export async function compressPhoto(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    return blob ?? file;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface IssuePhoto {
  key: string;
  previewUrl: string;
  blob: Blob;
  status: "uploading" | "done" | "failed";
  id?: number;
  error?: string;
}

/** Upload one photo for a delivery; resolves to its id or throws a message
 *  the receiver can act on. */
export async function uploadIssuePhoto(orderId: number, blob: Blob): Promise<number> {
  const form = new FormData();
  form.append("file", blob, blob.type === "image/jpeg" ? "photo.jpg" : "photo");
  const res = await fetch(`${BASE}/api/deliveries/${orderId}/issue-photos`, {
    method: "POST", credentials: "include", body: form,
  }).catch(() => null);
  if (!res) throw new Error("No connection — the photo didn't upload.");
  const body = (await res.json().catch(() => ({}))) as { id?: number; error?: string };
  if (!res.ok || !body.id) throw new Error(body.error || "The photo didn't upload.");
  return body.id;
}

export function issuePhotoUrl(id: number): string {
  return `${BASE}/api/deliveries/issue-photos/${id}`;
}

export function IssuePhotoStep({
  orderId,
  issues,
  photos,
  onPhotos,
  confirmed,
  onConfirmed,
}: {
  orderId: number;
  /** The NEW issue lines this save reports. */
  issues: IssueLine[];
  photos: IssuePhoto[];
  onPhotos: (update: (prev: IssuePhoto[]) => IssuePhoto[]) => void;
  confirmed: boolean;
  onConfirmed: (v: boolean) => void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const replaceKey = useRef<string | null>(null);
  const done = photos.filter((p) => p.status === "done").length;
  const full = photos.length >= MAX_ISSUE_PHOTOS;
  const confirmText = photoConfirmationText(issues);

  const startUpload = (key: string, blob: Blob) => {
    onPhotos((prev) => prev.map((p) => (p.key === key ? { ...p, status: "uploading", error: undefined } : p)));
    uploadIssuePhoto(orderId, blob).then(
      (id) => onPhotos((prev) => prev.map((p) => (p.key === key ? { ...p, status: "done", id } : p))),
      (err: unknown) => onPhotos((prev) => prev.map((p) => (p.key === key ? { ...p, status: "failed", error: err instanceof Error ? err.message : String(err) } : p))),
    );
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const blob = await compressPhoto(file);
    const replacing = replaceKey.current;
    replaceKey.current = null;
    const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const photo: IssuePhoto = { key, previewUrl: URL.createObjectURL(blob), blob, status: "uploading" };
    onPhotos((prev) => {
      if (replacing) {
        const old = prev.find((p) => p.key === replacing);
        if (old) URL.revokeObjectURL(old.previewUrl);
        return prev.map((p) => (p.key === replacing ? photo : p));
      }
      return [...prev, photo].slice(0, MAX_ISSUE_PHOTOS);
    });
    // A new or retaken photo means the tick must be given again.
    onConfirmed(false);
    startUpload(key, blob);
  };

  const remove = (key: string) => {
    onPhotos((prev) => {
      const old = prev.find((p) => p.key === key);
      if (old) URL.revokeObjectURL(old.previewUrl);
      return prev.filter((p) => p.key !== key);
    });
    onConfirmed(false);
  };

  return (
    <div className={cn(
      "rounded-2xl border-4 p-4 space-y-3",
      done > 0 && confirmed ? "border-green-500 bg-green-50/60 dark:bg-green-950/20" : "border-red-600 bg-red-50 dark:bg-red-950/30",
    )}>
      <p className="text-xl font-bold flex items-start gap-2 text-red-900 dark:text-red-100">
        <Camera className="w-7 h-7 shrink-0" />
        <span>Take a photo of the affected items to finish receiving this delivery</span>
      </p>
      <p className="text-lg font-semibold text-foreground">{photoPromptText(issues)}</p>
      <p className="text-sm text-muted-foreground">The photos are emailed to the supplier with the report.</p>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void onFile(f); }}
      />

      {photos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {photos.map((p, i) => (
            <div key={p.key} className="rounded-xl border-2 border-border bg-background overflow-hidden">
              <img src={p.previewUrl} alt={`Photo ${i + 1} of the affected items`} className="w-full aspect-[4/3] object-cover" />
              <div className="p-2 space-y-2">
                <p className={cn(
                  "text-sm font-semibold flex items-center gap-1.5",
                  p.status === "done" ? "text-green-700 dark:text-green-300" : p.status === "failed" ? "text-red-700 dark:text-red-300" : "text-muted-foreground",
                )}>
                  {p.status === "done" ? <><Check className="w-4 h-4" strokeWidth={3} /> Uploaded</>
                    : p.status === "failed" ? <><AlertTriangle className="w-4 h-4" /> {p.error ?? "Didn't upload"}</>
                    : <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</>}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {p.status === "failed" ? (
                    <button type="button" onClick={() => startUpload(p.key, p.blob)}
                      className="min-h-[44px] rounded-lg border-2 border-red-500 text-red-800 dark:text-red-200 text-sm font-bold inline-flex items-center justify-center gap-1">
                      <RotateCcw className="w-4 h-4" /> Retry
                    </button>
                  ) : (
                    <button type="button" disabled={p.status === "uploading"}
                      onClick={() => { replaceKey.current = p.key; cameraRef.current?.click(); }}
                      className="min-h-[44px] rounded-lg border-2 border-border text-sm font-bold inline-flex items-center justify-center gap-1 disabled:opacity-50">
                      <Camera className="w-4 h-4" /> Retake
                    </button>
                  )}
                  <button type="button" onClick={() => remove(p.key)} aria-label={`Remove photo ${i + 1}`}
                    className="min-h-[44px] rounded-lg border-2 border-border text-sm font-bold inline-flex items-center justify-center gap-1">
                    <Trash2 className="w-4 h-4" /> Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!full && (
        <button
          type="button"
          onClick={() => { replaceKey.current = null; cameraRef.current?.click(); }}
          className={cn(
            "w-full min-h-[64px] rounded-2xl text-lg font-bold inline-flex items-center justify-center gap-2",
            photos.length === 0 ? "bg-red-600 text-white hover:bg-red-700" : "border-2 border-dashed border-border bg-background hover:bg-secondary/50",
          )}
        >
          <Camera className="w-6 h-6" />
          {photos.length === 0 ? "Take the photo" : `Add another photo (${photos.length} of ${MAX_ISSUE_PHOTOS})`}
        </button>
      )}

      {done > 0 && (
        <label className={cn(
          "flex items-start gap-3 rounded-xl border-2 p-3 cursor-pointer min-h-[56px]",
          confirmed ? "border-green-500 bg-background" : "border-amber-500 bg-background",
        )}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => onConfirmed(e.target.checked)}
            className="mt-1 w-6 h-6 shrink-0 accent-green-600"
          />
          <span className="text-lg font-semibold">{confirmText}</span>
        </label>
      )}
    </div>
  );
}

/** Thumbnails of photos already saved — the reopened delivery and the
 *  after-save confirmation. Tap to open full size. */
export function IssuePhotoStrip({ photoIds, className }: { photoIds: number[]; className?: string }) {
  if (!photoIds.length) return null;
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {photoIds.map((id) => (
        <a key={id} href={issuePhotoUrl(id)} target="_blank" rel="noreferrer" className="block rounded-lg overflow-hidden border-2 border-border">
          <img src={issuePhotoUrl(id)} alt="Photo sent to the supplier" className="w-24 h-[4.5rem] object-cover" />
        </a>
      ))}
    </div>
  );
}

/** Revoke preview URLs when the dialog throws its photos away. */
export function useRevokeOnUnmount(photos: IssuePhoto[]) {
  const ref = useRef(photos);
  ref.current = photos;
  useEffect(() => () => { for (const p of ref.current) URL.revokeObjectURL(p.previewUrl); }, []);
}
