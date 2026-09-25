/**
 * Contracts on a person's record — founder / HR-records accounts only,
 * because contracts carry pay (Graeme, 2026-09-25: "upload a contract
 * manually into someone's employee record, an old PDF that we created at
 * the start of their employment ... then we'll create new contracts from
 * the data in that").
 *
 *   • the Contracts section: every contract issued in the app plus old ones
 *     uploaded as a PDF or photo, newest first;
 *   • "Add an old contract (PDF)": file one, with its original date + notes;
 *   • open one: the document inline, its date and notes (autosaved), and
 *     "Create a new contract from this" — Claude reads it, the founder
 *     checks every value against the words it came from in an editable,
 *     autosaved confirm card, then the contract issuer opens pre-filled.
 *     Nothing is ever issued from here.
 *
 * People access alone never shows any of this: the page only asks when
 * /api/contracts/uploaded/can-manage says yes, and every route re-checks on
 * the server (routes/uploaded-contracts.ts).
 */
import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, Camera, Check, ChevronRight, FilePlus2, FileSignature, FileText, FileUp, Loader2, Quote,
  RefreshCw, Sparkles, Trash2, Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { PeopleModal } from "@/components/people-modal";
import { ContractPaper } from "@/components/contract-view";
import { UploadedContractDocument, uploadedContractFileUrl } from "@/components/uploaded-contract-document";
import {
  contractHistory, uploadedContractLabel, fmtBytes, contractFileProblem, CONTRACT_UPLOAD_ACCEPT,
  type ContractHistoryResponse, type ContractHistoryEntry, type UploadedContractRow, type ContractPrefill,
  type ExtractedField,
} from "@/lib/contract-history";
import { fmtDay } from "@/lib/people-api";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
// Same account gate as /founder/contracts — only the founder issues.
const FOUNDER_EMAIL = "graeme@thecalzonekitchen.co.uk";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

function useMeId(): number | null {
  const { state } = useAuth();
  return state.status === "authenticated" ? state.user.id : null;
}

/** May the signed-in person see and manage contracts on People records?
 *  (The HR-records list — the founder today.) Asked of the server. */
export function useCanManageContracts(): boolean {
  const meId = useMeId();
  const { data } = useQuery<{ canManage: boolean }>({
    queryKey: ["contracts-uploaded-can-manage", meId],
    queryFn: () => fetch(`${BASE}/api/contracts/uploaded/can-manage`, { credentials: "include" }).then(r => jsonOrThrow(r)),
    enabled: meId != null,
    staleTime: 5 * 60 * 1000,
  });
  return data?.canManage === true;
}

export function contractHistoryKey(userId: number, meId: number | null) {
  return ["contract-history", userId, meId] as const;
}

export function useContractHistory(userId: number, enabled: boolean) {
  const meId = useMeId();
  return useQuery<ContractHistoryResponse>({
    queryKey: contractHistoryKey(userId, meId),
    queryFn: () => fetch(`${BASE}/api/contracts/uploaded/person/${userId}`, { credentials: "include" }).then(r => jsonOrThrow(r)),
    enabled: enabled && meId != null,
  });
}

export type OpenContract = { source: "issued" | "uploaded"; id: number };

// ── The section on the record ──────────────────────────────────────────────

export function ContractEntryCard({ entry, onOpen }: { entry: ContractHistoryEntry; onOpen: (o: OpenContract) => void }) {
  const isUpload = entry.source === "uploaded";
  const sub = entry.source === "issued"
    ? `${entry.issued.jobTitle} · ${entry.issued.rateOfPay}/hr · ${entry.issued.weeklyHours} hrs · issued ${fmtDay(entry.issued.issueDate, true)}`
    : [
        entry.uploaded.originalIssueDate ? `Dated ${fmtDay(entry.uploaded.originalIssueDate, true)}` : "Date not recorded",
        entry.uploaded.fileName,
        entry.uploaded.extraction?.fields.jobTitle.value,
      ].filter(Boolean).join(" · ");
  return (
    <button
      onClick={() => onOpen({ source: entry.source, id: isUpload ? entry.uploaded.id : entry.issued.id })}
      className="w-full text-left rounded-2xl border-2 border-border bg-card p-4 flex items-center gap-3 hover:border-primary/50"
    >
      <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center shrink-0",
        isUpload ? "bg-secondary" : "bg-primary/10")}>
        {isUpload ? <FileText className="w-6 h-6 text-muted-foreground" /> : <FileSignature className="w-6 h-6 text-primary" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-lg font-bold">{entry.label}</p>
        <p className="text-base text-muted-foreground line-clamp-2">{sub}</p>
      </div>
      {entry.source === "issued" && entry.issued.acknowledgedAt && (
        <span className="shrink-0 flex items-center gap-1 text-sm font-bold px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
          <Check className="w-4 h-4" /> Signed
        </span>
      )}
      <ChevronRight className="w-6 h-6 text-muted-foreground shrink-0" />
    </button>
  );
}

export function PersonContractsSection({ history, isLoading, error, onOpen, onAdd }: {
  history: ContractHistoryResponse | undefined;
  isLoading: boolean;
  error: unknown;
  onOpen: (o: OpenContract) => void;
  onAdd: () => void;
}) {
  const entries = history ? contractHistory(history.issued, history.uploaded) : [];
  return (
    <section className="rounded-3xl border-2 border-border bg-card p-4 sm:p-5 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="flex-1 min-w-0 text-xl font-bold flex items-center gap-2"><FileSignature className="w-5 h-5 text-primary" /> Contracts</h2>
        <button onClick={onAdd}
          className="h-12 px-4 rounded-xl border-2 border-border font-bold flex items-center gap-2 hover:bg-secondary/50">
          <FilePlus2 className="w-5 h-5" /> Add an old contract (PDF)
        </button>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-3 py-4 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Loading contracts…</div>
      ) : error ? (
        <p className="text-base text-destructive">Couldn't load contracts: {error instanceof Error ? error.message : "try again"}</p>
      ) : entries.length === 0 ? (
        <p className="text-base text-muted-foreground">No contracts on file yet. Add their old contract, or issue one from Contracts &amp; Starter Forms.</p>
      ) : (
        <div className="space-y-2">{entries.map(e => <ContractEntryCard key={e.key} entry={e} onOpen={onOpen} />)}</div>
      )}
      <p className="text-sm text-muted-foreground">Only you (and the person themself, read-only) can see these — they carry pay.</p>
    </section>
  );
}

// ── Add an old contract ────────────────────────────────────────────────────

export function AddOldContractModal({ userId, personName, onClose, onUploaded }: {
  userId: number;
  personName: string;
  onClose: () => void;
  onUploaded: (row: UploadedContractRow) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [issueDate, setIssueDate] = useState("");
  const [notes, setNotes] = useState("");
  const pdfInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    const p = contractFileProblem(f);
    setProblem(p);
    setFile(p ? null : f);
  };

  const upload = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append("userId", String(userId));
      if (issueDate) form.append("originalIssueDate", issueDate);
      if (notes.trim()) form.append("notes", notes.trim());
      form.append("file", file!);
      const res = await fetch(`${BASE}/api/contracts/uploaded`, { method: "POST", credentials: "include", body: form });
      return jsonOrThrow<UploadedContractRow>(res);
    },
    onSuccess: row => {
      toast({ title: "Contract filed", description: `Saved on ${personName}'s record.` });
      onUploaded(row);
    },
    onError: (e: Error) => setProblem(e.message),
  });

  return (
    <PeopleModal title={`Add an old contract — ${personName}`} onClose={onClose}>
      <div className="space-y-5">
        <p className="text-base text-muted-foreground">
          File the contract they were given before the app — a PDF, or a photo of the paper copy. It's kept as a record of
          their previous contract. It isn't marked as signed in the app.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => pdfInput.current?.click()}
            className="h-16 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50">
            <FileUp className="w-6 h-6" /> Choose a PDF
          </button>
          <button type="button" onClick={() => photoInput.current?.click()}
            className="h-16 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50">
            <Camera className="w-6 h-6" /> Photograph it
          </button>
          <input ref={pdfInput} type="file" accept={CONTRACT_UPLOAD_ACCEPT} className="hidden"
            onChange={e => { pick(e.target.files?.[0]); e.target.value = ""; }} />
          <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden"
            onChange={e => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        {file && (
          <div className="rounded-2xl bg-secondary/40 p-3 flex items-center gap-3">
            <FileText className="w-6 h-6 text-primary shrink-0" />
            <p className="flex-1 min-w-0 text-base font-bold truncate">{file.name || "Photo"}</p>
            <span className="text-sm text-muted-foreground shrink-0">{fmtBytes(file.size)}</span>
          </div>
        )}
        {problem && (
          <p className="rounded-2xl bg-destructive/10 text-destructive p-3 text-base font-semibold flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 shrink-0" /> {problem}
          </p>
        )}
        <div>
          <label htmlFor="old-contract-date" className="text-sm font-bold block mb-1">Date on the contract (optional)</label>
          <input id="old-contract-date" type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)}
            className="w-full h-14 px-4 rounded-2xl border-2 border-border bg-card text-lg font-bold" />
        </div>
        <div>
          <label htmlFor="old-contract-notes" className="text-sm font-bold block mb-1">Notes (optional)</label>
          <textarea id="old-contract-notes" value={notes} onChange={e => setNotes(e.target.value)} maxLength={2000} rows={3}
            placeholder="e.g. Original from the filing cabinet; superseded when hours changed"
            className="w-full p-4 rounded-2xl border-2 border-border bg-card text-base" />
        </div>
        <button
          onClick={() => upload.mutate()}
          disabled={!file || upload.isPending}
          className="w-full h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {upload.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileUp className="w-5 h-5" />}
          {upload.isPending ? "Uploading…" : "File this contract"}
        </button>
      </div>
    </PeopleModal>
  );
}

// ── Open one ───────────────────────────────────────────────────────────────

function IssuedContractView({ id }: { id: number }) {
  const meId = useMeId();
  const { data, isLoading, error } = useQuery<{ id: number; body: string; acknowledgedAt: string | null }>({
    queryKey: ["contracts", "one", id, meId],
    queryFn: () => fetch(`${BASE}/api/contracts/${id}`, { credentials: "include" }).then(r => jsonOrThrow(r)),
    enabled: meId != null,
  });
  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (error || !data) return <p className="text-destructive font-semibold">{error instanceof Error ? error.message : "Couldn't open it."}</p>;
  return (
    <div className="space-y-3">
      {data.acknowledgedAt && (
        <a href={`${BASE}/api/contracts/${id}/signed.pdf`} target="_blank" rel="noopener noreferrer"
          className="h-12 rounded-xl border-2 border-border font-bold flex items-center justify-center gap-2 hover:bg-secondary/50">
          <FileText className="w-4 h-4" /> Signed PDF
        </a>
      )}
      <div className="bg-secondary/30 rounded-2xl p-2 sm:p-4"><ContractPaper body={data.body} /></div>
    </div>
  );
}

export function ContractOpenModal({ target, userId, personName, onClose }: {
  target: OpenContract;
  userId: number;
  personName: string;
  onClose: () => void;
}) {
  if (target.source === "issued") {
    return (
      <PeopleModal title={`Contract — ${personName}`} onClose={onClose} wide>
        <IssuedContractView id={target.id} />
      </PeopleModal>
    );
  }
  return <UploadedContractModal id={target.id} userId={userId} personName={personName} onClose={onClose} />;
}

function UploadedContractModal({ id, userId, personName, onClose }: {
  id: number; userId: number; personName: string; onClose: () => void;
}) {
  const meId = useMeId();
  const queryClient = useQueryClient();
  const key = ["uploaded-contract", id, meId];
  const { data: row, isLoading, error } = useQuery<UploadedContractRow>({
    queryKey: key,
    queryFn: () => fetch(`${BASE}/api/contracts/uploaded/${id}`, { credentials: "include" }).then(r => jsonOrThrow(r)),
    enabled: meId != null,
  });
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  const refreshHistory = () => void queryClient.invalidateQueries({ queryKey: ["contract-history", userId] });

  const patch = async (body: Record<string, unknown>) => {
    const res = await fetch(`${BASE}/api/contracts/uploaded/${id}`, {
      method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const updated = await jsonOrThrow<UploadedContractRow>(res);
    queryClient.setQueryData(key, updated);
    refreshHistory();
  };

  const read = useMutation({
    mutationFn: (replacePrefill: boolean) => fetch(`${BASE}/api/contracts/uploaded/${id}/extract`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replacePrefill }),
    }).then(r => jsonOrThrow<UploadedContractRow>(r)),
    onSuccess: updated => { setReadError(null); queryClient.setQueryData(key, updated); refreshHistory(); setConfirming(true); },
    // A failed read still opens the card — blank fields to type into.
    onError: (e: Error) => { setReadError(e.message); setConfirming(true); },
  });

  const remove = useMutation({
    mutationFn: () => fetch(`${BASE}/api/contracts/uploaded/${id}`, { method: "DELETE", credentials: "include" }).then(r => jsonOrThrow(r)),
    onSuccess: () => { toast({ title: "Removed from the record" }); refreshHistory(); onClose(); },
    onError: (e: Error) => toast({ title: "Not removed", description: e.message, variant: "destructive" }),
  });

  const startNewContract = () => {
    if (row?.extraction) setConfirming(true);
    else read.mutate(false);
  };

  return (
    <PeopleModal title={row ? `${uploadedContractLabel(row.mime)} — ${personName}` : "Previous contract"} onClose={onClose} wide>
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : error || !row ? (
        <p className="text-destructive font-semibold">{error instanceof Error ? error.message : "Couldn't open it."}</p>
      ) : confirming ? (
        <ConfirmNewContract
          row={row}
          personName={personName}
          readError={readError}
          reading={read.isPending}
          onReadAgain={() => read.mutate(true)}
          onBack={() => setConfirming(false)}
          savePrefill={prefill => patch({ prefill })}
        />
      ) : (
        <div className="space-y-5">
          <UploadedContractDocument id={row.id} mime={row.mime} fileName={row.fileName} />

          <button
            onClick={startNewContract}
            disabled={read.isPending}
            className="w-full h-16 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-60"
          >
            {read.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : <Sparkles className="w-6 h-6" />}
            {read.isPending ? "Reading the contract…" : "Create a new contract from this"}
          </button>

          <UploadedDetails row={row} save={patch} />

          <p className="text-sm text-muted-foreground">
            Filed {new Date(row.uploadedAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            {row.uploadedByName ? ` by ${row.uploadedByName}` : ""} · {fmtBytes(row.byteSize)}
          </p>

          {removing ? (
            <div className="rounded-2xl border-2 border-destructive/50 bg-destructive/5 p-4 space-y-3">
              <p className="text-base font-semibold">Remove this file from {personName}'s record? Only do this if it was filed by mistake.</p>
              <div className="grid gap-2 grid-cols-2">
                <button onClick={() => setRemoving(false)} className="h-12 rounded-xl border-2 border-border font-bold">Keep it</button>
                <button onClick={() => remove.mutate()} disabled={remove.isPending}
                  className="h-12 rounded-xl bg-destructive text-destructive-foreground font-bold disabled:opacity-50">
                  {remove.isPending ? "Removing…" : "Remove"}
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setRemoving(true)}
              className="h-12 px-4 rounded-xl text-muted-foreground hover:text-destructive font-bold flex items-center gap-2">
              <Trash2 className="w-4 h-4" /> Filed by mistake? Remove it
            </button>
          )}
        </div>
      )}
    </PeopleModal>
  );
}

function UploadedDetails({ row, save }: { row: UploadedContractRow; save: (body: Record<string, unknown>) => Promise<void> }) {
  const [issueDate, setIssueDate] = useState(row.originalIssueDate ?? "");
  const [notes, setNotes] = useState(row.notes ?? "");
  const dateSave = useAutosave((v: string) => save({ originalIssueDate: v === "" ? null : v }), 300);
  const notesSave = useAutosave((v: string) => save({ notes: v }));
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <label htmlFor="uc-date" className="text-sm font-bold">Date on the contract</label>
          <SaveChip state={dateSave.state} error={dateSave.error} onRetry={() => void dateSave.flush()} />
        </div>
        <input id="uc-date" type="date" value={issueDate}
          onChange={e => { setIssueDate(e.target.value); dateSave.schedule(e.target.value); }}
          className="w-full h-14 px-4 rounded-2xl border-2 border-border bg-card text-lg font-bold" />
      </div>
      <div className="sm:col-span-2">
        <div className="flex items-center justify-between gap-2 mb-1">
          <label htmlFor="uc-notes" className="text-sm font-bold">Notes</label>
          <SaveChip state={notesSave.state} error={notesSave.error} onRetry={() => void notesSave.flush()} />
        </div>
        <textarea id="uc-notes" value={notes} rows={3} maxLength={2000}
          onChange={e => { setNotes(e.target.value); notesSave.schedule(e.target.value); }}
          onBlur={() => void notesSave.flush()}
          className="w-full p-4 rounded-2xl border-2 border-border bg-card text-base" />
      </div>
    </div>
  );
}

// ── Confirm the values for a new contract ──────────────────────────────────

const PREFILL_FIELDS: Array<{ key: keyof ContractPrefill; label: string; placeholder: string; type?: "date"; from: "jobTitle" | "rateOfPay" | "weeklyHours" | "startDate" }> = [
  { key: "jobTitle", label: "Job title", placeholder: "e.g. Food Production Operative", from: "jobTitle" },
  { key: "rateOfPay", label: "Rate of pay (per hour)", placeholder: "e.g. £12.21", from: "rateOfPay" },
  { key: "weeklyHours", label: "Weekly hours", placeholder: "e.g. 37.5", from: "weeklyHours" },
  { key: "startDate", label: "Start date (continuous employment)", placeholder: "", type: "date", from: "startDate" },
];

function SourceLine({ field }: { field: ExtractedField | undefined }) {
  if (!field) return null;
  return (
    <div className="space-y-1">
      {field.snippet ? (
        <p className="text-sm text-muted-foreground flex gap-1.5">
          <Quote className="w-4 h-4 shrink-0 mt-0.5" />
          <span><span className="font-semibold">From the contract:</span> <span className="italic">“{field.snippet}”</span></span>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground italic">Not found in the document — type it in.</p>
      )}
      {field.warning && (
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 flex gap-1.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {field.warning}
        </p>
      )}
    </div>
  );
}

function ConfirmNewContract({ row, personName, readError, reading, onReadAgain, onBack, savePrefill }: {
  row: UploadedContractRow;
  personName: string;
  readError: string | null;
  reading: boolean;
  onReadAgain: () => void;
  onBack: () => void;
  savePrefill: (p: ContractPrefill) => Promise<void>;
}) {
  const { state } = useAuth();
  const isFounder = state.status === "authenticated" && state.user.email === FOUNDER_EMAIL;
  const [, navigate] = useLocation();
  const x = row.extraction ?? null;
  const [values, setValues] = useState<ContractPrefill>(() => ({
    jobTitle: row.prefill?.jobTitle ?? null,
    rateOfPay: row.prefill?.rateOfPay ?? null,
    weeklyHours: row.prefill?.weeklyHours ?? null,
    startDate: row.prefill?.startDate ?? null,
  }));
  const auto = useAutosave((v: ContractPrefill) => savePrefill(v));

  const set = (k: keyof ContractPrefill, v: string) => {
    const next = { ...values, [k]: v === "" ? null : v };
    setValues(next);
    auto.schedule(next);
  };

  const go = async () => {
    if (!(await auto.flush())) return;
    navigate(`/founder/contracts?fromUploaded=${row.id}`);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="flex-1 min-w-0 text-xl font-bold flex items-center gap-2"><Wand2 className="w-5 h-5 text-primary" /> Check the details for {personName}'s new contract</h3>
        <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />
      </div>
      <p className="text-base text-muted-foreground">
        Read from the old contract by Claude. Check each one against the words it came from and correct anything wrong — your changes save as you type.
        Nothing is issued from here: the contract issuer opens filled in, and you preview and issue as normal.
      </p>

      {readError && (
        <p className="rounded-2xl bg-destructive/10 text-destructive p-4 text-base font-semibold flex gap-2">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" /> {readError} The fields below are blank for you to type in.
        </p>
      )}
      {x?.problem && (
        <p className="rounded-2xl bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-400 dark:border-amber-700 p-4 text-base font-semibold flex gap-2">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" /> {x.problem}
        </p>
      )}
      {x && x.nameCheck === "mismatch" && (
        <p className="rounded-2xl bg-rose-50 dark:bg-rose-950/30 border-2 border-rose-400 dark:border-rose-700 p-4 text-base font-semibold flex gap-2">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-rose-600" /> {x.fields.employeeName.warning}
        </p>
      )}
      {x && x.nameCheck === "match" && x.fields.employeeName.value && (
        <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Check className="w-4 h-4 text-emerald-600" /> Name on the contract: {x.fields.employeeName.value}</p>
      )}

      <div className="space-y-4">
        {PREFILL_FIELDS.map(f => (
          <div key={f.key} className="rounded-2xl border-2 border-border p-4 space-y-2">
            <label htmlFor={`pf-${f.key}`} className="text-sm font-bold block">{f.label}</label>
            <input
              id={`pf-${f.key}`}
              type={f.type ?? "text"}
              value={values[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={e => set(f.key, e.target.value)}
              onBlur={() => void auto.flush()}
              className="w-full h-14 px-4 rounded-2xl border-2 border-border bg-card text-lg font-bold"
            />
            <SourceLine field={x?.fields[f.from]} />
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button onClick={onBack} className="h-14 rounded-2xl border-2 border-border text-lg font-bold hover:bg-secondary/50">
          Back to the document
        </button>
        <button onClick={onReadAgain} disabled={reading}
          className="h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 disabled:opacity-50">
          {reading ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />} Read it again
        </button>
      </div>
      {isFounder ? (
        <button onClick={() => void go()}
          className="w-full h-16 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 hover:opacity-90">
          <FileSignature className="w-6 h-6" /> Open in the contract issuer
        </button>
      ) : (
        <p className="text-base text-muted-foreground">Only Graeme's account issues contracts — these values are saved for him.</p>
      )}
      <a href={uploadedContractFileUrl(row.id)} target="_blank" rel="noopener noreferrer" className="block text-center text-base font-bold text-primary underline">
        Open the old contract alongside
      </a>
    </div>
  );
}
