// "Record defect" (Graeme, 2026-10-01; Objective E). Opened from the
// quick-actions dock anywhere in the app and from the Defects page; the same
// form edits an existing record.
//
// A defect is any process not carried out correctly that ends in product not
// acceptable for normal despatch. Wonkies and dog bins are already counted
// from the station taps, so they are NOT offered here — this is for
// everything else, usually recorded after the fact (hence the date picker).

import { useMemo, useState } from "react";
import { CheckCircle2, Loader2, Minus, Plus, Search, X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATIONS } from "@/pages/station/shared/constants";
import { londonDay } from "@/lib/day-rollover";
import { dayText, type DefectRecord } from "@/lib/defects-view";
import { useDefectRecipeOptions, useDefectTypes, useSaveDefect, type DefectInput } from "@/hooks/use-defects";

/** Station key → name, for showing where a defect went wrong. */
export const DEFECT_STATION_LABELS: Record<string, string> = Object.fromEntries(STATIONS.map(s => [s.key, s.label]));

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
  // Mounted fresh on every open, so the form always starts clean.
  return <DefectForm onClose={onClose} editing={editing ?? null} />;
}

function DefectForm({ onClose, editing }: { onClose: () => void; editing: DefectRecord | null }) {
  const today = londonDay(Date.now());
  const typesQ = useDefectTypes();
  const recipesQ = useDefectRecipeOptions();
  const save = useSaveDefect();

  const [typeId, setTypeId] = useState<number | null>(editing?.defectTypeId ?? null);
  const [occurredOn, setOccurredOn] = useState(editing?.occurredOn ?? today);
  const [recipeId, setRecipeId] = useState<number | null>(editing?.recipeId ?? null);
  const [packsText, setPacksText] = useState(String(editing?.packs ?? 1));
  const knownStation = editing?.station ? editing.station in DEFECT_STATION_LABELS : false;
  const [station, setStation] = useState<string | null>(editing?.station && knownStation ? editing.station : null);
  const [otherStation, setOtherStation] = useState(editing?.station && !knownStation ? editing.station : "");
  const [stationOther, setStationOther] = useState(Boolean(editing?.station && !knownStation));
  const [orderRefs, setOrderRefs] = useState(editing?.orderRefs ?? "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [savedOnce, setSavedOnce] = useState(false);
  const [recipeSearch, setRecipeSearch] = useState("");

  const types = useMemo(
    () => (typesQ.data ?? []).filter(t => t.active || t.id === editing?.defectTypeId),
    [typesQ.data, editing?.defectTypeId],
  );
  const recipes = recipesQ.data ?? [];
  const recipeName = recipeId == null ? null : recipes.find(r => r.id === recipeId)?.name ?? editing?.recipeName ?? `Recipe ${recipeId}`;
  const matches = useMemo(() => {
    const needle = recipeSearch.trim().toLowerCase();
    if (!needle) return [];
    return recipes.filter(r => r.name.toLowerCase().includes(needle)).slice(0, 8);
  }, [recipeSearch, recipes]);

  const packs = Number(packsText);
  const packsValid = Number.isInteger(packs) && packs >= 1 && packs <= 100000;
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(occurredOn) && occurredOn <= today;
  const canSave = typeId != null && packsValid && dateValid && !save.isPending;

  const submit = () => {
    if (!canSave || typeId == null) return;
    const input: DefectInput = {
      occurredOn,
      defectTypeId: typeId,
      recipeId,
      packs,
      station: stationOther ? (otherStation.trim() || null) : station,
      orderRefs: orderRefs.trim() || null,
      note: note.trim() || null,
    };
    save.mutate({ id: editing?.id ?? null, input }, { onSuccess: () => setSavedOnce(true) });
  };

  const startAnother = () => {
    setSavedOnce(false); save.reset();
    setTypeId(null); setRecipeId(null); setPacksText("1"); setStation(null); setStationOther(false);
    setOtherStation(""); setOrderRefs(""); setNote(""); setRecipeSearch("");
  };

  const title = editing ? "Edit defect" : "Record a defect";

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
                  {editing ? "The defect has been updated." : "The defect is on record and counts in the Defects KPI."}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {!editing && (
                <button onClick={startAnother} className="h-14 rounded-2xl border-2 border-border text-lg font-bold hover:bg-secondary/50 transition-colors">
                  Record another
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
                Anything not done right that means product can't go out as normal. Wonkies and dog bins are counted from the stations already — no need to add them here.
              </p>

              <section className="space-y-2">
                <h3 className="text-lg font-bold">What went wrong?</h3>
                {typesQ.isLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
                {typesQ.isError && <p className="text-destructive">Couldn't load the defect types — {(typesQ.error as Error).message}</p>}
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

              <section className="space-y-2">
                <h3 className="text-lg font-bold">Which recipe? <span className="text-base font-normal text-muted-foreground">— if you know</span></h3>
                {recipeName ? (
                  <span className="inline-flex items-center gap-2 pl-4 pr-1.5 py-1.5 rounded-full bg-primary/10 text-base font-semibold">
                    {recipeName}
                    <button type="button" onClick={() => setRecipeId(null)} className="p-1.5 rounded-full hover:bg-primary/20" aria-label={`Remove ${recipeName}`}>
                      <X className="w-4 h-4" />
                    </button>
                  </span>
                ) : (
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={recipeSearch}
                      onChange={e => setRecipeSearch(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter" && matches[0]) { e.preventDefault(); setRecipeId(matches[0].id); setRecipeSearch(""); }
                      }}
                      placeholder="Type any part of the recipe name"
                      className="w-full h-12 pl-10 pr-4 rounded-2xl border-2 border-border bg-card text-base focus:outline-none focus:border-primary"
                    />
                    {matches.length > 0 && (
                      <ul className="mt-1 rounded-2xl border-2 border-border bg-card overflow-hidden">
                        {matches.map(r => (
                          <li key={r.id}>
                            <button
                              type="button"
                              onClick={() => { setRecipeId(r.id); setRecipeSearch(""); }}
                              className="w-full text-left px-4 py-3 text-base hover:bg-secondary/60"
                            >
                              {r.name}{r.category && <span className="text-sm text-muted-foreground"> · {r.category}</span>}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {recipeSearch.trim() && matches.length === 0 && !recipesQ.isLoading && (
                      <p className="mt-1 text-sm text-muted-foreground">No recipe matches “{recipeSearch.trim()}”.</p>
                    )}
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-lg font-bold">How many packs?</h3>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setPacksText(String(Math.max(1, (packsValid ? packs : 1) - 1)))}
                    className="w-14 h-14 rounded-2xl border-2 border-border bg-card flex items-center justify-center" aria-label="One fewer pack">
                    <Minus className="w-5 h-5" />
                  </button>
                  <input
                    inputMode="numeric"
                    value={packsText}
                    onChange={e => setPacksText(e.target.value.replace(/[^\d]/g, ""))}
                    aria-label="Packs"
                    className={cn("w-24 h-14 rounded-2xl border-2 bg-card text-center text-2xl font-bold tabular-nums", packsValid ? "border-border" : "border-destructive")}
                  />
                  <button type="button" onClick={() => setPacksText(String((packsValid ? packs : 0) + 1))}
                    className="w-14 h-14 rounded-2xl border-2 border-border bg-card flex items-center justify-center" aria-label="One more pack">
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
                {!packsValid && <p className="text-sm text-destructive">At least 1 pack.</p>}
              </section>

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
                <h3 className="text-lg font-bold">Anything else? <span className="text-base font-normal text-muted-foreground">— optional</span></h3>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder="What happened, and what was done about it"
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
              <button
                type="button"
                onClick={submit}
                disabled={!canSave}
                className="w-full h-14 rounded-2xl bg-primary text-primary-foreground text-xl font-bold flex items-center justify-center gap-3 disabled:opacity-50 active:scale-[0.99] transition-all"
              >
                {save.isPending ? <><Loader2 className="w-6 h-6 animate-spin" /> Saving…</> : editing ? "Save changes" : "Save defect"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
