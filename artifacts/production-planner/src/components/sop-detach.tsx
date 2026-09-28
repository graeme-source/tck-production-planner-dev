/**
 * Taking a wrongly attached SOP off a place (Graeme, 2026-09-28).
 *
 * Anyone may do it, but never by accident: there is no ✕ on any "Show me
 * how" button or list row any more. You open the SOP, and at the very bottom
 * of it a quiet "Wrong place?" link asks, in words, "Remove it from <place>?"
 * — a second, separate tap confirms. The SOP itself stays in the library;
 * the server logs who removed it (migration 0133) and Undo puts it back.
 */
import { useState } from "react";
import { Loader2, Unlink } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Where an opened SOP is attached — what lets its viewer offer "remove". */
export interface SopPlace {
  linkId: number;
  sopId: number;
  sopTitle: string;
  /** Human name of the place, e.g. "Order Packing Live", "Building Table 1". */
  placeLabel: string;
  /** Refresh whatever lists the link (chips, rails). */
  onChanged?: () => void;
}

type RemovedLink = { sopId: number; targetType: string; a: number | null; b: number | null; text: string | null };

export function SopDetachFooter({ place, onRemoved }: {
  place: SopPlace;
  /** Close the viewer — the SOP no longer belongs here. */
  onRemoved: () => void;
}) {
  const sopTitle = place.sopTitle;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function undo(removed: RemovedLink) {
    const res = await fetch(`${BASE}/api/standards/links`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sopId: removed.sopId, targetType: removed.targetType, a: removed.a, b: removed.b, text: removed.text }),
    });
    if (res.ok) {
      place.onChanged?.();
      toast({ title: "Put back", description: `"${sopTitle}" is back on ${place.placeLabel}.` });
    } else {
      toast({ title: "Couldn't put it back", description: "Attach it again from the + SOP button.", variant: "destructive" });
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/standards/links/${place.linkId}`, { method: "DELETE", credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 404) throw new Error(body?.error ?? "Failed");
      place.onChanged?.();
      onRemoved();
      const removed = body?.removed as RemovedLink | undefined;
      toast({
        title: "SOP removed from here",
        description: `"${sopTitle}" is no longer on ${place.placeLabel}. It's still in the SOP library.`,
        action: removed ? <ToastAction altText="Undo" onClick={() => void undo(removed)}>Undo</ToastAction> : undefined,
      });
    } catch {
      toast({ title: "Couldn't remove the SOP", description: "Try again in a moment.", variant: "destructive" });
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground py-2"
        >
          <Unlink className="w-4 h-4" /> Wrong place for this SOP?
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border-2 border-destructive/40 bg-destructive/5 p-4 space-y-3">
      <p className="text-base font-semibold">
        Remove "{sopTitle}" from {place.placeLabel}?
      </p>
      <p className="text-sm text-muted-foreground">
        It won't show here any more. The SOP isn't deleted — it stays in the library and can be attached again.
      </p>
      <div className="flex flex-wrap gap-2 justify-end">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="h-11 px-4 rounded-lg border border-border font-medium hover:bg-secondary/60"
        >
          No, keep it
        </button>
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy}
          className="h-11 px-4 rounded-lg bg-destructive text-destructive-foreground font-semibold inline-flex items-center gap-2 disabled:opacity-60"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink className="w-4 h-4" />}
          Yes, remove it from here
        </button>
      </div>
    </div>
  );
}
