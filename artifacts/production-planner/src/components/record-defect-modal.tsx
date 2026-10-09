// "Report defect / waste" (Graeme, 2026-10-01; waste added 2026-10-09 —
// Objectives C and E). Opened from the quick-actions panel anywhere in the
// app and from the Defects & waste page; the same form edits an existing
// record.
//
// A defect is any process not carried out correctly that ends in product
// not acceptable for normal despatch. Waste is anything binned — "2.3 kg of
// nacho cheese sauce that was left out overnight". Start typing any
// ingredient, sub-recipe or product, say how much, and the form shows what
// it cost (ingredients + the time to make it again) before saving. The cost
// is worked out on the server (the same maths the save snapshots).
//
// Wonkies and dog bins are already counted from the station taps, so they
// are NOT entered here.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Loader2, Minus, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATIONS } from "@/pages/station/shared/constants";
import { londonDay } from "@/lib/day-rollover";
import {
  dayText, gbpText, minutesText, parseAmount,
  type DefectRecord, type PackKind, type WasteCost, type WasteItem,
} from "@/lib/defects-view";
import { KIND_LABEL, searchItems } from "@/lib/defect-item-search";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  useDefectTypes, useSaveDefect, useWasteCost, useWasteItems, type DefectInput, type WasteItemInput,
} from "@/hooks/use-defects";

/** Station key → name, for showing where a defect went wrong. */
export const DEFECT_STATION_LABELS: Record<string, string> = Object.fromEntries(STATIONS.map(s => [s.key, s.label]));

/** The button/heading everywhere this form is offered. */
export const REPORT_DEFECT_LABEL = "Report defect / waste";

const REMAKE_CHOICES = [15, 30, 45, 60] as const;

const KIND_CHIP: Record<WasteItem["kind"], string> = {
  product: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  sub_recipe: "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-100",
  ingredient: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
};

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function RecordDefectModal({ open, onClose, editing }: {
  open: boolean;
  onClose: () => void;
  /** Set to edit an existing record; omit to record a new one. */
  editing?: DefectRecord | null;
}) {
  if (!open) return null;
  // Mounted fresh on every open, so the form always starts clean. Portalled
  // to <body>: inside a page, an animated (transformed) ancestor would turn
  // `fixed` into "fixed to the page", pushing the card off-screen on a phone.
  return createPortal(<DefectForm onClose={onClose} editing={editing ?? null} />, document.body);
}

/** The item a record already names, as a picker item (until the list loads,
 *  or when the item has since been archived). */
function itemOfRecord(r: DefectRecord, items: WasteItem[] | undefined): WasteItem | null {
  const kind = r.itemKind ?? (r.recipeId != null ? "product" : null);
  if (!kind) return null;
  const id = kind === "ingredient" ? r.ingredientId : kind === "sub_recipe" ? r.subRecipeId : r.recipeId;
  if (id == null) return null;
  const found = items?.find(i => i.kind === kind && i.id === id);
  if (found) return found;
  return {
    key: `${kind}:${id}`, kind, id, name: r.itemName ?? r.recipeName ?? "This item", detail: null,
    units: r.quantityUnit && kind !== "product" ? [r.quantityUnit] : [],
    packKinds: kind === "product" ? [{ kind: (r.packKind ?? "pack") as PackKind, label: r.packKind === "eight_pack_bag" ? "8-pack bag" : "Pack" }] : [],
    standardPrepMinutes: null,
  };
}

function DefectForm({ onClose, editing }: { onClose: () => void; editing: DefectRecord | null }) {
  const today = londonDay(Date.now());
  const typesQ = useDefectTypes();
  const itemsQ = useWasteItems();
  const save = useSaveDefect();

  const [typeId, setTypeId] = useState<number | null>(editing?.defectTypeId ?? null);
  const [occurredOn, setOccurredOn] = useState(editing?.occurredOn ?? today);
  const knownStation = editing?.station ? editing.station in DEFECT_STATION_LABELS : false;
  const [station, setStation] = useState<string | null>(editing?.station && knownStation ? editing.station : null);
  const [otherStation, setOtherStation] = useState(editing?.station && !knownStation ? editing.station : "");
  const [stationOther, setStationOther] = useState(Boolean(editing?.station && !knownStation));
  const [orderRefs, setOrderRefs] = useState(editing?.orderRefs ?? "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [savedOnce, setSavedOnce] = useState(false);

  // ── The item ──
  const [search, setSearch] = useState("");
  const [itemKey, setItemKey] = useState<string | null>(() => {
    const it = editing ? itemOfRecord(editing, undefined) : null;
    return it?.key ?? null;
  });
  const item = useMemo<WasteItem | null>(() => {
    if (!itemKey) return null;
    const found = itemsQ.data?.find(i => i.key === itemKey);
    if (found) return found;
    return editing ? itemOfRecord(editing, itemsQ.data) : null;
  }, [itemKey, itemsQ.data, editing]);
  const matches = useMemo(() => searchItems(itemsQ.data ?? [], search, 30), [itemsQ.data, search]);

  // Older records (before waste) name a recipe and a pack count but no cost;
  // they keep that unless someone changes the item, amount or remake time.
  const legacy = editing != null && editing.itemKind == null;
  const [itemDirty, setItemDirty] = useState(!editing);

  const [packKind, setPackKind] = useState<PackKind>((editing?.packKind as PackKind | null) ?? "pack");
  const [unit, setUnit] = useState<string>(editing?.quantityUnit && editing.quantityUnit !== "pack" && editing.quantityUnit !== "bag" ? editing.quantityUnit : "");
  const [amountText, setAmountText] = useState(() => {
    if (editing?.quantity != null) return String(editing.quantity);
    if (editing && editing.recipeId != null) return String(editing.packs);
    return "";
  });
  /** null = use the standard time for this amount (or 0 when there isn't one). */
  const [remakeMinutes, setRemakeMinutes] = useState<number | null>(editing?.itemKind ? (editing.remakeMinutes ?? 0) : null);
  const [customMinutes, setCustomMinutes] = useState("");
  const [packsText, setPacksText] = useState(String(editing?.packs || 1));

  const isProduct = item?.kind === "product";
  // Default unit: the first the item offers (kg for anything weighed).
  useEffect(() => {
    if (!item || isProduct) return;
    if (!unit || !item.units.some(u => u.toLowerCase() === unit.toLowerCase())) setUnit(item.units[0] ?? "kg");
  }, [item, isProduct, unit]);
  useEffect(() => {
    if (isProduct && item && !item.packKinds.some(p => p.kind === packKind)) setPackKind("pack");
  }, [isProduct, item, packKind]);

  const amount = parseAmount(amountText, isProduct);
  const touchItem = () => setItemDirty(true);

  const costInput: WasteItemInput | null = item && amount != null && (isProduct || unit)
    ? {
      itemKind: item.kind, itemId: item.id, packKind: isProduct ? packKind : null,
      quantity: amount, quantityUnit: isProduct ? (packKind === "eight_pack_bag" ? "bag" : "pack") : unit,
      remakeMinutes,
    }
    : null;
  const costKey = JSON.stringify(costInput);
  const debouncedKey = useDebouncedValue(costKey, 350);
  const debouncedInput = useMemo(() => JSON.parse(debouncedKey) as WasteItemInput | null, [debouncedKey]);
  const costQ = useWasteCost(debouncedInput);
  const cost = costInput ? costQ.data : undefined;
  const costPending = costKey !== debouncedKey || costQ.isFetching;
  const shownMinutes = remakeMinutes ?? cost?.remakeMinutes ?? 0;
  /** Using the item's standard prep time, scaled to the amount. */
  const standardActive = remakeMinutes === null && cost?.suggestedMinutes != null;

  const types = useMemo(
    () => (typesQ.data ?? []).filter(t => t.active || t.id === editing?.defectTypeId),
    [typesQ.data, editing?.defectTypeId],
  );

  const packs = Number(packsText);
  const packsValid = Number.isInteger(packs) && packs >= 1 && packs <= 100000;
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(occurredOn) && occurredOn <= today;
  const itemValid = item ? amount != null && (isProduct || Boolean(unit)) : packsValid;
  const canSave = typeId != null && itemValid && dateValid && !save.isPending;

  const submit = () => {
    if (!canSave || typeId == null) return;
    const base: DefectInput = {
      occurredOn,
      defectTypeId: typeId,
      station: stationOther ? (otherStation.trim() || null) : station,
      orderRefs: orderRefs.trim() || null,
      note: note.trim() || null,
    };
    let input: DefectInput;
    if (item && costInput && (itemDirty || !legacy)) {
      input = { ...base, ...costInput };
    } else if (item && legacy && editing) {
      // Untouched older record: keep its recipe and packs, still no cost.
      input = { ...base, recipeId: editing.recipeId, packs: editing.packs };
    } else {
      input = { ...base, recipeId: null, packs };
    }
    save.mutate({ id: editing?.id ?? null, input }, { onSuccess: () => setSavedOnce(true) });
  };

  const chooseItem = (it: WasteItem) => {
    setItemKey(it.key); setSearch(""); touchItem();
    setRemakeMinutes(it.kind === "product" ? 0 : null);
    setCustomMinutes("");
    if (it.kind === "product" && !parseAmount(amountText, true)) setAmountText("1");
    if (it.kind !== "product") setUnit(it.units[0] ?? "kg");
  };
  const clearItem = () => { setItemKey(null); touchItem(); setAmountText(""); setRemakeMinutes(null); };

  const startAnother = () => {
    setSavedOnce(false); save.reset();
    setTypeId(null); setItemKey(null); setAmountText(""); setUnit(""); setPackKind("pack"); setRemakeMinutes(null);
    setCustomMinutes(""); setPacksText("1"); setStation(null); setStationOther(false);
    setOtherStation(""); setOrderRefs(""); setNote(""); setSearch(""); setItemDirty(true);
  };

  const title = editing ? "Edit defect / waste" : REPORT_DEFECT_LABEL;
  const step = (delta: number) => {
    const cur = parseAmount(amountText, true) ?? 0;
    setAmountText(String(Math.max(1, cur + delta))); touchItem();
  };

  return (
    <div className="fixed inset-0 z-[150] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-background w-full sm:max-w-2xl rounded-t-3xl sm:rounded-3xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3 border-b border-border">
          <h2 className="text-2xl font-bold">{title}</h2>
          <button onClick={onClose} className="w-11 h-11 rounded-2xl bg-secondary flex items-center justify-center flex-shrink-0" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {savedOnce ? (
          <div className="p-6 space-y-5 overflow-y-auto">
            <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 p-5 flex items-start gap-3">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 flex-shrink-0" />
              <div>
                <p className="text-xl font-bold">Saved</p>
                <p className="text-base text-muted-foreground mt-0.5">
                  {editing ? "The record has been updated." : item ? `On record${cost?.totalCost != null ? ` — ${gbpText(cost.totalCost)} lost` : ""}. It counts on Defects & waste and in the day's efficiency.` : "The defect is on record and counts in the Defects KPI."}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {!editing && (
                <button onClick={startAnother} className="h-14 rounded-2xl border-2 border-border text-lg font-bold hover:bg-secondary/50 transition-colors">
                  Report another
                </button>
              )}
              <button onClick={onClose} className={cn("h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold", editing && "sm:col-span-2")}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
              <p className="text-base text-muted-foreground">
                Anything binned or not fit to go out — an ingredient, a sub-recipe or finished packs. Wonkies and dog bins are counted at the stations already — no need to add them here.
              </p>

              {/* ── What was it? ── */}
              <section className="space-y-2">
                <h3 className="text-lg font-bold">What was it?</h3>
                {item ? (
                  <div className="flex items-center gap-3 rounded-2xl border-2 border-primary bg-primary/5 p-3">
                    <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-bold", KIND_CHIP[item.kind])}>{KIND_LABEL[item.kind]}</span>
                    <span className="flex-1 min-w-0 text-lg font-bold leading-tight">{item.name}</span>
                    <button type="button" onClick={clearItem} className="w-11 h-11 rounded-xl hover:bg-primary/10 flex items-center justify-center shrink-0" aria-label={`Remove ${item.name}`}>
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                ) : (
                  <div>
                    <div className="relative">
                      <Search className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter" && matches[0]) { e.preventDefault(); chooseItem(matches[0]); }
                        }}
                        placeholder="Start typing — any ingredient, sub-recipe or product"
                        aria-label="Search for what was wasted"
                        className="w-full h-14 pl-11 pr-4 rounded-2xl border-2 border-border bg-card text-lg focus:outline-none focus:border-primary"
                      />
                    </div>
                    {itemsQ.isLoading && search.trim() && <Loader2 className="mt-2 w-5 h-5 animate-spin text-muted-foreground" />}
                    {itemsQ.isError && <p className="mt-1 text-destructive">Couldn't load the list — {(itemsQ.error as Error).message}</p>}
                    {matches.length > 0 && (
                      <ul className="mt-2 rounded-2xl border-2 border-border bg-card overflow-hidden max-h-72 overflow-y-auto divide-y divide-border">
                        {matches.map(it => (
                          <li key={it.key}>
                            <button type="button" onClick={() => chooseItem(it)} className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-secondary/60 min-h-[56px]">
                              <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-bold", KIND_CHIP[it.kind])}>{KIND_LABEL[it.kind]}</span>
                              <span className="flex-1 min-w-0 text-base font-semibold">{it.name}</span>
                              {it.detail && <span className="hidden sm:block shrink-0 text-sm text-muted-foreground truncate max-w-[10rem]">{it.detail}</span>}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {search.trim() && matches.length === 0 && itemsQ.data && (
                      <p className="mt-1 text-sm text-muted-foreground">Nothing matches “{search.trim()}”.</p>
                    )}
                    {!search.trim() && <p className="mt-1 text-sm text-muted-foreground">Nothing to name (a mislabel, a wrong item in an order)? Leave this and just say how many packs below.</p>}
                  </div>
                )}
              </section>

              {/* ── How much? ── */}
              <section className="space-y-2">
                <h3 className="text-lg font-bold">How much?</h3>
                {item && isProduct ? (
                  <div className="space-y-3">
                    {item.packKinds.length > 1 && (
                      <div className="flex flex-wrap gap-2">
                        {item.packKinds.map(p => (
                          <button key={p.kind} type="button" onClick={() => { setPackKind(p.kind); touchItem(); }} aria-pressed={packKind === p.kind}
                            className={cn("h-12 px-5 rounded-2xl border-2 text-base font-bold", packKind === p.kind ? "border-primary bg-primary/10" : "border-border bg-card")}>
                            {p.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => step(-1)} className="w-14 h-14 rounded-2xl border-2 border-border bg-card flex items-center justify-center" aria-label="One fewer">
                        <Minus className="w-5 h-5" />
                      </button>
                      <input inputMode="numeric" value={amountText} onChange={e => { setAmountText(e.target.value.replace(/[^\d]/g, "")); touchItem(); }} aria-label="How many"
                        className={cn("w-24 h-14 rounded-2xl border-2 bg-card text-center text-2xl font-bold tabular-nums", amount != null ? "border-border" : "border-destructive")} />
                      <button type="button" onClick={() => step(1)} className="w-14 h-14 rounded-2xl border-2 border-border bg-card flex items-center justify-center" aria-label="One more">
                        <Plus className="w-5 h-5" />
                      </button>
                      <span className="text-lg font-semibold">× {item.packKinds.find(p => p.kind === packKind)?.label ?? "pack"}</span>
                    </div>
                  </div>
                ) : item ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input inputMode="decimal" value={amountText} onChange={e => { setAmountText(e.target.value.replace(/[^\d.,]/g, "")); touchItem(); }}
                      placeholder="e.g. 2.3" aria-label="Amount"
                      className={cn("w-36 h-14 rounded-2xl border-2 bg-card px-4 text-2xl font-bold tabular-nums", amountText === "" || amount != null ? "border-border" : "border-destructive")} />
                    <div className="flex gap-2">
                      {item.units.map(u => (
                        <button key={u} type="button" onClick={() => { setUnit(u); touchItem(); }} aria-pressed={unit.toLowerCase() === u.toLowerCase()}
                          className={cn("h-14 min-w-[64px] px-4 rounded-2xl border-2 text-lg font-bold", unit.toLowerCase() === u.toLowerCase() ? "border-primary bg-primary/10" : "border-border bg-card")}>
                          {u}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setPacksText(String(Math.max(1, (packsValid ? packs : 1) - 1)))}
                      className="w-14 h-14 rounded-2xl border-2 border-border bg-card flex items-center justify-center" aria-label="One fewer pack">
                      <Minus className="w-5 h-5" />
                    </button>
                    <input inputMode="numeric" value={packsText} onChange={e => setPacksText(e.target.value.replace(/[^\d]/g, ""))} aria-label="Packs"
                      className={cn("w-24 h-14 rounded-2xl border-2 bg-card text-center text-2xl font-bold tabular-nums", packsValid ? "border-border" : "border-destructive")} />
                    <button type="button" onClick={() => setPacksText(String((packsValid ? packs : 0) + 1))}
                      className="w-14 h-14 rounded-2xl border-2 border-border bg-card flex items-center justify-center" aria-label="One more pack">
                      <Plus className="w-5 h-5" />
                    </button>
                    <span className="text-lg font-semibold">packs</span>
                  </div>
                )}
                {item && amountText !== "" && amount == null && <p className="text-sm text-destructive">{isProduct ? "A whole number, 1 or more." : "A number more than 0, e.g. 2.3."}</p>}
              </section>

              {/* ── Why ── */}
              <section className="space-y-2">
                <h3 className="text-lg font-bold">What went wrong?</h3>
                {typesQ.isLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
                {typesQ.isError && <p className="text-destructive">Couldn't load the reasons — {(typesQ.error as Error).message}</p>}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {types.map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTypeId(t.id)}
                      aria-pressed={typeId === t.id}
                      className={cn(
                        "min-h-[64px] rounded-2xl border-2 px-4 py-3 text-left text-lg font-bold transition-colors",
                        typeId === t.id ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50",
                      )}
                    >
                      {t.name}{!t.active && <span className="block text-sm font-normal text-muted-foreground">No longer in use</span>}
                    </button>
                  ))}
                </div>
              </section>

              {/* ── When ── */}
              <section className="space-y-2">
                <h3 className="text-lg font-bold">When did it happen?</h3>
                <div className="flex flex-wrap items-center gap-2">
                  {[{ label: "Today", d: today }, { label: "Yesterday", d: addDays(today, -1) }].map(c => (
                    <button
                      key={c.label}
                      type="button"
                      onClick={() => setOccurredOn(c.d)}
                      aria-pressed={occurredOn === c.d}
                      className={cn(
                        "h-12 px-5 rounded-2xl border-2 text-base font-bold",
                        occurredOn === c.d ? "border-primary bg-primary/10" : "border-border bg-card",
                      )}
                    >{c.label}</button>
                  ))}
                  <input
                    type="date"
                    value={occurredOn}
                    max={today}
                    onChange={e => setOccurredOn(e.target.value)}
                    aria-label="Day it happened"
                    className="h-12 px-3 rounded-2xl border-2 border-border bg-card text-base"
                  />
                </div>
                {!dateValid && <p className="text-sm text-destructive">Pick today or an earlier day.</p>}
                {dateValid && occurredOn !== today && <p className="text-sm text-muted-foreground">{dayText(occurredOn, today)}</p>}
              </section>

              {/* ── Remake time + live cost ── */}
              {item && (
                <section className="space-y-2">
                  <h3 className="text-lg font-bold">How long to make it again?</h3>
                  <div className="flex flex-wrap gap-2">
                    {cost?.suggestedMinutes != null && (
                      <button type="button" onClick={() => { setRemakeMinutes(null); setCustomMinutes(""); touchItem(); }} aria-pressed={standardActive}
                        className={cn("h-12 px-4 rounded-2xl border-2 text-base font-bold", standardActive ? "border-primary bg-primary/10" : "border-border bg-card")}>
                        Standard · {minutesText(cost.suggestedMinutes)}
                      </button>
                    )}
                    <button type="button" onClick={() => { setRemakeMinutes(0); setCustomMinutes(""); touchItem(); }} aria-pressed={!standardActive && shownMinutes === 0}
                      className={cn("h-12 px-4 rounded-2xl border-2 text-base font-bold", !standardActive && shownMinutes === 0 ? "border-primary bg-primary/10" : "border-border bg-card")}>
                      {isProduct ? "Won't be remade" : "No time"}
                    </button>
                    {REMAKE_CHOICES.map(m => (
                      <button key={m} type="button" onClick={() => { setRemakeMinutes(m); setCustomMinutes(""); touchItem(); }} aria-pressed={!standardActive && shownMinutes === m}
                        className={cn("h-12 min-w-[72px] px-4 rounded-2xl border-2 text-base font-bold", !standardActive && shownMinutes === m ? "border-primary bg-primary/10" : "border-border bg-card")}>
                        {m} min
                      </button>
                    ))}
                    <label className={cn("h-12 flex items-center gap-2 px-3 rounded-2xl border-2 bg-card", customMinutes ? "border-primary" : "border-border")}>
                      <input inputMode="numeric" value={customMinutes} placeholder="Other"
                        onChange={e => {
                          const t = e.target.value.replace(/[^\d]/g, "").slice(0, 4);
                          setCustomMinutes(t); touchItem();
                          const n = Number(t);
                          if (t && Number.isInteger(n) && n <= 1440) setRemakeMinutes(n);
                        }}
                        aria-label="Other number of minutes" className="w-16 bg-transparent text-base font-bold focus:outline-none" />
                      <span className="text-base text-muted-foreground">min</span>
                    </label>
                  </div>
                  <CostCard
                    loading={costPending && !cost}
                    refreshing={costPending && Boolean(cost)}
                    error={costInput && costQ.isError ? (costQ.error as Error).message : null}
                    waiting={!costInput}
                    isProduct={isProduct}
                    cost={cost ?? null}
                  />
                  {legacy && !itemDirty && (
                    <p className="text-sm text-muted-foreground">Recorded before costs were added — it stays without a cost unless you change the item, amount or time.</p>
                  )}
                </section>
              )}

              {/* ── Where ── */}
              <section className="space-y-2">
                <h3 className="text-lg font-bold">Where did it go wrong? <span className="text-base font-normal text-muted-foreground">— if you know</span></h3>
                <div className="flex flex-wrap gap-2">
                  {STATIONS.map(s => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => { setStationOther(false); setStation(cur => (cur === s.key ? null : s.key)); }}
                      aria-pressed={!stationOther && station === s.key}
                      className={cn(
                        "h-12 px-4 rounded-2xl border-2 text-base font-semibold",
                        !stationOther && station === s.key ? "border-primary bg-primary/10" : "border-border bg-card",
                      )}
                    >{s.label}</button>
                  ))}
                  <button
                    type="button"
                    onClick={() => { setStationOther(o => !o); setStation(null); }}
                    aria-pressed={stationOther}
                    className={cn("h-12 px-4 rounded-2xl border-2 text-base font-semibold", stationOther ? "border-primary bg-primary/10" : "border-border bg-card")}
                  >Somewhere else</button>
                </div>
                {stationOther && (
                  <input
                    value={otherStation}
                    onChange={e => setOtherStation(e.target.value)}
                    maxLength={60}
                    placeholder="Where?"
                    className="w-full h-12 px-4 rounded-2xl border-2 border-border bg-card text-base"
                  />
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-lg font-bold">Order numbers <span className="text-base font-normal text-muted-foreground">— optional</span></h3>
                <input
                  value={orderRefs}
                  onChange={e => setOrderRefs(e.target.value)}
                  maxLength={300}
                  placeholder="e.g. #136117, #136112"
                  className="w-full h-12 px-4 rounded-2xl border-2 border-border bg-card text-base"
                />
              </section>

              <section className="space-y-2">
                <h3 className="text-lg font-bold">What happened? <span className="text-base font-normal text-muted-foreground">— optional</span></h3>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder="e.g. Left out at ambient overnight — binned in the morning"
                  className="w-full px-4 py-3 rounded-2xl border-2 border-border bg-card text-base resize-y"
                />
              </section>
            </div>

            <div className="border-t border-border px-5 py-4 space-y-2">
              {save.isError && (
                <p className="flex items-start gap-2 text-base font-semibold text-destructive">
                  <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                  Not saved — {(save.error as Error).message}
                </p>
              )}
              {typeId == null && <p className="text-sm text-muted-foreground">Choose what went wrong to save.</p>}
              {typeId != null && !itemValid && <p className="text-sm text-muted-foreground">Say how much to save.</p>}
              <button
                type="button"
                onClick={submit}
                disabled={!canSave}
                className="w-full h-14 rounded-2xl bg-primary text-primary-foreground text-xl font-bold flex items-center justify-center gap-3 disabled:opacity-50 active:scale-[0.99] transition-all"
              >
                {save.isPending ? <><Loader2 className="w-6 h-6 animate-spin" /> Saving…</> : editing ? "Save changes" : "Save"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Ingredients £ · Time £ · Total £, live as the form changes. */
function CostCard({ loading, refreshing, error, waiting, isProduct, cost }: {
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  waiting: boolean;
  isProduct: boolean;
  cost: WasteCost | null;
}) {
  return (
    <div className="mt-2 rounded-2xl border-2 border-border bg-card p-4" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <p className="text-base font-bold">What it cost</p>
        {(loading || refreshing) && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>
      {waiting ? (
        <p className="mt-1 text-base text-muted-foreground">Say how much to see the cost.</p>
      ) : error ? (
        <p className="mt-1 text-base text-destructive">{error}</p>
      ) : loading || !cost ? (
        <p className="mt-1 text-base text-muted-foreground">Working it out…</p>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-secondary/60 p-2">
              <p className="text-xs font-semibold text-muted-foreground">{isProduct ? "Ingredients & packaging" : "Ingredients"}</p>
              <p className="text-xl font-extrabold tabular-nums">{gbpText(cost.ingredientCost)}</p>
            </div>
            <div className="rounded-xl bg-secondary/60 p-2">
              <p className="text-xs font-semibold text-muted-foreground">Time ({minutesText(cost.remakeMinutes)})</p>
              <p className="text-xl font-extrabold tabular-nums">{gbpText(cost.timeCost)}</p>
            </div>
            <div className="rounded-xl bg-rose-100 dark:bg-rose-900/40 p-2">
              <p className="text-xs font-semibold text-rose-900 dark:text-rose-100">Total</p>
              <p className="text-xl font-extrabold tabular-nums text-rose-900 dark:text-rose-100">{gbpText(cost.totalCost)}</p>
            </div>
          </div>
          {cost.ingredientCost == null && <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">This item has no price on file, so its ingredients can't be costed.</p>}
          {cost.remakeMinutes > 0 && cost.hourlyRate != null && (
            <p className="mt-2 text-sm text-muted-foreground">Time is priced at the team's average production labour cost.</p>
          )}
          {cost.remakeMinutes > 0 && cost.hourlyRate == null && <p className="mt-2 text-sm text-muted-foreground">No labour figures yet to price the time.</p>}
        </>
      )}
    </div>
  );
}
