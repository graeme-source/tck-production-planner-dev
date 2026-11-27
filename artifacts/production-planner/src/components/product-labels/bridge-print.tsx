/**
 * Back labels sent to the wrapping printer one label at a time (Graeme,
 * 27 Nov 2026). Objective C: when the roll runs out only the one label in
 * the printer is retried, never the whole run — the wrapping PC's print
 * bridge prints each label as its own Windows job and reports after every
 * one. This file is the packer's side: is the printer set up, send a run,
 * and the big live progress card ("47 of 120 printed", "Out of labels — put
 * a new roll in; it carries on by itself", "Done ✓") with Cancel the rest /
 * Print more / Try again. Server: routes/back-label-jobs.ts.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, Minus, Plus, Printer, RotateCcw, XCircle } from "lucide-react";
import type { BridgeJobState, BridgePauseReason, BridgeTone } from "@workspace/product-labels";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api/print-jobs/back-labels`;

export interface BridgeSetup {
  configured: boolean;
  printerName: string | null;
  station: string;
  bridgeOnline: boolean;
  lastSeenAt: string | null;
}

export interface BridgeRun {
  id: number;
  state: BridgeJobState;
  total: number;
  printed: number;
  packsLabelled: number;
  pauseReason: BridgePauseReason | null;
  error: string | null;
  recipeName: string;
  printerName: string;
  labelsPerPack: number;
  test: boolean;
  bridgeOnline: boolean;
  updatedAt: string;
  /** "47 of 120 printed" */
  count: string;
  message: string;
  tone: BridgeTone;
}

export const bridgeKeys = {
  setup: ["back-label-bridge", "setup"] as const,
  latest: (p: LatestParams) => ["back-label-bridge", "latest", p.recipeId, p.planItemId ?? null, p.role, p.test] as const,
  run: (id: number) => ["back-label-bridge", "run", id] as const,
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string; id?: number };
  if (!res.ok) {
    const err = new Error(body.error ?? `Request failed (${res.status})`) as Error & { code?: string; id?: number };
    err.code = body.code;
    err.id = body.id;
    throw err;
  }
  return body;
}

/** Is a wrapping printer set up for back labels, and is its PC on? */
export function useBackLabelBridgeSetup() {
  return useQuery({
    queryKey: bridgeKeys.setup,
    queryFn: () => call<BridgeSetup>("/setup"),
    staleTime: 0,
    refetchInterval: 15_000,
  });
}

interface LatestParams { recipeId: number; planItemId?: number; role: "main" | "wrapping"; test: boolean }

/** Today's run for this item, so reopening the dialog shows it (and a
 *  second tap can't print everything twice). */
export function useLatestBridgeRun(p: LatestParams, enabled: boolean) {
  return useQuery({
    queryKey: bridgeKeys.latest(p),
    enabled,
    staleTime: 0,
    queryFn: () => {
      const q = new URLSearchParams({ recipeId: String(p.recipeId), role: p.role });
      if (p.planItemId && !p.test) q.set("planItemId", String(p.planItemId));
      if (p.test) q.set("test", "1");
      return call<{ job: BridgeRun | null }>(`/latest?${q}`);
    },
  });
}

const ACTIVE: BridgeJobState[] = ["queued", "printing", "paused"];
export const isRunActive = (r: BridgeRun | null | undefined) => !!r && ACTIVE.includes(r.state);

/** Send a run; on "already printing" hands back that run's id. */
export function useSendToBridge(onRun: (id: number) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { recipeId: number; count: number; planItemId?: number; role?: "main" | "wrapping"; test?: boolean }) =>
      call<{ job: BridgeRun }>("/", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: d => {
      qc.setQueryData(bridgeKeys.run(d.job.id), { job: d.job });
      qc.invalidateQueries({ queryKey: ["back-label-bridge", "latest"] });
      onRun(d.job.id);
    },
    onError: (e: Error & { code?: string; id?: number }) => {
      if (e.code === "ALREADY_RUNNING" && e.id) onRun(e.id);
    },
  });
}

/** The live progress card for one run. Polls while it's going. */
export function BridgeRunCard({ runId, initial }: { runId: number; initial?: BridgeRun | null }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: bridgeKeys.run(runId),
    queryFn: () => call<{ job: BridgeRun }>(`/${runId}`),
    initialData: initial && initial.id === runId ? { job: initial } : undefined,
    refetchInterval: d => (isRunActive(d.state.data?.job) ? 1500 : false),
  });
  const run = q.data?.job;
  const [more, setMore] = useState(1);
  const act = useMutation({
    mutationFn: (a: { path: "cancel" | "retry" } | { path: "more"; packs: number }) =>
      call<{ job: BridgeRun }>(`/${runId}/${a.path}`, { method: "POST", body: JSON.stringify("packs" in a ? { packs: a.packs } : {}) }),
    onSuccess: d => {
      qc.setQueryData(bridgeKeys.run(runId), { job: d.job });
      qc.invalidateQueries({ queryKey: ["back-label-bridge", "latest"] });
    },
  });

  if (!run) {
    return q.isError
      ? <p className="text-destructive font-semibold">{(q.error as Error).message}</p>
      : <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Checking the printer…</div>;
  }

  const active = isRunActive(run);
  const pct = run.total > 0 ? Math.round((run.printed / run.total) * 100) : 0;
  const tone = {
    working: "border-sky-300 bg-sky-50 dark:bg-sky-950/20 dark:border-sky-800",
    warning: "border-amber-400 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700",
    done: "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800",
    stopped: "border-border bg-secondary/40",
  }[run.tone];
  const Icon = run.tone === "done" ? CheckCircle2 : run.tone === "warning" ? AlertTriangle : run.tone === "stopped" ? XCircle : Loader2;

  return (
    <div className={cn("rounded-2xl border-2 p-5 space-y-4", tone)} aria-live="polite">
      <div className="flex items-start gap-3">
        <Icon className={cn("w-8 h-8 shrink-0", run.tone === "working" && "animate-spin text-sky-600", run.tone === "warning" && "text-amber-600", run.tone === "done" && "text-emerald-600", run.tone === "stopped" && "text-muted-foreground")} />
        <div className="min-w-0 flex-1">
          <p className="text-3xl font-bold tabular-nums leading-tight">{run.count}</p>
          <p className="text-lg font-semibold mt-1">{run.message}</p>
          <p className="text-sm text-muted-foreground mt-1">
            On “{run.printerName}”{run.labelsPerPack > 1 ? ` · ${run.labelsPerPack} labels per pack` : ""}{run.test ? " · test print" : ""}
          </p>
        </div>
      </div>

      <div className="h-4 rounded-full bg-background/70 ring-1 ring-border overflow-hidden" role="progressbar" aria-valuenow={run.printed} aria-valuemin={0} aria-valuemax={run.total}>
        <div className={cn("h-full transition-all", run.tone === "warning" ? "bg-amber-500" : run.tone === "stopped" ? "bg-muted-foreground/50" : "bg-emerald-500")} style={{ width: `${pct}%` }} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {active && (
          <button
            type="button"
            onClick={() => act.mutate({ path: "cancel" })}
            disabled={act.isPending}
            className="h-12 px-5 rounded-xl border-2 border-border bg-card font-semibold hover:bg-secondary disabled:opacity-40"
          >
            Cancel the rest
          </button>
        )}
        {run.state === "failed" && (
          <button
            type="button"
            onClick={() => act.mutate({ path: "retry" })}
            disabled={act.isPending}
            className="h-12 px-5 rounded-xl bg-primary text-primary-foreground font-bold inline-flex items-center gap-2 disabled:opacity-40"
          >
            <RotateCcw className="w-5 h-5" /> Try again from {run.printed + 1}
          </button>
        )}
        {!active && run.state !== "expired" && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setMore(m => Math.max(1, m - 1))} className="w-12 h-12 rounded-xl border-2 border-border bg-card flex items-center justify-center" aria-label="One fewer"><Minus className="w-5 h-5" /></button>
            <span className="w-12 text-center text-2xl font-bold tabular-nums" aria-label="Packs to print more">{more}</span>
            <button type="button" onClick={() => setMore(m => Math.min(500, m + 1))} className="w-12 h-12 rounded-xl border-2 border-border bg-card flex items-center justify-center" aria-label="One more"><Plus className="w-5 h-5" /></button>
            <button
              type="button"
              onClick={() => act.mutate({ path: "more", packs: more })}
              disabled={act.isPending}
              className="h-12 px-5 rounded-xl border-2 border-primary text-primary font-bold inline-flex items-center gap-2 hover:bg-primary/10 disabled:opacity-40"
            >
              {act.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Printer className="w-5 h-5" />} Print {more} more
            </button>
          </div>
        )}
      </div>
      {act.isError && <p className="text-destructive font-semibold">{(act.error as Error).message}</p>}
    </div>
  );
}
