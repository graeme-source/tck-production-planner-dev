/**
 * "Record an unexpected delivery" (Graeme, 2026-09-25).
 *
 * A supplier sends something nobody booked in the app — a back order, an
 * auto-generated repeat — and it turns up at the door. Two steps here, then
 * the NORMAL goods-in receive takes over:
 *
 *   1. What's arrived? One forgiving search box (name, supplier, brand or
 *      item number), optional supplier to narrow it, a basket of items with
 *      pack counts, and a free-text line for anything not in the system.
 *   2. Is it one of these? Open orders for the same supplier or items, any
 *      day. Tap one to receive against it (it's moved to today), or "No —
 *      it's a different delivery" to record a new unexpected order.
 *
 * Either way the parent then opens the usual Receive Goods dialog for that
 * order: same use-by, temperature and quantity checks, same stock update.
 *
 * The basket is a draft kept on this device (localStorage), so closing the
 * dialog or a stray pull-to-refresh never loses it — the footer says so.
 * Modal rules: X + backdrop close, max-h-[92dvh], internal scroll.
 * Objectives C, D and F.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  X, Search, Truck, Plus, Minus, Trash2, PackagePlus, ArrowRight, ArrowLeft,
  Loader2, CheckCircle2, AlertTriangle, PencilLine, Check, CalendarClock, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { NumberInput } from "@/components/ui/number-input";
import { formatLineQtyParts, packSizeHint } from "@/pages/station/shared/prep-helpers";
import {
  inferDeliverySupplier,
  itemComesFrom,
  searchDeliveryItems,
  type DeliveryCatalogueItem,
} from "@/lib/delivery-item-search";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DRAFT_KEY = "tck:unexpected-delivery-draft:v1";

interface Catalogue {
  suppliers: Array<{ id: number; name: string }>;
  items: DeliveryCatalogueItem[];
}

type BasketLine =
  | { key: string; kind: "item"; ingredientId: number; quantity: number; unitPrice: number | null }
  | { key: string; kind: "misc"; description: string; quantity: number; unit: string; unitPrice: number | null };

interface Draft {
  filterSupplierId: number | null;
  lines: BasketLine[];
}

interface MatchLine {
  ingredientId: number | null;
  name: string;
  quantityOrdered: number;
  unit: string;
  nativeUnit: string | null;
  packWeight: number | null;
  stockInPacks: boolean;
}

interface OpenOrderMatch {
  id: number;
  supplierId: number;
  supplierName: string;
  expectedDeliveryDate: string | null;
  origin: string;
  matchedIngredientIds: number[];
  sameSupplier: boolean;
  daysFromToday: number | null;
  reasons: string[];
  lines: MatchLine[];
}

function readDraft(): Draft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return Array.isArray(d?.lines) ? d : null;
  } catch {
    return null;
  }
}

/** Returns false when the device won't store it, so the footer can say so. */
function writeDraft(d: Draft | null): boolean {
  try {
    if (!d || d.lines.length === 0) window.localStorage.removeItem(DRAFT_KEY);
    else window.localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

let keySeq = 0;
const newKey = () => `l${Date.now().toString(36)}${(keySeq++).toString(36)}`;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Something went wrong — try again");
  return data as T;
}

function money(n: number): string {
  return `£${n.toFixed(2)}`;
}

function dueLabel(m: OpenOrderMatch): { text: string; tone: "today" | "past" | "future" | "none" } {
  if (!m.expectedDeliveryDate || m.daysFromToday == null) return { text: "No delivery date", tone: "none" };
  const day = format(parseISO(m.expectedDeliveryDate), "EEE d MMM");
  const d = m.daysFromToday;
  if (d === 0) return { text: "Due today", tone: "today" };
  if (d < 0) return { text: `Was due ${day} — ${-d} day${d === -1 ? "" : "s"} ago`, tone: "past" };
  return { text: `Booked for ${day} — in ${d} day${d === 1 ? "" : "s"}`, tone: "future" };
}

export function UnexpectedDeliveryDialog({
  open,
  onClose,
  onReceive,
}: {
  open: boolean;
  onClose: () => void;
  /** Hand the chosen / created order to the normal receive dialog. */
  onReceive: (orderId: number) => void;
}) {
  const [step, setStep] = useState<"items" | "matches">("items");
  const [query, setQuery] = useState("");
  const [filterSupplierId, setFilterSupplierId] = useState<number | null>(null);
  const [lines, setLines] = useState<BasketLine[]>([]);
  const [editingPriceKey, setEditingPriceKey] = useState<string | null>(null);
  const [draftStored, setDraftStored] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const loadedDraft = useRef(false);

  // Restore the draft once per open; reset the step each time.
  useEffect(() => {
    if (!open) { loadedDraft.current = false; return; }
    setStep("items");
    setQuery("");
    setEditingPriceKey(null);
    if (!loadedDraft.current) {
      const d = readDraft();
      setFilterSupplierId(d?.filterSupplierId ?? null);
      setLines(d?.lines ?? []);
      loadedDraft.current = true;
    }
    setTimeout(() => searchRef.current?.focus(), 50);
  }, [open]);

  // Keep the draft on the device after every change.
  useEffect(() => {
    if (!open || !loadedDraft.current) return;
    setDraftStored(writeDraft({ filterSupplierId, lines }));
  }, [open, filterSupplierId, lines]);

  // A swipe-down in a long list must not reload the page mid-delivery.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.dataset.suppressPullToRefresh ?? null;
    document.body.dataset.suppressPullToRefresh = "1";
    return () => {
      if (prev === null) delete document.body.dataset.suppressPullToRefresh;
      else document.body.dataset.suppressPullToRefresh = prev;
    };
  }, [open]);

  const catalogueQuery = useQuery<Catalogue>({
    queryKey: ["/api/deliveries/unexpected/catalogue"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/deliveries/unexpected/catalogue`, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Couldn't load the items list");
      return data as Catalogue;
    },
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const itemsById = useMemo(
    () => new Map((catalogueQuery.data?.items ?? []).map(i => [i.id, i])),
    [catalogueQuery.data],
  );
  const supplierName = (id: number | null) =>
    id == null ? null : catalogueQuery.data?.suppliers.find(s => s.id === id)?.name ?? null;

  const hits = useMemo(
    () => searchDeliveryItems(catalogueQuery.data?.items ?? [], query, { supplierId: filterSupplierId, limit: 40 }),
    [catalogueQuery.data, query, filterSupplierId],
  );

  const itemLines = lines.filter((l): l is Extract<BasketLine, { kind: "item" }> => l.kind === "item");
  const firstItem = itemLines.length > 0 ? itemsById.get(itemLines[0].ingredientId) : null;
  const deliverySupplierId = inferDeliverySupplier(filterSupplierId, firstItem);
  const deliverySupplierName = supplierName(deliverySupplierId);
  const qtyInBasket = (ingredientId: number) => itemLines.find(l => l.ingredientId === ingredientId)?.quantity ?? 0;

  const addItem = (item: DeliveryCatalogueItem) => {
    setLines(prev => {
      const existing = prev.find(l => l.kind === "item" && l.ingredientId === item.id);
      if (existing) {
        return prev.map(l => (l === existing ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { key: newKey(), kind: "item", ingredientId: item.id, quantity: 1, unitPrice: null }];
    });
  };

  const addMisc = (description = "") => {
    setLines(prev => [...prev, { key: newKey(), kind: "misc", description, quantity: 1, unit: "each", unitPrice: null }]);
  };

  const updateLine = (key: string, patch: Partial<BasketLine>) =>
    setLines(prev => prev.map(l => (l.key === key ? ({ ...l, ...patch } as BasketLine) : l)));
  const removeLine = (key: string) => setLines(prev => prev.filter(l => l.key !== key));

  const clearDraft = () => {
    setLines([]);
    setFilterSupplierId(null);
    writeDraft(null);
  };

  const blankMisc = lines.some(l => l.kind === "misc" && !l.description.trim());
  const zeroQty = lines.some(l => !(l.quantity > 0));
  const nextBlocker =
    lines.length === 0 ? "Add what's arrived first"
      : deliverySupplierId == null ? "Pick who it's from"
        : blankMisc ? "Say what the extra item is"
          : zeroQty ? "Every item needs a quantity"
            : null;

  // ─── Step 2 data ───────────────────────────────────────────────────────
  const ingredientIds = itemLines.map(l => l.ingredientId);
  const matchesQuery = useQuery<{ today: string; matches: OpenOrderMatch[] }>({
    queryKey: ["/api/deliveries/unexpected/matches", deliverySupplierId, ingredientIds.join(",")],
    queryFn: () => postJson("/api/deliveries/unexpected/matches", { supplierId: deliverySupplierId, ingredientIds }),
    enabled: open && step === "matches",
    staleTime: 0,
  });

  const finish = (orderId: number) => {
    writeDraft(null);
    setLines([]);
    setFilterSupplierId(null);
    onReceive(orderId);
  };

  const useExisting = useMutation({
    mutationFn: (orderId: number) => postJson<{ id: number; moved: boolean }>(`/api/deliveries/unexpected/${orderId}/arrived-today`, {}),
    onSuccess: (r) => {
      if (r.moved) toast({ title: `PO #${r.id} moved to today`, description: "Now check it in as normal." });
      finish(r.id);
    },
    onError: (e: Error) => toast({ title: "Couldn't use that order", description: e.message, variant: "destructive" }),
  });

  const createNew = useMutation({
    mutationFn: () => postJson<{ id: number }>("/api/deliveries/unexpected", {
      supplierId: deliverySupplierId,
      lines: lines.map(l => l.kind === "item"
        ? { kind: "item", ingredientId: l.ingredientId, quantity: l.quantity, unitPrice: l.unitPrice }
        : { kind: "misc", description: l.description.trim(), quantity: l.quantity, unit: l.unit.trim() || "each", unitPrice: l.unitPrice }),
    }),
    onSuccess: (r) => {
      toast({ title: `Unexpected delivery recorded — PO #${r.id}`, description: "Now check it in as normal." });
      finish(r.id);
    },
    onError: (e: Error) => toast({ title: "Couldn't record the delivery", description: e.message, variant: "destructive" }),
  });

  const busy = useExisting.isPending || createNew.isPending;
  const close = () => { if (!busy) onClose(); };

  if (!open) return null;

  // ─── Render helpers ────────────────────────────────────────────────────
  const renderItemCard = (item: DeliveryCatalogueItem, matchedOnPart: boolean) => {
    const inBasket = qtyInBasket(item.id);
    const size = packSizeHint(item.packWeight, item.unit);
    const otherSupplier =
      item.secondarySupplierName && item.secondarySupplierName !== item.supplierName ? item.secondarySupplierName : null;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => addItem(item)}
        className={cn(
          "w-full text-left rounded-2xl border-2 p-4 transition-colors min-h-[88px] flex items-start gap-3",
          inBasket > 0
            ? "border-[#7cb342] bg-[#7cb342]/10"
            : "border-border bg-card hover:border-primary/50 active:bg-secondary/40",
        )}
      >
        <div className="flex-1 min-w-0">
          <p className="text-lg font-bold leading-tight">{item.name.trim()}</p>
          <p className="text-sm text-muted-foreground mt-0.5 truncate">
            {item.supplierName ?? "No supplier set"}
            {otherSupplier && <> · also {otherSupplier}</>}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {item.supplierPartNumber && (
              <span className={cn(
                "text-xs font-semibold px-2 py-0.5 rounded-full",
                matchedOnPart ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground",
              )}>
                Item no. {item.supplierPartNumber}
              </span>
            )}
            {size && <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">{size}</span>}
            {!size && <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">counted in {item.unit}</span>}
            {item.brand?.trim() && <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">{item.brand.trim()}</span>}
          </div>
        </div>
        <span className={cn(
          "shrink-0 rounded-xl px-3 py-2 text-sm font-bold flex items-center gap-1",
          inBasket > 0 ? "bg-[#7cb342] text-white" : "bg-primary/10 text-primary",
        )}>
          {inBasket > 0 ? <><Check className="w-4 h-4" /> {inBasket}</> : <><Plus className="w-4 h-4" /> Add</>}
        </span>
      </button>
    );
  };

  const stepper = (value: number, onChange: (n: number) => void, step: number, label: string) => (
    <div className="flex items-stretch rounded-xl border border-border bg-background overflow-hidden h-12">
      <button type="button" aria-label={`Fewer ${label}`} onClick={() => onChange(Math.max(0, Number((value - step).toFixed(3))))}
        className="px-3 bg-secondary/40 hover:bg-secondary/70 active:bg-secondary flex items-center">
        <Minus className="w-5 h-5" />
      </button>
      <NumberInput
        value={value}
        onChange={n => onChange(Math.max(0, n))}
        min="0"
        step={step}
        inputMode="decimal"
        aria-label={label}
        className="w-16 text-center text-xl font-bold tabular-nums bg-background focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button type="button" aria-label={`More ${label}`} onClick={() => onChange(Number((value + step).toFixed(3)))}
        className="px-3 bg-secondary/40 hover:bg-secondary/70 active:bg-secondary flex items-center">
        <Plus className="w-5 h-5" />
      </button>
    </div>
  );

  const priceEditor = (l: BasketLine, catalogueCost: number | null, perLabel: string) => {
    const effective = l.unitPrice ?? catalogueCost;
    if (editingPriceKey === l.key) {
      return (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">£</span>
          <NumberInput
            autoFocus
            value={effective ?? null}
            emptyValue={0}
            onChange={n => updateLine(l.key, { unitPrice: n })}
            min="0"
            step={0.01}
            inputMode="decimal"
            aria-label="Price"
            className="w-24 h-10 px-2 rounded-lg border border-border bg-background text-base font-semibold"
          />
          <span className="text-sm text-muted-foreground">{perLabel}</span>
          <button type="button" onClick={() => setEditingPriceKey(null)} className="h-10 px-3 rounded-lg bg-secondary text-sm font-semibold">Done</button>
        </div>
      );
    }
    return (
      <button type="button" onClick={() => setEditingPriceKey(l.key)} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 py-1">
        <PencilLine className="w-3.5 h-3.5" />
        {effective != null && effective > 0 ? <>{money(effective)} {perLabel}</> : <>Add a price (optional)</>}
      </button>
    );
  };

  const basket = (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-bold">In this delivery {lines.length > 0 && <span className="text-muted-foreground font-semibold">({lines.length})</span>}</h3>
        {lines.length > 0 && (
          <button type="button" onClick={clearDraft} className="text-sm text-muted-foreground hover:text-destructive px-2 py-1">Clear list</button>
        )}
      </div>

      {deliverySupplierId != null ? (
        <div className="rounded-xl bg-primary/5 border border-primary/20 px-3 py-2 text-sm">
          From <span className="font-bold">{deliverySupplierName}</span>
          {filterSupplierId == null && <span className="text-muted-foreground"> — not right? Pick the supplier above.</span>}
        </div>
      ) : lines.length > 0 ? (
        <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          Who's it from? Pick the supplier above.
        </div>
      ) : null}

      {lines.length === 0 && (
        <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-border px-3 py-6 text-center">
          Tap an item to add it. Tap again for another pack.
        </p>
      )}

      {lines.map(l => {
        if (l.kind === "item") {
          const item = itemsById.get(l.ingredientId);
          if (!item) return null;
          const inPacks = item.packWeight > 0;
          const size = packSizeHint(item.packWeight, item.unit);
          const offSupplier = deliverySupplierId != null && !itemComesFrom(item, deliverySupplierId);
          return (
            <div key={l.key} className="rounded-2xl border border-border bg-card p-3 space-y-2">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-bold leading-tight">{item.name.trim()}</p>
                  {item.supplierPartNumber && <p className="text-xs text-muted-foreground">Item no. {item.supplierPartNumber}</p>}
                  {offSupplier && (
                    <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1 mt-0.5">
                      <AlertTriangle className="w-3 h-3" /> Usually from {item.supplierName ?? "another supplier"}
                    </p>
                  )}
                </div>
                <button type="button" onClick={() => removeLine(l.key)} aria-label={`Remove ${item.name}`}
                  className="w-11 h-11 -mr-1 -mt-1 rounded-xl flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {stepper(l.quantity, n => updateLine(l.key, { quantity: n }), inPacks ? 1 : 0.5, inPacks ? "packs" : item.unit)}
                <div className="text-sm leading-tight">
                  <p className="font-semibold">{inPacks ? (l.quantity === 1 ? "pack" : "packs") : item.unit}</p>
                  {inPacks && size && <p className="text-muted-foreground">{size}</p>}
                </div>
              </div>
              {priceEditor(l, item.costPerPack > 0 ? item.costPerPack : null, inPacks ? "per pack" : `per ${item.unit}`)}
            </div>
          );
        }
        return (
          <div key={l.key} className="rounded-2xl border border-border bg-card p-3 space-y-2">
            <div className="flex items-start gap-2">
              <input
                value={l.description}
                onChange={e => updateLine(l.key, { description: e.target.value })}
                placeholder="What is it? e.g. Sample sauce"
                className={cn(
                  "flex-1 min-w-0 h-11 px-3 rounded-xl border bg-background text-base font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30",
                  l.description.trim() ? "border-border" : "border-amber-400",
                )}
              />
              <button type="button" onClick={() => removeLine(l.key)} aria-label="Remove this item"
                className="w-11 h-11 rounded-xl flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {stepper(l.quantity, n => updateLine(l.key, { quantity: n }), 1, l.unit || "each")}
              <input
                value={l.unit}
                onChange={e => updateLine(l.key, { unit: e.target.value })}
                aria-label="Unit"
                className="w-24 h-11 px-3 rounded-xl border border-border bg-background text-base"
              />
            </div>
            <p className="text-xs text-muted-foreground">Not in the system, so it won't change stock — it's recorded on the delivery.</p>
            {priceEditor(l, null, "each")}
          </div>
        );
      })}

      <button type="button" onClick={() => addMisc()}
        className="w-full h-12 rounded-xl border-2 border-dashed border-border text-sm font-semibold flex items-center justify-center gap-2 hover:bg-secondary/40">
        <PackagePlus className="w-4 h-4" /> Something not on the list
      </button>
    </div>
  );

  const matchesStep = () => {
    if (matchesQuery.isLoading) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p>Checking open orders…</p>
        </div>
      );
    }
    if (matchesQuery.isError) {
      return (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 space-y-3">
          <p className="text-destructive font-semibold">{(matchesQuery.error as Error).message}</p>
          <button type="button" onClick={() => matchesQuery.refetch()} className="h-11 px-4 rounded-xl bg-secondary font-semibold">Try again</button>
        </div>
      );
    }
    const matches = matchesQuery.data?.matches ?? [];
    const wanted = new Set(ingredientIds);
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-2xl font-bold">Is it one of these?</h3>
          <p className="text-muted-foreground mt-1">
            {matches.length > 0
              ? "These orders are still open for the same supplier or items — maybe booked for another day. If the delivery is one of them, tap it."
              : "No open orders match, so this is a new delivery."}
          </p>
        </div>

        {matches.map(m => {
          const due = dueLabel(m);
          return (
            <div key={m.id} className="rounded-2xl border-2 border-border bg-card overflow-hidden">
              <div className="p-4 space-y-2">
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Truck className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xl font-bold leading-tight">{m.supplierName}</p>
                    <p className="text-sm text-muted-foreground">PO #{m.id}{m.origin === "unexpected" && " · recorded as unexpected"}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className={cn(
                    "text-sm font-semibold px-2.5 py-1 rounded-full inline-flex items-center gap-1.5",
                    due.tone === "today" && "bg-[#7cb342] text-white",
                    due.tone === "past" && "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
                    due.tone === "future" && "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
                    due.tone === "none" && "bg-secondary text-muted-foreground",
                  )}>
                    <CalendarClock className="w-4 h-4" /> {due.text}
                  </span>
                  {m.reasons.map(r => (
                    <span key={r} className="text-sm font-medium px-2.5 py-1 rounded-full bg-secondary">{r}</span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {m.lines.map((l, i) => {
                    const q = formatLineQtyParts(l.quantityOrdered, l.unit, l.nativeUnit, l.packWeight, l.stockInPacks);
                    const hit = l.ingredientId != null && wanted.has(l.ingredientId);
                    return (
                      <span key={i} className={cn(
                        "text-sm rounded-xl px-3 py-1.5 border",
                        hit ? "border-[#7cb342] bg-[#7cb342]/10 font-semibold" : "border-border bg-background",
                      )}>
                        {hit && <Check className="w-3.5 h-3.5 inline -mt-0.5 mr-1 text-[#7cb342]" />}
                        {l.name} × {q.primary}
                      </span>
                    );
                  })}
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => useExisting.mutate(m.id)}
                className="w-full h-14 bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 hover:bg-primary/90 disabled:opacity-50"
              >
                {useExisting.isPending && useExisting.variables === m.id
                  ? <Loader2 className="w-5 h-5 animate-spin" />
                  : <CheckCircle2 className="w-5 h-5" />}
                Yes — it's this one, check it in
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  const suppliers = catalogueQuery.data?.suppliers ?? [];

  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/70 flex items-center justify-center p-2 sm:p-4 md:p-6" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Record an unexpected delivery"
        className="bg-background border-2 border-border rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-border shrink-0">
          <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-amber-700 dark:text-amber-300" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-display font-bold text-xl leading-tight">Record an unexpected delivery</h2>
            <p className="text-sm text-muted-foreground">
              Step {step === "items" ? 1 : 2} of 3 · {step === "items" ? "What's arrived?" : "Is it an order we already have?"} · then check it in
            </p>
          </div>
          <button type="button" onClick={close} disabled={busy} aria-label="Close"
            className="w-11 h-11 rounded-xl flex items-center justify-center hover:bg-secondary disabled:opacity-50">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">
          {catalogueQuery.isLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : catalogueQuery.isError ? (
            <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 space-y-3">
              <p className="text-destructive font-semibold">{(catalogueQuery.error as Error).message}</p>
              <button type="button" onClick={() => catalogueQuery.refetch()} className="h-11 px-4 rounded-xl bg-secondary font-semibold">Try again</button>
            </div>
          ) : step === "items" ? (
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
              <div className="space-y-3 min-w-0">
                <label className="block">
                  <span className="text-sm font-semibold text-muted-foreground">Who's it from? (optional — narrows the list)</span>
                  <select
                    value={filterSupplierId ?? ""}
                    onChange={e => setFilterSupplierId(e.target.value ? Number(e.target.value) : null)}
                    className="mt-1 w-full h-12 px-3 rounded-xl border border-border bg-background text-base font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    <option value="">Any supplier</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>

                <div className="relative">
                  <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Item, supplier, brand or item number"
                    enterKeyHint="search"
                    autoComplete="off"
                    className="w-full h-14 pl-12 pr-12 rounded-2xl border-2 border-border bg-background text-lg focus:outline-none focus:border-primary"
                  />
                  {query && (
                    <button type="button" onClick={() => { setQuery(""); searchRef.current?.focus(); }} aria-label="Clear search"
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl flex items-center justify-center hover:bg-secondary">
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>

                {!query.trim() && filterSupplierId == null ? (
                  <p className="text-muted-foreground text-center py-10">
                    Type what's on the delivery note — an item name, the supplier, a brand or the item number.
                  </p>
                ) : hits.length === 0 ? (
                  <div className="text-center py-8 space-y-3">
                    <p className="text-muted-foreground">Nothing matches “{query.trim()}”.</p>
                    {query.trim() && (
                      <button type="button" onClick={() => { addMisc(query.trim()); setQuery(""); }}
                        className="h-12 px-4 rounded-xl border-2 border-dashed border-border font-semibold inline-flex items-center gap-2 hover:bg-secondary/40">
                        <PackagePlus className="w-4 h-4" /> Add “{query.trim()}” as a one-off item
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid gap-2 lg:grid-cols-2">
                    {hits.map(h => renderItemCard(h.item, h.matchedOn.includes("partNumber")))}
                  </div>
                )}
              </div>

              <div className="md:sticky md:top-0 md:self-start min-w-0">{basket}</div>
            </div>
          ) : (
            matchesStep()
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-4 sm:px-5 py-3 shrink-0 flex items-center gap-3 flex-wrap bg-card">
          {step === "items" ? (
            <>
              <p className="text-xs text-muted-foreground flex-1 min-w-[140px]">
                {lines.length === 0
                  ? "Nothing is saved until you check it in."
                  : draftStored
                    ? "List kept on this device — safe to close and come back."
                    : "This device won't keep the list — finish before closing."}
              </p>
              <button
                type="button"
                disabled={nextBlocker != null}
                onClick={() => setStep("matches")}
                className="h-14 px-6 rounded-xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 flex-1 sm:flex-none hover:bg-primary/90 disabled:bg-secondary disabled:text-muted-foreground"
              >
                {nextBlocker ?? <>Next: check open orders <ArrowRight className="w-5 h-5" /></>}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setStep("items")} disabled={busy}
                className="h-14 px-4 rounded-xl border border-border font-semibold flex items-center gap-2 hover:bg-secondary/50 disabled:opacity-50">
                <ArrowLeft className="w-5 h-5" /> Back
              </button>
              <button
                type="button"
                disabled={busy || matchesQuery.isLoading}
                onClick={() => createNew.mutate()}
                className={cn(
                  "h-14 px-5 rounded-xl text-lg font-bold flex items-center gap-2 flex-1 justify-center disabled:opacity-50",
                  (matchesQuery.data?.matches.length ?? 0) > 0
                    ? "border-2 border-foreground/80 hover:bg-secondary/50"
                    : "bg-primary text-primary-foreground hover:bg-primary/90",
                )}
              >
                {createNew.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <PackagePlus className="w-5 h-5" />}
                {(matchesQuery.data?.matches.length ?? 0) > 0
                  ? "No — it's a different delivery"
                  : "Record it and check it in"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
