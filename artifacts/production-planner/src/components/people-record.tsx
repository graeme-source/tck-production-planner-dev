/**
 * One person's record — the single place for everything about them
 * (Graeme, 2026-09-25): who they are, their attendance over the last 12
 * months against the policy triggers, holiday and contract from Planday,
 * and ONE timeline of absences (each with its return-to-work form), lates,
 * forms, reviews and their write-ups. Start a return-to-work form or book a
 * review from the big buttons at the top — ONE "Book a review", classified
 * (Graeme, 2026-10-12), never a different button per kind.
 *
 * Reuses rather than rewrites: the review cards and write-up come from
 * components/people/review-notes.tsx, the return-to-work form from
 * components/rtw-form-editor.tsx. Data: /api/people/:id (attendance +
 * forms), /api/person-documents/person/:id (documents filed on the record
 * + their onboarding uploads, founder-only ones left out by the server for
 * anyone else), /api/people-reviews/person/:id (reviews = classified record
 * entries + their write-ups, private-note rules applied on the server), /api/people/:id/employment (Planday, loaded on its
 * own so a slow or failed Planday never holds up the rest of the page).
 */
import { useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock, Clock3, FilePlus2, FileSignature, FolderOpen,
  HeartPulse, Loader2, Lock, PenLine, RefreshCw, Sun, Target, History, ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { peopleFetch, peopleRetry, PeopleLockedError } from "@/hooks/use-people-gate";
import { UserAvatar } from "@/components/user-avatar";
import { PeopleModal } from "@/components/people-modal";
import { FormEditor, type RtwForm } from "@/components/rtw-form-editor";
import { ReviewTimelineCard, ReviewNoteCard, AgreedObjectiveCard } from "@/components/people/review-notes";
import { BookReviewForm } from "@/components/people/book-review";
import { useRefreshEntries } from "@/components/people/reviews-api";
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
import { PersonEmergencyContactPanel } from "@/components/emergency-contacts/person-emergency-contact-panel";
import { PeopleSheet } from "@/components/people-sheet";
import { RecordPanel, RecordTimelineCard, useRecordFacts } from "@/components/people/record-panel";
import { ReviewStatusBadge } from "@/components/people/review-status-badge";
import { PolicyTriggerBanner } from "@/components/people/policy-trigger-banner";
import { needsPolicyReview, type PolicyReviewRef } from "@workspace/people-reviews";
import { defaultHoursRange } from "@/components/hours-range-picker";
import type { PersonHoursResponse } from "@/lib/hours-worked-view";
import {
  fmtAmount, sectionFromSearch, recordEntriesSummary, hoursSummary, holidaySummary, contractsSummary, documentsSummary, agreedSummary,
  type RecordSection, type SectionSummary,
} from "@/lib/person-record-sections";

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

// ── Side panels: a big button each, opening a sheet ────────────────────────

const SECTION_TITLE: Record<RecordSection, string> = {
  hours: "Hours worked",
  holiday: "Employment & holiday",
  contracts: "Contracts",
  documents: "Documents",
  emergency: "Emergency contact",
  agreed: "What we agreed",
  record: "Reviews & records",
};

const SECTION_ICON: Record<RecordSection, React.ComponentType<{ className?: string }>> = {
  hours: Clock3,
  holiday: Sun,
  contracts: FileSignature,
  documents: FolderOpen,
  emergency: HeartPulse,
  agreed: Target,
  record: ClipboardList,
};

/** One big tappable card: the section's name and one plain line about
 *  what's inside. `compact` is the phone / iPad-portrait grid above
 *  Attendance; otherwise it's the stack in the right-hand column. */
function SectionCard({ section, summary, onOpen, compact }: {
  section: RecordSection;
  summary: SectionSummary;
  onOpen: () => void;
  compact: boolean;
}) {
  const Icon = SECTION_ICON[section];
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className={cn(
        "w-full text-left rounded-2xl border-2 bg-card flex flex-col gap-1 transition-all hover:border-primary/50 active:scale-[0.99]",
        compact ? "p-3 min-h-[4.5rem]" : "p-4 min-h-[5.5rem]",
        summary.tone === "alert" ? "border-rose-400 dark:border-rose-700"
          : summary.tone === "warn" ? "border-amber-400 dark:border-amber-700"
          : "border-border",
      )}
    >
      <span className="flex items-center gap-2 w-full">
        <Icon className={cn("shrink-0", compact ? "w-5 h-5" : "w-6 h-6",
          section === "emergency" ? "text-red-600 dark:text-red-400" : "text-primary")} />
        <span className={cn("flex-1 min-w-0 font-bold leading-tight", compact ? "text-base" : "text-base @5xl/page:text-lg")}>{SECTION_TITLE[section]}</span>
        <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
      </span>
      <span className={cn("block text-muted-foreground leading-snug line-clamp-2",
        compact ? "text-sm" : "text-base",
        summary.tone === "alert" && "text-rose-700 dark:text-rose-300 font-semibold",
        summary.tone === "warn" && "text-amber-800 dark:text-amber-200 font-semibold")}>
        {summary.line}
      </span>
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
  const [modal, setModal] = useState<null | "rtw" | "book">(null);
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
  // The side panel open in a sheet — ?section=holiday opens one from a link.
  const [section, setSection] = useState<RecordSection | null>(() => sectionFromSearch(search));
  // Reviews & records (components/people/record-panel.tsx). The server only
  // answers for the founder / People access and never on your own record —
  // anyone else gets an error here and the section simply doesn't show.
  const recordEntries = useRecordFacts(userId, ready);
  const [openEntry, setOpenEntry] = useState<number | null>(null);
  // Same query (and cache) as the Hours worked panel's default range, for
  // the one-line summary on its button.
  const hoursRange = useMemo(defaultHoursRange, []);
  const hours = useQuery<PersonHoursResponse>({
    queryKey: ["people-hours", userId, hoursRange.from, hoursRange.to],
    queryFn: () => peopleFetch<PersonHoursResponse>(`/people/${userId}/hours?from=${hoursRange.from}&to=${hoursRange.to}`),
    enabled: ready,
    retry: peopleRetry,
    staleTime: 5 * 60 * 1000,
  });

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
  const refreshEntries = useRefreshEntries(userId);

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
    void queryClient.invalidateQueries({ queryKey: ["people-list"] });
    void queryClient.invalidateQueries({ queryKey: ["rtw-mine"] });
  };
  // A review booked, held, cancelled or written up: its entries, the badges,
  // the list and the policy trigger banner (useRefreshEntries does all four).
  const refreshReviews = refreshEntries;

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

  // Reviews are classified record entries (migration 0178). For the
  // timeline each one is a "meeting" card; for "What we agreed" its
  // write-up's open objectives, latest review first (same grouping rules as
  // before, keyed by entry).
  const reviewCards = useMemo(() => (recordEntries.data?.entries ?? []).map(entry => ({
    id: entry.id, scheduledFor: entry.meetingDate ?? entry.entryDate, heldAt: entry.heldAt, createdAt: entry.createdAt, entry,
  })), [recordEntries.data]);
  const grouped = useMemo(() => {
    const r = recordEntries.data;
    if (!r) return null;
    const notes = [...r.entries.flatMap(e => e.writeUp), ...r.looseNotes].map(n => ({ ...n, meetingId: n.entryId }));
    const g = groupRecordNotes(notes, new Set(r.entries.map(e => e.id)));
    return { ...g, agreedNow: currentObjectives(g.openObjectives, reviewCards) };
  }, [recordEntries.data, reviewCards]);

  const timeline = useMemo(() => {
    if (!data) return [];
    const all = buildPersonTimeline({
      spells: data.spells,
      lates: data.lates,
      forms: data.forms,
      meetings: reviewCards,
      looseNotes: recordEntries.data?.looseNotes ?? [],
      contracts: canContracts && contracts.data
        ? contractHistory(contracts.data.issued, contracts.data.uploaded).map(entry => ({ key: entry.key, date: entry.date, entry }))
        : [],
      documents: documents.data
        ? documentEntries(documents.data.documents, documents.data.onboarding).map(entry => ({ key: entry.key, date: entry.date, entry }))
        : [],
      // The entries themselves are cards above; these are the moments in
      // their life — a warning expiring, a review closed, a reclassification.
      reviews: (recordEntries.facts?.events ?? [])
        .filter(event => event.kind !== "entry" && event.kind !== "meeting")
        .map(event => ({ key: event.key, date: event.date, event })),
    });
    return withinWindow(all, windowFrom);
  }, [data, reviewCards, recordEntries.data, windowFrom, canContracts, contracts.data, documents.data, recordEntries.facts]);

  const lockedError = [record.error, recordEntries.error, documents.error].find(e => e instanceof PeopleLockedError) as PeopleLockedError | undefined;
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
  // The employment-record lock (server: lib/people-write-access.ts): only
  // Graeme, and People access on anyone's record but their own. Read-only
  // otherwise — the server refuses the writes regardless.
  const canWrite = p.canWrite !== false;
  const s = data.summary;
  // Reviews load only for the founder / People access, never on your own
  // record (the server answers 404 otherwise), so loaded + canWrite = may book.
  const canManage = recordEntries.data != null && canWrite;
  const viewerId = recordEntries.data?.viewerId ?? currentUserId;
  const startDate = p.contractStartDate
    ?? (employment.data?.status === "ok" ? employment.data.employment.hiredFrom : null);
  const service = lengthOfService(startDate, today);
  const counts = timelineCounts(timeline);
  const visible = filterTimeline(timeline, filter);
  const formsNeeded = data.spells.filter(x => x.formState === "needed").length;

  // The side panels, in the order they're asked about most. Contracts only
  // for the founder/HR account (they carry pay); What we agreed only when
  // something is open.
  const agreedNow = grouped?.agreedNow ?? [];
  const showRecord = recordEntries.data != null || (recordEntries.isLoading && ready);
  // The review a policy trigger line names: scroll to its card in the
  // timeline, or (older than the window shown) open it in the record panel.
  const openPolicyReview = (r: PolicyReviewRef) => {
    if (!showRecord) return;
    setFilter("all");
    requestAnimationFrame(() => {
      const el = document.getElementById(`person-meeting-${r.id}`);
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
      setOpenEntry(r.id);
      setSection("record");
    });
  };
  const openEntryInPanel = (id: number) => { setOpenEntry(id); setSection("record"); };
  const sections: Array<{ key: RecordSection; summary: SectionSummary }> = [
    ...(showRecord ? [{ key: "record" as const, summary: recordEntriesSummary(recordEntries.facts?.summary, recordEntries.isLoading, !!recordEntries.error) }] : []),
    { key: "hours", summary: hoursSummary(hours.data, hours.isLoading || !ready) },
    { key: "holiday", summary: holidaySummary(employment.data, employment.isLoading || !ready) },
    ...(agreedNow.length > 0 ? [{ key: "agreed" as const, summary: agreedSummary(agreedNow.length) }] : []),
    { key: "documents", summary: documentsSummary(documents.data, documents.isLoading, !!documents.error) },
    ...(canContracts ? [{ key: "contracts" as const, summary: contractsSummary(contracts.data, contracts.isLoading, !!contracts.error) }] : []),
    { key: "emergency", summary: { line: "Tap to show — every look is recorded", tone: "plain" } },
  ];
  const sectionCards = (compact: boolean) => sections.map(x => (
    <SectionCard key={x.key} section={x.key} summary={x.summary} compact={compact} onOpen={() => setSection(x.key)} />
  ));
  const openSection = (section === "contracts" && !canContracts) || (section === "record" && !showRecord) ? null : section;

  return (
    <div className="@container/page max-w-4xl lg:max-w-7xl mx-auto space-y-5 pb-24">
      <Link href="/people" className="inline-flex items-center gap-2 px-4 h-14 rounded-2xl bg-secondary hover:bg-secondary/70 text-lg font-bold transition-colors">
        <ChevronLeft className="w-5 h-5" /> Everyone
      </Link>

      {/* Two columns once there's room (iPad landscape, desktop): the record
          on the left, the side panels as a stack of buttons on the right.
          Narrower (iPad portrait, phone): one column, with the buttons in a
          grid under the header. Container queries, so it follows the space
          the page really has beside the app sidebar. */}
      <div className="@2xl/page:grid @2xl/page:grid-cols-[minmax(0,1fr)_13rem] @5xl/page:grid-cols-[minmax(0,3fr)_minmax(0,1fr)] @2xl/page:gap-4 @5xl/page:gap-6 @2xl/page:items-start">
      <div className="@container/main min-w-0 space-y-5">

      {/* Who they are, and the three things you come here to do. */}
      <section className="rounded-3xl border-2 border-border bg-card p-4 sm:p-5 space-y-4">
        <div className="flex items-center gap-4">
          <UserAvatar name={p.name} avatarUrl={p.avatarUrl} size="xl" />
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-3xl font-bold leading-tight break-words">{p.name}{!p.isActive && <span className="text-lg text-muted-foreground font-sans"> · Leaver</span>}</h1>
            {startDate && (
              <p className="text-base text-muted-foreground">Started {fmtDay(startDate, true)}{service ? ` · ${service}` : ""}</p>
            )}
            {recordEntries.facts && (
              <button type="button" onClick={() => setSection("record")} className="mt-1 text-left">
                <ReviewStatusBadge badge={recordEntries.facts.badge} liveWarningUntil={recordEntries.facts.liveWarningUntil} size="sm" />
              </button>
            )}
          </div>
        </div>
        {/* Their job title — what they do, not their app access. Keyed by
            person so moving between records never carries a draft across. */}
        <JobTitleField key={p.id} userId={p.id} initial={p.jobTitle} readOnly={!canWrite} />
        {!canWrite && p.readOnlyNote && (
          <p className="rounded-2xl bg-secondary/50 px-4 py-3 text-base font-semibold flex items-center gap-2">
            <Lock className="w-5 h-5 shrink-0" /> {p.readOnlyNote}
          </p>
        )}
        {/* ONE button for every kind of review — classified as it's booked,
            and re-classifiable afterwards (Graeme, 2026-10-12). */}
        <div className="grid gap-3 @sm/main:grid-cols-2">
          <button onClick={() => setModal("rtw")}
            className={cn("min-h-14 px-3 py-2 rounded-2xl text-base @3xl/main:text-lg font-bold leading-tight text-center flex items-center justify-center gap-2 transition-all active:scale-[0.99]",
              formsNeeded > 0 ? "bg-amber-600 text-white hover:bg-amber-700" : "border-2 border-border hover:bg-secondary/50")}>
            <HeartPulse className="w-6 h-6 shrink-0" /> Return-to-work form{formsNeeded > 0 ? ` (${formsNeeded})` : ""}
          </button>
          <button onClick={() => setModal("book")} disabled={!canManage}
            className="min-h-14 px-3 py-2 rounded-2xl bg-primary text-primary-foreground text-base @3xl/main:text-lg font-bold leading-tight text-center flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.99] disabled:opacity-50">
            <CalendarDays className="w-6 h-6 shrink-0" /> Schedule a meeting
          </button>
        </div>
      </section>

      {/* Phone and iPad portrait: the side panels as a grid of buttons,
          straight under the header. */}
      <nav aria-label={`More about ${p.name}`} className="grid gap-2 grid-cols-2 @2xl/page:hidden">
        {sectionCards(true)}
      </nav>

      {/* Attendance at a glance, against the policy triggers. */}
      <section className="space-y-3">
        <h2 className="text-xl font-bold flex items-center gap-2"><Clock className="w-5 h-5 text-primary" /> Attendance — last 12 months</h2>
        {!data.attendance.linked ? (
          <p className="text-base text-muted-foreground">Not linked to Planday yet, so there's no attendance to show — link them from Analytics → Employee Records.</p>
        ) : (
          <>
            <div className="grid gap-3 grid-cols-2 @2xl/main:grid-cols-4">
              <Tile label="Sickness instances" value={s.sickInstances} sub={`Trigger at ${s.policy.sickInstances}`} alert={needsPolicyReview(data.triggerReview?.sickness)} />
              <Tile label="Sick days" value={s.sickDays} />
              <Tile label="Lates" value={s.lates} sub={`Trigger at ${s.policy.lates}`} alert={needsPolicyReview(data.triggerReview?.lates)} />
              <Tile label="Other absence" value={s.otherAbsenceDays} sub={`day${s.otherAbsenceDays === 1 ? "" : "s"} — Absent, dependants' or emergency leave`} />
            </div>
            {/* Each trigger: red while a review is still needed (due / due
                again); calm once one is booked or held (Graeme, 2026-10-12). */}
            {([data.triggerReview?.sickness, data.triggerReview?.lates] as const).map(t => t && (
              <PolicyTriggerBanner key={t.kind} status={t} months={s.policy.months} canManage={canManage}
                onBook={() => setModal("book")} onOpenReview={openPolicyReview} />
            ))}
            <p className="text-sm text-muted-foreground">
              {fmtDay(s.windowStart, true)} to today. Policy: {s.policy.sickInstances} sickness instances or {s.policy.lates} lates in a rolling {s.policy.months} months → review meeting.
              {data.attendance.stale && " Couldn't reach Planday just now — showing attendance as last synced."}
            </p>
          </>
        )}
      </section>

      {/* Everything, in one line of time — straight after Attendance. */}
      <section className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="flex-1 min-w-0 text-xl font-bold flex items-center gap-2"><History className="w-5 h-5 text-primary" /> The record</h2>
          {canWrite && (
            <button onClick={() => setAddingDocument(true)}
              className="h-12 px-4 rounded-xl border-2 border-border font-bold flex items-center gap-2 hover:bg-secondary/50">
              <FilePlus2 className="w-5 h-5" /> Add a document
            </button>
          )}
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
        {canWrite && recordEntries.error && !(recordEntries.error instanceof PeopleLockedError) && (
          <p className="text-base text-destructive">Couldn't load reviews: {recordEntries.error instanceof Error ? recordEntries.error.message : "try again"}</p>
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
            return (
              <div key={e.key} id={`person-meeting-${e.meeting.id}`} className="scroll-mt-4">
                <ReviewTimelineCard entry={e.meeting.entry} classifications={recordEntries.data?.classifications ?? []}
                  stages={recordEntries.data?.stages ?? []} viewerId={viewerId} canWrite={canManage} personName={p.name}
                  onOpen={() => openEntryInPanel(e.meeting.id)} onChanged={refreshReviews} />
              </div>
            );
          }
          if (e.kind === "contract") return <ContractEntryCard key={e.key} entry={e.contract.entry} onOpen={setOpenContract} />;
          if (e.kind === "document") return <DocumentEntryCard key={e.key} entry={e.document.entry} onOpen={setOpenDocument} />;
          if (e.kind === "review") {
            return <RecordTimelineCard key={e.key} event={e.review.event} onOpen={openEntryInPanel} />;
          }
          return <ReviewNoteCard key={e.key} note={e.note} viewerId={viewerId} canWrite={canManage} personName={p.name} onChanged={refreshReviews} />;
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
        <Lock className="w-3.5 h-3.5" /> Private — People access only. Write-ups stay private to whoever wrote them until shared.
      </p>
      </div>

      {/* iPad landscape and wider: the side panels as a column of buttons,
          kept in view while the timeline scrolls. */}
      <aside aria-label={`More about ${p.name}`} className="hidden @2xl/page:flex flex-col gap-3 sticky top-0">
        {sectionCards(false)}
      </aside>
      </div>

      {/* The open side panel. Same components as before, moved in here —
          their own saving and buttons are unchanged. */}
      {openSection && (
        <PeopleSheet title={`${SECTION_TITLE[openSection]} — ${p.name}`} onClose={() => setSection(null)}>
          {openSection === "hours" && <PersonHoursPanel userId={userId} ready={ready} />}
          {openSection === "holiday" && <EmploymentPanel userId={userId} ready={ready} />}
          {openSection === "contracts" && (
            <PersonContractsSection
              history={contracts.data}
              isLoading={contracts.isLoading}
              error={contracts.error}
              onOpen={setOpenContract}
              onAdd={() => setAddingContract(true)}
            />
          )}
          {/* Their emergency contact — tap to show; every look is logged. */}
          {openSection === "emergency" && <PersonEmergencyContactPanel userId={userId} personName={p.name} />}
          {openSection === "documents" && (
            <PersonDocumentsSection
              data={documents.data}
              isLoading={documents.isLoading}
              error={documents.error}
              onOpen={setOpenDocument}
              onAdd={() => setAddingDocument(true)}
              readOnly={!canWrite}
            />
          )}
          {openSection === "record" && (
            <RecordPanel userId={userId} ready={ready} openEntryId={openEntry} onOpenEntry={setOpenEntry}
              person={{ id: p.id, name: p.name, email: recordEntries.data?.person.email ?? null, isActive: p.isActive }} />
          )}
          {openSection === "agreed" && (
            <section className="space-y-3">
              {agreedNow.length === 0 ? (
                <p className="text-base text-muted-foreground py-2">Nothing agreed is open right now.</p>
              ) : agreedNow.map(n => (
                <AgreedObjectiveCard key={n.id} note={n} viewerId={viewerId} canWrite={canManage} onChanged={refreshReviews} />
              ))}
            </section>
          )}
        </PeopleSheet>
      )}

      {modal === "rtw" && (
        <RtwStartModal userId={p.id} name={p.name} spells={data.spells} onClose={() => setModal(null)}
          onOpened={form => { setModal(null); setOpenForm(form); refreshAll(); }} />
      )}
      {modal === "book" && recordEntries.data && (
        <PeopleModal title={`Schedule a meeting — ${p.name}`} onClose={() => setModal(null)} wide>
          {/* Then the review opens, to write it up or change anything. */}
          <BookReviewForm data={recordEntries.data} onCancel={() => setModal(null)}
            onCreated={id => { setModal(null); refreshReviews(); openEntryInPanel(id); }} />
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
        <DocumentOpenModal target={openDocument} userId={p.id} personName={p.name} onClose={() => setOpenDocument(null)} readOnly={!canWrite} />
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
