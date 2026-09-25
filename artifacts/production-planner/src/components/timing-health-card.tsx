import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getGetRecipeQueryKey, getListIngredientsQueryKey, getListRecipesQueryKey } from "@workspace/api-client-react";
import { AlertTriangle, Beef, Check, CheckCircle2, ChefHat, Clock, Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { ingredientTimingHref } from "@/components/timing-flag";

/**
 * "Timing data" card on the Recipes page (Graeme, 2026-09-25): everything the
 * day schedule and the meat "start cooking by" times need that is missing —
 * or set but no longer matching the floor — each with a suggested value from
 * real history and a one-tap "Use suggested". Nothing is ever filled in
 * automatically; every save is a person's tap, with a visible save state.
 *
 * Server: GET /api/timing-health (rules in api-server lib/timing-health.ts and
 * lib/timing-suggestions.ts). Saves: PUT /api/recipes/:id/build-time and
 * PUT /api/ingredients/:id/meat-timing — single-field endpoints, because the
 * full recipe/ingredient PUTs replace every field.
 */

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Suggestion { value: number; samples: number; excluded: number }
interface RecipeIssue {
  recipeId: number;
  name: string;
  category: string | null;
  kind: "missing" | "check";
  currentSeconds: number | null;
  timesPlanned: number;
  suggestion: Suggestion | null;
}
interface MeatIssue {
  ingredientId: number;
  name: string;
  usedBy: string[];
  kind: "missing" | "check";
  missing: "cook" | "process" | "both" | null;
  cookMinutes: number | null;
  processMinutes: number | null;
  cookSuggestion: Suggestion | null;
}
interface TimingHealth {
  buildWindowDays: number;
  cookWindowDays: number;
  recipes: RecipeIssue[];
  meats: MeatIssue[];
  notPlannedRecently: Array<{ recipeId: number; name: string }>;
}

type SaveState = { status: "idle" } | { status: "saving" } | { status: "saved" } | { status: "error"; message: string };

/** 352 → "5 min 52 s". */
export function formatBuildSeconds(seconds: number): string {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r} s`;
  return r === 0 ? `${m} min` : `${m} min ${r} s`;
}

function weeks(days: number): string {
  return `${Math.round(days / 7)} weeks`;
}

async function putJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}${url}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || `Save failed (${res.status})`);
  return json;
}

function SaveBadge({ state }: { state: SaveState }) {
  if (state.status === "saving") return <span className="inline-flex items-center gap-1 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Saving…</span>;
  if (state.status === "saved") return <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600"><Check className="w-4 h-4" /> Saved</span>;
  if (state.status === "error") return <span className="inline-flex items-center gap-1 text-sm font-medium text-destructive"><AlertTriangle className="w-4 h-4" /> Not saved — {state.message}</span>;
  return null;
}

/** One save pipeline per card: mutation + visible state + cache refresh. */
function useTimingSave(onSaved: (summary: string) => void) {
  const qc = useQueryClient();
  const [state, setState] = useState<SaveState>({ status: "idle" });
  const mutation = useMutation({
    mutationFn: (v: { url: string; body: unknown; summary: string; recipeId?: number }) => putJson(v.url, v.body),
    onMutate: () => setState({ status: "saving" }),
    onSuccess: (_d, v) => {
      setState({ status: "saved" });
      onSaved(v.summary);
      qc.invalidateQueries({ queryKey: ["timing-health"] });
      qc.invalidateQueries({ queryKey: ["plan-schedule"] });
      qc.invalidateQueries({ queryKey: getListRecipesQueryKey() });
      qc.invalidateQueries({ queryKey: getListIngredientsQueryKey() });
      if (v.recipeId != null) qc.invalidateQueries({ queryKey: getGetRecipeQueryKey(v.recipeId) });
    },
    onError: (err: Error) => setState({ status: "error", message: err.message }),
  });
  return { state, save: mutation.mutate, busy: mutation.isPending };
}

/** Number field that saves on blur / Enter — for values history can't suggest. */
function AutosaveNumber({ label, unit, placeholder, busy, onCommit }: {
  label: string;
  unit: string;
  placeholder?: string;
  busy: boolean;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const commit = () => {
    if (draft.trim() === "") { setInvalid(false); return; }
    const n = Number(draft);
    if (!Number.isFinite(n) || n <= 0) { setInvalid(true); return; }
    setInvalid(false);
    onCommit(n);
  };
  return (
    <label className="flex items-center gap-2 text-sm flex-wrap">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        value={draft}
        placeholder={placeholder}
        disabled={busy}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className={cn(
          "w-24 px-3 py-2 rounded-lg border bg-background text-base tabular-nums",
          invalid ? "border-destructive" : "border-border",
        )}
      />
      <span className="text-muted-foreground">{unit}</span>
      {invalid && <span className="text-destructive text-xs">Has to be a number above zero</span>}
    </label>
  );
}

function RecipeCard({ issue, windowDays, onEdit, onSaved }: {
  issue: RecipeIssue;
  windowDays: number;
  onEdit: (id: number) => void;
  onSaved: (summary: string) => void;
}) {
  const { state, save, busy } = useTimingSave(onSaved);
  const saveSeconds = (seconds: number) => save({
    url: `/api/recipes/${issue.recipeId}/build-time`,
    body: { targetBuildSeconds: seconds },
    summary: `${issue.name} — build time ${formatBuildSeconds(seconds)} a batch`,
    recipeId: issue.recipeId,
  });
  const s = issue.suggestion;
  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onEdit(issue.recipeId)}
            className="font-semibold text-lg text-left underline-offset-2 hover:underline"
            title="Open the recipe to set its build time"
          >
            {issue.name}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {issue.kind === "missing" ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                <AlertTriangle className="w-3.5 h-3.5" /> No build time — schedule is guessing
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200">
                Set to {formatBuildSeconds(issue.currentSeconds ?? 0)} — the floor says otherwise
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {issue.timesPlanned > 0 ? `On ${issue.timesPlanned} plan${issue.timesPlanned === 1 ? "" : "s"} in ${weeks(windowDays)}` : "Not planned lately"}
            </span>
          </div>
        </div>
        <SaveBadge state={state} />
      </div>

      {s ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Real builds: <span className="font-semibold text-foreground">{formatBuildSeconds(s.value)} a batch</span> per builder
            {" "}— the middle of {s.samples} batches in the last {weeks(windowDays)}
            {s.excluded > 0 && <> ({s.excluded} left out: breaks, double-taps, one-offs)</>}.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => saveSeconds(s.value)}
            className="min-h-11 px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50"
          >
            Use suggested: {formatBuildSeconds(s.value)}
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Not enough real builds to suggest a time (needs 5 clean batches). Time one batch and enter it.
        </p>
      )}
      <AutosaveNumber
        label={s ? "Or enter your own:" : "Build time:"}
        unit="min a batch (one builder)"
        placeholder={s ? String(Math.round((s.value / 60) * 10) / 10) : "e.g. 5"}
        busy={busy}
        onCommit={min => saveSeconds(Math.round(min * 60))}
      />
    </div>
  );
}

function MeatCard({ issue, windowDays, onSaved }: {
  issue: MeatIssue;
  windowDays: number;
  onSaved: (summary: string) => void;
}) {
  const { state, save, busy } = useTimingSave(onSaved);
  const saveCook = (min: number) => save({
    url: `/api/ingredients/${issue.ingredientId}/meat-timing`,
    body: { estimatedCookTimeMin: Math.round(min) },
    summary: `${issue.name} — cook time ${Math.round(min)} min`,
  });
  const saveProcess = (min: number) => save({
    url: `/api/ingredients/${issue.ingredientId}/meat-timing`,
    body: { meatProcessMinutes: Math.round(min) },
    summary: `${issue.name} — process time ${Math.round(min)} min`,
  });
  const needsCook = issue.missing === "cook" || issue.missing === "both" || issue.kind === "check";
  const needsProcess = issue.missing === "process" || issue.missing === "both";
  const badge = issue.kind === "check"
    ? `Cook time set to ${issue.cookMinutes} min — the ovens say otherwise`
    : issue.missing === "both" ? "No cook or process time — no start time on the day"
    : issue.missing === "cook" ? "No cook time — start time is too late"
    : "No process time — start time may be too late";
  const s = issue.cookSuggestion;
  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={ingredientTimingHref(issue.ingredientId)} className="font-semibold text-lg underline-offset-2 hover:underline">
            {issue.name}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className={cn(
              "inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full",
              issue.kind === "check"
                ? "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200"
                : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
            )}>
              {issue.kind === "missing" && <AlertTriangle className="w-3.5 h-3.5" />} {badge}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Used in {issue.usedBy.join(", ")}</p>
        </div>
        <SaveBadge state={state} />
      </div>

      {(issue.cookMinutes != null || issue.processMinutes != null) && (
        <p className="text-sm text-muted-foreground">
          Set now: cook {issue.cookMinutes != null ? `${issue.cookMinutes} min` : "—"} · process {issue.processMinutes != null ? `${issue.processMinutes} min` : "—"}
        </p>
      )}

      {needsCook && (
        <div className="space-y-2">
          {s ? (
            <>
              <p className="text-sm text-muted-foreground">
                Oven history: <span className="font-semibold text-foreground">{s.value} min</span> oven-in to oven-out
                {" "}— the middle of {s.samples} trays in the last {weeks(windowDays)}
                {s.excluded > 0 && <> ({s.excluded} left out: logged in and out at once, or one-offs)</>}.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => saveCook(s.value)}
                className="min-h-11 px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50"
              >
                Use suggested cook time: {s.value} min
              </button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No usable oven history to suggest a cook time — trays weren&rsquo;t logged in and out as they happened.</p>
          )}
          <AutosaveNumber label={s ? "Or enter cook time:" : "Cook time:"} unit="min" placeholder={s ? String(s.value) : undefined} busy={busy} onCommit={saveCook} />
        </div>
      )}

      {needsProcess && (
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            Process time (pull, shred, cool, portion after cooking) isn&rsquo;t recorded anywhere, so it can&rsquo;t be worked out — enter it.
          </p>
          <AutosaveNumber label="Process time:" unit="min" busy={busy} onCommit={saveProcess} />
        </div>
      )}
    </div>
  );
}

export function TimingHealthCard({ onEditRecipe }: { onEditRecipe: (recipeId: number) => void }) {
  const { state: authState } = useAuth();
  const canManage = authState.status === "authenticated" &&
    (authState.user.role === "admin" || authState.user.role === "manager");
  const [justSaved, setJustSaved] = useState<string[]>([]);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<TimingHealth>({
    queryKey: ["timing-health"],
    enabled: canManage,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/timing-health`, { credentials: "include" });
      if (!res.ok) throw new Error(`Couldn't load timing data (${res.status})`);
      return res.json();
    },
    staleTime: 60_000,
  });

  if (!canManage) return null;
  const onSaved = (summary: string) => setJustSaved(prev => [summary, ...prev.filter(p => p !== summary)].slice(0, 6));

  const total = (data?.recipes.length ?? 0) + (data?.meats.length ?? 0);
  const missingCount = (data?.recipes.filter(r => r.kind === "missing").length ?? 0) + (data?.meats.filter(m => m.kind === "missing").length ?? 0);

  return (
    <section className="rounded-2xl border border-border bg-secondary/20 p-4 sm:p-5 space-y-4" aria-labelledby="timing-data-heading">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 id="timing-data-heading" className="font-display text-xl font-bold flex items-center gap-2">
            <Clock className="w-5 h-5" /> Timing data
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5 max-w-3xl">
            The day schedule and the meat &ldquo;start cooking by&rdquo; times are only as good as these. Anything missing is a guess on the day until it&rsquo;s set.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="min-h-11 px-3 py-2 rounded-xl border border-border bg-card text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
        >
          <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} /> Refresh
        </button>
      </div>

      {justSaved.length > 0 && (
        <ul className="space-y-1">
          {justSaved.map(s => (
            <li key={s} className="text-sm font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> Saved: {s}
            </li>
          ))}
        </ul>
      )}

      {isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Checking recipes and meats…</div>}
      {isError && (
        <p className="text-sm text-destructive flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4" /> {(error as Error).message} — tap Refresh to try again.
        </p>
      )}

      {data && total === 0 && (
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4" /> All set — every recipe on the day schedule has a build time and every meat it uses has cook and process times.
        </p>
      )}

      {data && total > 0 && (
        <>
          <p className="text-sm font-semibold">
            {missingCount > 0 ? `${missingCount} missing` : "Nothing missing"}
            {total - missingCount > 0 && ` · ${total - missingCount} to check against the floor`}
          </p>

          {data.recipes.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><ChefHat className="w-4 h-4" /> Build times</h3>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {data.recipes.map(r => (
                  <RecipeCard key={r.recipeId} issue={r} windowDays={data.buildWindowDays} onEdit={onEditRecipe} onSaved={onSaved} />
                ))}
              </div>
            </div>
          )}

          {data.meats.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><Beef className="w-4 h-4" /> Meat cook &amp; process times</h3>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {data.meats.map(m => (
                  <MeatCard key={m.ingredientId} issue={m} windowDays={data.cookWindowDays} onSaved={onSaved} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {data && (
        <p className="text-xs text-muted-foreground">
          {data.notPlannedRecently.length > 0 && (
            <>
              Also no build time, but not on a plan in {weeks(data.buildWindowDays)}:{" "}
              {data.notPlannedRecently.map((r, i) => (
                <span key={r.recipeId}>
                  {i > 0 && ", "}
                  <button type="button" onClick={() => onEditRecipe(r.recipeId)} className="underline underline-offset-2 hover:text-foreground">{r.name}</button>
                </span>
              ))}
              .{" "}
            </>
          )}
          Mac cheese and fried chicken have their own stations, so they aren&rsquo;t on the builders&rsquo; day schedule and aren&rsquo;t listed.
        </p>
      )}
    </section>
  );
}
