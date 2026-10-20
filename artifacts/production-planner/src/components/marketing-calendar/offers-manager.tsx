/**
 * The offer library, managed from the calendar (2026-10-20): "'Free pack for
 * orders over 39.95' just becomes a list item; we can type new ones, add,
 * edit, delete." Each offer's wording and notes autosave; archive keeps an
 * offer but stops it being suggested; delete is soft with an Undo toast.
 * Phases keep their own copy of the words, so nothing here changes a phase.
 *
 * Modal rule: explicit X, card capped at 92dvh with internal scrolling.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Loader2, Plus, Tag, Trash2, X } from "lucide-react";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { createOffer, deleteOffer, invalidateOffers, patchOffer, restoreOffer, useOffers, type Offer } from "./api";

export function OffersManager({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const offersQ = useOffers();
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const offers = offersQ.data?.offers ?? [];
  const live = offers.filter(o => !o.archived);
  const archived = offers.filter(o => o.archived);

  const add = async () => {
    if (!text.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      await createOffer({ text: text.trim() });
      setText("");
      await invalidateOffers(qc);
    } catch (err) {
      setAddError((err as Error).message);
    } finally {
      setAdding(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[130] bg-black/60 flex items-center justify-center p-2 sm:p-6" onClick={onClose}>
      <div
        className="bg-card border-2 border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Offers"
      >
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-border">
          <Tag className="w-5 h-5 text-violet-600 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <h2 className="font-display font-bold text-lg leading-tight">Offers</h2>
            <p className="text-sm text-muted-foreground">The list you pick from on a phase. Changes here never change a phase already using an offer.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close"><X className="w-6 h-6" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          <div className="space-y-1.5">
            <div className="flex gap-2">
              <input
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void add(); } }}
                maxLength={300}
                placeholder="New offer, e.g. Free pack on orders over £39.95"
                className="flex-1 min-w-0 px-4 py-3 rounded-xl border-2 border-border bg-background text-base focus:outline-none focus:border-primary"
                aria-label="New offer"
              />
              <button type="button" onClick={() => void add()} disabled={!text.trim() || adding}
                className="px-4 py-3 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center gap-1.5 disabled:opacity-40">
                {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add
              </button>
            </div>
            {addError && <p className="text-sm text-destructive">{addError}</p>}
          </div>

          {offersQ.isLoading && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>}
          {offersQ.isError && <p className="text-sm text-destructive">{(offersQ.error as Error).message}</p>}
          {offersQ.data && live.length === 0 && <p className="text-sm text-muted-foreground">No offers yet — add one above, or type one on a phase.</p>}

          <ul className="space-y-3">
            {live.map(o => <OfferRow key={o.id} offer={o} />)}
          </ul>

          {archived.length > 0 && (
            <div className="space-y-3">
              <button type="button" onClick={() => setShowArchived(v => !v)}
                className="text-sm font-semibold text-muted-foreground underline underline-offset-2">
                {showArchived ? "Hide" : "Show"} archived ({archived.length})
              </button>
              {showArchived && <ul className="space-y-3">{archived.map(o => <OfferRow key={o.id} offer={o} />)}</ul>}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function OfferRow({ offer }: { offer: Offer }) {
  const qc = useQueryClient();
  const [text, setText] = useState(offer.text);
  const [notes, setNotes] = useState(offer.notes ?? "");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Wording and notes save separately, so typing in one never drops the other.
  const saveText = useAutosave<string>(async value => {
    if (!value.trim()) throw new Error("An offer can't be blank");
    await patchOffer(offer.id, { text: value });
    void invalidateOffers(qc);
  });
  const saveNotes = useAutosave<string | null>(async value => {
    await patchOffer(offer.id, { notes: value });
    void invalidateOffers(qc);
  });
  const rank = ["idle", "saved", "dirty", "saving", "error"] as const;
  const save = rank.indexOf(saveText.state) >= rank.indexOf(saveNotes.state) ? saveText : saveNotes;

  const setArchived = async (archived: boolean) => {
    setBusy(true);
    setError(null);
    try { await patchOffer(offer.id, { archived }); await invalidateOffers(qc); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteOffer(offer.id);
      await invalidateOffers(qc);
      toast({
        title: `“${offer.text}” deleted`,
        description: offer.usedBy > 0 ? "Phases using it keep their wording." : undefined,
        action: (
          <ToastAction altText="Undo" onClick={() => {
            void restoreOffer(offer.id)
              .then(() => invalidateOffers(qc))
              .catch(err => toast({ title: "Couldn't undo", description: (err as Error).message, variant: "destructive" }));
          }}>Undo</ToastAction>
        ),
      });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <li className={cn("rounded-2xl border-2 p-3 sm:p-4 space-y-2", offer.archived ? "border-dashed border-border opacity-80" : "border-violet-500/30")}>
      <div className="flex items-start gap-2">
        <input
          value={text}
          onChange={e => { setText(e.target.value); saveText.schedule(e.target.value); }}
          onBlur={() => void saveText.flush()}
          maxLength={300}
          className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border-2 border-border bg-background text-base font-semibold focus:outline-none focus:border-primary"
          aria-label="Offer wording"
        />
        <SaveChip state={save.state} error={save.error} onRetry={() => void save.flush()} />
      </div>
      <input
        value={notes}
        onChange={e => { setNotes(e.target.value); saveNotes.schedule(e.target.value || null); }}
        onBlur={() => void saveNotes.flush()}
        maxLength={2000}
        placeholder="Notes (optional) — e.g. needs the FREEPACK code live in Shopify"
        className="w-full px-3 py-2 rounded-xl border-2 border-border bg-background text-sm focus:outline-none focus:border-primary"
        aria-label="Offer notes"
      />
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground flex-1 min-w-[8rem]">
          {offer.usedBy === 0 ? "Not on any phase" : `On ${offer.usedBy} phase${offer.usedBy === 1 ? "" : "s"}`}
          {offer.archived && " · archived"}
        </span>
        <button type="button" onClick={() => void setArchived(!offer.archived)} disabled={busy}
          className="px-3 py-2 rounded-xl border-2 border-border text-sm font-semibold flex items-center gap-1.5 hover:bg-secondary/50 disabled:opacity-50">
          {offer.archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />} {offer.archived ? "Unarchive" : "Archive"}
        </button>
        {!confirming ? (
          <button type="button" onClick={() => (offer.usedBy > 0 ? setConfirming(true) : void remove())} disabled={busy}
            className="px-3 py-2 rounded-xl border-2 border-red-500/40 text-red-600 text-sm font-semibold flex items-center gap-1.5 hover:bg-red-500/10 disabled:opacity-50">
            <Trash2 className="w-4 h-4" /> Delete
          </button>
        ) : (
          <span className="w-full rounded-xl border-2 border-red-500/50 bg-red-500/10 p-3 space-y-2">
            <span className="block text-sm font-semibold">
              {offer.usedBy} phase{offer.usedBy === 1 ? " uses" : "s use"} this offer. They keep their wording — it just leaves the list. Delete it?
            </span>
            <span className="flex gap-2 flex-wrap">
              <button type="button" onClick={() => void remove()} disabled={busy}
                className="px-3 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-60">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Yes, delete
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="px-3 py-2 rounded-xl border-2 border-border text-sm font-semibold">Keep it</button>
              <button type="button" onClick={() => { setConfirming(false); void setArchived(true); }} className="px-3 py-2 rounded-xl border-2 border-border text-sm font-semibold">Archive instead</button>
            </span>
          </span>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </li>
  );
}
