/**
 * People → Needs attention (Graeme, 2026-10-12): the private HR action
 * queue. Reached from the one generic to-do ("Your attention is required in
 * HR — tap here"), which says nothing about anyone; the People section asks
 * for the private PIN first, and only then does this name people.
 *
 * Each card says who and what's needed, what's happened since, and offers
 * one-tap actions — Open the entry (book a meeting, write it up) · Extend ·
 * Close as resolved · Escalate to the next stage · Begin dismissal process
 * (a confirmation + the formal-hearing checklist; nothing about their
 * employment changes in the app) · probation Passed / Not passed / Extend.
 * Every action follows the same write rule on the server and lands on the
 * record and timeline like any other entry.
 */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BellRing, CheckCircle2, ChevronLeft, Loader2, Lock } from "lucide-react";
import {
  evidenceLine, fmtDayIso, meetingChecklist, PERIOD_MONTHS, type AttentionItem, type EvidenceKind,
} from "@workspace/people-reviews";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { peopleFetch, peopleRetry, PeopleLockedError } from "@/hooks/use-people-gate";
import { PeopleLockedCard } from "@/components/people-locked-card";
import { recordSend, recordBadgesKey, type ProbationFact, type RecordAttendance } from "./reviews-api";

interface Card extends AttentionItem {
  line: string;
  person: { id: number; name: string };
  entry: null | {
    id: number; title: string; classification: string | null; evidence: EvidenceKind | null; entryDate: string;
    reviewStart: string | null; reviewEnd: string | null; stage: string | null; status: string; canEscalate: boolean; usesStage: boolean;
  };
  probation: ProbationFact | null;
  attendance: RecordAttendance | null;
}

const KEY = ["people-record-entries", "attention"];

function Btn({ children, onClick, tone, disabled }: { children: React.ReactNode; onClick: () => void; tone?: "primary" | "danger"; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={cn("min-h-14 px-4 py-2 rounded-2xl text-base font-bold leading-tight disabled:opacity-50",
        tone === "primary" ? "bg-primary text-primary-foreground" : tone === "danger" ? "border-2 border-rose-400 text-rose-700 dark:text-rose-300" : "border-2 border-border hover:bg-secondary/50")}>
      {children}
    </button>
  );
}

export function NeedsAttention({ ready }: { ready: boolean }) {
  const qc = useQueryClient();
  const q = useQuery<{ today: string; items: Card[] }>({
    queryKey: KEY,
    queryFn: () => peopleFetch("/people-reviews/attention"),
    enabled: ready,
    retry: peopleRetry,
    refetchOnWindowFocus: false,
  });

  if (q.error instanceof PeopleLockedError) return <PeopleLockedCard error={q.error} />;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KEY });
    void qc.invalidateQueries({ queryKey: recordBadgesKey });
    void qc.invalidateQueries({ queryKey: ["people-record-entries"] });
  };
  const items = q.data?.items ?? [];

  return (
    <div className="max-w-4xl mx-auto space-y-5 pb-24">
      <Link href="/people" className="inline-flex items-center gap-2 px-4 h-14 rounded-2xl bg-secondary hover:bg-secondary/70 text-lg font-bold">
        <ChevronLeft className="w-5 h-5" /> Everyone
      </Link>
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0"><BellRing className="w-6 h-6 text-primary" /></div>
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold leading-tight">Needs attention</h1>
          <p className="text-base text-muted-foreground">Probation dates, review periods, warnings and meetings that need a decision.</p>
        </div>
      </div>
      {!ready || q.isLoading ? (
        <div className="flex items-center gap-3 py-12 text-lg text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /> Checking…</div>
      ) : q.error ? (
        <p className="p-4 rounded-2xl bg-destructive/10 text-destructive text-lg font-semibold">{q.error instanceof Error ? q.error.message : "Couldn't load"}</p>
      ) : items.length === 0 ? (
        <div className="text-center py-12 rounded-3xl bg-secondary/30">
          <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
          <p className="text-2xl font-bold mt-2">Nothing needs you right now</p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {items.map(i => <AttentionCard key={i.key} item={i} today={q.data!.today} onDone={refresh} />)}
        </div>
      )}
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Lock className="w-3.5 h-3.5" /> Private — only people who can write employment records, and never about your own.
      </p>
    </div>
  );
}

function AttentionCard({ item, onDone }: { item: Card; today: string; onDone: () => void }) {
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<null | "extend" | "dismissal">(null);
  const [busy, setBusy] = useState(false);
  const e = item.entry;
  const evidence = e ? evidenceLine(e.evidence, item.attendance) : null;
  const openEntry = (id: number) => navigate(`/people/${item.person.id}?entry=${id}`);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await fn(); toast({ title: done }); setMode(null); onDone(); }
    catch (err) { toast({ title: "Couldn't do that", description: err instanceof Error ? err.message : "Try again", variant: "destructive" }); }
    finally { setBusy(false); }
  };

  return (
    <article className={cn("rounded-3xl border-2 bg-card p-4 space-y-3", item.overdue ? "border-rose-400 dark:border-rose-700" : item.fyi ? "border-border" : "border-amber-400 dark:border-amber-700")}>
      <div className="flex items-start gap-3">
        {item.overdue && <AlertTriangle className="w-6 h-6 text-rose-600 shrink-0 mt-1" />}
        <div className="flex-1 min-w-0">
          <Link href={`/people/${item.person.id}`} className="text-xl font-bold underline-offset-4 hover:underline">{item.person.name}</Link>
          <p className="text-lg font-semibold leading-snug">{item.line}</p>
          {e && (
            <p className="text-base text-muted-foreground">
              {e.classification}{e.stage ? ` · ${e.stage}` : ""}{e.title ? ` · ${e.title}` : ""}
              {e.reviewStart ? ` · in review since ${fmtDayIso(e.reviewStart)}` : ""}
            </p>
          )}
          {item.probation && (
            <p className="text-base text-muted-foreground">Probation {fmtDayIso(item.probation.startDate)} → {fmtDayIso(item.probation.endDate)}{item.probation.derived ? " (from their contract)" : ""}</p>
          )}
          {evidence && <p className={cn("text-base mt-1", evidence.triggered && "font-semibold text-rose-800 dark:text-rose-200")}>{evidence.text}</p>}
        </div>
      </div>

      {mode === null && (
        <div className="grid gap-2 grid-cols-2">
          {e && <Btn tone="primary" onClick={() => openEntry(e.id)}>{item.kind === "meeting_write_up" ? "Add meeting notes" : "Open · book a meeting"}</Btn>}
          {item.kind === "review_due" && e && <Btn onClick={() => setMode("extend")}>Extend</Btn>}
          {item.kind === "review_due" && e && (
            <Btn disabled={busy} onClick={() => void run(() => recordSend("PATCH", `/entries/${e.id}`, { status: "closed", outcome: "Resolved" }), "Closed as resolved")}>Close as resolved</Btn>
          )}
          {e?.canEscalate && item.kind !== "warning_expiring" && (
            <Btn disabled={busy} onClick={() => void run(async () => {
              const r = await recordSend<{ id: number }>("POST", `/entries/${e.id}/escalate`, {});
              openEntry(r.id);
            }, "Escalated to the next stage")}>Escalate</Btn>
          )}
          {e?.usesStage && item.kind !== "warning_expiring" && <Btn tone="danger" onClick={() => setMode("dismissal")}>Begin dismissal process</Btn>}
          {item.kind === "probation_due" && (
            <>
              <Btn tone="primary" disabled={busy} onClick={() => void run(() => recordSend("POST", `/person/${item.person.id}/probation`, { action: "passed" }), "Marked as passed")}>Passed</Btn>
              <Btn onClick={() => setMode("extend")}>Extend</Btn>
              <Btn tone="danger" disabled={busy} onClick={() => void run(() => recordSend("POST", `/person/${item.person.id}/probation`, { action: "not_passed" }), "Recorded: not passed")}>Not passed</Btn>
              <Btn onClick={() => navigate(`/people/${item.person.id}?section=record`)}>Open their record</Btn>
            </>
          )}
        </div>
      )}

      {mode === "extend" && (
        <div className="space-y-2">
          <p className="text-base font-bold">Extend by</p>
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
            {PERIOD_MONTHS.map(m => (
              <Btn key={m} disabled={busy} onClick={() => void run(
                () => item.kind === "probation_due"
                  ? recordSend("POST", `/person/${item.person.id}/probation`, { action: "extend", months: m })
                  : recordSend("POST", `/entries/${e!.id}/extend`, { months: m }),
                `Extended by ${m} month${m === 1 ? "" : "s"}`)}>
                +{m} month{m === 1 ? "" : "s"}
              </Btn>
            ))}
          </div>
          <Btn onClick={() => setMode(null)}>Cancel</Btn>
        </div>
      )}

      {mode === "dismissal" && e && (
        <div className="rounded-2xl border-2 border-rose-400 p-4 space-y-3">
          <p className="text-lg font-bold">Begin the dismissal process for {item.person.name}?</p>
          <p className="text-base">This adds a new open entry with a disciplinary hearing to arrange. Dismissal is only a possible outcome of that hearing — nothing about their employment changes in the app. Before the hearing:</p>
          <ul className="list-disc pl-5 text-base space-y-1">
            {meetingChecklist("disciplinary").map(c => <li key={c.key}>{c.label}</li>)}
          </ul>
          <div className="grid gap-2 grid-cols-2">
            <Btn tone="danger" disabled={busy} onClick={() => void run(async () => {
              const r = await recordSend<{ id: number }>("POST", `/entries/${e.id}/begin-dismissal`, { confirm: true });
              openEntry(r.id);
            }, "Started — arrange the hearing")}>Yes, start it</Btn>
            <Btn onClick={() => setMode(null)}>Cancel</Btn>
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{item.fyi ? "For your information" : item.overdue ? "Overdue" : `Due ${fmtDayIso(item.date)}`}</p>
    </article>
  );
}
