/**
 * "Sent to the accountant on …" for one new starter (Graeme, 2026-10-27).
 * Their payroll paperwork goes to the accountant automatically, once, the
 * moment it's complete; this line says whether it has, and gives the
 * founder a Send / Send again button. API: /api/starter-payroll/status.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, Loader2, Send } from "lucide-react";
import { Link } from "wouter";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface StarterPayrollStatus {
  userId: number;
  complete: boolean;
  missing: string[];
  documents: string[];
  lastSent: { at: string; to: string | null; documents: string[]; trigger: "auto" | "manual"; byName: string | null } | null;
  lastAttempt: { at: string; status: string; error: string | null; trigger: "auto" | "manual" } | null;
  changedSinceSent: boolean;
}
interface StatusResponse { statuses: StarterPayrollStatus[]; accountantEmailSet: boolean; canSend: boolean }

async function jsonOrThrow<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
  return body as T;
}

export function useStarterPayrollStatus(meId: number | null) {
  return useQuery({
    queryKey: ["starter-payroll", "status", meId],
    queryFn: () => fetch(`${BASE}/api/starter-payroll/status`, { credentials: "include" }).then(r => jsonOrThrow<StatusResponse>(r)),
    enabled: meId != null,
  });
}

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", {
  timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

export function StarterPayrollSendStatus({ userId, meId }: { userId: number; meId: number | null }) {
  const qc = useQueryClient();
  const q = useStarterPayrollStatus(meId);
  const send = useMutation({
    mutationFn: () => fetch(`${BASE}/api/starter-payroll/send`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    }).then(r => jsonOrThrow<{ ok: true; documents: string[] }>(r)),
    onSuccess: res => toast({ title: "Sent to the accountant", description: `${res.documents.length} document${res.documents.length === 1 ? "" : "s"} attached` }),
    onError: (e: Error) => toast({ title: "Didn't send", description: e.message, variant: "destructive" }),
    onSettled: () => { void qc.invalidateQueries({ queryKey: ["starter-payroll", "status"] }); },
  });

  const s = q.data?.statuses.find(x => x.userId === userId);
  if (!s) return null;
  const canSend = q.data?.canSend ?? false;
  const emailSet = q.data?.accountantEmailSet ?? false;

  let tone: "ok" | "warn" | "wait" = "wait";
  let icon = <Clock className="w-5 h-5 flex-shrink-0" />;
  let line: React.ReactNode;
  const last = s.lastAttempt;

  if (s.lastSent) {
    tone = "ok";
    icon = <CheckCircle2 className="w-5 h-5 flex-shrink-0" />;
    line = (
      <>
        Payroll paperwork sent to the accountant on {when(s.lastSent.at)}
        {s.lastSent.trigger === "manual" && s.lastSent.byName ? ` by ${s.lastSent.byName}` : " (automatically)"}
        {s.lastSent.documents.length > 0 && <span className="block text-sm font-normal opacity-80">{s.lastSent.documents.join(" · ")}</span>}
        {s.changedSinceSent && <span className="block text-sm font-semibold">Something payroll needs has changed since — send it again.</span>}
      </>
    );
  } else if (last?.status === "not_sent" || (s.complete && !emailSet)) {
    tone = "warn";
    icon = <AlertTriangle className="w-5 h-5 flex-shrink-0" />;
    line = <>Not sent: set the accountant's email on <Link href="/finance/payroll" className="underline font-bold">Finance → Payroll</Link></>;
  } else if (last?.status === "failed") {
    tone = "warn";
    icon = <AlertTriangle className="w-5 h-5 flex-shrink-0" />;
    line = <>Didn't send to the accountant ({when(last.at)}): {last.error ?? "unknown error"}</>;
  } else if (last?.status === "sending") {
    line = <>Sending to the accountant…</>;
  } else if (s.complete) {
    line = <>Payroll paperwork complete — not sent to the accountant yet.</>;
  } else {
    line = <>Payroll paperwork goes to the accountant automatically once done. Waiting for: {s.missing.join(", ")}.</>;
  }

  return (
    <div className={cn(
      "mt-2 rounded-xl border-2 px-3 py-2.5 flex items-start gap-2.5 flex-wrap",
      tone === "ok" && "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200",
      tone === "warn" && "border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200",
      tone === "wait" && "border-border bg-secondary/40 text-foreground",
    )}>
      {icon}
      <p className="flex-1 min-w-[12rem] text-base font-medium">{line}</p>
      {canSend && s.complete && emailSet && (
        <button
          type="button" onClick={() => send.mutate()} disabled={send.isPending}
          className="h-11 px-4 rounded-xl bg-primary text-primary-foreground font-bold inline-flex items-center gap-2 disabled:opacity-50"
        >
          {send.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {s.lastSent ? "Send again" : "Send to the accountant"}
        </button>
      )}
    </div>
  );
}
