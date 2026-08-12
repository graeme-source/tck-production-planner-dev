/**
 * Collections — goods leaving the unit, the mirror of a delivery.
 *
 * Renders in two places, both from `CollectionPanel`:
 *   - nested at the TOP of a supplier's delivery card, when a collection shares
 *     that supplier and date. The delivery can't be received until it's done,
 *     so it leads the card and is styled to be unmissable.
 *   - as a standalone card on days with no matching delivery.
 *
 * Completing one needs every line ticked, the driver's name, and a signature
 * drawn on the iPad. A photo of the items with the driver or in the vehicle is
 * optional. All three rules are enforced server-side too — the browser is not
 * the place to decide whether goods left the building with a signature.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  PackageOpen, PenLine, Camera, Check, X, Loader2, Plus, Trash2,
  AlertTriangle, CheckCircle2, Image as ImageIcon, Undo2, Edit2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface CollectionLine {
  id: number;
  collectionId: number;
  description: string;
  quantity: number;
  unit: string;
  checkedOff: boolean;
  quantityCollected: number | null;
  notes: string | null;
  sortOrder: number;
}

export interface Collection {
  id: number;
  supplierId: number;
  supplierName: string | null;
  collectionDate: string;
  status: "scheduled" | "collected" | "cancelled";
  reference: string | null;
  notes: string | null;
  driverName: string | null;
  hasSignature: boolean;
  hasPhoto: boolean;
  collectedAt: string | null;
  collectedByName: string | null;
  createdAt: string;
  lines: CollectionLine[];
  outstanding: boolean;
}

/** All collections in a Mon–Sun window — the same range the weekly deliveries
 *  view uses, so the two can be grouped together client-side. */
export function useWeekCollections(from: string, to: string) {
  return useQuery<Collection[]>({
    queryKey: ["collections", from, to],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/collections?from=${from}&to=${to}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load collections");
      return res.json();
    },
    staleTime: 30_000,
  });
}

/** Key a collection to its delivery: same supplier, same day. Matches the
 *  server's derivation in outstandingCollectionsForOrder. */
export function collectionKey(supplierId: number, date: string) {
  return `${supplierId}|${date}`;
}

export function groupCollections(collections: Collection[] | undefined) {
  const map = new Map<string, Collection[]>();
  for (const c of collections ?? []) {
    if (c.status === "cancelled") continue;
    const k = collectionKey(c.supplierId, c.collectionDate);
    map.set(k, [...(map.get(k) ?? []), c]);
  }
  return map;
}

// ── Signature pad ──────────────────────────────────────────────────────────
// Pointer events rather than mouse/touch pairs so one code path covers the
// Apple Pencil, a finger and a mouse. touch-action:none stops iPadOS treating
// a signing stroke as a page scroll.
function SignaturePad({ onChange }: { onChange: (blob: Blob | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const dirtyRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Back the canvas at device resolution so the signature isn't a blurry
    // upscale on a retina iPad.
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
  }, []);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const emit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !dirtyRef.current) { onChange(null); return; }
    canvas.toBlob(blob => onChange(blob), "image/png");
  }, [onChange]);

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawingRef.current = true;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!dirtyRef.current) { dirtyRef.current = true; setHasInk(true); }
  };

  const end = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    emit();
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
    dirtyRef.current = false;
    setHasInk(false);
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <div className="relative rounded-xl border-2 border-dashed border-border bg-background overflow-hidden">
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          onPointerCancel={end}
          className="w-full h-40 touch-none cursor-crosshair block"
        />
        {!hasInk && (
          <span className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground pointer-events-none">
            Driver signs here
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={clear}
        disabled={!hasInk}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-secondary/50 transition-colors disabled:opacity-40"
      >
        <Undo2 className="w-3.5 h-3.5" /> Clear signature
      </button>
    </div>
  );
}

// ── Complete a collection ──────────────────────────────────────────────────
function CompleteCollectionDialog({
  collection, onClose,
}: { collection: Collection; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [driverName, setDriverName] = useState("");
  const [signature, setSignature] = useState<Blob | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!photo) { setPhotoPreview(null); return; }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const allTicked = collection.lines.every(l => l.checkedOff);
  const canSubmit = allTicked && driverName.trim().length > 1 && !!signature;

  const complete = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append("driverName", driverName.trim());
      if (signature) form.append("signature", signature, `collection-${collection.id}-signature.png`);
      if (photo) form.append("photo", photo, photo.name || "collection-photo.jpg");
      const res = await fetch(`${BASE}/api/collections/${collection.id}/complete`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not complete the collection");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      queryClient.invalidateQueries({ queryKey: ["weekly-deliveries"] });
      toast({ title: "Collection signed for", description: `${collection.supplierName ?? "Collection"} handed over to ${driverName.trim()}.` });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Could not complete the collection"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg my-8">
        <div className="p-5 border-b border-border flex items-start gap-3">
          <PackageOpen className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-display font-bold text-lg leading-tight">Hand over &amp; sign</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              {collection.supplierName}
              {collection.reference ? ` · ${collection.reference}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {!allTicked && (
            <div className="flex items-start gap-2 text-sm rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5 text-amber-900 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Tick every item off in the list before the driver signs.</span>
            </div>
          )}

          <label className="block">
            <span className="text-sm font-semibold">Driver's name <span className="text-red-500">*</span></span>
            <input
              autoFocus
              value={driverName}
              onChange={e => setDriverName(e.target.value)}
              placeholder="Name of the driver collecting"
              autoCapitalize="words"
              className="mt-1.5 w-full px-4 py-3 text-base border border-border rounded-xl bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </label>

          <div>
            <span className="text-sm font-semibold flex items-center gap-1.5">
              <PenLine className="w-4 h-4 text-muted-foreground" />
              Driver's signature <span className="text-red-500">*</span>
            </span>
            <p className="text-xs text-muted-foreground mt-0.5 mb-1.5">Hand the iPad to the driver.</p>
            <SignaturePad onChange={setSignature} />
          </div>

          <div>
            <span className="text-sm font-semibold flex items-center gap-1.5">
              <Camera className="w-4 h-4 text-muted-foreground" />
              Photo <span className="text-muted-foreground font-normal">(optional)</span>
            </span>
            <p className="text-xs text-muted-foreground mt-0.5 mb-1.5">
              The items with the driver, or loaded in the vehicle.
            </p>
            {photoPreview ? (
              <div className="relative rounded-xl overflow-hidden border border-border">
                <img src={photoPreview} alt="Collection" className="w-full max-h-56 object-cover" />
                <button
                  onClick={() => setPhoto(null)}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80 transition-colors"
                  title="Remove photo"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <label className="flex items-center justify-center gap-2 px-4 py-4 rounded-xl border-2 border-dashed border-border hover:bg-secondary/40 transition-colors cursor-pointer text-sm font-medium">
                <Camera className="w-4 h-4" /> Take or choose a photo
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={e => setPhoto(e.target.files?.[0] ?? null)}
                />
              </label>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-xl px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-border flex gap-3">
          <button
            onClick={onClose}
            className="px-5 py-3 border border-border rounded-xl text-sm font-medium hover:bg-secondary/50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => { setError(null); complete.mutate(); }}
            disabled={!canSubmit || complete.isPending}
            className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-primary text-primary-foreground rounded-xl font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {complete.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              : <><Check className="w-4 h-4" /> Confirm collection</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit / reschedule / delete a scheduled collection ──────────────────────
// Signed-for collections are immutable (the server enforces it too): the
// signature is evidence for a specific list on a specific day.
function EditCollectionDialog({
  collection, onClose,
}: { collection: Collection; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [collectionDate, setCollectionDate] = useState(collection.collectionDate);
  const [reference, setReference] = useState(collection.reference ?? "");
  const [notes, setNotes] = useState(collection.notes ?? "");
  const [lines, setLines] = useState<Array<{ description: string; quantity: string; unit: string }>>(
    collection.lines.map(l => ({ description: l.description, quantity: String(l.quantity), unit: l.unit })),
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validLines = lines
    .map(l => ({ ...l, description: l.description.trim() }))
    .filter(l => l.description.length > 0);
  // Replacing lines re-creates them un-ticked, so only send them when the
  // list itself changed.
  const linesChanged = JSON.stringify(validLines) !== JSON.stringify(
    collection.lines.map(l => ({ description: l.description, quantity: String(l.quantity), unit: l.unit })),
  );
  const anyTicked = collection.lines.some(l => l.checkedOff);
  const canSubmit = collectionDate && validLines.length > 0;

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        collectionDate,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
      };
      if (linesChanged) {
        body.lines = validLines.map(l => ({
          description: l.description,
          quantity: Number(l.quantity) || 1,
          unit: l.unit.trim() || "items",
        }));
      }
      const res = await fetch(`${BASE}/api/collections/${collection.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save the collection");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      queryClient.invalidateQueries({ queryKey: ["weekly-deliveries"] });
      toast({ title: "Collection updated" });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Could not save the collection"),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/collections/${collection.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not delete the collection");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      queryClient.invalidateQueries({ queryKey: ["weekly-deliveries"] });
      toast({ title: "Collection deleted" });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Could not delete the collection"),
  });

  const busy = save.isPending || remove.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg my-8">
        <div className="p-5 border-b border-border flex items-start gap-3">
          <PackageOpen className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-display font-bold text-lg leading-tight">Edit collection</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              {collection.supplierName ?? "Collection"} — change the date to move it to another day.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm font-semibold">Date <span className="text-red-500">*</span></span>
              <input
                type="date"
                value={collectionDate}
                onChange={e => setCollectionDate(e.target.value)}
                className="mt-1.5 w-full px-3 py-2.5 border border-border rounded-xl bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold">Reference <span className="text-muted-foreground font-normal">(optional)</span></span>
              <input
                value={reference}
                onChange={e => setReference(e.target.value)}
                placeholder="e.g. Empty water bottles"
                className="mt-1.5 w-full px-3 py-2.5 border border-border rounded-xl bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </label>
          </div>

          <div>
            <span className="text-sm font-semibold">Items being collected <span className="text-red-500">*</span></span>
            {anyTicked && (
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                Changing the items un-ticks anything already ticked off.
              </p>
            )}
            <div className="mt-1.5 space-y-2">
              {lines.map((line, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={line.description}
                    onChange={e => setLines(ls => ls.map((l, j) => j === i ? { ...l, description: e.target.value } : l))}
                    placeholder="Item name"
                    className="flex-1 px-3 py-2.5 border border-border rounded-xl bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={line.quantity}
                    onChange={e => setLines(ls => ls.map((l, j) => j === i ? { ...l, quantity: e.target.value } : l))}
                    className="w-20 px-3 py-2.5 border border-border rounded-xl bg-background text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <input
                    value={line.unit}
                    onChange={e => setLines(ls => ls.map((l, j) => j === i ? { ...l, unit: e.target.value } : l))}
                    placeholder="items"
                    className="w-24 px-3 py-2.5 border border-border rounded-xl bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <button
                    onClick={() => setLines(ls => ls.length === 1 ? ls : ls.filter((_, j) => j !== i))}
                    disabled={lines.length === 1}
                    className="p-2.5 rounded-xl border border-border text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30"
                    title="Remove item"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => setLines(ls => [...ls, { description: "", quantity: "1", unit: "items" }])}
              className="mt-2 flex items-center gap-1.5 text-xs px-3 py-2 border border-border rounded-lg hover:bg-secondary/50 transition-colors font-medium"
            >
              <Plus className="w-3.5 h-3.5" /> Add another item
            </button>
          </div>

          <label className="block">
            <span className="text-sm font-semibold">Notes <span className="text-muted-foreground font-normal">(optional)</span></span>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="mt-1.5 w-full px-3 py-2.5 border border-border rounded-xl bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </label>

          {error && (
            <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-xl px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-border flex items-center gap-3">
          {confirmingDelete ? (
            <>
              <span className="text-sm font-medium text-destructive">Delete this collection?</span>
              <button
                onClick={() => { setError(null); remove.mutate(); }}
                disabled={busy}
                className="flex items-center gap-1.5 px-4 py-3 bg-destructive text-destructive-foreground rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {remove.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Yes, delete
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                disabled={busy}
                className="px-4 py-3 border border-border rounded-xl text-sm font-medium hover:bg-secondary/50 transition-colors"
              >
                Keep it
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setConfirmingDelete(true)}
                disabled={busy}
                className="flex items-center gap-1.5 px-4 py-3 border border-destructive/40 text-destructive rounded-xl text-sm font-medium hover:bg-destructive/10 transition-colors disabled:opacity-40"
              >
                <Trash2 className="w-4 h-4" /> Delete
              </button>
              <div className="flex-1" />
              <button
                onClick={onClose}
                disabled={busy}
                className="px-5 py-3 border border-border rounded-xl text-sm font-medium hover:bg-secondary/50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { setError(null); save.mutate(); }}
                disabled={!canSubmit || busy}
                className="flex items-center justify-center gap-2 px-5 py-3 bg-primary text-primary-foreground rounded-xl font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {save.isPending
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                  : <><Check className="w-4 h-4" /> Save changes</>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── The panel itself ───────────────────────────────────────────────────────
export function CollectionPanel({
  collection, nested, canEdit,
}: { collection: Collection; nested: boolean; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [completing, setCompleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showPhoto, setShowPhoto] = useState(false);

  const tickLine = useMutation({
    mutationFn: async ({ lineId, checkedOff }: { lineId: number; checkedOff: boolean }) => {
      const res = await fetch(`${BASE}/api/collections/lines/${lineId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkedOff }),
      });
      if (!res.ok) throw new Error("Could not update the item");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["collections"] }),
    onError: () => toast({ title: "Could not update the item", variant: "destructive" }),
  });

  const done = collection.status === "collected";
  const tickedCount = collection.lines.filter(l => l.checkedOff).length;

  return (
    <>
      <div
        className={cn(
          "overflow-hidden",
          nested
            ? "border-b-2 border-amber-300 dark:border-amber-800"
            : "rounded-2xl border-2",
          done
            ? nested ? "bg-green-50/60 dark:bg-green-950/20" : "border-green-300 dark:border-green-800 bg-green-50/40 dark:bg-green-950/20"
            : nested ? "bg-amber-50/70 dark:bg-amber-950/30" : "border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/25",
        )}
      >
        <div className="px-4 py-3 flex items-center gap-3">
          <div className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
            done ? "bg-green-100 dark:bg-green-900/40" : "bg-amber-100 dark:bg-amber-900/40",
          )}>
            {done
              ? <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
              : <PackageOpen className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-bold text-base">
                Collection{!nested && collection.supplierName ? ` · ${collection.supplierName}` : ""}
              </h4>
              <span className={cn(
                "text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full",
                done
                  ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                  : "bg-amber-200/70 dark:bg-amber-900/50 text-amber-900 dark:text-amber-200",
              )}>
                {done ? "Signed for" : "Do this first"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {collection.reference ? `${collection.reference} · ` : ""}
              {done && collection.collectedAt
                ? `${collection.driverName} · ${format(new Date(collection.collectedAt), "d MMM HH:mm")}`
                : `${tickedCount} / ${collection.lines.length} ticked off`}
            </p>
          </div>
          {!done && canEdit && (
            <div className="shrink-0 flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); setEditing(true); }}
                className="p-2.5 rounded-xl border border-border text-muted-foreground hover:bg-secondary/50 transition-colors"
                title="Edit, move or delete this collection"
              >
                <Edit2 className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setCompleting(true); }}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition-colors"
              >
                <PenLine className="w-4 h-4" /> Hand over &amp; sign
              </button>
            </div>
          )}
          {done && (
            <div className="shrink-0 flex items-center gap-2" onClick={e => e.stopPropagation()}>
              <a
                href={`${BASE}/api/collections/${collection.id}/signature`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-xs px-3 py-2 border border-border rounded-lg hover:bg-secondary/50 transition-colors"
              >
                <PenLine className="w-3.5 h-3.5" /> Signature
              </a>
              {collection.hasPhoto && (
                <button
                  onClick={() => setShowPhoto(true)}
                  className="flex items-center gap-1.5 text-xs px-3 py-2 border border-border rounded-lg hover:bg-secondary/50 transition-colors"
                >
                  <ImageIcon className="w-3.5 h-3.5" /> Photo
                </button>
              )}
            </div>
          )}
        </div>

        <div className="px-4 pb-3" onClick={e => e.stopPropagation()}>
          <div className="flex flex-wrap gap-2">
            {collection.lines.map(line => (
              <button
                key={line.id}
                disabled={done || !canEdit || tickLine.isPending}
                onClick={() => tickLine.mutate({ lineId: line.id, checkedOff: !line.checkedOff })}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-xl border text-sm transition-colors disabled:cursor-default",
                  line.checkedOff
                    ? "border-green-400 dark:border-green-700 bg-green-100/80 dark:bg-green-900/30 text-green-900 dark:text-green-200"
                    : "border-border bg-background hover:bg-secondary/50",
                )}
              >
                <span className={cn(
                  "w-4 h-4 rounded flex items-center justify-center shrink-0",
                  line.checkedOff ? "bg-green-500 text-white" : "border border-muted-foreground/40",
                )}>
                  {line.checkedOff && <Check className="w-3 h-3" />}
                </span>
                <span className="font-medium">{line.description}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {line.quantity} {line.unit}
                </span>
              </button>
            ))}
          </div>
          {collection.notes && (
            <p className="text-xs text-muted-foreground mt-2">{collection.notes}</p>
          )}
        </div>
      </div>

      {completing && (
        <CompleteCollectionDialog collection={collection} onClose={() => setCompleting(false)} />
      )}

      {editing && (
        <EditCollectionDialog collection={collection} onClose={() => setEditing(false)} />
      )}

      {showPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setShowPhoto(false)}
        >
          <img
            src={`${BASE}/api/collections/${collection.id}/photo`}
            alt="Collection"
            className="max-h-full max-w-full rounded-xl"
          />
        </div>
      )}
    </>
  );
}

// ── Add a collection ───────────────────────────────────────────────────────
interface SupplierLite { id: number; name: string }

export function AddCollectionDialog({
  suppliers, defaultDate, defaultSupplierId, onClose,
}: {
  suppliers: SupplierLite[];
  defaultDate: string;
  defaultSupplierId?: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState<number | "">(defaultSupplierId ?? "");
  const [collectionDate, setCollectionDate] = useState(defaultDate);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Array<{ description: string; quantity: string; unit: string }>>([
    { description: "", quantity: "1", unit: "items" },
  ]);
  const [error, setError] = useState<string | null>(null);

  const validLines = lines
    .map(l => ({ ...l, description: l.description.trim() }))
    .filter(l => l.description.length > 0);
  const canSubmit = supplierId !== "" && collectionDate && validLines.length > 0;

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/collections`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: Number(supplierId),
          collectionDate,
          reference: reference.trim() || undefined,
          notes: notes.trim() || undefined,
          lines: validLines.map(l => ({
            description: l.description,
            quantity: Number(l.quantity) || 1,
            unit: l.unit.trim() || "items",
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not create the collection");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      toast({ title: "Collection added" });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Could not create the collection"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg my-8">
        <div className="p-5 border-b border-border flex items-start gap-3">
          <PackageOpen className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-display font-bold text-lg leading-tight">Add a collection</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Something being collected from us. If there's a delivery from the same supplier that
              day, this shows at the top of it and holds the delivery until it's done.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm font-semibold">Supplier <span className="text-red-500">*</span></span>
              <select
                value={supplierId}
                onChange={e => setSupplierId(e.target.value ? Number(e.target.value) : "")}
                className="mt-1.5 w-full px-3 py-2.5 border border-border rounded-xl bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="">Choose a supplier…</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-semibold">Date <span className="text-red-500">*</span></span>
              <input
                type="date"
                value={collectionDate}
                onChange={e => setCollectionDate(e.target.value)}
                className="mt-1.5 w-full px-3 py-2.5 border border-border rounded-xl bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-semibold">Reference <span className="text-muted-foreground font-normal">(optional)</span></span>
            <input
              value={reference}
              onChange={e => setReference(e.target.value)}
              placeholder="e.g. Empty water bottles, mixer for repair"
              className="mt-1.5 w-full px-3 py-2.5 border border-border rounded-xl bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </label>

          <div>
            <span className="text-sm font-semibold">Items being collected <span className="text-red-500">*</span></span>
            <div className="mt-1.5 space-y-2">
              {lines.map((line, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={line.description}
                    onChange={e => setLines(ls => ls.map((l, j) => j === i ? { ...l, description: e.target.value } : l))}
                    placeholder="Item name"
                    className="flex-1 px-3 py-2.5 border border-border rounded-xl bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={line.quantity}
                    onChange={e => setLines(ls => ls.map((l, j) => j === i ? { ...l, quantity: e.target.value } : l))}
                    className="w-20 px-3 py-2.5 border border-border rounded-xl bg-background text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <input
                    value={line.unit}
                    onChange={e => setLines(ls => ls.map((l, j) => j === i ? { ...l, unit: e.target.value } : l))}
                    placeholder="items"
                    className="w-24 px-3 py-2.5 border border-border rounded-xl bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <button
                    onClick={() => setLines(ls => ls.length === 1 ? ls : ls.filter((_, j) => j !== i))}
                    disabled={lines.length === 1}
                    className="p-2.5 rounded-xl border border-border text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30"
                    title="Remove item"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => setLines(ls => [...ls, { description: "", quantity: "1", unit: "items" }])}
              className="mt-2 flex items-center gap-1.5 text-xs px-3 py-2 border border-border rounded-lg hover:bg-secondary/50 transition-colors font-medium"
            >
              <Plus className="w-3.5 h-3.5" /> Add another item
            </button>
          </div>

          <label className="block">
            <span className="text-sm font-semibold">Notes <span className="text-muted-foreground font-normal">(optional)</span></span>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="mt-1.5 w-full px-3 py-2.5 border border-border rounded-xl bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </label>

          {error && (
            <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-xl px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-border flex gap-3">
          <button
            onClick={onClose}
            className="px-5 py-3 border border-border rounded-xl text-sm font-medium hover:bg-secondary/50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => { setError(null); create.mutate(); }}
            disabled={!canSubmit || create.isPending}
            className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-primary text-primary-foreground rounded-xl font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {create.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Adding…</>
              : <><Plus className="w-4 h-4" /> Add collection</>}
          </button>
        </div>
      </div>
    </div>
  );
}
