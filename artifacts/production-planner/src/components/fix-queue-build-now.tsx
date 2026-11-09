/**
 * "Build approved fixes now" on the Fix queue (Graeme, 2 Nov 2026): after a
 * review session, one tap starts Claude building every approved card
 * instead of waiting for the hourly run; they go live in the 3:05pm
 * deploy. The reviewer checks for the request every ten minutes
 * (api lib/fix-queue-build-request*). Only cards with code count; approved
 * cards waiting on a data change or an answer are listed under it instead.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Hammer, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const KEY = ["issue-pipeline", "build-now"] as const;

interface BuildNowView {
  status: "idle" | "requested" | "building" | "done";
  request: { requestedAt: string; requestedBy: string | null; claimedAt?: string | null; finishedAt?: string | null; note?: string | null } | null;
  /** Approved cards with code to write. */
  approvedWaiting: number;
  /** Approved cards waiting on something other than code. */
  approvedNotCode?: Array<{ issueId: number; waitingFor: string; summary: string }>;
  inProgress: number;
}

async function call(method: "GET" | "POST"): Promise<BuildNowView> {
  const res = await fetch(`${BASE}/api/issue-pipeline/review/build-now`, {
    method, credentials: "include",
    ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: "{}" } : {}),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as BuildNowView;
}

const time = (iso: string | null | undefined) => (iso ? format(parseISO(iso), "HH:mm") : "");

export function FixQueueBuildNow() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: KEY, queryFn: () => call("GET"), refetchInterval: 30_000 });
  const press = useMutation({
    mutationFn: () => call("POST"),
    onSuccess: v => qc.setQueryData(KEY, v),
    onError: err => toast({ title: "Couldn't start the build", description: err instanceof Error ? err.message : "Try again", variant: "destructive" }),
  });
  if (!data) return null;
  const r = data.request;
  const waiting = data.status === "requested";
  const building = data.status === "building";
  const line = waiting ? `Asked at ${time(r?.requestedAt)} — Claude starts within 10 minutes`
    : building ? `Claude is building them (since ${time(r?.claimedAt)}) — live at 3:05pm`
    : data.status === "done" && r?.note ? `Last build ${time(r.finishedAt)}: ${r.note}`
    : null;

  const notCode = data.approvedNotCode ?? [];
  const nothingToBuild = data.approvedWaiting === 0;
  return (
    <div className="rounded-2xl border-2 border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => press.mutate()} disabled={press.isPending || waiting || building || nothingToBuild}
          className="min-h-12 px-4 rounded-xl bg-primary text-primary-foreground text-base font-semibold flex items-center gap-2 disabled:opacity-50">
          {press.isPending || building ? <Loader2 className="w-5 h-5 animate-spin" /> : <Hammer className="w-5 h-5" />}
          {nothingToBuild ? "Nothing to build" : `Build ${data.approvedWaiting} approved now`}
        </button>
        {line && <span className="text-sm text-muted-foreground">{line}</span>}
      </div>
      {notCode.length > 0 && (
        // Approved, but the button can't build them: say what each is waiting
        // for, so they don't look like builds that never happen (9 Nov 2026).
        <div className="space-y-1.5">
          <p className="text-sm font-semibold">
            {notCode.length} approved {notCode.length === 1 ? "card has" : "cards have"} no code to build
          </p>
          <ul className="space-y-1">
            {notCode.map(card => (
              <li key={card.issueId} className="text-sm flex gap-2">
                <span className="font-semibold tabular-nums flex-shrink-0">#{card.issueId}</span>
                <span className="min-w-0">
                  <span className="text-amber-700 dark:text-amber-400 font-medium">Waiting for {card.waitingFor}.</span>{" "}
                  <span className="text-muted-foreground">{card.summary}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
