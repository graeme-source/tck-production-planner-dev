/**
 * "This order should already have been fulfilled" — a checklist, not a
 * warning (Graeme, 27 Nov 2026 — #140447). When an order comes back on the
 * pack list after Complete was pressed, opening it shows ONLY this, and the
 * packer works through it:
 *
 *   1. Find the box — tick: order number on the label, the customer's name,
 *      the label ending. "Yes, found it" / "No, I can't find it".
 *   2. The system checks what happened (GET …/fulfil-attempts/:id/diagnosis):
 *      Shopify still open, a server restart as Complete was pressed, nothing
 *      else went wrong, same live APC booking, label printed before Complete.
 *   3. Every check passed → one button: mark it fulfilled with the tracking
 *      number, then carry on packing. Anything else → "Escalate to Graeme or
 *      a manager" and nothing more.
 *
 * Every answer is recorded (POST …/check; the server re-runs the checks
 * itself and refuses the fix unless they pass). The server-crash case is
 * the one the team can fix themselves; escalation is always the fallback.
 * Objective C.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2, Circle, Loader2, PhoneCall, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { forgetOrder, type QueueEntry } from "@/lib/fulfil-queue";
import { labelEnding, shouldHaveGoneWords, whenWords } from "@/lib/fulfil-flag-words";
import { useNow } from "./fulfil-attempt-flag";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Check { key: string; ok: boolean; label: string; detail: string }
interface DiagnosisData {
  orderId: number;
  orderName: string;
  customerName: string | null;
  firstAttemptBy: string | null;
  ordersSince: number | null;
  booking: { waybill: string; trackingUrl: string | null } | null;
  noCourier: boolean;
  checks: Check[];
  canFix: boolean;
  completeAt: string | null;
  previousChecks: Array<{ at: string; by: string | null; found: boolean; outcome: string }>;
}

type Step = "find" | "not-found" | "checks" | "fixing" | "fixed" | "escalate";

async function postJson(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${r.status}`);
  return data;
}

function Tick({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className={cn("flex items-start gap-3 rounded-xl border-2 px-4 py-3 cursor-pointer text-base", checked ? "border-primary bg-primary/5" : "border-border bg-card")}>
      <input type="checkbox" className="mt-1 w-5 h-5" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

function Escalate({ title, children, onBack }: { title: string; children?: React.ReactNode; onBack: () => void }) {
  return (
    <div className="rounded-2xl border-2 border-red-600 bg-red-50 dark:bg-red-950/30 p-5 space-y-3 text-red-900 dark:text-red-100">
      <p className="text-lg font-bold flex items-center gap-2"><PhoneCall className="w-5 h-5" /> {title}</p>
      {children}
      <p className="text-sm">Don't pack or fulfil this order. Leave it where it is and show them this screen.</p>
      <button onClick={onBack} className="px-4 py-2.5 rounded-xl border-2 border-red-600 font-bold flex items-center gap-2"><ArrowLeft className="w-4 h-4" /> Back to the list</button>
    </div>
  );
}

export function FulfilChecklist({ orderId, local, customerName, onBack }: {
  orderId: number;
  local?: QueueEntry;
  customerName?: string | null;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const now = useNow();
  const localAt = local?.state === "gave-up" ? local.firstAt : undefined;
  const { data, isLoading, error, refetch } = useQuery<DiagnosisData>({
    queryKey: ["fulfil-diagnosis", orderId, localAt ?? null],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/fulfilment/fulfil-attempts/${orderId}/diagnosis${localAt ? `?localAt=${localAt}` : ""}`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 0,
    refetchOnMount: "always",
  });
  const [step, setStep] = useState<Step>("find");
  const [tickOrder, setTickOrder] = useState(false);
  const [tickName, setTickName] = useState(false);
  const [tickLabel, setTickLabel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [serverChecks, setServerChecks] = useState<Check[] | null>(null);

  const who = data?.customerName ?? customerName ?? local?.customerName ?? null;
  const ending = labelEnding(data?.booking?.waybill ?? local?.consignmentNumber ?? null);
  const needLabelTick = !data?.noCourier && !!ending;
  const allTicked = tickOrder && (!who || tickName) && (!needLabelTick || tickLabel);
  const checks = serverChecks ?? data?.checks ?? [];

  async function record(found: boolean, outcome: "not-found" | "escalated" | "fixing" | "fixed") {
    return postJson(`${BASE}/api/fulfilment/fulfil-attempts/${orderId}/check`, { found, outcome, ...(localAt ? { localAt } : {}) }) as Promise<{ outcome: string; canFix: boolean; booking: DiagnosisData["booking"]; noCourier: boolean; checks: Check[] }>;
  }

  async function notFound() {
    setBusy(true);
    try { await record(false, "not-found"); } catch { /* still escalate */ }
    setBusy(false);
    setStep("not-found");
  }

  async function found() {
    setBusy(true);
    setProblem(null);
    try {
      // Fresh checks now the box is in hand. Passing → offer the fix (which
      // the server checks again before anything is sent); failing → record
      // the escalation.
      const fresh = await refetch();
      const d = fresh.data;
      if (!d) throw new Error("the checks didn't run");
      setServerChecks(d.checks);
      if (d.canFix) {
        setStep("checks");
      } else {
        await record(true, "escalated").catch(() => undefined);
        setStep("escalate");
      }
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      setStep("escalate");
    } finally {
      setBusy(false);
    }
  }

  async function fix() {
    if (!data) return;
    setBusy(true);
    setProblem(null);
    setStep("fixing");
    try {
      const r = await record(true, "fixing");
      if (!r.canFix) { setServerChecks(r.checks); setStep("escalate"); return; }
      await postJson(`${BASE}/api/fulfilment/orders/${orderId}/complete`, {
        ...(r.booking ? { consignmentNumber: r.booking.waybill, trackingUrl: r.booking.trackingUrl ?? undefined } : {}),
        clientAttemptId: `checklist-${orderId}-${Date.now()}`,
      });
      try { await record(true, "fixed"); } catch { /* fulfilled either way */ }
      forgetOrder(orderId);
      void qc.invalidateQueries({ queryKey: ["fulfil-attempts-stuck"] });
      setStep("fixed");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      setStep("escalate");
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <p className="py-10 flex items-center justify-center gap-2 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Checking this order…</p>;
  if (error || !data) {
    return <Escalate title="Escalate to Graeme or a manager" onBack={onBack}><p className="text-sm">This order should already have been fulfilled, and the checks couldn't run ({error instanceof Error ? error.message : "no answer"}).</p></Escalate>;
  }

  const firstAt = data.completeAt ?? (local ? new Date(local.firstAt).toISOString() : null);

  return (
    <div className="space-y-4">
      {/* What happened, in plain words. */}
      <div className="rounded-2xl border-2 border-red-600 bg-red-50 dark:bg-red-950/30 p-5 space-y-2 text-red-900 dark:text-red-100">
        <p className="text-lg font-bold flex items-center gap-2"><AlertTriangle className="w-5 h-5 flex-shrink-0" /> This order should already have been fulfilled</p>
        {firstAt && (
          <p className="text-base">
            Complete was pressed at <strong>{shouldHaveGoneWords(firstAt, data.ordersSince, now)}</strong>
            {(data.firstAttemptBy ?? (local ? "this screen" : null)) && <> by <strong>{data.firstAttemptBy ?? "this screen"}</strong></>}, but Shopify never got it.
          </p>
        )}
        <p className="text-base">Order <strong>{data.orderName}</strong>{who && <> · <strong>{who}</strong></>}{ending && <> · label ending <strong className="font-mono">{ending}</strong></>}</p>
        {data.previousChecks.length > 0 && (
          <p className="text-xs">Checked before: {data.previousChecks.map(c => `${whenWords(c.at, now)} ${c.by ?? "someone"} — ${c.found ? "found it" : "couldn't find it"}`).join("; ")}</p>
        )}
      </div>

      {step === "find" && (
        <div className="space-y-3">
          <p className="text-lg font-bold">Step 1 — find the box. Tick each one as you check it.</p>
          <Tick checked={tickOrder} onChange={setTickOrder}>I've found a packed box with <strong>{data.orderName}</strong> on the label</Tick>
          {who && <Tick checked={tickName} onChange={setTickName}>The name on the label is <strong>{who}</strong></Tick>}
          {needLabelTick && <Tick checked={tickLabel} onChange={setTickLabel}>The label number ends <strong className="font-mono">{ending}</strong>, and there's only one label on the box</Tick>}
          <div className="flex flex-wrap gap-3 pt-1">
            <button onClick={found} disabled={!allTicked || busy} className="px-5 py-3 rounded-xl bg-primary text-primary-foreground font-bold text-base disabled:opacity-40 flex items-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Yes — I've found it
            </button>
            <button onClick={notFound} disabled={busy} className="px-5 py-3 rounded-xl border-2 border-red-600 text-red-700 dark:text-red-300 font-bold text-base">
              No — I can't find it
            </button>
          </div>
        </div>
      )}

      {step === "not-found" && (
        <Escalate title="Escalate to Graeme or a manager" onBack={onBack}>
          <p className="text-sm">The box isn't there, so we can't be sure it was packed. A manager needs to decide what happens next.</p>
        </Escalate>
      )}

      {(step === "checks" || step === "fixing" || step === "escalate") && (
        <div className="space-y-2">
          <p className="text-lg font-bold">Step 2 — what the system found</p>
          <ul className="space-y-1.5">
            {checks.map(c => (
              <li key={c.key} className="flex items-start gap-2 rounded-xl border border-border bg-card px-4 py-2.5">
                {c.ok ? <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" /> : <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />}
                <span><span className="font-semibold">{c.label}</span><span className="block text-sm text-muted-foreground">{c.detail}</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(step === "checks" || step === "fixing") && (
        <div className="rounded-2xl border-2 border-primary bg-primary/5 p-5 space-y-3">
          <p className="text-lg font-bold">Step 3 — everything matches a server restart. You can fix it.</p>
          <p className="text-sm">This marks {data.orderName} fulfilled in Shopify {data.noCourier ? "(no tracking — local delivery or collection)" : <>with the tracking number ending <span className="font-mono">{ending}</span></>} and emails {who ?? "the customer"} their dispatch email, exactly as Complete would have.</p>
          <button onClick={fix} disabled={busy} className="px-5 py-3 rounded-xl bg-red-600 text-white font-bold text-base flex items-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Circle className="w-4 h-4" />} Mark fulfilled{data.noCourier ? "" : " and add the tracking"}
          </button>
        </div>
      )}

      {step === "fixed" && (
        <div className="rounded-2xl border-2 border-green-600 bg-green-50 dark:bg-green-950/30 p-5 space-y-3 text-green-900 dark:text-green-100">
          <p className="text-lg font-bold flex items-center gap-2"><CheckCircle2 className="w-5 h-5" /> Fixed — {data.orderName} is fulfilled{data.noCourier ? "" : " with its tracking"}</p>
          <p className="text-sm">Put the box back with the others. Nothing else to do.</p>
          <button onClick={onBack} className="px-5 py-3 rounded-xl bg-primary text-primary-foreground font-bold text-base">Carry on packing</button>
        </div>
      )}

      {step === "escalate" && (
        <Escalate title="Escalate to Graeme or a manager" onBack={onBack}>
          <p className="text-sm">{problem ? `It couldn't be fixed here: ${problem}` : "The box is there, but not everything matches a simple server restart (see the crosses above), so it needs someone to look into it."}</p>
        </Escalate>
      )}
    </div>
  );
}
