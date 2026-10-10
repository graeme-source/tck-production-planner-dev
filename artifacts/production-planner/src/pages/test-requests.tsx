/**
 * Test requests — Analytics → Test requests (Graeme, 2026-10-10; Objectives
 * E and F). Every change someone has been asked to test for real, who was
 * asked, and what they said. Managers and admins; the API enforces it too.
 *
 * Opens with ?new=1 (and &issue=ID, &title=…, &link=/path) straight into
 * "Request a test" — the Fix queue links here that way.
 */
import { useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Clock, ExternalLink, Image as ImageIcon, Loader2, Lock, RotateCcw, Rocket } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { feedTimestamp } from "@/lib/feed-time";
import { STATUS_LABELS, whenSummary, type TestStatus } from "@/lib/test-requests";
import { NewTestRequestModal, type NewTestPrefill } from "@/components/new-test-request-modal";
import { testerPhotoUrl, useCloseTestRequest, useTestRequestList, type ListTab, type TestRequestView, type TesterView } from "@/hooks/use-test-requests";

const TABS: Array<{ key: ListTab; label: string }> = [
  { key: "open", label: "Waiting" },
  { key: "problems", label: "Problems found" },
  { key: "answered", label: "Answered" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];

const STATUS_TONE: Record<TestStatus, string> = {
  waiting: "bg-secondary text-foreground",
  in_progress: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  passed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  problems: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
  skipped: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  closed: "bg-muted text-muted-foreground",
};

const ANSWER_TONE: Record<string, string> = {
  works_easy: "text-emerald-700 dark:text-emerald-400",
  works_confusing: "text-amber-700 dark:text-amber-400",
  doesnt_work: "text-rose-700 dark:text-rose-400",
  cant_test: "text-muted-foreground",
};

export default function TestRequestsPage() {
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.user.role : "viewer";
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const initialTab = (TABS.find(t => t.key === params.get("tab"))?.key ?? "open") as ListTab;
  const [tab, setTab] = useState<ListTab>(initialTab);
  const [newOpen, setNewOpen] = useState(false);
  const [prefill, setPrefill] = useState<NewTestPrefill | undefined>();

  useEffect(() => {
    if (params.get("new") !== "1") return;
    const issue = Number(params.get("issue"));
    setPrefill({ issueId: Number.isInteger(issue) && issue > 0 ? issue : null, title: params.get("title") ?? "", linkPath: params.get("link") ?? "" });
    setNewOpen(true);
    navigate("/test-requests", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const listQ = useTestRequestList(tab);
  const isManager = role === "admin" || role === "manager";

  if (!isManager) {
    return (
      <div className="p-4 sm:p-8 max-w-3xl mx-auto">
        <PageHeader title="Test requests" />
        <p className="text-lg text-muted-foreground">Test requests are for managers. If you've been asked to test something, it pops up for you on its own.</p>
      </div>
    );
  }

  const counts = listQ.data?.counts;

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-5xl mx-auto">
      <PageHeader title="Test requests" />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="text-lg text-muted-foreground max-w-2xl">
          Changes that have to be tried for real — on the station, at the right time — before we call them done. Whoever's asked gets a card until they answer. If it came from an issue report, the person who reported it is always asked.
        </p>
        <button
          type="button"
          onClick={() => { setPrefill(undefined); setNewOpen(true); }}
          className="h-16 px-7 rounded-2xl bg-sky-600 text-white text-xl font-bold flex items-center gap-3 shadow-lg shadow-sky-600/20 active:scale-[0.99] transition-all"
        >
          <ClipboardCheck className="w-6 h-6" /> Request a test
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-pressed={tab === t.key}
            className={cn("h-12 px-5 rounded-full text-base font-bold whitespace-nowrap border-2", tab === t.key ? "bg-foreground text-background border-foreground" : "border-border hover:bg-secondary/50")}
          >
            {t.label}{counts ? ` · ${counts[t.key]}` : ""}
          </button>
        ))}
      </div>

      {listQ.isLoading && <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />}
      {listQ.isError && <p className="text-lg font-semibold text-destructive">Couldn't load test requests — {(listQ.error as Error).message}</p>}
      {listQ.data && listQ.data.requests.length === 0 && (
        <div className="rounded-3xl border-2 border-dashed border-border p-10 text-center text-lg text-muted-foreground">Nothing here.</div>
      )}

      <div className="grid gap-4">
        {listQ.data?.requests.map(r => <RequestCard key={r.id} r={r} />)}
      </div>

      <NewTestRequestModal open={newOpen} onClose={() => setNewOpen(false)} prefill={prefill} />
    </div>
  );
}

function RequestCard({ r }: { r: TestRequestView }) {
  const close = useCloseTestRequest();
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState("");
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-3xl border-2 border-border bg-card p-5 sm:p-6 space-y-4 shadow-sm">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl sm:text-2xl font-display font-bold leading-tight">{r.title}</h2>
          <p className="text-sm text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2">
            {r.source === "deploy" && <span className="inline-flex items-center gap-1 font-semibold"><Rocket className="w-4 h-4" /> From a deploy{r.fixRef ? ` (${r.fixRef})` : ""} ·</span>}
            Asked by {r.createdByName} · {feedTimestamp(r.createdAt)}
          </p>
        </div>
        <span className={cn("h-9 px-4 rounded-full text-base font-bold flex items-center", STATUS_TONE[r.status])}>{STATUS_LABELS[r.status]}</span>
      </div>

      <button type="button" onClick={() => setExpanded(e => !e)} className="block text-left w-full">
        <p className={cn("text-base whitespace-pre-wrap", !expanded && "line-clamp-3")}>{r.steps}</p>
      </button>

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-base">
        <span className="flex items-center gap-1.5 text-muted-foreground"><Clock className="w-4 h-4" /> {whenSummary(r)}</span>
        {r.linkPath && (
          <Link href={r.linkPath} className="flex items-center gap-1.5 font-semibold text-sky-700 dark:text-sky-400 underline underline-offset-4">
            <ExternalLink className="w-4 h-4" /> {r.linkPath}
          </Link>
        )}
        {r.issue && (
          <Link href={`/reports?tab=issues&issueId=${r.issue.id}`} className="flex items-center gap-1.5 font-semibold text-rose-700 dark:text-rose-400 underline underline-offset-4 min-w-0">
            <AlertTriangle className="w-4 h-4 shrink-0" /> <span className="truncate max-w-[20rem]">Issue #{r.issue.id}{r.issue.description ? `: “${r.issue.description}”` : ""}</span>
          </Link>
        )}
      </div>

      <div className="grid gap-2">
        {r.testers.map(t => <TesterRow key={t.userId} requestId={r.id} t={t} />)}
      </div>

      {r.closedAt && (
        <p className="text-base text-muted-foreground flex items-center gap-2"><Lock className="w-4 h-4" /> Closed by {r.closedByName} · {feedTimestamp(r.closedAt)}{r.closeNote ? ` — ${r.closeNote}` : ""}</p>
      )}

      {close.isError && <p className="text-base font-semibold text-destructive">Couldn't save — {(close.error as Error).message}</p>}
      <div className="flex flex-wrap gap-2">
        {r.closedAt ? (
          <button type="button" onClick={() => close.mutate({ id: r.id, reopen: true })} disabled={close.isPending} className="h-12 px-5 rounded-2xl border-2 border-border text-base font-bold flex items-center gap-2 hover:bg-secondary/50 disabled:opacity-50">
            {close.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <RotateCcw className="w-5 h-5" />} Reopen — ask again
          </button>
        ) : closing ? (
          <div className="w-full space-y-2">
            <input value={note} onChange={e => setNote(e.target.value)} maxLength={1000} placeholder="Why? (optional) e.g. Fixed again — new test coming" className="w-full h-12 px-4 rounded-2xl border-2 border-border bg-card text-base" />
            <div className="flex gap-2">
              <button type="button" onClick={() => setClosing(false)} className="h-12 px-5 rounded-2xl border-2 border-border text-base font-bold">Cancel</button>
              <button type="button" onClick={() => close.mutate({ id: r.id, note }, { onSuccess: () => setClosing(false) })} disabled={close.isPending} className="h-12 px-5 rounded-2xl bg-foreground text-background text-base font-bold flex items-center gap-2 disabled:opacity-50">
                {close.isPending && <Loader2 className="w-5 h-5 animate-spin" />} Close it — stop asking
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setClosing(true)} className="h-12 px-5 rounded-2xl border-2 border-border text-base font-bold flex items-center gap-2 hover:bg-secondary/50">
            <CheckCircle2 className="w-5 h-5" /> Close
          </button>
        )}
      </div>
    </div>
  );
}

function TesterRow({ requestId, t }: { requestId: number; t: TesterView }) {
  const state = t.answer
    ? <span className={cn("font-bold", ANSWER_TONE[t.answer])}>{t.answerLabel}</span>
    : t.startedAt
      ? <span className="font-semibold text-sky-700 dark:text-sky-400">Trying it now</span>
      : <span className="text-muted-foreground">Not answered yet</span>;
  return (
    <div className="rounded-2xl bg-secondary/50 px-4 py-3 flex flex-wrap items-start gap-x-4 gap-y-1">
      <div className="min-w-0 flex-1">
        <p className="text-base">
          <span className="font-bold">{t.name}</span>
          {t.isReporter && <span className="text-sm text-muted-foreground"> · reported it</span>}
          {" — "}{state}
          {t.answeredAt && <span className="text-sm text-muted-foreground"> · {feedTimestamp(t.answeredAt)}</span>}
          {!t.answer && t.snoozeCount > 0 && <span className="text-sm text-muted-foreground"> · put off {t.snoozeCount}×</span>}
        </p>
        {t.note && <p className="text-base mt-1 whitespace-pre-wrap">“{t.note}”</p>}
      </div>
      {t.hasPhoto && (
        <a href={testerPhotoUrl(requestId, t.userId)} target="_blank" rel="noreferrer" className="shrink-0" aria-label={`${t.name}'s photo`}>
          <img src={testerPhotoUrl(requestId, t.userId)} alt="" className="w-20 h-20 rounded-xl object-cover border border-border" onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
          <span className="sr-only"><ImageIcon /> photo</span>
        </a>
      )}
    </div>
  );
}
