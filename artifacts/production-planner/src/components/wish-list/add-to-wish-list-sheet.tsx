/**
 * "Add to Wish List" — opened from Quick actions (Graeme, 23 Oct 2026).
 *
 * As step-free as possible: paste a link and the page is read straight
 * away (no button) — name, price and picture appear, all editable, and one
 * tap adds it. No link? Type what you need instead. If it's already on the
 * list, your vote goes on the existing item instead ("Already on the list —
 * added your vote instead").
 *
 * Modal rules (CLAUDE.md): X to close, card capped at 92dvh with its own
 * scroll so Add is always reachable, full width on a phone.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { CheckCircle2, ExternalLink, Gift, Link2, Loader2, ThumbsUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  WishListError,
  useAddWishItem,
  useReadLink,
  useVote,
} from "@/hooks/use-wish-list";
import {
  WISH_LIST_NAME,
  WISH_LIST_PATH,
  WISH_LIST_SUBTITLE,
  formatPence,
  looksLikeLink,
  penceToPoundsInput,
  poundsInputToPence,
  vatWord,
  type WishListItem,
} from "@/lib/wish-list";

interface Draft {
  url: string | null;
  title: string;
  priceText: string;
  priceIncludesVat: boolean | null;
  priceExVatPence: number | null;
  currency: string;
  imageUrl: string | null;
  storeName: string | null;
  notes: string;
  quantity: number;
}

const EMPTY: Draft = {
  url: null, title: "", priceText: "", priceIncludesVat: null, priceExVatPence: null,
  currency: "GBP", imageUrl: null, storeName: null, notes: "", quantity: 1,
};

export function AddToWishListSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [link, setLink] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [readNote, setReadNote] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ item: WishListItem; message: string; ask?: boolean } | null>(null);
  const [imageBroken, setImageBroken] = useState(false);
  const lastRead = useRef<string | null>(null);
  const readLink = useReadLink();
  const add = useAddWishItem();
  const vote = useVote();

  // Always starts fresh: a shared iPad must never show the last person's
  // half-finished request.
  useEffect(() => {
    if (!open) return;
    setLink(""); setDraft(null); setReadNote(null); setDuplicate(null); setImageBroken(false);
    lastRead.current = null;
    readLink.reset(); add.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /** Already on the list: put this person's vote on it instead. */
  const voteOnDuplicate = (item: WishListItem) => {
    if (item.votes.votedToday) {
      setDuplicate({ item, message: "Already on the list — and you've already voted for it today" });
      return;
    }
    vote.mutate(item.id, {
      onSuccess: r => setDuplicate({ item: r.item, message: "Already on the list — added your vote instead" }),
      onError: (e: Error) => setDuplicate({
        item,
        message: e instanceof WishListError && e.status === 409 ? "Already on the list — and you've already voted for it today" : `Already on the list — ${e.message}`,
      }),
    });
  };

  const startRead = (text: string) => {
    const t = text.trim();
    if (!looksLikeLink(t) || lastRead.current === t) return;
    lastRead.current = t;
    setDuplicate(null); setReadNote(null); setImageBroken(false);
    readLink.mutate(t, {
      onSuccess: r => {
        if (r.duplicate && !r.reading) { voteOnDuplicate(r.duplicate); setDraft(null); return; }
        const reading = r.reading;
        setDraft({
          ...EMPTY,
          url: r.url,
          title: reading?.title ?? "",
          priceText: penceToPoundsInput(reading?.pricePence ?? null),
          priceIncludesVat: reading?.priceIncludesVat ?? null,
          priceExVatPence: reading?.priceExVatPence ?? null,
          currency: reading?.currency ?? "GBP",
          imageUrl: reading?.imageUrl ?? null,
          storeName: reading?.storeName ?? null,
        });
        if (r.duplicate) setDuplicate({ item: r.duplicate, message: "Looks like this might already be on the list", ask: true });
        if (!r.readOk) setReadNote("The shop wouldn't let us read that page — check the name and add the price if you know it.");
        else if (!reading?.title || reading.pricePence == null) setReadNote("We couldn't find everything on that page — fill in what's missing.");
      },
      onError: (e: Error) => {
        lastRead.current = null;
        setReadNote(e.message);
        setDraft({ ...EMPTY, url: t });
      },
    });
  };

  // Typing a link (rather than pasting) reads it once they pause.
  useEffect(() => {
    if (!open || !looksLikeLink(link)) return;
    const timer = setTimeout(() => startRead(link), 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, open]);

  if (!open) return null;

  const priceP = draft ? poundsInputToPence(draft.priceText) : null;
  const priceInvalid = priceP === undefined;
  const canAdd = !!draft && draft.title.trim().length > 0 && !priceInvalid && !add.isPending;

  const submit = () => {
    if (!draft || !canAdd) return;
    add.mutate({
      url: draft.url,
      title: draft.title.trim(),
      pricePence: priceP ?? null,
      priceIncludesVat: priceP == null ? null : draft.priceIncludesVat,
      // A price someone typed over replaces the shop's; drop the ex-VAT
      // figure then, since it no longer matches.
      priceExVatPence: draft.priceText === penceToPoundsInput(priceP ?? null) ? draft.priceExVatPence : null,
      currency: draft.currency,
      imageUrl: draft.imageUrl,
      storeName: draft.storeName,
      notes: draft.notes.trim() || null,
      quantity: draft.quantity,
    }, {
      onSuccess: r => {
        if (r.duplicate) {
          setDuplicate({ item: r.item, message: r.message ?? "Already on the list — added your vote instead" });
          setDraft(null);
          return;
        }
        toast({ title: `Added to the ${WISH_LIST_NAME}`, description: `${r.item.title} — your vote's counted.` });
        onClose();
      },
      onError: (e: Error) => toast({ title: "Couldn't add it — try again", description: e.message, variant: "destructive" }),
    });
  };

  const typeInstead = () => {
    setDraft({ ...EMPTY });
    setReadNote(null);
  };

  return createPortal(
    <div className="fixed inset-0 z-[55] bg-black/60 flex items-end sm:items-center justify-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-wish-title"
        onClick={e => e.stopPropagation()}
        className="bg-background w-full sm:max-w-2xl max-h-[92dvh] rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-border">
          <div className="w-12 h-12 rounded-2xl bg-pink-500 text-white flex items-center justify-center flex-shrink-0">
            <Gift className="w-7 h-7" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="add-wish-title" className="font-display font-bold text-2xl leading-tight">Add to {WISH_LIST_NAME}</h2>
            <p className="text-sm text-muted-foreground">{WISH_LIST_SUBTITLE}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 rounded-xl border border-border flex items-center justify-center text-muted-foreground hover:text-foreground flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* The one big box: paste and it reads. */}
          <div>
            <label htmlFor="wish-link" className="block text-lg font-bold mb-2">Paste a link</label>
            <div className="relative">
              <Link2 className="w-6 h-6 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                id="wish-link"
                autoFocus
                inputMode="url"
                autoComplete="off"
                value={link}
                onChange={e => setLink(e.target.value)}
                onPaste={e => {
                  const text = e.clipboardData.getData("text");
                  if (looksLikeLink(text)) { setTimeout(() => startRead(text), 0); }
                }}
                placeholder="Paste the shop's link here"
                className="w-full h-16 pl-14 pr-4 rounded-2xl border-2 border-primary/50 bg-background text-lg focus:outline-none focus:ring-4 focus:ring-primary/20"
              />
            </div>
            {readLink.isPending && (
              <p className="mt-3 flex items-center gap-2 text-base text-muted-foreground" role="status">
                <Loader2 className="w-5 h-5 animate-spin" /> Reading the page…
              </p>
            )}
            {!draft && !duplicate && !readLink.isPending && (
              <button type="button" onClick={typeInstead} className="mt-3 text-base font-semibold text-primary underline underline-offset-4">
                or just type what you need
              </button>
            )}
          </div>

          {duplicate && (
            <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-3" role="status">
              <p className="flex items-center gap-2 text-lg font-bold">
                {vote.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <ThumbsUp className="w-5 h-5" />}
                {vote.isPending ? "Already on the list — adding your vote…" : duplicate.message}
              </p>
              <DuplicateCard item={duplicate.item} />
              {draft && !vote.isPending && duplicate.ask && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => voteOnDuplicate(duplicate.item)} className="h-12 px-5 rounded-xl bg-amber-500 text-white font-bold">
                    Yes — vote for that one
                  </button>
                  <button type="button" onClick={() => setDuplicate(null)} className="h-12 px-5 rounded-xl border-2 border-border font-bold">
                    No, it's different
                  </button>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Link href={WISH_LIST_PATH} onClick={onClose} className="text-base font-semibold text-primary underline underline-offset-4">
                  See the {WISH_LIST_NAME}
                </Link>
              </div>
            </div>
          )}

          {draft && !(duplicate && !duplicate.ask) && (
            <div className="space-y-4">
              {readNote && <p className="text-base rounded-xl bg-secondary px-4 py-3">{readNote}</p>}
              <div className="flex gap-4 items-start">
                {draft.imageUrl && !imageBroken && (
                  <img
                    src={draft.imageUrl}
                    alt=""
                    onError={() => setImageBroken(true)}
                    className="w-24 h-24 sm:w-32 sm:h-32 rounded-2xl object-contain bg-white border border-border flex-shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0 space-y-1">
                  <label htmlFor="wish-title" className="block text-base font-bold">What is it?</label>
                  <textarea
                    id="wish-title"
                    value={draft.title}
                    onChange={e => setDraft({ ...draft, title: e.target.value })}
                    rows={2}
                    maxLength={300}
                    autoFocus={!draft.url}
                    placeholder="e.g. Spare blue chopping boards"
                    className="w-full px-3 py-2.5 rounded-xl border-2 border-border bg-background text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  {draft.storeName && <p className="text-sm text-muted-foreground">From {draft.storeName}</p>}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4">
                <div>
                  <label htmlFor="wish-price" className="block text-base font-bold mb-1">Price <span className="font-normal text-muted-foreground">(if you know it)</span></label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg text-muted-foreground">{draft.currency === "GBP" ? "£" : draft.currency === "EUR" ? "€" : "$"}</span>
                    <input
                      id="wish-price"
                      inputMode="decimal"
                      value={draft.priceText}
                      onChange={e => setDraft({ ...draft, priceText: e.target.value })}
                      placeholder="0.00"
                      className={cn("w-full h-14 pl-8 pr-3 rounded-xl border-2 bg-background text-lg tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30", priceInvalid ? "border-rose-500" : "border-border")}
                    />
                  </div>
                  {priceInvalid && <p className="text-sm text-rose-600 mt-1">That's not a price — numbers only, like 12.50</p>}
                  {!priceInvalid && priceP != null && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {[vatWord(draft.priceIncludesVat), draft.priceExVatPence != null && draft.priceIncludesVat ? `${formatPence(draft.priceExVatPence, draft.currency)} ex VAT` : ""].filter(Boolean).join(" · ") || "The shop didn't say if VAT is included"}
                    </p>
                  )}
                </div>
                <div>
                  <span className="block text-base font-bold mb-1">How many?</span>
                  <div className="flex items-center gap-2">
                    <button type="button" aria-label="One fewer" onClick={() => setDraft({ ...draft, quantity: Math.max(1, draft.quantity - 1) })} className="w-14 h-14 rounded-xl border-2 border-border text-2xl font-bold">−</button>
                    <span className="w-12 text-center text-2xl font-bold tabular-nums" aria-live="polite">{draft.quantity}</span>
                    <button type="button" aria-label="One more" onClick={() => setDraft({ ...draft, quantity: Math.min(1000, draft.quantity + 1) })} className="w-14 h-14 rounded-xl border-2 border-border text-2xl font-bold">+</button>
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="wish-notes" className="block text-base font-bold mb-1">Why do we need it? <span className="font-normal text-muted-foreground">(optional)</span></label>
                <textarea
                  id="wish-notes"
                  value={draft.notes}
                  onChange={e => setDraft({ ...draft, notes: e.target.value })}
                  rows={2}
                  maxLength={2000}
                  placeholder="e.g. The old one's cracked and we're sharing one between two stations"
                  className="w-full px-3 py-2.5 rounded-xl border-2 border-border bg-background text-base focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
          )}
        </div>

        {draft && !(duplicate && !duplicate.ask) && (
          <div className="p-5 pt-3 border-t border-border">
            <button
              type="button"
              onClick={submit}
              disabled={!canAdd}
              className="w-full h-16 rounded-2xl bg-primary text-primary-foreground text-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {add.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : <CheckCircle2 className="w-6 h-6" />}
              {add.isPending ? "Adding…" : `Add to ${WISH_LIST_NAME}`}
            </button>
          </div>
        )}
        {duplicate && !duplicate.ask && (
          <div className="p-5 pt-3 border-t border-border">
            <button type="button" onClick={onClose} className="w-full h-16 rounded-2xl bg-primary text-primary-foreground text-xl font-bold">Done</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function DuplicateCard({ item }: { item: WishListItem }) {
  const price = formatPence(item.pricePence, item.currency);
  return (
    <div className="flex gap-3 items-center rounded-xl bg-background border border-border p-3">
      {item.imageUrl && <img src={item.imageUrl} alt="" className="w-16 h-16 rounded-xl object-contain bg-white border border-border flex-shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className="text-base font-bold break-words">{item.title}</p>
        <p className="text-sm text-muted-foreground">
          {[price, `${item.votes.total} vote${item.votes.total === 1 ? "" : "s"}`, item.createdByName ? `asked for by ${item.createdByName}` : null].filter(Boolean).join(" · ")}
        </p>
      </div>
      {item.url && (
        <a href={item.url} target="_blank" rel="noopener noreferrer" aria-label="Open the shop's page" className="w-11 h-11 rounded-xl border border-border flex items-center justify-center flex-shrink-0">
          <ExternalLink className="w-5 h-5" />
        </a>
      )}
    </div>
  );
}
