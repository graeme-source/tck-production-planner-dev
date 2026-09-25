/**
 * One person's record — the single place for everything about them
 * (Graeme, 2026-09-25): who they are, their attendance over the last 12
 * months against the policy triggers, holiday and contract from Planday,
 * and ONE timeline of absences (each with its return-to-work form), lates,
 * forms, meetings and reviews, notes and feedback. Start a return-to-work
 * form, book a meeting or write a note from the big buttons at the top.
 *
 * Reuses rather than rewrites: the review cards and composers come from
 * components/employee-reviews.tsx, the return-to-work form from
 * components/rtw-form-editor.tsx. Data: /api/people/:id (attendance +
 * forms), /api/person-documents/person/:id (documents filed on the record
 * + their onboarding uploads, founder-only ones left out by the server for
 * anyone else), /api/employee-reviews/:id (meetings + notes, private-note rules
 * applied on the server), /api/people/:id/employment (Planday, loaded on its
 * own so a slow or failed Planday never holds up the rest of the page).
 */
import { useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock, FilePlus2, HeartPulse, Loader2, Lock,
  PenLine, Plus, RefreshCw, Sun, Target, History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { peopleFetch, peopleRetry, PeopleLockedError } from "@/hooks/use-people-gate";
import { UserAvatar } from "@/components/user-avatar";
import { PeopleModal } from "@/components/people-modal";
import { FormEditor, type RtwForm } from "@/components/rtw-form-editor";
import {
  api as reviewsApi, MeetingCard, NoteCard, AgreedObjective, BookMeeting, WriteNote, type Record_ as ReviewRecord,
} from "@/components/employee-reviews";
import { groupRecordNotes, currentObjectives } from "@/lib/employee-record-grouping";
import {
  buildPersonTimeline, filterTimeline, timelineCounts, withinWindow, lengthOfService, spellsWithoutForm,
  TIMELINE_FILTERS, type TimelineFilter, type TimelineSpell,
} from "@/lib/person-timeline";
import { ABSENCE_TYPE_OPTIONS, absencePhrase } from "@/lib/rtw-wording";
import {
  type PersonRecordResponse, type EmploymentResponse, fmtDay, fmtDayRange,
} from "@/lib/people-api";
import { PeopleLockedCard } from "@/components/people-locked-card";
import { JobTitleField } from "@/components/job-title-field";
import {
  useCanManageContracts, useContractHistory, PersonContractsSection, ContractEntryCard, AddOldContractModal,
  ContractOpenModal, type OpenContract,
} from "@/components/person-contracts";
import { contractHistory } from "@/lib/contract-history";
import { PersonHoursPanel } from "@/components/person-hours-panel";
import {
  usePersonDocuments, personDocumentsKey, PersonDocumentsSection, DocumentEntryCard, AddDocumentModal, DocumentOpenModal,
  type OpenDocument,
} from "@/components/person-documents";
import { documentEntries, isFiledFounderOnly } from "@/lib/person-documents";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function minusMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

async function fetchForm(id: number): Promise<RtwForm> {
  const r = await fetch(`${BASE}/api/return-to-work/form/${id}`, { credentials: "include" });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.error ?? "Couldn't open the form");
  }
  return r.json();
}

async function createForm(body: { userId: number; absenceStart: string; absenceEnd: string | null; absenceType: string | null }): Promise<RtwForm> {
  const r = await fetch(`${BASE}/api/return-to-work`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? "Couldn't start the form");
  return fetchForm(Number(d.id));
}

// ── Attendance tiles ───────────────────────────────────────────────────────

function Tile({ label, value, sub, alert }: { label: string; value: number | string; sub?: string; alert?: boolean }) {
  return (
    <div className={cn(
      "rounded-2xl border-2 p-4",
      alert ? "border-rose-400 bg-rose-50 dark:border-rose-700 dark:bg-rose-950/30" : "border-border bg-card",
    )}>
      <p className="text-sm font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("text-4xl font-display font-bold mt-1 tabular-nums", alert && "text-rose-700 dark:text-rose-300")}>{value}</p>
      {sub && <p className="text-sm text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Employment & holiday (Planday) ─────────────────────────────────────────

function fmtAmount(n: number | null, unit: string): string {
  if (n == null) return "—";
  const u = unit.toLowerCase() === "hours" ? "h" : ` ${unit.toLowerCase()}`;
  return `${Number.isInteger(n) ? n : n.toFixed(1)}${u}`;
}

function EmploymentPanel({ userId, ready }: { userId: number; ready: boolean }) {
  const queryClient = useQueryClient();
  const key = ["people-employment", userId];
  const { data, isLoading, error, isFetching } = useQuery<EmploymentResponse>({
    queryKey: key,
    queryFn: () => peopleFetch<EmploymentResponse>(`/people/${userId}/employment`),
    enabled: ready,
    retry: peopleRetry,
    staleTime: 5 * 60 * 1000,
  });
  const retry = async () => {
    try {
      const fresh = await peopleFetch<EmploymentResponse>(`/people/${userId}/employment?fresh=1`);
      queryClient.setQueryData(key, fresh);
    } catch {
      toast({ title: "Still couldn't reach Planday", description: "Try again in a minute.", variant: "destructive" });
    }
  };

  let body: React.ReactNode;
  if (!ready || isLoading) {
    body = <div className="flex items-center gap-3 py-6 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Asking Planday…</div>;
  } else if (error || !data || data.status === "unreachable") {
    body = (
      <div className="flex items-center gap-3 flex-wrap py-2">
        <p className="flex-1 min-w-0 text-base text-muted-foreground">Couldn't reach Planday — try again.</p>
        <button onClick={retry} disabled={isFetching} className="h-12 px-4 rounded-xl border-2 border-border font-bold flex items-center gap-2 hover:bg-secondary/50">
          <RefreshCw className="w-4 h-4" /> Try again
        </button>
      </div>
    );
  } else if (data.status === "not_linked") {
    body = <p className="text-base text-muted-foreground py-2">Not linked to a Planday employee yet — link them from Analytics → Employee Records.</p>;
  } else if (data.status === "not_configured") {
    body = <p className="text-base text-muted-foreground py-2">Planday isn't connected on this server.</p>;
  } else {
    const h = data.holiday;
    const e = data.employment;
    body = (
      <div className="space-y-4">
        {h ? (
          <>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <Tile label="Holiday left now" value={fmtAmount(h.balanceNow, h.unit)} sub="Earned so far, minus taken" />
              <Tile label="Taken this year" value={fmtAmount(h.takenThisYear, h.unit)} sub={h.yearStart && h.yearEnd ? `${fmtDay(h.yearStart, true)} – ${fmtDay(h.yearEnd, true)}` : undefined} />
              <Tile label="Booked ahead" value={fmtAmount(h.upcomingTotal, h.unit)} sub={`${h.upcoming.length} day${h.upcoming.length === 1 ? "" : "s"} booked`} />
              <Tile label="At year end" value={fmtAmount(h.balanceAfterBooked, h.unit)} sub="After booked holiday" alert={h.balanceAfterBooked != null && h.balanceAfterBooked < 0} />
            </div>
            {h.upcoming.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {h.upcoming.map(u => (
                  <span key={u.date} className="inline-flex items-center gap-1.5 text-sm font-bold px-2.5 py-1 rounded-lg bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200">
                    <Sun className="w-4 h-4" /> {fmtDay(u.date)} · {fmtAmount(u.amount, h.unit)}
                  </span>
                ))}
              </div>
            )}
            <p className="text-sm text-muted-foreground">{h.accountNames.join(", ")} (Planday).</p>
          </>
        ) : (
          <p className="text-base text-muted-foreground">No current holiday account in Planday.</p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-secondary/40 p-3">
            <p className="text-sm font-bold text-muted-foreground">Contract rule</p>
            <p className="text-lg font-bold">{e.contractRule ?? "None assigned in Planday"}</p>
            {e.contractRuleNote && <p className="text-sm text-muted-foreground">{e.contractRuleNote}</p>}
          </div>
          <div className="rounded-2xl bg-secondary/40 p-3">
            <p className="text-sm font-bold text-muted-foreground">Employee type</p>
            <p className="text-lg font-bold">{e.employeeType ?? "—"}</p>
          </div>
          <div className="rounded-2xl bg-secondary/40 p-3">
            <p className="text-sm font-bold text-muted-foreground">Started (Planday)</p>
            <p className="text-lg font-bold">{e.hiredFrom ? fmtDay(e.hiredFrom, true) : "—"}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-3xl border-2 border-border bg-card p-4 sm:p-5 space-y-3">
      <h2 className="text-xl font-bold flex items-center gap-2"><Sun className="w-5 h-5 text-primary" /> Employment &amp; holiday</h2>
      {body}
    </section>
  );
}

// ── Return-to-work: start a form ───────────────────────────────────────────

function RtwStartModal({ userId, name, spells, onClose, onOpened }: {
  userId: number;
  name: string;
  spells: TimelineSpell[];
  onClose: () => void;
  onOpened: (form: RtwForm) => void;
}) {
  const today = todayIso();
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState<string>(ABSENCE_TYPE_OPTIONS[0]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const open = spellsWithoutForm(spells);

  const go = async (body: { absenceStart: string; absenceEnd: string | null; absenceType: string | null }) => {
    setBusy(true);
    try {
      onOpened(await createForm({ userId, ...body }));
    } catch (err) {
      toast({ title: "Couldn't start the form", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const manualOk = start !== "" && start <= today && (end === "" || (end >= start && end <= today));

  return (
    <PeopleModal title={`Return-to-work form — ${name}`} onClose={onClose}>
      <div className="space-y-5">
        {open.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-lg font-bold">Absences from Planday with no form</h3>
            {open.map(s => (
              <button
                key={s.start}
                disabled={busy}
                onClick={() => go({ absenceStart: s.start, absenceEnd: s.end, absenceType: s.types.join(" + ") || null })}
                className="w-full text-left rounded-2xl border-2 border-amber-400 dark:border-amber-700 bg-amber-50/70 dark:bg-amber-950/30 p-4 flex items-center gap-3 hover:border-amber-500 disabled:opacity-50"
              >
                <HeartPulse className="w-6 h-6 text-amber-600 shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-lg font-bold">{fmtDayRange(s.start, s.end, true)} · {s.days} day{s.days === 1 ? "" : "s"}</span>
                  <span className="block text-base text-muted-foreground">{s.types.join(" + ")}{s.formState === "away" ? " · still off" : ""}</span>
                </span>
                <span className="shrink-0 h-12 px-4 rounded-xl bg-amber-600 text-white font-bold flex items-center gap-2">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenLine className="w-4 h-4" />} Start form
                </span>
              </button>
            ))}
          </section>
        )}

        <section className="rounded-2xl border-2 border-border p-4 space-y-3">
          <h3 className="text-lg font-bold">Record an absence Planday doesn't show</h3>
          <div>
            <label className="text-sm font-bold block mb-1" htmlFor="rtw-type">Type of absence</label>
            <select id="rtw-type" value={type} onChange={e => setType(e.target.value)}
              className="w-full h-14 px-4 rounded-2xl border-2 border-border bg-card text-lg font-bold">
              {ABSENCE_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-sm font-bold block mb-1" htmlFor="rtw-start">First day off</label>
              <input id="rtw-start" type="date" value={start} max={today} onChange={e => setStart(e.target.value)}
                className="w-full h-14 px-4 rounded-2xl border-2 border-border bg-card text-lg font-bold" />
            </div>
            <div>
              <label className="text-sm font-bold block mb-1" htmlFor="rtw-end">Last day off (optional)</label>
              <input id="rtw-end" type="date" value={end} min={start || undefined} max={today} onChange={e => setEnd(e.target.value)}
                className="w-full h-14 px-4 rounded-2xl border-2 border-border bg-card text-lg font-bold" />
            </div>
          </div>
          {start !== "" && !manualOk && (
            <p className="text-sm font-semibold text-destructive">The last day can't be before the first, and neither can be in the future.</p>
          )}
          <button
            disabled={busy || !manualOk}
            onClick={() => go({ absenceStart: start, absenceEnd: end || null, absenceType: type })}
            className="w-full h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <PenLine className="w-5 h-5" />} Start the form
          </button>
        </section>
      </div>
    </PeopleModal>
  );
}

// ── Timeline cards for attendance ──────────────────────────────────────────

const STATE_LABEL: Record<TimelineSpell["formState"], string> = {
  needed: "Form needed",
  missing: "No form on file",
  away: "Still off",
  draft: "Draft form",
  signed: "Form signed",
};

function AbsenceCard({ spell, form, highlight, onStart, onOpen }: {
  spell: TimelineSpell;
  form: RtwForm | null;
  highlight: boolean;
  onStart: () => void;
  onOpen: (id: number) => void;
}) {
  const state = spell.formState;
  const hasForm = spell.formId != null;
  return (
    <div className={cn(
      "rounded-2xl border-2 bg-card p-4 space-y-2",
      state === "needed" ? "border-amber-400 dark:border-amber-700" : "border-border",
      highlight && "ring-4 ring-primary/40",
    )}>
      <div className="flex items-start gap-3">
        <HeartPulse className={cn("w-6 h-6 shrink-0 mt-0.5", spell.sickness ? "text-rose-600" : "text-amber-600")} />
        <div className="flex-1 min-w-0">
          <p className="text-xl font-bold leading-snug">{fmtDayRange(spell.start, spell.end, true)}</p>
          <p className="text-base text-muted-foreground">
            {spell.days} day{spell.days === 1 ? "" : "s"} · {spell.types.join(" + ")}
          </p>
          {form?.reasonCategory && (
            <p className="text-base mt-1 line-clamp-2">{form.reasonCategory}{form.reasonDetails ? ` — ${form.reasonDetails}` : ""}</p>
          )}
        </div>
        <span className={cn(
          "shrink-0 text-sm font-bold px-2.5 py-1 rounded-lg",
          state === "needed" ? "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200" :
          state === "signed" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" :
          state === "draft" ? "bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200" :
          "bg-secondary text-muted-foreground",
        )}>
          {STATE_LABEL[state]}
        </span>
      </div>
      {hasForm ? (
        <button onClick={() => onOpen(spell.formId!)} className="w-full h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50">
          {state === "signed" ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <PenLine className="w-5 h-5" />}
          {state === "signed" ? "Open the form" : "Carry on with the form"}
        </button>
      ) : (
        <button
          onClick={onStart}
          className={cn(
            "w-full h-14 rounded-2xl text-lg font-bold flex items-center justify-center gap-2",
            state === "needed" ? "bg-amber-600 text-white hover:bg-amber-700" : "border-2 border-border hover:bg-secondary/50",
          )}
        >
          <PenLine className="w-5 h-5" /> {state === "away" ? "Start the form early" : state === "missing" ? "Add a form" : "Start form"}
        </button>
      )}
    </div>
  );
}

function FormEntryCard({ form, onOpen }: { form: RtwForm; onOpen: (id: number) => void }) {
  return (
    <button onClick={() => onOpen(form.id)} className="w-full text-left rounded-2xl border-2 border-border bg-card p-4 flex items-center gap-3 hover:border-primary/50">
      <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center shrink-0",
        form.status === "complete" ? "bg-emerald-100 dark:bg-emerald-950/40" : "bg-amber-100 dark:bg-amber-950/40")}>
        {form.status === "complete" ? <CheckCircle2 className="w-6 h-6 text-emerald-600" /> : <PenLine className="w-6 h-6 text-amber-600" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-lg font-bold">Return-to-work form — {absencePhrase(form.absenceType)} {fmtDayRange(form.absenceStart, form.absenceEnd, true)}</p>
        <p className="text-base text-muted-foreground line-clamp-2">
          {form.reasonCategory ?? "No reason recorded yet"}{form.reasonDetails ? ` — ${form.reasonDetails}` : ""}
          {form.status === "complete" ? ` · signed${form.managerName ? ` with ${form.managerName}` : ""}` : " · draft"}
        </p>
      </div>
      <ChevronRight className="w-6 h-6 text-muted-foreground shrink-0" />
    </button>
  );
}

// ── The record ─────────────────────────────────────────────────────────────

export function PersonRecord({ userId, ready }: { userId: number; ready: boolean }) {
  const queryClient = useQueryClient();
  const search = useSearch();
  const { state: authState } = useAuth();
  const currentUserId = authState.status === "authenticated" ? authState.user.id : null;
  const today = todayIso();
  const [from, setFrom] = useState<string | null>(null); // null = the default 12 months
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [modal, setModal] = useState<null | "rtw" | "book" | "note">(null);
  const [openForm, setOpenForm] = useState<RtwForm | null>(null);
  // Contracts — founder/HR accounts only (they carry pay); the server says
  // whether to ask at all, and re-checks every request.
  const canContracts = useCanManageContracts();
  const contracts = useContractHistory(userId, ready && canContracts);
  const [addingContract, setAddingContract] = useState(false);
  const [openContract, setOpenContract] = useState<OpenContract | null>(null);
  // Documents filed on the record + their onboarding uploads — People access;
  // founder-only ones are left out by the server for everyone else.
  const documents = usePersonDocuments(userId, ready);
  const [addingDocument, setAddingDocument] = useState(false);
  const [openDocument, setOpenDocument] = useState<OpenDocument | null>(null);

  const recordKey = ["people-record", userId, from ?? "default"];
  const record = useQuery<PersonRecordResponse>({
    queryKey: recordKey,
    queryFn: () => peopleFetch<PersonRecordResponse>(`/people/${userId}${from ? `?from=${from}` : ""}`),
    enabled: ready,
    retry: peopleRetry,
    // Keep showing the record while "Show older" loads — but never another
    // person's record while this one loads.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === userId ? prev : undefined),
  });
  const reviewsKey = ["employee-review-record", String(userId)];
  const reviews = useQuery<ReviewRecord>({
    queryKey: reviewsKey,
    queryFn: () => reviewsApi<ReviewRecord>(`/employee-reviews/${userId}`),
    enabled: ready,
    retry: peopleRetry,
  });

  // Same query (and cache) as the Employment panel — for the start date when
  // the app has no contract on file for them.
  const employment = useQuery<EmploymentResponse>({
    queryKey: ["people-employment", userId],
    queryFn: () => peopleFetch<EmploymentResponse>(`/people/${userId}/employment`),
    enabled: ready,
    retry: peopleRetry,
    staleTime: 5 * 60 * 1000,
  });

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["people-record", userId] });
    void queryClient.invalidateQueries({ queryKey: reviewsKey });
    void queryClient.invalidateQueries({ queryKey: ["people-list"] });
    void queryClient.invalidateQueries({ queryKey: ["rtw-mine"] });
  };
  const refreshReviews = () => {
    void queryClient.invalidateQueries({ queryKey: reviewsKey });
    void queryClient.invalidateQueries({ queryKey: ["people-list"] });
  };

  const openFormById = async (id: number) => {
    try {
      setOpenForm(await fetchForm(id));
    } catch (err) {
      toast({ title: "Couldn't open the form", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    }
  };
  const startFromSpell = async (s: TimelineSpell) => {
    try {
      setOpenForm(await createForm({ userId, absenceStart: s.start, absenceEnd: s.end, absenceType: s.types.join(" + ") || null }));
      refreshAll();
    } catch (err) {
      toast({ title: "Couldn't start the form", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    }
  };

  // A chase to-do lands here with ?spell=<userId>:<start> — ring that absence.
  const spellParam = new URLSearchParams(search).get("spell");
  const highlightStart = spellParam && spellParam.startsWith(`${userId}:`) ? spellParam.slice(String(userId).length + 1) : null;

  const data = record.data;
  const windowFrom = data?.window.from ?? minusMonths(today, 12);

  const grouped = useMemo(() => {
    const r = reviews.data;
    if (!r) return null;
    const g = groupRecordNotes(r.notes, new Set(r.meetings.map(m => m.id)));
    return { ...g, agreedNow: currentObjectives(g.openObjectives, r.meetings) };
  }, [reviews.data]);

  const timeline = useMemo(() => {
    if (!data) return [];
    const all = buildPersonTimeline({
      spells: data.spells,
      lates: data.lates,
      forms: data.forms,
      meetings: reviews.data?.meetings ?? [],
      looseNotes: grouped?.unattached ?? [],
      contracts: canContracts && contracts.data
        ? contractHistory(contracts.data.issued, contracts.data.uploaded).map(entry => ({ key: entry.key, date: entry.date, entry }))
        : [],
      documents: documents.data
        ? documentEntries(documents.data.documents, documents.data.onboarding).map(entry => ({ key: entry.key, date: entry.date, entry }))
        : [],
    });
    return withinWindow(all, windowFrom);
  }, [data, reviews.data, grouped, windowFrom, canContracts, contracts.data, documents.data]);

  const lockedError = [record.error, reviews.error, documents.error].find(e => e instanceof PeopleLockedError) as PeopleLockedError | undefined;
  if (lockedError) return <PeopleLockedCard error={lockedError} />;

  if (!ready || (record.isLoading && !data)) {
    return <div className="flex items-center justify-center gap-3 py-16 text-lg text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /> Loading the record…</div>;
  }
  if (record.error || !data) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <Link href="/people" className="inline-flex items-center gap-2 px-4 h-14 rounded-2xl bg-secondary text-lg font-bold"><ChevronLeft className="w-5 h-5" /> Everyone</Link>
        <div className="p-5 rounded-2xl bg-destructive/10 text-destructive text-lg font-semibold">{record.error instanceof Error ? record.error.message : "Couldn't load this record."}</div>
      </div>
    );
  }

  const p = data.person;
  const s = data.summary;
  const canManage = reviews.data?.canManage ?? false;
  const startDate = p.contractStartDate
    ?? (employment.data?.status === "ok" ? employment.data.employment.hiredFrom : null);
  const service = lengthOfService(startDate, today);
  const counts = timelineCounts(timeline);
  const visible = filterTimeline(timeline, filter);
  const byMeeting = grouped?.byMeeting ?? new Map();
  const meetingCardProps = {
    canManage,
    currentUserId,
    subjectId: p.id,
    subjectName: p.name,
    onChanged: refreshReviews,
  };
  const formsNeeded = data.spells.filter(x => x.formState === "needed").length;

  return (
    <div className="max-w-4xl mx-auto space-y-5 pb-24">
      <Link href="/people" className="inline-flex items-center gap-2 px-4 h-14 rounded-2xl bg-secondary hover:bg-secondary/70 text-lg font-bold transition-colors">
        <ChevronLeft className="w-5 h-5" /> Everyone
      </Link>

      {/* Who they are, and the three things you come here to do. */}
      <section className="rounded-3xl border-2 border-border bg-card p-4 sm:p-5 space-y-4">
        <div className="flex items-center gap-4">
          <UserAvatar name={p.name} avatarUrl={p.avatarUrl} size="xl" />
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-3xl font-bold leading-tight break-words">{p.name}{!p.isActive && <span className="text-lg text-muted-foreground font-sans"> · Leaver</span>}</h1>
            {startDate && (
              <p className="text-base text-muted-foreground">Started {fmtDay(startDate, true)}{service ? ` · ${service}` : ""}</p>
            )}
          </div>
        </div>
        {/* Their job title — what they do, not their app access. Keyed by
            person so moving between records never carries a draft across. */}
        <JobTitleField key={p.id} userId={p.id} initial={p.jobTitle} />
        <div className="grid gap-3 sm:grid-cols-3">
          <button onClick={() => setModal("rtw")}
            className={cn("h-16 rounded-2xl text-lg font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.99]",
              formsNeeded > 0 ? "bg-amber-600 text-white hover:bg-amber-700" : "border-2 border-border hover:bg-secondary/50")}>
            <HeartPulse className="w-6 h-6" /> Return-to-work form{formsNeeded > 0 ? ` (${formsNeeded})` : ""}
          </button>
          <button onClick={() => setModal("book")} disabled={!canManage}
            className="h-16 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.99] disabled:opacity-50">
            <CalendarDays className="w-6 h-6" /> Book a meeting / review
          </button>
          <button onClick={() => setModal("note")} disabled={!canManage}
            className="h-16 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 disabled:opacity-50">
            <Plus className="w-6 h-6" /> Write a note
          </button>
        </div>
      </section>

      {/* Attendance at a glance, against the policy triggers. */}
      <section className="space-y-3">
        <h2 className="text-xl font-bold flex items-center gap-2"><Clock className="w-5 h-5 text-primary" /> Attendance — last 12 months</h2>
        {!data.attendance.linked ? (
          <p className="text-base text-muted-foreground">Not linked to Planday yet, so there's no attendance to show — link them from Analytics → Employee Records.</p>
        ) : (
          <>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <Tile label="Sickness instances" value={s.sickInstances} sub={`Trigger at ${s.policy.sickInstances}`} alert={s.triggers.sickness} />
              <Tile label="Sick days" value={s.sickDays} />
              <Tile label="Lates" value={s.lates} sub={`Trigger at ${s.policy.lates}`} alert={s.triggers.lates} />
              <Tile label="Other absence" value={s.otherAbsenceDays} sub={`day${s.otherAbsenceDays === 1 ? "" : "s"} — Absent, dependants' or emergency leave`} />
            </div>
            {(s.triggers.sickness || s.triggers.lates) && (
              <div className="rounded-2xl border-2 border-rose-400 dark:border-rose-700 bg-rose-50 dark:bg-rose-950/30 p-4 flex items-center gap-3 flex-wrap">
                <AlertTriangle className="w-6 h-6 text-rose-600 shrink-0" />
                <p className="flex-1 min-w-0 text-base font-semibold text-rose-900 dark:text-rose-200">
                  Policy trigger reached — {s.triggers.sickness ? `${s.sickInstances} sickness instances` : ""}{s.triggers.sickness && s.triggers.lates ? " and " : ""}{s.triggers.lates ? `${s.lates} lates` : ""} in 12 months. The policy calls for a review meeting.
                </p>
                {canManage && (
                  <button onClick={() => setModal("book")} className="h-12 px-4 rounded-xl bg-rose-600 text-white font-bold">Book a review</button>
                )}
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              {fmtDay(s.windowStart, true)} to today. Policy: {s.policy.sickInstances} sickness instances or {s.policy.lates} lates in a rolling {s.policy.months} months → review meeting.
              {data.attendance.stale && " Couldn't reach Planday just now — showing attendance as last synced."}
            </p>
          </>
        )}
      </section>

      {grouped && grouped.agreedNow.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-bold flex items-center gap-2"><Target className="w-5 h-5 text-primary" /> What we agreed</h2>
          {grouped.agreedNow.map(n => (
            <AgreedObjective key={n.id} note={n} canManage={canManage} currentUserId={currentUserId} onChanged={refreshReviews} />
          ))}
        </section>
      )}

      <EmploymentPanel userId={userId} ready={ready} />

      <PersonHoursPanel userId={userId} ready={ready} />

      {canContracts && (
        <PersonContractsSection
          history={contracts.data}
          isLoading={contracts.isLoading}
          error={contracts.error}
          onOpen={setOpenContract}
          onAdd={() => setAddingContract(true)}
        />
      )}

      <PersonDocumentsSection
        data={documents.data}
        isLoading={documents.isLoading}
        error={documents.error}
        onOpen={setOpenDocument}
        onAdd={() => setAddingDocument(true)}
      />

      {/* Everything, in one line of time. */}
      <section className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="flex-1 min-w-0 text-xl font-bold flex items-center gap-2"><History className="w-5 h-5 text-primary" /> The record</h2>
          <button onClick={() => setAddingDocument(true)}
            className="h-12 px-4 rounded-xl border-2 border-border font-bold flex items-center gap-2 hover:bg-secondary/50">
            <FilePlus2 className="w-5 h-5" /> Add a document
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {TIMELINE_FILTERS.filter(f => f.key !== "contracts" || counts.contracts > 0).map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
              className={cn(
                "h-12 px-4 rounded-2xl border-2 text-base font-bold transition-colors",
                filter === f.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
              )}>
              {f.label} {counts[f.key]}
            </button>
          ))}
        </div>
        {reviews.error && !(reviews.error instanceof PeopleLockedError) && (
          <p className="text-base text-destructive">Couldn't load meetings and notes: {reviews.error instanceof Error ? reviews.error.message : "try again"}</p>
        )}

        {visible.length === 0 ? (
          <div className="text-center py-10 rounded-2xl bg-secondary/30">
            <p className="text-2xl font-bold">Nothing here in this period</p>
            <p className="text-base text-muted-foreground mt-1">Try another filter, or show older.</p>
          </div>
        ) : visible.map(e => {
          if (e.kind === "absence") {
            return (
              <AbsenceCard key={e.key} spell={e.spell} form={e.form} highlight={highlightStart === e.spell.start}
                onStart={() => void startFromSpell(e.spell)} onOpen={id => void openFormById(id)} />
            );
          }
          if (e.kind === "late") {
            return (
              <div key={e.key} className="rounded-2xl border-2 border-border bg-card px-4 py-3 flex items-center gap-3">
                <Clock className="w-5 h-5 text-amber-600 shrink-0" />
                <p className="flex-1 min-w-0 text-lg font-semibold">{fmtDay(e.date, true)}</p>
                <span className="text-sm font-bold px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">{e.late.label}</span>
              </div>
            );
          }
          if (e.kind === "form") return <FormEntryCard key={e.key} form={e.form} onOpen={id => void openFormById(id)} />;
          if (e.kind === "meeting") {
            return <MeetingCard key={e.key} meeting={e.meeting} notes={byMeeting.get(e.meeting.id) ?? []} {...meetingCardProps} />;
          }
          if (e.kind === "contract") return <ContractEntryCard key={e.key} entry={e.contract.entry} onOpen={setOpenContract} />;
          if (e.kind === "document") return <DocumentEntryCard key={e.key} entry={e.document.entry} onOpen={setOpenDocument} />;
          return <NoteCard key={e.key} note={e.note} canManage={canManage} currentUserId={currentUserId} onChanged={refreshReviews} />;
        })}

        <button
          onClick={() => setFrom(minusMonths(windowFrom, 12))}
          disabled={record.isFetching}
          className="w-full h-14 rounded-2xl border-2 border-dashed border-border text-lg font-bold flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 disabled:opacity-50"
        >
          {record.isFetching ? <Loader2 className="w-5 h-5 animate-spin" /> : <History className="w-5 h-5" />}
          Show older — before {fmtDay(windowFrom, true)}
        </button>
      </section>

      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Lock className="w-3.5 h-3.5" /> Private — People access only. Notes stay private to whoever wrote them until shared.
      </p>

      {modal === "rtw" && (
        <RtwStartModal userId={p.id} name={p.name} spells={data.spells} onClose={() => setModal(null)}
          onOpened={form => { setModal(null); setOpenForm(form); refreshAll(); }} />
      )}
      {modal === "book" && (
        <PeopleModal title={`Book a meeting — ${p.name}`} onClose={() => setModal(null)}>
          <BookMeeting subjectId={p.id} onDone={() => { setModal(null); refreshReviews(); }} onCancel={() => setModal(null)} />
        </PeopleModal>
      )}
      {modal === "note" && (
        <PeopleModal title={`Write a note — ${p.name}`} onClose={() => setModal(null)}>
          <WriteNote subjectId={p.id} subjectName={p.name} onDone={() => { setModal(null); refreshReviews(); }} onCancel={() => setModal(null)} />
        </PeopleModal>
      )}
      {addingContract && (
        <AddOldContractModal
          userId={p.id}
          personName={p.name}
          onClose={() => setAddingContract(false)}
          onUploaded={row => {
            setAddingContract(false);
            void queryClient.invalidateQueries({ queryKey: ["contract-history", p.id] });
            setOpenContract({ source: "uploaded", id: row.id });
          }}
        />
      )}
      {openContract && (
        <ContractOpenModal target={openContract} userId={p.id} personName={p.name} onClose={() => setOpenContract(null)} />
      )}
      {addingDocument && (
        <AddDocumentModal
          userId={p.id}
          personName={p.name}
          canSetVisibility={documents.data?.canSetVisibility ?? false}
          onClose={() => setAddingDocument(false)}
          onFiled={row => {
            setAddingDocument(false);
            void queryClient.invalidateQueries({ queryKey: personDocumentsKey(p.id) });
            if (!isFiledFounderOnly(row)) setOpenDocument({ source: "filed", id: row.id });
          }}
        />
      )}
      {openDocument && (
        <DocumentOpenModal target={openDocument} userId={p.id} personName={p.name} onClose={() => setOpenDocument(null)} />
      )}
      {openForm && (
        <PeopleModal title="Return-to-work form" onClose={() => { setOpenForm(null); refreshAll(); }} wide>
          <FormEditor
            form={openForm}
            isRtwManager
            onBack={() => { setOpenForm(null); refreshAll(); }}
            onDone={() => { setOpenForm(null); refreshAll(); }}
          />
        </PeopleModal>
      )}
    </div>
  );
}
