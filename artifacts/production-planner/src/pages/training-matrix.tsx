// Training matrix — onboarding & training sign-off.
//
// List view: cards of each matrix. Detail view: a grid of enrolled users (rows)
// × items (columns) with a per-cell trained sign-off (date + who signed off).
// Items can be free-text or linked to a live document (Documents →
// assessment_type 'sop' or 'policy'); linked columns open the canonical
// reader at /documents/:id (which renders markdown or serves the PDF).
// Whole feature is gated to admins/managers (page permission /training +
// API requireAdminOrManager).

import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import {
  Plus, Trash2, GraduationCap, FileText, ChevronLeft, Pencil, Users, BookOpen,
  Loader2, ExternalLink, Check, X, ClipboardList, MoreVertical,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Data layer ───────────────────────────────────────────────────────────────
async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

type MatrixSummary = {
  id: number; name: string; description: string | null;
  itemCount: number; peopleCount: number; createdByName: string | null; updatedAt: string;
};
type Item = {
  id: number; label: string; sopId: number | null; sortOrder: number;
  sopTitle: string | null; sopFileSizeBytes: number | null;
};
type Enrolment = {
  enrolmentId: number; userId: number; name: string; role: string;
  avatarUrl: string | null; sortOrder: number;
};
type RecordCell = {
  itemId: number; userId: number; trained: boolean;
  trainedAt: string | null; signedOffByName: string | null;
};
type MatrixDetail = {
  matrix: { id: number; name: string; description: string | null };
  items: Item[]; enrolments: Enrolment[]; records: RecordCell[];
};
type Sop = { id: number; title: string; assessmentType: string; fileSizeBytes: number | null };
type AppUserLite = { id: number; name: string; role: string; isActive: boolean };

const cellKey = (itemId: number, userId: number) => `${itemId}:${userId}`;

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function TrainingMatrixPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Training"
        description="Onboarding & training sign-off matrices."
        action={
          // The lean matrix is a reflection of the curriculum, so the place
          // to change it is the curriculum itself — reachable from here,
          // always, rather than buried in the morning-meeting screens.
          <Link href="/lean-curriculum">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary/70 text-xs font-medium transition-colors cursor-pointer">
              <BookOpen className="w-3.5 h-3.5" /> Lean curriculum
            </span>
          </Link>
        }
      />
      {selectedId == null
        ? <MatrixList onOpen={setSelectedId} />
        : <MatrixDetailView matrixId={selectedId} onBack={() => setSelectedId(null)} />}
    </div>
  );
}

// ─── List view ──────────────────────────────────────────────────────────────
function MatrixList({ onOpen }: { onOpen: (id: number) => void }) {
  const qc = useQueryClient();
  const { data: matrices, isLoading } = useQuery({
    queryKey: ["training", "matrices"],
    queryFn: () => api<MatrixSummary[]>("/training/matrices"),
  });
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const createMatrix = useMutation({
    mutationFn: () => api<MatrixSummary>("/training/matrices", {
      method: "POST",
      body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
    }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["training", "matrices"] });
      setIsAddOpen(false); setName(""); setDescription("");
      toast({ title: "Matrix created", description: created.name });
      onOpen(created.id);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMatrix = useMutation({
    mutationFn: (id: number) => api<void>(`/training/matrices/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["training", "matrices"] }); toast({ title: "Matrix deleted" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button
          onClick={() => setIsAddOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> New Matrix
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : !matrices?.length ? (
        <div className="text-center py-20 text-muted-foreground">
          <GraduationCap className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No training matrices yet</p>
          <p className="text-sm">Create one to start tracking onboarding sign-offs.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {matrices.map((m) => (
            <div key={m.id} className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <button onClick={() => onOpen(m.id)} className="flex items-start gap-3 text-left min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                    <GraduationCap className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{m.name}</p>
                    {m.description && <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{m.description}</p>}
                  </div>
                </button>
                <button
                  onClick={() => { if (confirm(`Delete "${m.name}"? This removes its items and all sign-offs.`)) deleteMatrix.mutate(m.id); }}
                  className="p-2 text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                  aria-label="Delete matrix"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <button onClick={() => onOpen(m.id)} className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t border-border">
                <span className="inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {m.peopleCount} {m.peopleCount === 1 ? "person" : "people"}</span>
                <span className="inline-flex items-center gap-1"><ClipboardList className="w-3.5 h-3.5" /> {m.itemCount} {m.itemCount === 1 ? "item" : "items"}</span>
              </button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader><DialogTitle>New Training Matrix</DialogTitle></DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); if (name.trim()) createMatrix.mutate(); }}
            className="space-y-4 mt-2"
          >
            <div>
              <label className="text-sm font-medium mb-1 block">Name *</label>
              <input
                value={name} onChange={(e) => setName(e.target.value)} autoFocus
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="e.g. New Colleague Onboarding"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Description</label>
              <textarea
                value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                placeholder="Optional"
              />
            </div>
            <button
              type="submit" disabled={!name.trim() || createMatrix.isPending}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {createMatrix.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create Matrix
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Detail (grid) view ───────────────────────────────────────────────────────
function MatrixDetailView({ matrixId, onBack }: { matrixId: number; onBack: () => void }) {
  const qc = useQueryClient();
  const matrixKey = ["training", "matrix", matrixId] as const;
  const { data, isLoading } = useQuery({
    queryKey: matrixKey,
    queryFn: () => api<MatrixDetail>(`/training/matrices/${matrixId}`),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: matrixKey });

  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [isAddPersonOpen, setIsAddPersonOpen] = useState(false);
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [isEditMatrixOpen, setIsEditMatrixOpen] = useState(false);
  const [onboardingPerson, setOnboardingPerson] = useState<{ userId: number; name: string } | null>(null);

  const upsertRecord = useMutation({
    mutationFn: (vars: { itemId: number; userId: number; trained: boolean; trainedAt: string | null }) =>
      api<RecordCell>("/training/records", { method: "PUT", body: JSON.stringify(vars) }),
    onSuccess: invalidate,
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const deleteItem = useMutation({
    mutationFn: (itemId: number) => api<void>(`/training/items/${itemId}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); toast({ title: "Item removed" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const removeEnrolment = useMutation({
    mutationFn: (enrolmentId: number) => api<void>(`/training/enrolments/${enrolmentId}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); toast({ title: "Person removed" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  const { matrix, items, enrolments, records } = data;
  const recordMap = new Map(records.map(r => [cellKey(r.itemId, r.userId), r]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" /> All matrices
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsAddPersonOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-border text-sm font-medium hover:bg-secondary/60 transition-colors"
          >
            <Users className="w-4 h-4" /> Add person
          </button>
          <button
            onClick={() => setIsAddItemOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add item
          </button>
        </div>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold truncate">{matrix.name}</h2>
          {matrix.description && <p className="text-sm text-muted-foreground">{matrix.description}</p>}
        </div>
        <button
          onClick={() => setIsEditMatrixOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-sm font-medium hover:bg-secondary/60 transition-colors flex-shrink-0"
        >
          <Pencil className="w-4 h-4" /> Edit details
        </button>
      </div>

      {items.length === 0 && enrolments.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-2xl">
          <p className="font-medium">Empty matrix</p>
          <p className="text-sm">Add training items and enrol people to build the grid.</p>
        </div>
      ) : (
        // Transposed grid: items down the left (readable), people across the top.
        <div className="border border-border rounded-2xl overflow-auto bg-card max-h-[72vh]">
          <table className="border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 bg-card border-b border-r border-border p-3 text-left align-bottom min-w-[240px]">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Training item</span>
                </th>
                {enrolments.map((person) => (
                  <th key={person.enrolmentId} className="sticky top-0 z-20 bg-card border-b border-border align-bottom p-0">
                    <PersonHeader
                      person={person}
                      onRemove={() => { if (confirm(`Remove ${person.name} from this matrix?`)) removeEnrolment.mutate(person.enrolmentId); }}
                      onViewOnboarding={() => setOnboardingPerson({ userId: person.userId, name: person.name })}
                    />
                  </th>
                ))}
                {enrolments.length === 0 && (
                  <th className="sticky top-0 z-20 bg-card border-b border-border p-3 text-xs text-muted-foreground font-normal align-bottom whitespace-nowrap">No people yet — add someone →</th>
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="group">
                  <td className="sticky left-0 z-10 bg-card border-r border-b border-border p-2.5 min-w-[240px]">
                    <ItemRowHeader
                      item={item}
                      onEdit={() => setEditItem(item)}
                      onDelete={() => { if (confirm(`Remove "${item.label}"? Its sign-offs will be deleted.`)) deleteItem.mutate(item.id); }}
                    />
                  </td>
                  {enrolments.map((person) => {
                    const rec = recordMap.get(cellKey(item.id, person.userId)) ?? null;
                    return (
                      <td key={person.enrolmentId} className="border-b border-border p-0 text-center align-middle">
                        <Cell
                          record={rec}
                          onSave={(trained, trainedAt) => upsertRecord.mutate({ itemId: item.id, userId: person.userId, trained, trainedAt })}
                          saving={upsertRecord.isPending}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td className="p-4 text-sm text-muted-foreground" colSpan={Math.max(1, enrolments.length + 1)}>No items yet — add one.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {isAddItemOpen && <AddItemDialog matrixId={matrixId} onClose={() => setIsAddItemOpen(false)} onDone={invalidate} />}
      {editItem && <EditItemDialog item={editItem} onClose={() => setEditItem(null)} onDone={invalidate} />}
      {isAddPersonOpen && <AddPersonDialog matrixId={matrixId} enrolledIds={enrolments.map(e => e.userId)} onClose={() => setIsAddPersonOpen(false)} onDone={invalidate} />}
      {isEditMatrixOpen && <EditMatrixDialog matrix={matrix} onClose={() => setIsEditMatrixOpen(false)} onDone={invalidate} />}
      {onboardingPerson && <OnboardingInfoDialog userId={onboardingPerson.userId} name={onboardingPerson.name} onClose={() => setOnboardingPerson(null)} />}
    </div>
  );
}

// ─── Item row header (left column: readable label + open SOP + edit/remove) ───
function ItemRowHeader({ item, onEdit, onDelete }: { item: Item; onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const isSop = item.sopId != null;
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        {isSop && <FileText className="w-4 h-4 text-primary flex-shrink-0" />}
        <span className="text-sm font-medium">{item.label}</span>
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className="p-1 rounded-md text-muted-foreground/40 group-hover:text-muted-foreground hover:bg-secondary transition-colors flex-shrink-0"
            aria-label="Item actions"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-1.5" align="end">
          {isSop && (
            <a
              href={`${BASE}/documents/${item.sopId}`} target="_blank" rel="noopener noreferrer"
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-secondary transition-colors"
              onClick={() => setOpen(false)}
            >
              <ExternalLink className="w-4 h-4 text-primary" /> Open document
            </a>
          )}
          <button onClick={() => { setOpen(false); onEdit(); }} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-secondary transition-colors">
            <Pencil className="w-4 h-4" /> Edit item
          </button>
          <button onClick={() => { setOpen(false); onDelete(); }} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-destructive hover:bg-destructive/10 transition-colors">
            <Trash2 className="w-4 h-4" /> Remove item
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ─── Person column header (avatar + rotated name + remove) ────────────────────
function PersonHeader({ person, onRemove, onViewOnboarding }: { person: Enrolment; onRemove: () => void; onViewOnboarding: () => void }) {
  const [open, setOpen] = useState(false);
  const initials = person.name.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="h-40 w-12 flex flex-col items-center justify-end gap-2 pb-2 hover:bg-secondary/50 transition-colors" title={person.name}>
          <span
            className="text-xs font-medium text-foreground whitespace-nowrap max-h-28 overflow-hidden text-ellipsis"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            {person.name}
          </span>
          <span className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center flex-shrink-0">
            {initials}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-1.5" align="start">
        <p className="text-sm font-medium px-2 py-1.5">{person.name}</p>
        <div className="h-px bg-border my-1" />
        <button onClick={() => { setOpen(false); onViewOnboarding(); }} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-secondary transition-colors">
          <ClipboardList className="w-4 h-4" /> View onboarding info
        </button>
        <button onClick={() => { setOpen(false); onRemove(); }} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-destructive hover:bg-destructive/10 transition-colors">
          <X className="w-4 h-4" /> Remove from matrix
        </button>
      </PopoverContent>
    </Popover>
  );
}

// Read-only view of a colleague's pre-arrival onboarding submission, so the
// admin can tick the matching matrix items. Loads from /api/onboarding/:userId.
function OnboardingInfoDialog({ userId, name, onClose }: { userId: number; name: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["onboarding", userId],
    queryFn: () => api<{ submission: any; documents: { id: number; kind: string; fileName: string | null }[] }>(`/onboarding/${userId}`),
  });
  const s = data?.submission;
  const docs = data?.documents ?? [];
  const kindLabel: Record<string, string> = { right_to_work: "Right to work / ID", food_hygiene: "Food Hygiene certificate", other: "Document" };
  const Row = ({ label, value }: { label: string; value: string | null | undefined }) => (
    <div className="flex justify-between gap-3 py-1.5 border-b border-border last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-right">{value || <span className="text-muted-foreground/60">—</span>}</span>
    </div>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader><DialogTitle>Onboarding info — {name}</DialogTitle></DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : !s && docs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">{name} hasn't submitted their pre-arrival form yet.</p>
        ) : (
          <div className="space-y-4 mt-1">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Contact</p>
              <Row label="Mobile" value={s?.phone} />
              <Row label="Address" value={s?.address} />
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Emergency contact</p>
              <Row label="Name" value={s?.emergencyContactName} />
              <Row label="Phone" value={s?.emergencyContactPhone} />
              <Row label="Relationship" value={s?.emergencyContactRelationship} />
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Documents</p>
              {docs.length === 0 ? (
                <p className="text-sm text-muted-foreground/60">None uploaded</p>
              ) : (
                <ul className="space-y-1.5">
                  {docs.map(d => (
                    <li key={d.id} className="flex items-center justify-between gap-2 text-sm bg-secondary/40 rounded-lg px-3 py-2">
                      <span className="flex items-center gap-2 min-w-0"><FileText className="w-4 h-4 text-primary flex-shrink-0" /><span className="truncate">{kindLabel[d.kind] ?? d.kind}</span></span>
                      <a href={`${BASE}/api/onboarding/documents/${d.id}/file`} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                        <ExternalLink className="w-3.5 h-3.5" /> Open
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Cell (the dot + sign-off popover) ────────────────────────────────────────
function Cell({ record, onSave, saving }: {
  record: RecordCell | null;
  onSave: (trained: boolean, trainedAt: string | null) => void;
  saving: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trained = record?.trained ?? false;
  const today = new Date().toISOString().slice(0, 10);
  const [draftTrained, setDraftTrained] = useState(trained);
  const [draftDate, setDraftDate] = useState(record?.trainedAt ?? today);

  function openCell() {
    setDraftTrained(trained);
    setDraftDate(record?.trainedAt ?? today);
    setOpen(true);
  }

  return (
    <Popover open={open} onOpenChange={(o) => (o ? openCell() : setOpen(false))}>
      <PopoverTrigger asChild>
        <button
          className="w-12 h-12 flex items-center justify-center hover:bg-secondary/40 transition-colors"
          title={trained ? `Trained${record?.trainedAt ? ` ${formatDate(record.trainedAt)}` : ""}${record?.signedOffByName ? ` · ${record.signedOffByName}` : ""}` : "Not trained"}
        >
          <span
            className={cn(
              "w-5 h-5 rounded-full border-2 transition-colors",
              trained ? "bg-primary border-primary" : "border-muted-foreground/30",
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-3 space-y-3" align="center">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <span
            onClick={() => setDraftTrained(v => !v)}
            className={cn(
              "w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
              draftTrained ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40",
            )}
          >
            {draftTrained && <Check className="w-3.5 h-3.5" />}
          </span>
          <span className="text-sm font-medium">Trained</span>
        </label>

        {draftTrained && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Date trained</label>
            <input
              type="date" value={draftDate} onChange={(e) => setDraftDate(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        )}

        {trained && record?.signedOffByName && (
          <p className="text-xs text-muted-foreground">Signed off by {record.signedOffByName}</p>
        )}

        <button
          onClick={() => { onSave(draftTrained, draftTrained ? draftDate : null); setOpen(false); }}
          disabled={saving}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save
        </button>
      </PopoverContent>
    </Popover>
  );
}

// ─── Edit matrix details dialog (rename / re-describe) ────────────────────────
function EditMatrixDialog({ matrix, onClose, onDone }: {
  matrix: { id: number; name: string; description: string | null };
  onClose: () => void; onDone: () => void;
}) {
  const [name, setName] = useState(matrix.name);
  const [description, setDescription] = useState(matrix.description ?? "");

  const updateMatrix = useMutation({
    mutationFn: () => api(`/training/matrices/${matrix.id}`, {
      method: "PUT",
      body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
    }),
    onSuccess: () => { onDone(); onClose(); toast({ title: "Matrix updated" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader><DialogTitle>Edit matrix details</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) updateMatrix.mutate(); }} className="space-y-4 mt-2">
          <div>
            <label className="text-sm font-medium mb-1 block">Name *</label>
            <input
              value={name} onChange={(e) => setName(e.target.value)} autoFocus
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Description</label>
            <textarea
              value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              placeholder="Optional"
            />
          </div>
          <button
            type="submit" disabled={!name.trim() || updateMatrix.isPending}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {updateMatrix.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save changes
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add item dialog ──────────────────────────────────────────────────────────
function AddItemDialog({ matrixId, onClose, onDone }: { matrixId: number; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<"custom" | "sop">("custom");
  const [label, setLabel] = useState("");
  const [sopId, setSopId] = useState<string>("");

  const { data: sops } = useQuery({
    queryKey: ["training", "sops"],
    queryFn: async () => {
      const all = await api<Sop[]>("/risk-assessments");
      return all.filter(d => d.assessmentType === "sop" || d.assessmentType === "policy");
    },
  });

  const addItem = useMutation({
    mutationFn: () => api<Item>(`/training/matrices/${matrixId}/items`, {
      method: "POST",
      body: JSON.stringify(
        mode === "sop"
          ? { sopId: Number(sopId), label: label.trim() || undefined }
          : { label: label.trim() },
      ),
    }),
    onSuccess: () => { onDone(); onClose(); toast({ title: "Item added" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const canSubmit = mode === "custom" ? !!label.trim() : !!sopId;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader><DialogTitle>Add training item</DialogTitle></DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setMode("custom")}
              className={cn("px-3 py-2 rounded-lg text-sm font-medium border transition-colors", mode === "custom" ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary/60")}
            >Custom item</button>
            <button
              onClick={() => setMode("sop")}
              className={cn("px-3 py-2 rounded-lg text-sm font-medium border transition-colors", mode === "sop" ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary/60")}
            >Link a SOP</button>
          </div>

          {mode === "sop" && (
            <div>
              <label className="text-sm font-medium mb-1 block">SOP document *</label>
              <select
                value={sopId} onChange={(e) => setSopId(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">Select a SOP…</option>
                {sops?.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
              {sops && sops.length === 0 && <p className="text-xs text-muted-foreground mt-1">No SOPs in Documents yet. Add one under Reports → Documents, or use a custom item.</p>}
            </div>
          )}

          <div>
            <label className="text-sm font-medium mb-1 block">{mode === "sop" ? "Column label (optional override)" : "Label *"}</label>
            <input
              value={label} onChange={(e) => setLabel(e.target.value)} autoFocus={mode === "custom"}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder={mode === "sop" ? "Defaults to the SOP title" : "e.g. Emergency Contact Details"}
            />
          </div>

          <button
            onClick={() => addItem.mutate()} disabled={!canSubmit || addItem.isPending}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {addItem.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add item
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit item dialog ─────────────────────────────────────────────────────────
function EditItemDialog({ item, onClose, onDone }: { item: Item; onClose: () => void; onDone: () => void }) {
  const [label, setLabel] = useState(item.label);
  const [sopId, setSopId] = useState<string>(item.sopId != null ? String(item.sopId) : "");

  const { data: sops } = useQuery({
    queryKey: ["training", "sops"],
    queryFn: async () => {
      const all = await api<Sop[]>("/risk-assessments");
      return all.filter(d => d.assessmentType === "sop" || d.assessmentType === "policy");
    },
  });

  const updateItem = useMutation({
    mutationFn: () => api<Item>(`/training/items/${item.id}`, {
      method: "PUT",
      body: JSON.stringify({ label: label.trim(), sopId: sopId ? Number(sopId) : null }),
    }),
    onSuccess: () => { onDone(); onClose(); toast({ title: "Item updated" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader><DialogTitle>Edit item</DialogTitle></DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <label className="text-sm font-medium mb-1 block">Label *</label>
            <input
              value={label} onChange={(e) => setLabel(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Linked SOP</label>
            <select
              value={sopId} onChange={(e) => setSopId(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">No SOP (custom item)</option>
              {sops?.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>
          <button
            onClick={() => updateItem.mutate()} disabled={!label.trim() || updateItem.isPending}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {updateItem.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save changes
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add person dialog ────────────────────────────────────────────────────────
function AddPersonDialog({ matrixId, enrolledIds, onClose, onDone }: {
  matrixId: number; enrolledIds: number[]; onClose: () => void; onDone: () => void;
}) {
  const [userId, setUserId] = useState<string>("");
  const enrolled = new Set(enrolledIds);

  const { data: users } = useQuery({
    queryKey: ["training", "users"],
    queryFn: () => api<AppUserLite[]>("/users"),
  });
  const available = users?.filter(u => u.isActive && !enrolled.has(u.id)) ?? [];

  const enrol = useMutation({
    mutationFn: () => api(`/training/matrices/${matrixId}/enrolments`, {
      method: "POST", body: JSON.stringify({ userId: Number(userId) }),
    }),
    onSuccess: () => { onDone(); onClose(); toast({ title: "Person added" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader><DialogTitle>Add person to matrix</DialogTitle></DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <label className="text-sm font-medium mb-1 block">Team member *</label>
            <select
              value={userId} onChange={(e) => setUserId(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">Select a person…</option>
              {available.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            {users && available.length === 0 && <p className="text-xs text-muted-foreground mt-1">Everyone is already enrolled. New starters need a user account first (Settings → Team & Access).</p>}
          </div>
          <button
            onClick={() => enrol.mutate()} disabled={!userId || enrol.isPending}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {enrol.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add to matrix
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
