/**
 * Wish List — "Equipment & things we need" (Graeme, 23 Oct 2026; objective E).
 *
 * Everyone can see the list, add to it (here or from Quick actions) and +1
 * anything once a day — so the most-felt need rises to the top ("so I can
 * see what the biggest pain point is"). Full-width table on desktop and
 * iPad landscape, big cards on a phone or iPad portrait. Sort by votes
 * (default), newest, oldest or price; filter by status; search.
 *
 * The founder and admins approve / mark ordered / received / decline (with
 * a note), edit and remove; the person who asked can edit their own item
 * while it's still "Asked for". The server enforces all of it.
 */
import { useMemo, useState, type ReactNode } from "react";
import { ExternalLink, Gift, Loader2, Pencil, Plus, Search, ThumbsUp, Check, X, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { AddToWishListSheet } from "@/components/wish-list/add-to-wish-list-sheet";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { feedTimestamp } from "@/lib/feed-time";
import {
  useDeleteWishItem,
  useEditWishItem,
  useSetWishStatus,
  useVote,
  useWishList,
} from "@/hooks/use-wish-list";
import {
  FILTERS,
  SORTS,
  STATUS_LABEL,
  STATUS_TONE,
  WISH_LIST_NAME,
  WISH_LIST_SUBTITLE,
  countsByFilter,
  formatPence,
  penceToPoundsInput,
  poundsInputToPence,
  vatWord,
  visibleItems,
  voteBarPercent,
  voteSpreadLine,
  type WishListFilter,
  type WishListItem,
  type WishListSort,
  type WishListStatus,
} from "@/lib/wish-list";

const SORT_KEY = "wish-list:sort";

function savedSort(): WishListSort {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return SORTS.some(s => s.key === v) ? (v as WishListSort) : "votes";
  } catch { return "votes"; }
}

export default function WishListPage() {
  const { data, isLoading, error } = useWishList();
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<WishListFilter>("open");
  const [sort, setSortState] = useState<WishListSort>(savedSort);
  const [query, setQuery] = useState("");
  const [managing, setManaging] = useState<WishListItem | null>(null);
  const [editing, setEditing] = useState<WishListItem | null>(null);

  const setSort = (s: WishListSort) => {
    setSortState(s);
    try { localStorage.setItem(SORT_KEY, s); } catch { /* private mode — the choice just isn't remembered */ }
  };

  const items = data?.items ?? [];
  const shown = useMemo(() => visibleItems(items, { filter, sort, query }), [items, filter, sort, query]);
  const counts = useMemo(() => countsByFilter(items), [items]);
  // The bar is measured against the most-voted OPEN item — the biggest
  // pain point still to fix.
  const topVotes = useMemo(
    () => Math.max(0, ...items.filter(i => i.status === "requested" || i.status === "approved").map(i => i.votes.total)),
    [items],
  );
  const canManage = data?.canManage ?? false;

  return (
    <div className="space-y-5">
      <PageHeader
        title={WISH_LIST_NAME}
        description={WISH_LIST_SUBTITLE}
        action={
          <button
            onClick={() => setAdding(true)}
            className="h-10 px-4 bg-primary text-primary-foreground rounded-xl font-semibold flex items-center gap-2 hover:bg-primary/90"
          >
            <Plus className="w-5 h-5" /> <span className="hidden sm:inline">Add something</span>
          </button>
        }
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Show">
          {FILTERS.map(f => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "h-11 px-4 rounded-full border-2 text-base font-semibold flex items-center gap-2",
                filter === f.key ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-secondary/60",
              )}
            >
              {f.label}
              <span className={cn("min-w-[24px] h-6 px-1.5 rounded-full text-sm flex items-center justify-center tabular-nums", filter === f.key ? "bg-white/25" : "bg-secondary")}>{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search the list"
              aria-label="Search the list"
              className="w-full h-12 pl-10 pr-10 rounded-xl border-2 border-border bg-background text-base focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <label className="flex items-center gap-2 text-base font-semibold">
            <span className="whitespace-nowrap">Sort by</span>
            <select
              value={sort}
              onChange={e => setSort(e.target.value as WishListSort)}
              className="h-12 px-3 rounded-xl border-2 border-border bg-background text-base flex-1 sm:flex-none"
            >
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
        </div>
      </div>

      {isLoading && <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Loading…</p>}
      {error && <p className="text-rose-600">Couldn't load the {WISH_LIST_NAME}: {(error as Error).message}</p>}

      {!isLoading && !error && shown.length === 0 && (
        <div className="rounded-3xl border-2 border-dashed border-border p-8 text-center space-y-3">
          <Gift className="w-12 h-12 mx-auto text-pink-500" />
          <p className="text-xl font-bold">{items.length === 0 ? "Nothing on the list yet" : "Nothing here"}</p>
          <p className="text-muted-foreground">{items.length === 0 ? "Need a piece of kit? Paste the link and everyone can vote for it." : "Try another filter or clear the search."}</p>
          {items.length === 0 && (
            <button onClick={() => setAdding(true)} className="h-14 px-6 rounded-2xl bg-primary text-primary-foreground text-lg font-bold inline-flex items-center gap-2">
              <Plus className="w-5 h-5" /> Add something
            </button>
          )}
        </div>
      )}

      {shown.length > 0 && (
        <>
          {/* Desktop / iPad landscape: the table. */}
          <div className="hidden lg:block rounded-2xl border border-border overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-secondary/60 text-sm uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-bold">Item</th>
                  <th className="px-4 py-3 font-bold whitespace-nowrap">Price</th>
                  <th className="px-4 py-3 font-bold whitespace-nowrap">Asked for by</th>
                  <th className="px-4 py-3 font-bold w-[260px]">Votes</th>
                  <th className="px-4 py-3 font-bold">Status</th>
                  <th className="px-4 py-3 font-bold"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map(item => (
                  <tr key={item.id} className="align-middle">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Thumb item={item} size="w-16 h-16" />
                        <div className="min-w-0">
                          <ItemTitle item={item} className="text-lg" />
                          {item.storeName && <p className="text-sm text-muted-foreground">{item.storeName}</p>}
                          {item.notes && <p className="text-sm mt-0.5 whitespace-pre-wrap break-words">“{item.notes}”</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap"><Price item={item} /></td>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{item.createdByName ?? "—"}</p>
                      <p className="text-sm text-muted-foreground whitespace-nowrap">{feedTimestamp(item.createdAt)}</p>
                    </td>
                    <td className="px-4 py-3"><Votes item={item} topVotes={topVotes} /></td>
                    <td className="px-4 py-3"><StatusPill item={item} /></td>
                    <td className="px-4 py-3 text-right">
                      <RowActions item={item} canManage={canManage} onManage={setManaging} onEdit={setEditing} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phone / iPad portrait: big cards. */}
          <ul className="lg:hidden grid grid-cols-1 md:grid-cols-2 gap-3">
            {shown.map(item => (
              <li key={item.id} className="rounded-3xl border-2 border-border p-4 space-y-3 bg-card">
                <div className="flex gap-3 items-start">
                  <Thumb item={item} size="w-20 h-20" />
                  <div className="min-w-0 flex-1">
                    <ItemTitle item={item} className="text-xl" />
                    <div className="mt-1"><Price item={item} inline /></div>
                    <p className="text-sm text-muted-foreground">
                      {[item.storeName, `${item.createdByName ?? "Someone"} · ${feedTimestamp(item.createdAt)}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </div>
                {item.notes && <p className="text-base whitespace-pre-wrap break-words">“{item.notes}”</p>}
                <Votes item={item} topVotes={topVotes} />
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  <StatusPill item={item} />
                  <RowActions item={item} canManage={canManage} onManage={setManaging} onEdit={setEditing} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <AddToWishListSheet open={adding} onClose={() => setAdding(false)} />
      {managing && <ManageDialog item={managing} onClose={() => setManaging(null)} onEdit={() => { setEditing(managing); setManaging(null); }} />}
      {editing && <EditDialog item={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Thumb({ item, size }: { item: WishListItem; size: string }) {
  const [broken, setBroken] = useState(false);
  if (!item.imageUrl || broken) {
    return <div className={cn(size, "rounded-xl bg-pink-500/10 flex items-center justify-center flex-shrink-0")}><Gift className="w-7 h-7 text-pink-500" /></div>;
  }
  return <img src={item.imageUrl} alt="" loading="lazy" onError={() => setBroken(true)} className={cn(size, "rounded-xl object-contain bg-white border border-border flex-shrink-0")} />;
}

function ItemTitle({ item, className }: { item: WishListItem; className?: string }) {
  const label = <>{item.title}{item.quantity > 1 && <span className="text-muted-foreground font-semibold"> × {item.quantity}</span>}</>;
  if (!item.url) return <p className={cn("font-bold break-words", className)}>{label}</p>;
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" className={cn("font-bold break-words hover:underline underline-offset-4", className)}>
      {label} <ExternalLink className="inline w-4 h-4 align-baseline text-muted-foreground" />
    </a>
  );
}

function Price({ item, inline = false }: { item: WishListItem; inline?: boolean }) {
  const price = formatPence(item.pricePence, item.currency);
  if (!price) return <span className="text-muted-foreground">No price</span>;
  const vat = vatWord(item.priceIncludesVat);
  const ex = item.priceIncludesVat && item.priceExVatPence != null ? `${formatPence(item.priceExVatPence, item.currency)} ex VAT` : null;
  return (
    <span className={cn(inline ? "inline" : "block")}>
      <span className="text-lg font-bold tabular-nums">{price}</span>
      {vat && <span className="text-sm text-muted-foreground"> {vat}</span>}
      {ex && <span className={cn("text-sm text-muted-foreground", inline ? "" : "block")}>{inline ? " · " : ""}{ex}</span>}
    </span>
  );
}

function Votes({ item, topVotes }: { item: WishListItem; topVotes: number }) {
  const vote = useVote();
  const pct = voteBarPercent(item.votes.total, topVotes);
  const isTop = topVotes > 0 && item.votes.total === topVotes && (item.status === "requested" || item.status === "approved");
  const open = item.status === "requested" || item.status === "approved";
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="flex items-baseline gap-1.5">
          <span className="text-2xl font-bold tabular-nums">{item.votes.total}</span>
          <span className="text-sm font-semibold">vote{item.votes.total === 1 ? "" : "s"}</span>
          {isTop && <span className="text-xs font-bold uppercase tracking-wide text-pink-600 ml-1">Top</span>}
        </p>
        <div className="h-2.5 rounded-full bg-secondary overflow-hidden my-1" aria-hidden>
          <div className={cn("h-full rounded-full", isTop ? "bg-pink-500" : "bg-pink-400/70")} style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">{voteSpreadLine(item.votes)}</p>
      </div>
      {open && (
        <button
          type="button"
          disabled={item.votes.votedToday || vote.isPending}
          onClick={() => vote.mutate(item.id, {
            onError: (e: Error) => toast({ title: "Vote not added", description: e.message }),
          })}
          aria-label={item.votes.votedToday ? "You've voted for this today" : `Add a vote for ${item.title} today`}
          className={cn(
            "h-14 min-w-[104px] px-3 rounded-2xl text-base font-bold flex items-center justify-center gap-1.5 flex-shrink-0",
            item.votes.votedToday ? "bg-secondary text-muted-foreground" : "bg-pink-500 text-white hover:bg-pink-600 shadow-md shadow-pink-500/30",
          )}
        >
          {vote.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : item.votes.votedToday ? <Check className="w-5 h-5" /> : <ThumbsUp className="w-5 h-5" />}
          {item.votes.votedToday ? "Voted today" : "+1 today"}
        </button>
      )}
    </div>
  );
}

function StatusPill({ item }: { item: WishListItem }) {
  return (
    <div className="min-w-0">
      <span className={cn("inline-block px-3 py-1 rounded-full text-sm font-bold", STATUS_TONE[item.status])}>{STATUS_LABEL[item.status]}</span>
      {item.statusNote && <p className="text-sm mt-1 whitespace-pre-wrap break-words">{item.statusNote}</p>}
      {item.statusChangedByName && item.status !== "requested" && (
        <p className="text-xs text-muted-foreground mt-0.5">{item.statusChangedByName}{item.statusChangedAt ? ` · ${feedTimestamp(item.statusChangedAt)}` : ""}</p>
      )}
    </div>
  );
}

function RowActions({ item, canManage, onManage, onEdit }: {
  item: WishListItem; canManage: boolean; onManage: (i: WishListItem) => void; onEdit: (i: WishListItem) => void;
}) {
  if (canManage) {
    return (
      <button onClick={() => onManage(item)} className="h-12 px-4 rounded-xl border-2 border-border font-bold hover:bg-secondary/60 whitespace-nowrap">
        Update
      </button>
    );
  }
  if (item.canEdit) {
    return (
      <button onClick={() => onEdit(item)} className="h-12 px-4 rounded-xl border-2 border-border font-bold hover:bg-secondary/60 flex items-center gap-1.5">
        <Pencil className="w-4 h-4" /> Edit
      </button>
    );
  }
  return null;
}

/** Shared shell for the two small dialogs: X, 92dvh cap, inner scroll. */
function DialogShell({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[55] bg-black/60 flex items-end sm:items-center justify-center sm:p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        className="bg-background w-full sm:max-w-xl max-h-[92dvh] rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-start gap-3 px-5 pt-5 pb-3 border-b border-border">
          <h2 className="flex-1 min-w-0 font-display font-bold text-xl leading-tight break-words">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="w-11 h-11 rounded-xl border border-border flex items-center justify-center text-muted-foreground hover:text-foreground flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">{children}</div>
        {footer && <div className="p-5 pt-3 border-t border-border">{footer}</div>}
      </div>
    </div>
  );
}

const STATUS_ACTIONS: Array<{ status: WishListStatus; label: string; tone: string }> = [
  { status: "approved", label: "Approve", tone: "bg-emerald-600 text-white" },
  { status: "ordered", label: "Mark ordered", tone: "bg-violet-600 text-white" },
  { status: "received", label: "Mark received", tone: "bg-slate-700 text-white" },
  { status: "declined", label: "Decline", tone: "bg-rose-600 text-white" },
  { status: "requested", label: "Back to asked for", tone: "border-2 border-border" },
];

function ManageDialog({ item, onClose, onEdit }: { item: WishListItem; onClose: () => void; onEdit: () => void }) {
  const setStatus = useSetWishStatus();
  const remove = useDeleteWishItem();
  const [note, setNote] = useState(item.statusNote ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const busy = setStatus.isPending || remove.isPending;

  const apply = (status: WishListStatus) => setStatus.mutate({ id: item.id, status, note: note.trim() || null }, {
    onSuccess: () => { toast({ title: `${STATUS_LABEL[status]}: ${item.title}` }); onClose(); },
    onError: (e: Error) => toast({ title: "Couldn't change it — try again", description: e.message, variant: "destructive" }),
  });

  return (
    <DialogShell title={item.title} onClose={onClose}>
      <p className="text-base">Now: <span className={cn("px-2.5 py-0.5 rounded-full text-sm font-bold", STATUS_TONE[item.status])}>{STATUS_LABEL[item.status]}</span></p>
      <div>
        <label htmlFor="wish-status-note" className="block text-base font-bold mb-1">Note for the team <span className="font-normal text-muted-foreground">(optional — e.g. why it's declined, or when it's arriving)</span></label>
        <textarea id="wish-status-note" value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={1000}
          className="w-full px-3 py-2.5 rounded-xl border-2 border-border bg-background text-base focus:outline-none focus:ring-2 focus:ring-primary/30" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {STATUS_ACTIONS.filter(a => a.status !== item.status).map(a => (
          <button key={a.status} disabled={busy} onClick={() => apply(a.status)} className={cn("h-14 rounded-2xl text-lg font-bold disabled:opacity-50", a.tone)}>
            {a.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
        <button onClick={onEdit} disabled={busy} className="h-12 px-4 rounded-xl border-2 border-border font-bold flex items-center gap-1.5"><Pencil className="w-4 h-4" /> Edit details</button>
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)} disabled={busy} className="h-12 px-4 rounded-xl border-2 border-rose-300 text-rose-700 font-bold flex items-center gap-1.5"><Trash2 className="w-4 h-4" /> Remove from list</button>
        ) : (
          <button
            onClick={() => remove.mutate(item.id, {
              onSuccess: () => { toast({ title: `Removed: ${item.title}` }); onClose(); },
              onError: (e: Error) => toast({ title: "Couldn't remove it", description: e.message, variant: "destructive" }),
            })}
            disabled={busy}
            className="h-12 px-4 rounded-xl bg-rose-600 text-white font-bold flex items-center gap-1.5"
          >
            {remove.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Tap again to remove
          </button>
        )}
      </div>
    </DialogShell>
  );
}

function EditDialog({ item, onClose }: { item: WishListItem; onClose: () => void }) {
  const edit = useEditWishItem();
  const [title, setTitle] = useState(item.title);
  const [url, setUrl] = useState(item.url ?? "");
  const [priceText, setPriceText] = useState(penceToPoundsInput(item.pricePence));
  const [quantity, setQuantity] = useState(item.quantity);
  const [notes, setNotes] = useState(item.notes ?? "");
  const pence = poundsInputToPence(priceText);
  const priceChanged = pence !== item.pricePence;
  const valid = title.trim().length > 0 && pence !== undefined;

  const save = () => {
    if (!valid) return;
    edit.mutate({
      id: item.id,
      title: title.trim(),
      url: url.trim() || null,
      pricePence: pence ?? null,
      // A typed-over price no longer matches what the shop said about VAT.
      ...(priceChanged ? { priceIncludesVat: null, priceExVatPence: null } : {}),
      quantity,
      notes: notes.trim() || null,
    }, {
      onSuccess: () => { toast({ title: "Saved" }); onClose(); },
      onError: (e: Error) => toast({ title: "Not saved — try again", description: e.message, variant: "destructive" }),
    });
  };

  const field = "w-full px-3 py-2.5 rounded-xl border-2 border-border bg-background text-base focus:outline-none focus:ring-2 focus:ring-primary/30";
  return (
    <DialogShell
      title="Edit"
      onClose={onClose}
      footer={
        <button onClick={save} disabled={!valid || edit.isPending} className="w-full h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
          {edit.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />} {edit.isPending ? "Saving…" : "Save changes"}
        </button>
      }
    >
      <label className="block"><span className="block text-base font-bold mb-1">What is it?</span>
        <textarea value={title} onChange={e => setTitle(e.target.value)} rows={2} maxLength={300} className={cn(field, "text-lg font-semibold")} /></label>
      <label className="block"><span className="block text-base font-bold mb-1">Link</span>
        <input value={url} onChange={e => setUrl(e.target.value)} inputMode="url" className={field} placeholder="https://…" /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="block text-base font-bold mb-1">Price (£)</span>
          <input value={priceText} onChange={e => setPriceText(e.target.value)} inputMode="decimal" className={cn(field, pence === undefined && "border-rose-500")} />
          {pence === undefined && <span className="text-sm text-rose-600">Numbers only, like 12.50</span>}
        </label>
        <label className="block"><span className="block text-base font-bold mb-1">How many?</span>
          <input type="number" min={1} max={1000} value={quantity} onChange={e => setQuantity(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} className={field} /></label>
      </div>
      <label className="block"><span className="block text-base font-bold mb-1">Why do we need it?</span>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} maxLength={2000} className={field} /></label>
      {(title !== item.title || url !== (item.url ?? "") || priceChanged || quantity !== item.quantity || notes !== (item.notes ?? "")) && (
        <p className="text-sm font-semibold text-amber-700 dark:text-amber-300" role="status">Not saved yet — tap Save changes.</p>
      )}
    </DialogShell>
  );
}
