/**
 * Cook and chill (issue #244, Objective D) — for sub-recipes that are cooked
 * and must be cooled, e.g. garlic confit and garlic butter. Which ones is the
 * "Cook and chill" tick on the sub-recipe, never a name in code.
 *
 *   Prep      record the core temperature at cook-out (the Mac Cheese
 *             station's FSA slider row: 70°C/2 min = 75°C/30 s, never a
 *             fixed 75°C), then tap "Into blast chiller".
 *   Wrapping  tick "Chilling finished" when it comes out (Prep can too).
 *
 * Cooling is the same start/finish shape as the calzone chill timer, so both
 * land in one cooling log in Analytics -> HACCP. Server: /api/cook-chill.
 * Hidden on Wrapping when nothing is chilling, and on Prep when no
 * sub-recipe is ticked for cook and chill.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Flame, Loader2, Snowflake, ThermometerSnowflake, X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { formatHold, defaultHoldSeconds } from "@/lib/cook-standards";
import { recordsForStation, cookMet, minutesText, clockText, COOK_CHILL_BOARD_KEY, COOK_CHILL_SUB_RECIPES_KEY, type CookChillRecordView } from "@/lib/cook-chill-view";
import { useNow } from "@/hooks/use-now";
import { TempHoldCheckRow } from "@/pages/station/stations/macaroni-cheese-station";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api/cook-chill${path}`, {
    credentials: "include",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) {
    if (body.code === "PIN_REQUIRED") throw new Error("Enter your PIN, then tap again");
    throw new Error(body.error ?? `Couldn't save (${res.status})`);
  }
  return body;
}

export function CookChillCard({ station, planId }: { station: "prep" | "wrapping"; planId: number | null }) {
  const qc = useQueryClient();
  const now = useNow(30_000);
  const board = useQuery({
    queryKey: COOK_CHILL_BOARD_KEY,
    queryFn: () => api<{ records: CookChillRecordView[]; chillTargetTempC: number }>("/board"),
    refetchInterval: 15_000,
  });
  const subRecipes = useQuery({
    queryKey: COOK_CHILL_SUB_RECIPES_KEY,
    queryFn: () => api<{ subRecipes: Array<{ id: number; name: string }> }>("/sub-recipes"),
    enabled: station === "prep",
    staleTime: 60_000,
  });

  const [cooking, setCooking] = useState<{ id: number; name: string } | null>(null);
  const [entry, setEntry] = useState<{ tempC: number; holdSeconds: number } | undefined>(undefined);

  const refresh = () => void qc.invalidateQueries({ queryKey: COOK_CHILL_BOARD_KEY });
  const onError = (err: unknown) => toast({ title: "Not saved", description: err instanceof Error ? err.message : String(err), variant: "destructive" });

  const recordCook = useMutation({
    mutationFn: (v: { subRecipeId: number; tempC: number; holdSeconds: number }) => api("/records", {
      method: "POST",
      body: JSON.stringify({ subRecipeId: v.subRecipeId, planId, cookTempC: v.tempC, heldForSeconds: Math.max(1, Math.round(v.holdSeconds)) }),
    }),
    onSuccess: () => {
      toast({ title: "Cook temperature recorded", description: `${cooking?.name ?? "Sub-recipe"} — now tap "Into blast chiller" when it goes in.` });
      setCooking(null);
      setEntry(undefined);
      refresh();
    },
    onError,
  });
  const chillStart = useMutation({
    mutationFn: (id: number) => api(`/records/${id}/chill-start`, { method: "POST", body: "{}" }),
    onSuccess: refresh,
    onError,
  });
  const chillEnd = useMutation({
    mutationFn: (id: number) => api(`/records/${id}/chill-end`, {
      method: "POST",
      body: JSON.stringify({ via: station === "prep" ? "prep_station" : "wrapping_station" }),
    }),
    onSuccess: refresh,
    onError,
  });

  const records = recordsForStation(board.data?.records ?? [], station);
  const flagged = subRecipes.data?.subRecipes ?? [];
  const target = board.data?.chillTargetTempC ?? 4;

  if (station === "wrapping" && records.length === 0) return null;
  if (station === "prep" && flagged.length === 0 && records.length === 0) return null;

  const busyId = (m: { isPending: boolean; variables?: number }) => (m.isPending ? m.variables : undefined);

  return (
    <section className="bg-card border-2 border-cyan-200 dark:border-cyan-900 rounded-2xl p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <ThermometerSnowflake className="w-6 h-6 text-cyan-600" /> Cook and chill
        </h3>
        <span className="text-sm text-muted-foreground">
          {station === "prep"
            ? `Record the core temp at cook-out, then when it goes in the blast chiller (chill to ${target}°C).`
            : `Tick "Chilling finished" when it comes out of the blast chiller (chilled to ${target}°C).`}
        </span>
      </div>

      {board.isError && <p className="text-sm text-destructive">Couldn't load — {(board.error as Error).message}</p>}

      {station === "prep" && !cooking && flagged.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {flagged.map(sr => (
            <button
              key={sr.id}
              type="button"
              onClick={() => { setCooking(sr); setEntry(undefined); }}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-red-300 bg-red-50 dark:bg-red-950/20 text-base font-semibold hover:bg-red-100 dark:hover:bg-red-950/40"
            >
              <Flame className="w-5 h-5 text-red-500" /> Record a cook — {sr.name}
            </button>
          ))}
        </div>
      )}

      {station === "prep" && cooking && (
        <div className="rounded-xl border border-border p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-base font-bold">{cooking.name} — core temperature at cook-out</p>
            <button
              type="button"
              onClick={() => { setCooking(null); setEntry(undefined); }}
              className="p-2 rounded-lg hover:bg-secondary"
              aria-label="Cancel"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <TempHoldCheckRow
            label="Probe the thickest part"
            recordType="cook_chill"
            records={[]}
            entry={entry}
            onEntryChange={setEntry}
            onRecord={() => {
              const e = entry ?? { tempC: 70, holdSeconds: 120 };
              if (defaultHoldSeconds(e.tempC) == null) {
                toast({ title: "Below 60°C", description: "That's under the safe-cook table — keep cooking before recording.", variant: "destructive" });
                return;
              }
              recordCook.mutate({ subRecipeId: cooking.id, tempC: e.tempC, holdSeconds: e.holdSeconds });
            }}
            saving={recordCook.isPending}
          />
        </div>
      )}

      {records.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {records.map(r => (
            <RecordTile
              key={r.id}
              r={r}
              now={now}
              station={station}
              startBusy={busyId(chillStart) === r.id}
              endBusy={busyId(chillEnd) === r.id}
              onStart={() => chillStart.mutate(r.id)}
              onEnd={() => chillEnd.mutate(r.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function RecordTile({ r, now, station, startBusy, endBusy, onStart, onEnd }: {
  r: CookChillRecordView;
  now: Date;
  station: "prep" | "wrapping";
  startBusy: boolean;
  endBusy: boolean;
  onStart: () => void;
  onEnd: () => void;
}) {
  const met = cookMet(r);
  return (
    <div className={cn(
      "rounded-xl border-2 p-4 space-y-2",
      r.stage === "chilled" ? "border-emerald-300 bg-emerald-50/40 dark:bg-emerald-950/10"
        : r.stage === "chilling" ? "border-cyan-300 bg-cyan-50/40 dark:bg-cyan-950/10"
        : "border-amber-300 bg-amber-50/40 dark:bg-amber-950/10",
    )}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-lg font-bold leading-tight">{r.subRecipeName}</p>
        {r.stage === "chilled" && <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" aria-label="Chilled" />}
      </div>
      <p className={cn("text-sm font-semibold flex items-center gap-1", met ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>
        {!met && <AlertTriangle className="w-4 h-4" />}
        Cooked {r.cookTempC}°C for {formatHold(r.cookHeldForSeconds)} {met ? "✓" : "(below the safe-cook table)"} · {r.cookedByName} {clockText(r.cookedAt)}
      </p>

      {r.stage === "cooked" && (
        station === "prep" ? (
          <button
            type="button"
            onClick={onStart}
            disabled={startBusy}
            className="w-full flex items-center justify-center gap-2 px-4 py-4 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white text-lg font-semibold disabled:opacity-50"
          >
            {startBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Snowflake className="w-5 h-5" />}
            Into blast chiller
          </button>
        ) : null
      )}

      {r.stage === "chilling" && r.chillStartAt && (
        <>
          <p className="text-base">
            In the blast chiller since <strong>{clockText(r.chillStartAt)}</strong> ({minutesText(r.chillStartAt, now)})
            {r.chillStartByName ? ` · ${r.chillStartByName}` : ""}
          </p>
          <button
            type="button"
            onClick={onEnd}
            disabled={endBusy}
            className="w-full flex items-center justify-center gap-2 px-4 py-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-lg font-semibold disabled:opacity-50"
          >
            {endBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
            Chilling finished
          </button>
        </>
      )}

      {r.stage === "chilled" && r.chillStartAt && r.chillEndAt && (
        <p className="text-base">
          Chilled {clockText(r.chillStartAt)} → {clockText(r.chillEndAt)} ({minutesText(r.chillStartAt, r.chillEndAt)})
          {r.chillEndByName ? ` · ${r.chillEndByName}` : ""}
        </p>
      )}
    </div>
  );
}
