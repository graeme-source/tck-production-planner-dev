/**
 * Label printer — setup, test and audit page for the prep-room TSC printer
 * (Stage 1 of the raw-ingredient labels build, Graeme 2026-09-08).
 *
 * Shows whether the print bridge on the factory PC is checking in, fires a
 * test label so the app → queue → bridge → printer pipe can be proven from
 * an iPad, and lists recent jobs — which is also the start of the HACCP
 * label audit trail. The one-tap ingredient/tin buttons on the prep
 * stations come in the next stages; this page is the plumbing check.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Printer, Loader2, CheckCircle2, AlertTriangle, Wifi, WifiOff } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface PrintJobRow {
  id: number;
  kind: string;
  status: string;
  error: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  printed_at: string | null;
  user_name: string | null;
}

interface PrintStatus {
  bridgeOnline: boolean;
  lastBridgeSeenAt: string | null;
  queued: number;
  printedToday: number;
  failedToday: number;
  recent: PrintJobRow[];
}

function payloadSummary(job: PrintJobRow): string {
  const p = job.payload ?? {};
  if (job.kind === "test") return "Test label";
  if (job.kind === "ingredient") return `${p.itemName ?? "?"} · use by ${p.useBy ?? "?"}`;
  if (job.kind === "tin") return `${p.recipeName ?? "?"} · use ${p.intendedUse ?? "?"} · use by ${p.useBy ?? "?"}`;
  return job.kind;
}

export default function LabelPrinterPage() {
  const queryClient = useQueryClient();
  const [copies, setCopies] = useState(1);

  const { data: status } = useQuery<PrintStatus>({
    queryKey: ["print-jobs-status"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/print-jobs/status`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load printer status");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const printTest = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/print-jobs`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "test", copies }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to queue the label");
    },
    onSuccess: () => {
      toast({ title: "Test label queued", description: "It should print within a couple of seconds if the bridge is connected." });
      queryClient.invalidateQueries({ queryKey: ["print-jobs-status"] });
    },
    onError: err => toast({ title: "Couldn't queue the label", description: err instanceof Error ? err.message : undefined, variant: "destructive" }),
  });

  return (
    <div className="space-y-6 p-6 max-w-3xl mx-auto">
      <PageHeader title="Label Printer" description="Prep-room TSC printer — test, status and label history." />

      {/* Bridge status — the honest light. Green means the factory PC's
          bridge asked for work in the last minute; red means taps will
          queue but nothing prints. */}
      {status && (
        <div className={cn(
          "rounded-2xl border-2 p-5 flex items-center gap-4",
          status.bridgeOnline
            ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/20"
            : "border-amber-400 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/20",
        )}>
          {status.bridgeOnline
            ? <Wifi className="w-8 h-8 text-emerald-600 flex-shrink-0" />
            : <WifiOff className="w-8 h-8 text-amber-600 flex-shrink-0" />}
          <div className="flex-1">
            <p className="font-bold text-lg">
              {status.bridgeOnline ? "Bridge connected" : "Bridge not connected"}
            </p>
            <p className="text-sm text-muted-foreground">
              {status.bridgeOnline
                ? "The factory PC is listening — labels print within a couple of seconds."
                : status.lastBridgeSeenAt
                  ? `Last seen ${new Date(status.lastBridgeSeenAt).toLocaleTimeString()}. Labels queue and print when it's back.`
                  : "The bridge has not checked in since the app started. See tools/print-bridge/README.md for setup."}
            </p>
          </div>
          <div className="text-right text-sm tabular-nums text-muted-foreground flex-shrink-0">
            <p><span className="font-bold text-foreground">{status.queued}</span> queued</p>
            <p><span className="font-bold text-emerald-600">{status.printedToday}</span> printed today</p>
            {status.failedToday > 0 && <p><span className="font-bold text-destructive">{status.failedToday}</span> failed</p>}
          </div>
        </div>
      )}

      {/* Test print */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
        <h2 className="font-semibold text-lg flex items-center gap-2"><Printer className="w-5 h-5 text-primary" /> Print a test label</h2>
        <p className="text-sm text-muted-foreground">
          Proves the whole pipe — this iPad → app → bridge → printer — and shows the layout on the real 100×25&nbsp;mm stock.
        </p>
        <div className="flex items-center gap-3">
          <label className="text-sm text-muted-foreground">Copies</label>
          <select
            value={copies}
            onChange={e => setCopies(Number(e.target.value))}
            className="px-2 py-1.5 border border-border rounded-lg text-sm bg-background"
          >
            {[1, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button
            onClick={() => printTest.mutate()}
            disabled={printTest.isPending}
            className="ml-auto flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-semibold hover:bg-primary/90 disabled:opacity-50"
          >
            {printTest.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
            Print test label
          </button>
        </div>
      </div>

      {/* Recent jobs — the start of the label audit trail */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
        <h2 className="font-semibold text-lg">Recent labels</h2>
        {!status?.recent?.length && <p className="text-sm text-muted-foreground italic">Nothing printed yet.</p>}
        <div className="space-y-1.5">
          {status?.recent?.map(job => (
            <div key={job.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border/60 text-sm">
              {job.status === "printed" && <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
              {job.status === "queued" && <Loader2 className="w-4 h-4 text-muted-foreground animate-spin flex-shrink-0" />}
              {job.status === "failed" && <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0" />}
              <span className="flex-1 min-w-0 truncate font-medium">{payloadSummary(job)}</span>
              {job.error && <span className="text-xs text-destructive truncate max-w-[14rem]" title={job.error}>{job.error}</span>}
              <span className="text-xs text-muted-foreground flex-shrink-0">{job.user_name ?? ""}</span>
              <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">
                {new Date(job.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
