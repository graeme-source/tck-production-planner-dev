/**
 * Founder — employment contracts (Graeme, 2026-09-07).
 *
 * One master template lives in the system; this page is the only place it
 * can be read or edited, and the account gate is the founder's email (same
 * rule as the rest of the founder area — contracts carry pay, so role
 * checks aren't enough). From here the founder generates a per-person
 * contract: pick the employee, type rate of pay / job title / weekly hours /
 * start date, preview the exact filled text, and issue it. The contract
 * lands in that employee's hub — theirs and the founder's eyes only.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Redirect } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { PageHeader } from "@/components/page-header";
import { FounderNav } from "@/components/founder-nav";
import { toast } from "@/hooks/use-toast";
import { printContract } from "@/components/contract-print";
import { ContractPaper } from "@/components/contract-view";
import {
  Check, ChevronRight, FileDown, FileSignature, Loader2, Pencil, Printer, Send, Trash2, X, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const FOUNDER_EMAIL = "graeme@thecalzonekitchen.co.uk";

interface Template {
  id: number;
  name: string;
  body: string;
  defaultJobTitle: string;
  defaultWeeklyHours: string;
  updatedAt: string;
  placeholders: string[];
  knownFields: string[];
}

interface Person { id: number; name: string; email: string }

interface IssuedRow {
  id: number;
  userId: number;
  employeeName: string;
  jobTitle: string;
  rateOfPay: string;
  weeklyHours: string;
  startDate: string;
  issueDate: string;
  issuedAt: string;
  acknowledgedAt: string | null;
  signedInitials: string | null;
}

async function jsonOrThrow(res: Response) {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data;
}

function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

// ── Contract viewer (founder side) ─────────────────────────────────────────

function ContractDialog({ contractId, onClose }: { contractId: number; onClose: () => void }) {
  const { state } = useAuth();
  const meId = state.status === "authenticated" ? state.user.id : null;
  const { data, isLoading } = useQuery<IssuedRow & { body: string }>({
    queryKey: ["contracts", "one", contractId, meId],
    queryFn: () => fetch(`${BASE}/api/contracts/${contractId}`, { credentials: "include" }).then(jsonOrThrow),
    enabled: meId !== null,
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl max-w-3xl w-full max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-border flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold truncate">{data ? `Contract — ${data.employeeName}` : "Contract"}</h2>
          <div className="flex items-center gap-2">
            {data?.acknowledgedAt && (
              <a
                href={`${BASE}/api/contracts/${data.id}/signed.pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-secondary/50"
                title="The archival copy saved when they signed"
              >
                <FileDown className="w-4 h-4" /> Signed PDF
              </a>
            )}
            {data && (
              <button
                onClick={() => printContract(`Employment contract — ${data.employeeName}`, data.body)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-secondary/50"
              >
                <Printer className="w-4 h-4" /> Print
              </button>
            )}
            <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-secondary/50">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto p-4 sm:p-6 bg-secondary/30">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : data ? (
            <ContractPaper body={data.body} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── New contract ───────────────────────────────────────────────────────────

function NewContractCard({ template, people, meId }: { template: Template; people: Person[]; meId: number }) {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<number | "">("");
  const [rateOfPay, setRateOfPay] = useState("");
  const [jobTitle, setJobTitle] = useState(template.defaultJobTitle);
  const [weeklyHours, setWeeklyHours] = useState(template.defaultWeeklyHours);
  const [startDate, setStartDate] = useState(todayIso());
  const [preview, setPreview] = useState<{ body: string; employeeName: string } | null>(null);

  const fields = userId !== "" && rateOfPay.trim() && jobTitle.trim() && weeklyHours.trim() && startDate
    ? { userId: Number(userId), rateOfPay: rateOfPay.trim(), jobTitle: jobTitle.trim(), weeklyHours: weeklyHours.trim(), startDate }
    : null;

  const previewMut = useMutation({
    mutationFn: () => fetch(`${BASE}/api/contracts/preview`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    }).then(jsonOrThrow),
    onSuccess: (data: { body: string; employeeName: string }) => setPreview(data),
    onError: (e: Error) => toast({ title: "Can't preview", description: e.message, variant: "destructive" }),
  });

  const issueMut = useMutation({
    mutationFn: () => fetch(`${BASE}/api/contracts/generate`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    }).then(jsonOrThrow),
    onSuccess: (row: IssuedRow) => {
      setPreview(null);
      setUserId(""); setRateOfPay("");
      setJobTitle(template.defaultJobTitle); setWeeklyHours(template.defaultWeeklyHours);
      setStartDate(todayIso());
      queryClient.invalidateQueries({ queryKey: ["contracts", "issued", meId] });
      toast({ title: `Contract issued to ${row.employeeName}`, description: "It's now in their Employee Hub, and they've been notified." });
    },
    onError: (e: Error) => toast({ title: "Not issued", description: e.message, variant: "destructive" }),
  });

  const inputCls = "w-full h-12 px-3 rounded-xl border border-border bg-background text-base focus:outline-none focus:ring-2 focus:ring-primary/40";

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Send className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">New contract</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="space-y-1.5 sm:col-span-2">
          <span className="text-sm font-medium">Employee</span>
          <select value={userId} onChange={e => setUserId(e.target.value === "" ? "" : Number(e.target.value))} className={inputCls}>
            <option value="">Choose a team member…</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="text-sm font-medium">Rate of pay (per hour)</span>
          <input value={rateOfPay} onChange={e => setRateOfPay(e.target.value)} placeholder="e.g. £12.50" className={inputCls} />
        </label>
        <label className="space-y-1.5">
          <span className="text-sm font-medium">Start date</span>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={inputCls} />
        </label>
        <label className="space-y-1.5">
          <span className="text-sm font-medium">Job title</span>
          <input value={jobTitle} onChange={e => setJobTitle(e.target.value)} className={inputCls} />
        </label>
        <label className="space-y-1.5">
          <span className="text-sm font-medium">Weekly hours</span>
          <input value={weeklyHours} onChange={e => setWeeklyHours(e.target.value)} className={inputCls} />
        </label>
      </div>
      <p className="text-sm text-muted-foreground">
        Name and dates fill in automatically — the issue date is today. You'll see the exact contract before anything is sent.
      </p>
      <button
        onClick={() => previewMut.mutate()}
        disabled={!fields || previewMut.isPending}
        className="w-full h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-40 transition-all active:scale-[0.99]"
      >
        {previewMut.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileSignature className="w-5 h-5" />}
        Preview contract
      </button>

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="bg-card border border-border rounded-2xl max-w-3xl w-full max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-border flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Ready to issue — {preview.employeeName}</h2>
                <p className="text-sm text-muted-foreground">Read it through: this exact text goes to their Employee Hub.</p>
              </div>
              <button onClick={() => setPreview(null)} className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-secondary/50">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto p-4 sm:p-6 border-b border-border bg-secondary/30">
              <ContractPaper body={preview.body} />
            </div>
            <div className="p-4 flex gap-3 justify-end">
              <button onClick={() => setPreview(null)} className="px-5 h-12 rounded-xl border border-border font-medium hover:bg-secondary/50">
                Back
              </button>
              <button
                onClick={() => issueMut.mutate()}
                disabled={issueMut.isPending}
                className="px-6 h-12 rounded-xl bg-primary text-primary-foreground font-bold flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
              >
                {issueMut.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                Issue to {preview.employeeName}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Issued list ────────────────────────────────────────────────────────────

function IssuedCard({ meId }: { meId: number }) {
  const queryClient = useQueryClient();
  const [viewing, setViewing] = useState<number | null>(null);
  const [withdrawing, setWithdrawing] = useState<IssuedRow | null>(null);

  const { data, isLoading } = useQuery<IssuedRow[]>({
    queryKey: ["contracts", "issued", meId],
    queryFn: () => fetch(`${BASE}/api/contracts/issued`, { credentials: "include" }).then(jsonOrThrow),
  });

  const withdrawMut = useMutation({
    mutationFn: (id: number) => fetch(`${BASE}/api/contracts/${id}`, { method: "DELETE", credentials: "include" }).then(jsonOrThrow),
    onSuccess: () => {
      setWithdrawing(null);
      queryClient.invalidateQueries({ queryKey: ["contracts", "issued", meId] });
      toast({ title: "Contract withdrawn" });
    },
    onError: (e: Error) => toast({ title: "Not withdrawn", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
      <h2 className="text-lg font-semibold">Issued contracts</h2>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : (data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">Nothing issued yet.</p>
      ) : (
        <ul className="divide-y divide-border border border-border rounded-xl overflow-hidden">
          {(data ?? []).map(row => (
            <li key={row.id} className="bg-card">
              <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
                <button onClick={() => setViewing(row.id)} className="flex-1 min-w-[12rem] text-left group">
                  <span className="font-semibold text-base group-hover:text-primary transition-colors">{row.employeeName}</span>
                  <span className="block text-sm text-muted-foreground">
                    {row.jobTitle} · {row.rateOfPay}/hr · starts {row.startDate} · issued {row.issueDate}
                  </span>
                </button>
                {row.acknowledgedAt ? (
                  <span className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                    <Check className="w-3.5 h-3.5" /> Signed{row.signedInitials ? ` (${row.signedInitials})` : ""}
                  </span>
                ) : (
                  <>
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                      Awaiting signature
                    </span>
                    <button
                      onClick={() => setWithdrawing(row)}
                      className="p-2 text-muted-foreground hover:text-destructive rounded-lg hover:bg-destructive/10"
                      title="Withdraw this contract (only possible before it's signed)"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </div>
            </li>
          ))}
        </ul>
      )}

      {viewing != null && <ContractDialog contractId={viewing} onClose={() => setViewing(null)} />}

      {withdrawing && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setWithdrawing(null)}>
          <div className="bg-card border border-border rounded-2xl max-w-md w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="font-bold text-lg">Withdraw this contract?</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              {withdrawing.employeeName}'s contract ({withdrawing.jobTitle}, issued {withdrawing.issueDate}) will be removed
              from their hub. They haven't acknowledged it yet.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setWithdrawing(null)} className="px-4 h-11 rounded-xl border border-border font-medium hover:bg-secondary/50">Keep it</button>
              <button
                onClick={() => withdrawMut.mutate(withdrawing.id)}
                disabled={withdrawMut.isPending}
                className="px-5 h-11 rounded-xl bg-destructive text-destructive-foreground font-bold disabled:opacity-50"
              >
                {withdrawMut.isPending ? "Withdrawing…" : "Withdraw"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Starter forms overview ─────────────────────────────────────────────────

interface FormsOverview {
  formTypes: { type: string; title: string }[];
  people: { id: number; name: string; forms: { id: number; formType: string; signedAt: string | null; updatedAt: string }[] }[];
}

function SubmissionDialog({ submissionId, onClose }: { submissionId: number; onClose: () => void }) {
  const { state } = useAuth();
  const meId = state.status === "authenticated" ? state.user.id : null;
  const { data, isLoading } = useQuery<{ id: number; body: string | null; signedAt: string | null; formType: string }>({
    queryKey: ["starter-forms", "one", submissionId, meId],
    queryFn: () => fetch(`${BASE}/api/starter-forms/submission/${submissionId}`, { credentials: "include" }).then(jsonOrThrow),
    enabled: meId !== null,
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl max-w-3xl w-full max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-border flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Signed starter form</h2>
          <div className="flex items-center gap-2">
            {data?.signedAt && (
              <a
                href={`${BASE}/api/starter-forms/submission/${data.id}/signed.pdf`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-secondary/50"
              >
                <FileDown className="w-4 h-4" /> Signed PDF
              </a>
            )}
            <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-secondary/50">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto p-4 sm:p-6 bg-secondary/30">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : data?.body ? (
            <ContractPaper body={data.body} />
          ) : (
            <p className="text-sm text-muted-foreground p-4">This form is still a draft — nothing signed yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function StarterFormsOverviewCard({ meId }: { meId: number }) {
  const [viewing, setViewing] = useState<number | null>(null);
  const { data, isLoading } = useQuery<FormsOverview>({
    queryKey: ["starter-forms", "overview", meId],
    queryFn: () => fetch(`${BASE}/api/starter-forms/overview`, { credentials: "include" }).then(jsonOrThrow),
  });

  // Only people who have at least started something — the whole team listed
  // with empty rows would bury the newcomers this card exists for.
  const rows = (data?.people ?? []).filter(p => p.forms.length > 0);

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
      <h2 className="text-lg font-semibold">Starter forms</h2>
      <p className="text-sm text-muted-foreground">
        HMRC starter checklist, payroll details and health questionnaire — filled and signed by new starters from
        their hub (and the first-login onboarding flow). Tap a signed form to read it.
      </p>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">Nobody has started their forms yet.</p>
      ) : (
        <ul className="divide-y divide-border border border-border rounded-xl overflow-hidden">
          {rows.map(p => (
            <li key={p.id} className="bg-card px-4 py-3">
              <p className="font-semibold text-base mb-1.5">{p.name}</p>
              <div className="flex gap-2 flex-wrap">
                {(data?.formTypes ?? []).map(ft => {
                  const sub = p.forms.find(f => f.formType === ft.type);
                  const signed = sub?.signedAt != null;
                  return (
                    <button
                      key={ft.type}
                      disabled={!sub}
                      onClick={() => sub && setViewing(sub.id)}
                      className={cn(
                        "text-xs font-semibold px-2.5 py-1.5 rounded-full border transition-colors",
                        signed
                          ? "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800 hover:opacity-80"
                          : sub
                            ? "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-800"
                            : "bg-secondary text-muted-foreground border-border",
                      )}
                    >
                      {ft.title}: {signed ? "Signed ✓" : sub ? "Draft" : "Not started"}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
      {viewing != null && <SubmissionDialog submissionId={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

// ── Master template editor ─────────────────────────────────────────────────

function TemplateCard({ template, meId }: { template: Template; meId: number }) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState(template.body);
  const [defaultJobTitle, setDefaultJobTitle] = useState(template.defaultJobTitle);
  const [defaultWeeklyHours, setDefaultWeeklyHours] = useState(template.defaultWeeklyHours);
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveMut = useMutation({
    mutationFn: (payload: { body: string; defaultJobTitle: string; defaultWeeklyHours: string }) =>
      fetch(`${BASE}/api/contracts/template`, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then(jsonOrThrow),
    onSuccess: () => {
      setSaveState("saved");
      setSaveError(null);
      queryClient.invalidateQueries({ queryKey: ["contracts", "template", meId] });
    },
    onError: (e: Error) => { setSaveState("error"); setSaveError(e.message); },
  });

  // Autosave with a visible state — charter rule for every data-entry field.
  function scheduleSave(next: { body: string; defaultJobTitle: string; defaultWeeklyHours: string }) {
    setSaveState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSaveState("saving");
      saveMut.mutate(next);
    }, 1200);
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const chip =
    saveState === "saving" ? { text: "Saving…", cls: "text-muted-foreground" } :
    saveState === "dirty" ? { text: "Unsaved changes…", cls: "text-muted-foreground" } :
    saveState === "saved" ? { text: "Saved", cls: "text-emerald-600 dark:text-emerald-400" } :
    saveState === "error" ? { text: saveError ?? "Couldn't save", cls: "text-destructive" } :
    { text: "", cls: "" };

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Pencil className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Master template</h2>
        </div>
        <span className={cn("text-sm font-medium", chip.cls)} aria-live="polite">{chip.text}</span>
      </div>
      <p className="text-sm text-muted-foreground">
        Only you can see or edit this. These fill in automatically when you generate: {" "}
        {["employee_name", "issue_date", "start_date", "rate_of_pay", "job_title", "weekly_hours"].map(p => (
          <code key={p} className="inline-block bg-secondary/70 rounded px-1.5 py-0.5 text-xs mr-1 mb-1">{`{{${p}}}`}</code>
        ))}
        Removing or misspelling one stops generation with an error rather than issuing a half-filled contract.
        {" "}<code className="inline-block bg-secondary/70 rounded px-1.5 py-0.5 text-xs mr-1">[[founder_signature]]</code>
        marks where your handwritten signature is drawn on the employer signature line.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="space-y-1.5">
          <span className="text-sm font-medium">Default job title</span>
          <input
            value={defaultJobTitle}
            onChange={e => { setDefaultJobTitle(e.target.value); scheduleSave({ body, defaultJobTitle: e.target.value, defaultWeeklyHours }); }}
            className="w-full h-11 px-3 rounded-xl border border-border bg-background text-base"
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-sm font-medium">Default weekly hours</span>
          <input
            value={defaultWeeklyHours}
            onChange={e => { setDefaultWeeklyHours(e.target.value); scheduleSave({ body, defaultJobTitle, defaultWeeklyHours: e.target.value }); }}
            className="w-full h-11 px-3 rounded-xl border border-border bg-background text-base"
          />
        </label>
      </div>
      <textarea
        value={body}
        onChange={e => { setBody(e.target.value); scheduleSave({ body: e.target.value, defaultJobTitle, defaultWeeklyHours }); }}
        spellCheck={false}
        className="w-full min-h-[28rem] p-4 rounded-xl border border-border bg-background font-mono text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function FounderContracts() {
  const { state } = useAuth();
  const meId = state.status === "authenticated" ? state.user.id : null;
  const isFounder = state.status === "authenticated" && state.user.email === FOUNDER_EMAIL;

  const { data: template, isLoading: tplLoading, error: tplError } = useQuery<Template>({
    queryKey: ["contracts", "template", meId],
    queryFn: () => fetch(`${BASE}/api/contracts/template`, { credentials: "include" }).then(jsonOrThrow),
    enabled: isFounder,
  });
  const { data: people } = useQuery<Person[]>({
    queryKey: ["contracts", "people", meId],
    queryFn: () => fetch(`${BASE}/api/contracts/people`, { credentials: "include" }).then(jsonOrThrow),
    enabled: isFounder,
  });

  if (state.status === "authenticated" && !isFounder) return <Redirect to="/" />;
  if (state.status !== "authenticated") return null;

  return (
    <div className="space-y-6 max-w-4xl">
      <FounderNav />
      <PageHeader
        title="Contracts & Starter Forms"
        description="Your master employment contract, every contract you've issued, and each starter's signed forms. All of it goes person-to-person — visible to them and you only."
      />
      {tplLoading && <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}
      {tplError != null && (
        <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive">
          <AlertTriangle className="w-5 h-5" />
          <p className="text-sm">{(tplError as Error).message}</p>
        </div>
      )}
      {template && meId != null && (
        <>
          <NewContractCard template={template} people={people ?? []} meId={meId} />
          <IssuedCard meId={meId} />
          <StarterFormsOverviewCard meId={meId} />
          {/* No key on purpose: while the founder types, local state is the
              source of truth — a refetch after autosave must not remount the
              editor and eat the cursor. */}
          <TemplateCard template={template} meId={meId} />
        </>
      )}
    </div>
  );
}
