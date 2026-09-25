/**
 * Documents on a person's record (Graeme, 2026-09-25: "on people's
 * timelines, just to post a document that gets stored in their document
 * section").
 *
 *   • the Documents section: letters, certificates, right-to-work evidence,
 *     warnings… newest first, plus the files the person uploaded themselves
 *     at onboarding (read-only here);
 *   • "Add a document": a PDF or a photo (camera on the iPad), its kind,
 *     title, date, notes, and whether to share it with the person;
 *   • open one: the document inline, its details autosaved, share / who-sees
 *     switches, and "Remove" (a soft delete — never gone from the database).
 *
 * The server decides everything that matters (routes/person-documents.ts):
 * founder-only documents never reach anyone else, and a non-HR person can't
 * change who sees a document. This file only shows what came back.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, Camera, ChevronRight, Eye, EyeOff, FilePlus2, FileText, FileUp, FolderOpen, Loader2, Lock,
  Share2, Trash2, UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { useAutosave } from "@/hooks/use-autosave";
import { peopleFetch, peopleRetry } from "@/hooks/use-people-gate";
import { SaveChip } from "@/components/save-chip";
import { PeopleModal } from "@/components/people-modal";
import { InlineDocument } from "@/components/inline-document";
import { fmtBytes } from "@/lib/contract-history";
import { fmtDay } from "@/lib/people-api";
import {
  PERSON_DOCUMENT_KINDS, PERSON_DOCUMENT_ACCEPT, KIND_LABELS, kindLabel, onboardingKindLabel, defaultVisibility,
  isHrDefaultKind, visibilityLabel, documentEntries, documentFileProblem, mimeForFile, titleFromFileName,
  isFiledFounderOnly,
  type PersonDocumentsResponse, type PersonDocumentRow, type OnboardingDocumentRow, type DocumentEntry,
  type PersonDocumentVisibility, type FiledFounderOnly,
} from "@/lib/person-documents";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function personDocumentFileUrl(id: number, download = false): string {
  return `${BASE}/api/person-documents/${id}/file${download ? "?download=1" : ""}`;
}
export function onboardingDocumentFileUrl(id: number, download = false): string {
  return `${BASE}/api/person-documents/onboarding/${id}/file${download ? "?download=1" : ""}`;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => null);
  if (res.status === 423 || res.status === 428) throw new Error("People is locked — enter your private PIN and try again.");
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function useMeId(): number | null {
  const { state } = useAuth();
  return state.status === "authenticated" ? state.user.id : null;
}

export function personDocumentsKey(userId: number) {
  return ["person-documents", userId] as const;
}

/** One person's documents + onboarding uploads, as this viewer may see them. */
export function usePersonDocuments(userId: number, ready: boolean) {
  const meId = useMeId();
  return useQuery<PersonDocumentsResponse>({
    // Keyed by viewer too: a PIN switch on a shared iPad must never show the
    // previous person's view for a frame.
    queryKey: [...personDocumentsKey(userId), meId],
    queryFn: () => peopleFetch<PersonDocumentsResponse>(`/person-documents/person/${userId}`),
    enabled: ready && meId != null,
    retry: peopleRetry,
  });
}

export type OpenDocument = { source: "filed"; id: number } | { source: "onboarding"; doc: OnboardingDocumentRow };

// ── Cards and the section ──────────────────────────────────────────────────

function KindBadge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "warn" }) {
  return (
    <span className={cn(
      "shrink-0 text-sm font-bold px-2.5 py-1 rounded-lg",
      tone === "warn" ? "bg-rose-100 text-rose-900 dark:bg-rose-950/50 dark:text-rose-200" : "bg-secondary text-foreground",
    )}>
      {label}
    </span>
  );
}

export function DocumentEntryCard({ entry, onOpen }: { entry: DocumentEntry; onOpen: (o: OpenDocument) => void }) {
  if (entry.source === "onboarding") {
    const d = entry.doc;
    return (
      <button onClick={() => onOpen({ source: "onboarding", doc: d })}
        className="w-full text-left rounded-2xl border-2 border-border bg-card p-4 flex items-center gap-3 hover:border-primary/50">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-secondary">
          <UserRound className="w-6 h-6 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-lg font-bold truncate">{onboardingKindLabel(d.kind)}{d.fileName ? ` — ${d.fileName}` : ""}</p>
          <p className="text-base text-muted-foreground">
            {fmtDay(d.uploadedAt, true)} · Uploaded by {d.uploadedByName ?? "them"} at onboarding
          </p>
        </div>
        {d.visibility === "hr" && <Lock className="w-5 h-5 text-muted-foreground shrink-0" aria-label="Graeme only" />}
        <KindBadge label="Onboarding" />
        <ChevronRight className="w-6 h-6 text-muted-foreground shrink-0" />
      </button>
    );
  }
  const d = entry.doc;
  return (
    <button onClick={() => onOpen({ source: "filed", id: d.id })}
      className="w-full text-left rounded-2xl border-2 border-border bg-card p-4 flex items-center gap-3 hover:border-primary/50">
      <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center shrink-0",
        isHrDefaultKind(d.kind) ? "bg-rose-100 dark:bg-rose-950/40" : "bg-primary/10")}>
        <FileText className={cn("w-6 h-6", isHrDefaultKind(d.kind) ? "text-rose-600" : "text-primary")} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-lg font-bold truncate">{d.title}</p>
        <p className="text-base text-muted-foreground">
          {fmtDay(d.documentDate, true)}{d.uploadedByName ? ` · added by ${d.uploadedByName}` : ""}
          {d.sharedWithEmployee ? " · shared with them" : ""}
        </p>
      </div>
      {d.visibility === "hr" && <Lock className="w-5 h-5 text-muted-foreground shrink-0" aria-label="Graeme only" />}
      <KindBadge label={kindLabel(d.kind)} tone={isHrDefaultKind(d.kind) ? "warn" : "neutral"} />
      <ChevronRight className="w-6 h-6 text-muted-foreground shrink-0" />
    </button>
  );
}

export function PersonDocumentsSection({ data, isLoading, error, onOpen, onAdd }: {
  data: PersonDocumentsResponse | undefined;
  isLoading: boolean;
  error: unknown;
  onOpen: (o: OpenDocument) => void;
  onAdd: () => void;
}) {
  const entries = data ? documentEntries(data.documents, data.onboarding) : [];
  return (
    <section className="rounded-3xl border-2 border-border bg-card p-4 sm:p-5 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="flex-1 min-w-0 text-xl font-bold flex items-center gap-2"><FolderOpen className="w-5 h-5 text-primary" /> Documents</h2>
        <button onClick={onAdd}
          className="h-12 px-4 rounded-xl bg-primary text-primary-foreground font-bold flex items-center gap-2 hover:opacity-90">
          <FilePlus2 className="w-5 h-5" /> Add a document
        </button>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-3 py-4 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Loading documents…</div>
      ) : error ? (
        <p className="text-base text-destructive">Couldn't load documents: {error instanceof Error ? error.message : "try again"}</p>
      ) : entries.length === 0 ? (
        <p className="text-base text-muted-foreground">No documents on file yet. Add a letter, a certificate, their right-to-work evidence — a PDF or a photo.</p>
      ) : (
        <div className="space-y-2">{entries.map(e => <DocumentEntryCard key={e.key} entry={e} onOpen={onOpen} />)}</div>
      )}
      <p className="text-sm text-muted-foreground flex items-center gap-1.5">
        <Lock className="w-4 h-4 shrink-0" /> People access only. Warnings and disciplinaries are Graeme only. The person sees a document only if you share it.
      </p>
    </section>
  );
}

// ── Add a document ─────────────────────────────────────────────────────────

const FIELD = "w-full h-14 px-4 rounded-2xl border-2 border-border bg-card text-lg font-bold";

function ShareSwitch({ checked, onChange, personName, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; personName: string; disabled?: boolean;
}) {
  return (
    <label className={cn(
      "flex items-start gap-3 rounded-2xl border-2 p-4 cursor-pointer",
      checked ? "border-primary bg-primary/5" : "border-border",
      disabled && "opacity-50 cursor-not-allowed",
    )}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)}
        className="mt-1 w-6 h-6 accent-[var(--primary)] shrink-0" />
      <span className="min-w-0">
        <span className="block text-lg font-bold flex items-center gap-2"><Share2 className="w-5 h-5" /> Share with {personName}</span>
        <span className="block text-base text-muted-foreground">
          They'll see it, read-only, in their Employee Hub → My Documents. Your notes stay private.
        </span>
      </span>
    </label>
  );
}

function VisibilityChoice({ value, onChange }: { value: PersonDocumentVisibility; onChange: (v: PersonDocumentVisibility) => void }) {
  return (
    <div className="grid gap-2 grid-cols-2" role="radiogroup" aria-label="Who can see it">
      {(["people", "hr"] as const).map(v => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={cn("h-14 rounded-2xl border-2 text-base font-bold flex items-center justify-center gap-2",
            value === v ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
          {v === "hr" ? <Lock className="w-5 h-5" /> : <Eye className="w-5 h-5" />} {visibilityLabel(v)}
        </button>
      ))}
    </div>
  );
}

export function AddDocumentModal({ userId, personName, canSetVisibility, onClose, onFiled }: {
  userId: number;
  personName: string;
  /** HR-records account (the founder): may choose who sees it. */
  canSetVisibility: boolean;
  onClose: () => void;
  onFiled: (row: PersonDocumentRow | FiledFounderOnly) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [kind, setKind] = useState<string>("letter");
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [shared, setShared] = useState(false);
  const [visibility, setVisibility] = useState<PersonDocumentVisibility | null>(null); // null = follow the kind
  const fileInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  const effectiveVisibility = canSetVisibility && visibility ? visibility : defaultVisibility(kind);
  const founderOnlyForMe = !canSetVisibility && effectiveVisibility === "hr";

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    const p = documentFileProblem(f);
    setProblem(p);
    if (p) { setFile(null); return; }
    // Give a typeless .heic its real type so the server can check it.
    const type = mimeForFile(f);
    setFile(type === f.type ? f : new File([f], f.name, { type }));
    if (!titleTouched) setTitle(titleFromFileName(f.name));
  };

  const upload = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append("kind", kind);
      form.append("title", title.trim());
      form.append("documentDate", date);
      if (notes.trim()) form.append("notes", notes.trim());
      form.append("sharedWithEmployee", shared ? "true" : "false");
      if (canSetVisibility && visibility) form.append("visibility", visibility);
      form.append("file", file!);
      const res = await fetch(`${BASE}/api/person-documents/person/${userId}`, { method: "POST", credentials: "include", body: form });
      return jsonOrThrow<PersonDocumentRow | FiledFounderOnly>(res);
    },
    onSuccess: row => {
      toast({
        title: "Document filed",
        description: isFiledFounderOnly(row) ? `Saved on ${personName}'s record for Graeme only.` : `Saved on ${personName}'s record.`,
      });
      onFiled(row);
    },
    onError: (e: Error) => setProblem(e.message),
  });

  const ready = file != null && title.trim() !== "" && /^\d{4}-\d{2}-\d{2}$/.test(date) && !upload.isPending;

  return (
    <PeopleModal title={`Add a document — ${personName}`} onClose={onClose}>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => fileInput.current?.click()}
            className="h-16 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50">
            <FileUp className="w-6 h-6" /> Choose a file
          </button>
          <button type="button" onClick={() => photoInput.current?.click()}
            className="h-16 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50">
            <Camera className="w-6 h-6" /> Photograph it
          </button>
          <input ref={fileInput} type="file" accept={PERSON_DOCUMENT_ACCEPT} className="hidden"
            onChange={e => { pick(e.target.files?.[0]); e.target.value = ""; }} />
          <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/heic" capture="environment" className="hidden"
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
          <label htmlFor="pd-kind" className="text-sm font-bold block mb-1">What is it?</label>
          <select id="pd-kind" value={kind} onChange={e => setKind(e.target.value)} className={FIELD}>
            {PERSON_DOCUMENT_KINDS.map(k => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="pd-title" className="text-sm font-bold block mb-1">Title</label>
          <input id="pd-title" value={title} maxLength={200} placeholder="e.g. Level 2 food hygiene certificate"
            onChange={e => { setTitle(e.target.value); setTitleTouched(true); }} className={FIELD} />
        </div>
        <div>
          <label htmlFor="pd-date" className="text-sm font-bold block mb-1">Date on the document</label>
          <input id="pd-date" type="date" value={date} onChange={e => setDate(e.target.value)} className={FIELD} />
        </div>
        <div>
          <label htmlFor="pd-notes" className="text-sm font-bold block mb-1">Notes (optional — never shown to {personName})</label>
          <textarea id="pd-notes" value={notes} onChange={e => setNotes(e.target.value)} maxLength={4000} rows={3}
            className="w-full p-4 rounded-2xl border-2 border-border bg-card text-base" />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-bold">Who can see it</p>
          {canSetVisibility ? (
            <VisibilityChoice value={effectiveVisibility} onChange={setVisibility} />
          ) : (
            <p className={cn("rounded-2xl p-3 text-base font-semibold flex items-center gap-2",
              founderOnlyForMe ? "bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-400 dark:border-amber-700" : "bg-secondary/40")}>
              {founderOnlyForMe ? <Lock className="w-5 h-5 shrink-0" /> : <Eye className="w-5 h-5 shrink-0" />}
              {founderOnlyForMe
                ? `${KIND_LABELS[kind as keyof typeof KIND_LABELS]}s are filed for Graeme only — once filed, you won't see it here.`
                : "Everyone with People access."}
            </p>
          )}
        </div>

        <ShareSwitch checked={shared} onChange={setShared} personName={personName} />
        {shared && isHrDefaultKind(kind) && (
          <p className="text-base font-semibold text-amber-800 dark:text-amber-300 flex gap-2">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" /> This {kindLabel(kind).toLowerCase()} will be shown to {personName}.
          </p>
        )}

        <button onClick={() => upload.mutate()} disabled={!ready}
          className="w-full h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
          {upload.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileUp className="w-5 h-5" />}
          {upload.isPending ? "Uploading…" : "File this document"}
        </button>
      </div>
    </PeopleModal>
  );
}

// ── Open one ───────────────────────────────────────────────────────────────

export function DocumentOpenModal({ target, userId, personName, onClose }: {
  target: OpenDocument;
  userId: number;
  personName: string;
  onClose: () => void;
}) {
  if (target.source === "onboarding") {
    const d = target.doc;
    return (
      <PeopleModal title={`${onboardingKindLabel(d.kind)} — ${personName}`} onClose={onClose} wide>
        <div className="space-y-4">
          <InlineDocument src={onboardingDocumentFileUrl(d.id)} downloadSrc={onboardingDocumentFileUrl(d.id, true)}
            mime={d.mime} title={d.fileName ?? onboardingKindLabel(d.kind)} />
          <p className="text-base text-muted-foreground">
            Uploaded by {d.uploadedByName ?? personName} at onboarding, {fmtDay(d.uploadedAt, true)} · {fmtBytes(d.byteSize)}.
            {d.visibility === "hr" ? " Graeme only — it carries pay." : ""} Read-only here.
          </p>
        </div>
      </PeopleModal>
    );
  }
  return <FiledDocumentModal id={target.id} userId={userId} personName={personName} onClose={onClose} />;
}

function FiledDocumentModal({ id, userId, personName, onClose }: {
  id: number; userId: number; personName: string; onClose: () => void;
}) {
  const meId = useMeId();
  const queryClient = useQueryClient();
  const key = ["person-document", id, meId];
  const { data: row, isLoading, error } = useQuery<PersonDocumentRow>({
    queryKey: key,
    queryFn: () => peopleFetch<PersonDocumentRow>(`/person-documents/${id}`),
    enabled: meId != null,
    retry: peopleRetry,
  });
  const [removing, setRemoving] = useState(false);

  const refreshList = () => void queryClient.invalidateQueries({ queryKey: personDocumentsKey(userId) });

  /** Save a change. Resolves false when the change made it founder-only for
   *  someone who isn't — the modal then closes, as they can no longer see it. */
  const patch = async (body: Record<string, unknown>): Promise<void> => {
    const res = await fetch(`${BASE}/api/person-documents/${id}`, {
      method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const updated = await jsonOrThrow<PersonDocumentRow | FiledFounderOnly>(res);
    refreshList();
    if (isFiledFounderOnly(updated)) {
      toast({ title: "Now Graeme only", description: "It's on the record, but only Graeme can see it now." });
      onClose();
      return;
    }
    queryClient.setQueryData(key, updated);
  };

  const remove = useMutation({
    mutationFn: () => fetch(`${BASE}/api/person-documents/${id}`, { method: "DELETE", credentials: "include" }).then(r => jsonOrThrow(r)),
    onSuccess: () => { toast({ title: "Removed from the record" }); refreshList(); onClose(); },
    onError: (e: Error) => toast({ title: "Not removed", description: e.message, variant: "destructive" }),
  });

  return (
    <PeopleModal title={row ? `${row.title} — ${personName}` : "Document"} onClose={onClose} wide>
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : error || !row ? (
        <p className="text-destructive font-semibold">{error instanceof Error ? error.message : "Couldn't open it."}</p>
      ) : (
        <div className="space-y-5">
          <InlineDocument src={personDocumentFileUrl(row.id)} downloadSrc={personDocumentFileUrl(row.id, true)}
            mime={row.mime} title={row.title} />
          {/* Keyed by id so moving between documents never carries a draft across. */}
          <DocumentDetails key={row.id} row={row} personName={personName} save={patch} />
          <p className="text-sm text-muted-foreground">
            Added {new Date(row.uploadedAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            {row.uploadedByName ? ` by ${row.uploadedByName}` : ""} · {row.fileName ?? "file"} · {fmtBytes(row.byteSize)}
          </p>
          {removing ? (
            <div className="rounded-2xl border-2 border-destructive/50 bg-destructive/5 p-4 space-y-3">
              <p className="text-base font-semibold">
                Remove "{row.title}" from {personName}'s record? It disappears from the record{row.sharedWithEmployee ? " and their Employee Hub" : ""}; a copy is kept behind the scenes with who removed it and when.
              </p>
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
              <Trash2 className="w-4 h-4" /> Remove from the record
            </button>
          )}
        </div>
      )}
    </PeopleModal>
  );
}

function DocumentDetails({ row, personName, save }: {
  row: PersonDocumentRow;
  personName: string;
  save: (body: Record<string, unknown>) => Promise<void>;
}) {
  const canSetVisibility = row.canSetVisibility === true;
  const [title, setTitle] = useState(row.title);
  const [date, setDate] = useState(row.documentDate.slice(0, 10));
  const [notes, setNotes] = useState(row.notes ?? "");
  const [kind, setKind] = useState(row.kind);
  const [pendingKind, setPendingKind] = useState<string | null>(null); // a kind that would lock a non-HR person out
  const [confirmShare, setConfirmShare] = useState(false);

  const titleSave = useAutosave((v: string) => save({ title: v }));
  const dateSave = useAutosave((v: string) => save({ documentDate: v }), 300);
  const notesSave = useAutosave((v: string) => save({ notes: v }));
  const kindSave = useAutosave((v: string) => save({ kind: v }), 0);
  const shareSave = useAutosave((v: boolean) => save({ sharedWithEmployee: v }), 0);
  const visSave = useAutosave((v: PersonDocumentVisibility) => save({ visibility: v }), 0);

  const chooseKind = (next: string) => {
    if (next === kind) return;
    if (!canSetVisibility && isHrDefaultKind(next) && row.visibility !== "hr") { setPendingKind(next); return; }
    setKind(next);
    kindSave.schedule(next);
  };

  const setShared = (v: boolean) => {
    if (v && isHrDefaultKind(kind) && !confirmShare) { setConfirmShare(true); return; }
    setConfirmShare(false);
    shareSave.schedule(v);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <div className="flex items-center justify-between gap-2 mb-1">
            <label htmlFor="pd-edit-title" className="text-sm font-bold">Title</label>
            <SaveChip state={titleSave.state} error={titleSave.error} onRetry={() => void titleSave.flush()} />
          </div>
          <input id="pd-edit-title" value={title} maxLength={200}
            onChange={e => { setTitle(e.target.value); if (e.target.value.trim()) titleSave.schedule(e.target.value); }}
            onBlur={() => void titleSave.flush()} className={FIELD} />
          {title.trim() === "" && <p className="text-sm font-semibold text-destructive mt-1">A document needs a title — this won't save while it's blank.</p>}
        </div>
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <label htmlFor="pd-edit-kind" className="text-sm font-bold">What is it?</label>
            <SaveChip state={kindSave.state} error={kindSave.error} onRetry={() => void kindSave.flush()} />
          </div>
          <select id="pd-edit-kind" value={kind} onChange={e => chooseKind(e.target.value)} className={FIELD}>
            {PERSON_DOCUMENT_KINDS.map(k => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </select>
        </div>
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <label htmlFor="pd-edit-date" className="text-sm font-bold">Date on the document</label>
            <SaveChip state={dateSave.state} error={dateSave.error} onRetry={() => void dateSave.flush()} />
          </div>
          <input id="pd-edit-date" type="date" value={date}
            onChange={e => { setDate(e.target.value); if (e.target.value) dateSave.schedule(e.target.value); }} className={FIELD} />
        </div>
        <div className="sm:col-span-2">
          <div className="flex items-center justify-between gap-2 mb-1">
            <label htmlFor="pd-edit-notes" className="text-sm font-bold">Notes (never shown to {personName})</label>
            <SaveChip state={notesSave.state} error={notesSave.error} onRetry={() => void notesSave.flush()} />
          </div>
          <textarea id="pd-edit-notes" value={notes} rows={3} maxLength={4000}
            onChange={e => { setNotes(e.target.value); notesSave.schedule(e.target.value); }}
            onBlur={() => void notesSave.flush()} className="w-full p-4 rounded-2xl border-2 border-border bg-card text-base" />
        </div>
      </div>

      {pendingKind && (
        <div className="rounded-2xl border-2 border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-3">
          <p className="text-base font-semibold">
            Marking it as a {kindLabel(pendingKind).toLowerCase()} makes it Graeme only — you won't see it here afterwards.
          </p>
          <div className="grid gap-2 grid-cols-2">
            <button onClick={() => setPendingKind(null)} className="h-12 rounded-xl border-2 border-border font-bold">Keep it as {kindLabel(kind)}</button>
            <button onClick={() => { const k = pendingKind; setPendingKind(null); setKind(k); kindSave.schedule(k); }}
              className="h-12 rounded-xl bg-amber-600 text-white font-bold">Make it Graeme only</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold">Who can see it</p>
          {canSetVisibility && <SaveChip state={visSave.state} error={visSave.error} onRetry={() => void visSave.flush()} />}
        </div>
        {canSetVisibility ? (
          <VisibilityChoice value={row.visibility} onChange={v => { if (v !== row.visibility) visSave.schedule(v); }} />
        ) : (
          <p className="rounded-2xl bg-secondary/40 p-3 text-base font-semibold flex items-center gap-2">
            <Eye className="w-5 h-5 shrink-0" /> Everyone with People access. Only Graeme can change this.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-end">
          <SaveChip state={shareSave.state} error={shareSave.error} onRetry={() => void shareSave.flush()} />
        </div>
        <ShareSwitch checked={row.sharedWithEmployee} onChange={setShared} personName={personName} disabled={shareSave.state === "saving"} />
        {confirmShare && (
          <div className="rounded-2xl border-2 border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-3">
            <p className="text-base font-semibold">Show this {kindLabel(kind).toLowerCase()} to {personName} in their Employee Hub?</p>
            <div className="grid gap-2 grid-cols-2">
              <button onClick={() => setConfirmShare(false)} className="h-12 rounded-xl border-2 border-border font-bold flex items-center justify-center gap-2">
                <EyeOff className="w-4 h-4" /> Not yet
              </button>
              <button onClick={() => { setConfirmShare(false); shareSave.schedule(true); }}
                className="h-12 rounded-xl bg-primary text-primary-foreground font-bold flex items-center justify-center gap-2">
                <Share2 className="w-4 h-4" /> Share it
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
