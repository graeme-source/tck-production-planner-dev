import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen, X, Loader2, Plus, Upload, Trash2, Filter, ChevronLeft, ChevronRight,
  Edit2, ArrowUp, ArrowDown, FileText, Image as ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { STATIONS } from "@/pages/station/shared/constants";

interface SopSummary {
  id: number;
  title: string;
  stations: string[];
  authorName: string | null;
  stepCount: number;
  coverImageStepId: number | null;
  updatedAt: string;
}

interface SopStep {
  id: number;
  position: number;
  description: string;
  hasImage: boolean;
}

interface SopDetail extends SopSummary {
  steps: SopStep[];
}

const STATION_LABELS: Record<string, string> = {
  main_prep: "Main Prep",
  prep_bases: "Bases & Sauces",
  prep_meat: "Raw Meat Prep",
};
for (const s of STATIONS) STATION_LABELS[s.key] = s.label;

function stationLabel(key: string): string {
  return STATION_LABELS[key] ?? key;
}

// For SOP tagging we collapse building_1 + building_2 into a single
// "Building" picker — operators think of it as one workstation for
// reference-material purposes. The underlying station keys stay separate
// so the filter-by-station logic keeps working unchanged: selecting the
// virtual key tags BOTH real keys on save.
interface PickerOption {
  id: string;               // virtual id used inside the picker set
  label: string;
  stationKeys: string[];    // real station keys to tag when selected
}

const BUILDING_GROUP_ID = "building";

const PICKER_OPTIONS: PickerOption[] = [
  ...STATIONS
    .filter(s => s.key !== "building_1" && s.key !== "building_2")
    .map(s => ({ id: s.key, label: s.label, stationKeys: [s.key] })),
  { id: BUILDING_GROUP_ID, label: "Building", stationKeys: ["building_1", "building_2"] },
  { id: "main_prep", label: "Main Prep", stationKeys: ["main_prep"] },
  { id: "prep_bases", label: "Bases & Sauces", stationKeys: ["prep_bases"] },
  { id: "prep_meat", label: "Raw Meat Prep", stationKeys: ["prep_meat"] },
];

// Turn a list of real station keys into the picker ids that are currently
// selected. "Building" is selected if EITHER building_1 or building_2 is
// present (so SOPs tagged under only one still show the group selected).
function realKeysToPickerIds(stations: string[]): Set<string> {
  const set = new Set<string>();
  const realSet = new Set(stations);
  for (const opt of PICKER_OPTIONS) {
    if (opt.stationKeys.some(k => realSet.has(k))) set.add(opt.id);
  }
  return set;
}

// Given a picker id set, return the flat list of real station keys to save.
function pickerIdsToRealKeys(pickerIds: Set<string>): string[] {
  const out = new Set<string>();
  for (const opt of PICKER_OPTIONS) {
    if (pickerIds.has(opt.id)) for (const k of opt.stationKeys) out.add(k);
  }
  return Array.from(out);
}

// Group the saved station keys for display on cards. building_1 + building_2
// both present collapse into a single "Building" chip; one-only keeps its
// specific label so admins can still see the partial tagging.
function displayStationTags(stations: string[]): string[] {
  const set = new Set(stations);
  const out: string[] = [];
  const hasBoth = set.has("building_1") && set.has("building_2");
  if (hasBoth) {
    out.push("Building");
    set.delete("building_1");
    set.delete("building_2");
  }
  for (const key of set) out.push(stationLabel(key));
  return out;
}

function stepImageUrl(stepId: number, cacheBust?: number): string {
  return `/api/standards/steps/${stepId}/image${cacheBust ? `?v=${cacheBust}` : ""}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Top-level dialog — library + viewer + editor routing lives here.
// ─────────────────────────────────────────────────────────────────────────

export function StandardsSopsDialog({
  open,
  onClose,
  currentStationType,
}: {
  open: boolean;
  onClose: () => void;
  currentStationType?: string | null;
}) {
  type View = { kind: "library" } | { kind: "viewer"; sopId: number } | { kind: "editor"; sopId: number };
  const [view, setView] = useState<View>({ kind: "library" });

  useEffect(() => {
    if (open) setView({ kind: "library" });
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-black/60"
            onClick={onClose}
          />
          {view.kind === "library" && (
            <Library
              currentStationType={currentStationType ?? null}
              onClose={onClose}
              onOpenSop={(sopId) => setView({ kind: "viewer", sopId })}
              onEditSop={(sopId) => setView({ kind: "editor", sopId })}
            />
          )}
          {view.kind === "viewer" && (
            <Viewer
              sopId={view.sopId}
              onBack={() => setView({ kind: "library" })}
              onEdit={() => setView({ kind: "editor", sopId: view.sopId })}
              onClose={onClose}
            />
          )}
          {view.kind === "editor" && (
            <Editor
              sopId={view.sopId}
              onBack={() => setView({ kind: "library" })}
              onClose={onClose}
              defaultStation={currentStationType ?? null}
            />
          )}
        </>
      )}
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Library
// ─────────────────────────────────────────────────────────────────────────

function Library({
  currentStationType,
  onClose,
  onOpenSop,
  onEditSop,
}: {
  currentStationType: string | null;
  onClose: () => void;
  onOpenSop: (sopId: number) => void;
  onEditSop: (sopId: number) => void;
}) {
  const { state } = useAuth();
  const canEdit = state.status === "authenticated" && (state.user.role === "admin" || state.user.role === "manager");

  const [filter, setFilter] = useState<"current" | "all">(currentStationType ? "current" : "all");
  const [items, setItems] = useState<SopSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const effectiveStationFilter = filter === "current" ? currentStationType ?? null : null;

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = effectiveStationFilter ? `?station=${encodeURIComponent(effectiveStationFilter)}` : "";
      const resp = await fetch(`/api/standards${params}`, { credentials: "include" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: SopSummary[] = await resp.json();
      setItems(data);
    } catch (err) {
      console.warn("[Standards] fetch failed:", err);
      toast({ title: "Failed to load SOPs", variant: "destructive" });
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [effectiveStationFilter]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const resp = await fetch("/api/standards", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Untitled SOP",
          stations: currentStationType ? [currentStationType] : [],
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: { id: number } = await resp.json();
      onEditSop(data.id);
    } catch (err) {
      toast({ title: "Failed to create SOP", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("Delete this SOP?")) return;
    try {
      const resp = await fetch(`/api/standards/${id}`, { method: "DELETE", credentials: "include" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      toast({ title: "Deleted" });
      fetchList();
    } catch (err) {
      toast({ title: "Delete failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: 8 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
    >
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col pointer-events-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <BookOpen className="w-5 h-5 text-primary flex-shrink-0" />
            <h2 className="font-display font-bold text-xl truncate">Standards &amp; SOPs</h2>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && (
              <button
                onClick={handleCreate}
                disabled={creating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60"
              >
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                New SOP
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {currentStationType && (
          <div className="flex items-center gap-1.5 px-5 py-3 border-b border-border flex-shrink-0 text-sm">
            <Filter className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-muted-foreground mr-1">Show:</span>
            <div className="inline-flex rounded-lg border border-border bg-background overflow-hidden">
              <button
                onClick={() => setFilter("current")}
                className={cn(
                  "px-3 py-1.5 text-sm font-medium transition-colors",
                  filter === "current" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
                )}
              >
                {stationLabel(currentStationType)}
              </button>
              <button
                onClick={() => setFilter("all")}
                className={cn(
                  "px-3 py-1.5 text-sm font-medium transition-colors border-l border-border",
                  filter === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
                )}
              >
                All stations
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          )}
          {!loading && items && items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <BookOpen className="w-12 h-12 text-muted-foreground/40 mb-3" />
              <p className="font-semibold">No SOPs yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                {filter === "current" && currentStationType
                  ? `Nothing is filed against ${stationLabel(currentStationType)} yet.`
                  : "Tap \u201cNew SOP\u201d to create your first one."}
              </p>
            </div>
          )}
          {!loading && items && items.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map(item => (
                <SopCard
                  key={item.id}
                  item={item}
                  canEdit={canEdit}
                  onOpen={() => onOpenSop(item.id)}
                  onEdit={() => onEditSop(item.id)}
                  onDelete={() => handleDelete(item.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function SopCard({
  item,
  canEdit,
  onOpen,
  onEdit,
  onDelete,
}: {
  item: SopSummary;
  canEdit: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="bg-background border border-border rounded-xl overflow-hidden flex flex-col group">
      <button
        onClick={onOpen}
        className="relative aspect-[4/3] bg-secondary/40 overflow-hidden flex items-center justify-center"
      >
        {item.coverImageStepId ? (
          <img src={stepImageUrl(item.coverImageStepId)} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
        ) : (
          <FileText className="w-10 h-10 text-muted-foreground/40" />
        )}
        <span className="absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded-full bg-black/60 text-white font-medium">
          {item.stepCount} step{item.stepCount === 1 ? "" : "s"}
        </span>
      </button>
      <div className="p-3 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm leading-tight">{item.title || "Untitled SOP"}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
            by {item.authorName ?? "Unknown"}
          </p>
          {item.stations.length > 0 ? (() => {
            const tags = displayStationTags(item.stations);
            return (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {tags.slice(0, 3).map(t => (
                  <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">
                    {t}
                  </span>
                ))}
                {tags.length > 3 && (
                  <span className="text-[10px] text-muted-foreground">+{tags.length - 3}</span>
                )}
              </div>
            );
          })() : (
            <span className="text-[10px] px-1.5 py-0.5 mt-1.5 inline-block rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              All stations
            </span>
          )}
        </div>
        {canEdit && (
          <div className="flex flex-col gap-1 flex-shrink-0">
            <button onClick={onEdit} title="Edit" className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary">
              <Edit2 className="w-4 h-4" />
            </button>
            <button onClick={onDelete} title="Delete" className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Viewer — full-screen, one step per screen, swipe / arrow navigation.
// ─────────────────────────────────────────────────────────────────────────

function Viewer({
  sopId,
  onBack,
  onEdit,
  onClose,
}: {
  sopId: number;
  onBack: () => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { state } = useAuth();
  const canEdit = state.status === "authenticated" && (state.user.role === "admin" || state.user.role === "manager");

  const [sop, setSop] = useState<SopDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [stepIndex, setStepIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/standards/${sopId}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data: SopDetail) => {
        setSop(data);
        setStepIndex(0);
      })
      .catch(err => toast({ title: "Failed to load", description: String(err), variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [sopId]);

  const steps = sop?.steps ?? [];
  const totalSteps = steps.length;
  const step = steps[stepIndex];
  const atFirst = stepIndex === 0;
  const atLast = stepIndex >= totalSteps - 1;

  const goPrev = useCallback(() => setStepIndex(i => Math.max(0, i - 1)), []);
  const goNext = useCallback(() => setStepIndex(i => Math.min(totalSteps - 1, i + 1)), [totalSteps]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goPrev, goNext, onBack]);

  const onTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 40) return;
    if (dx < 0) goNext(); else goPrev();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex flex-col bg-card pointer-events-auto"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="w-4 h-4" /> Library
        </button>
        <div className="min-w-0 flex-1 text-center px-4">
          <p className="font-display font-bold text-xl truncate">{sop?.title || "Loading…"}</p>
          {totalSteps > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Step {stepIndex + 1} of {totalSteps}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canEdit && sop && (
            <button onClick={onEdit} className="text-sm px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary">
              Edit
            </button>
          )}
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative flex items-stretch">
        {loading && (
          <div className="flex items-center justify-center w-full text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        )}
        {!loading && totalSteps === 0 && (
          <div className="flex items-center justify-center w-full text-muted-foreground">
            <p>This SOP has no steps yet.</p>
          </div>
        )}
        {!loading && step && (
          <div className="flex-1 flex flex-col lg:flex-row">
            {step.hasImage && (
              <div className="lg:w-3/5 bg-secondary/30 flex items-center justify-center p-6 overflow-hidden">
                <img
                  src={stepImageUrl(step.id)}
                  alt={`Step ${stepIndex + 1}`}
                  className="max-w-full max-h-[60vh] lg:max-h-full object-contain rounded-lg"
                />
              </div>
            )}
            <div className={cn(
              "flex-1 flex flex-col items-center justify-center p-8 overflow-y-auto",
              !step.hasImage && "lg:items-center",
            )}>
              <div className="max-w-3xl w-full">
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
                  Step {stepIndex + 1}
                </div>
                <p className="text-2xl md:text-3xl lg:text-4xl leading-relaxed font-medium whitespace-pre-wrap">
                  {step.description || <span className="text-muted-foreground italic">No description.</span>}
                </p>
              </div>
            </div>
          </div>
        )}

        {totalSteps > 1 && (
          <>
            <button
              onClick={goPrev}
              disabled={atFirst}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-background/90 border border-border shadow flex items-center justify-center disabled:opacity-30 disabled:pointer-events-none hover:bg-secondary transition-colors"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              onClick={goNext}
              disabled={atLast}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-background/90 border border-border shadow flex items-center justify-center disabled:opacity-30 disabled:pointer-events-none hover:bg-secondary transition-colors"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </>
        )}
      </div>

      {totalSteps > 1 && (
        <div className="px-5 py-3 border-t border-border flex items-center justify-center gap-1.5 flex-shrink-0">
          {steps.map((_, i) => (
            <button
              key={i}
              onClick={() => setStepIndex(i)}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === stepIndex ? "w-8 bg-primary" : "w-1.5 bg-border hover:bg-muted-foreground",
              )}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Editor — inline step list with autosave + image upload per step.
// ─────────────────────────────────────────────────────────────────────────

function Editor({
  sopId,
  onBack,
  onClose,
  defaultStation,
}: {
  sopId: number;
  onBack: () => void;
  onClose: () => void;
  defaultStation: string | null;
}) {
  const [sop, setSop] = useState<SopDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  // Picker state tracks virtual picker ids (so "building" is one id that
  // maps to two real station keys). Saved to the server as the flat list
  // of real keys via pickerIdsToRealKeys.
  const [pickerIds, setPickerIds] = useState<Set<string>>(new Set());

  const fetchDetail = useCallback(async () => {
    try {
      const resp = await fetch(`/api/standards/${sopId}`, { credentials: "include" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: SopDetail = await resp.json();
      setSop(data);
      setTitle(data.title);
      setPickerIds(realKeysToPickerIds(data.stations));
    } catch (err) {
      toast({ title: "Failed to load", description: String(err), variant: "destructive" });
    }
  }, [sopId]);

  useEffect(() => {
    setLoading(true);
    fetchDetail().finally(() => setLoading(false));
  }, [fetchDetail]);

  const saveMeta = async (next: { title?: string; stations?: string[] }) => {
    try {
      await fetch(`/api/standards/${sopId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
    } catch (err) {
      toast({ title: "Save failed", description: String(err), variant: "destructive" });
    }
  };

  const togglePickerId = (id: string) => {
    setPickerIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveMeta({ stations: pickerIdsToRealKeys(next) });
      return next;
    });
  };

  const addStep = async () => {
    try {
      const resp = await fetch(`/api/standards/${sopId}/steps`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: "" }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      fetchDetail();
    } catch (err) {
      toast({ title: "Failed to add step", description: String(err), variant: "destructive" });
    }
  };

  const moveStep = async (stepId: number, direction: -1 | 1) => {
    if (!sop) return;
    const idx = sop.steps.findIndex(s => s.id === stepId);
    const newIdx = idx + direction;
    if (idx < 0 || newIdx < 0 || newIdx >= sop.steps.length) return;
    const reordered = [...sop.steps];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    setSop({ ...sop, steps: reordered.map((s, i) => ({ ...s, position: i })) });
    try {
      await fetch(`/api/standards/${sopId}/reorder`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepIds: reordered.map(s => s.id) }),
      });
    } catch (err) {
      toast({ title: "Reorder failed", description: String(err), variant: "destructive" });
      fetchDetail();
    }
  };

  const deleteStep = async (stepId: number) => {
    if (!window.confirm("Delete this step?")) return;
    try {
      await fetch(`/api/standards/steps/${stepId}`, { method: "DELETE", credentials: "include" });
      fetchDetail();
    } catch (err) {
      toast({ title: "Delete failed", description: String(err), variant: "destructive" });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: 8 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
    >
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[94vh] flex flex-col pointer-events-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="w-4 h-4" /> Library
          </button>
          <h2 className="font-display font-bold text-lg">Edit SOP</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {loading && <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>}
          {!loading && sop && (
            <>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium block mb-1.5">Name</label>
                  <input
                    type="text"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    onBlur={() => saveMeta({ title })}
                    placeholder="e.g. Changeover between Margherita and BBQ Pulled Pork"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  {sop.authorName && (
                    <p className="text-xs text-muted-foreground mt-1">Author: {sop.authorName}</p>
                  )}
                </div>
                <div>
                  <label className="text-sm font-medium block mb-1.5">Stations</label>
                  <p className="text-xs text-muted-foreground mb-2">
                    Tap every station this SOP applies to. Leave empty to show on every station.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {PICKER_OPTIONS.map(opt => {
                      const selected = pickerIds.has(opt.id);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => togglePickerId(opt.id)}
                          className={cn(
                            "text-xs px-2.5 py-1 rounded-full border transition-colors",
                            selected
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background text-muted-foreground border-border hover:text-foreground",
                          )}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Steps</h3>
                  <button
                    onClick={addStep}
                    className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <Plus className="w-4 h-4" /> Add step
                  </button>
                </div>
                {sop.steps.length === 0 && (
                  <div className="border-2 border-dashed border-border rounded-xl p-6 text-center text-muted-foreground text-sm">
                    No steps yet. Tap &ldquo;Add step&rdquo; to start.
                  </div>
                )}
                {sop.steps.map((step, i) => (
                  <StepRow
                    key={step.id}
                    step={step}
                    index={i}
                    total={sop.steps.length}
                    onChanged={fetchDetail}
                    onMove={(dir) => moveStep(step.id, dir)}
                    onDelete={() => deleteStep(step.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function StepRow({
  step,
  index,
  total,
  onChanged,
  onMove,
  onDelete,
}: {
  step: SopStep;
  index: number;
  total: number;
  onChanged: () => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [description, setDescription] = useState(step.description);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [imageBust, setImageBust] = useState(0);

  useEffect(() => { setDescription(step.description); }, [step.description]);

  const saveDescription = async () => {
    if (description === step.description) return;
    try {
      await fetch(`/api/standards/steps/${step.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
    } catch (err) {
      toast({ title: "Save failed", description: String(err), variant: "destructive" });
    }
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("image", file);
      const resp = await fetch(`/api/standards/steps/${step.id}/image`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${resp.status}`);
      }
      setImageBust(Date.now());
      onChanged();
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const removeImage = async () => {
    setRemoving(true);
    try {
      await fetch(`/api/standards/steps/${step.id}/image`, { method: "DELETE", credentials: "include" });
      onChanged();
    } catch (err) {
      toast({ title: "Remove failed", description: String(err), variant: "destructive" });
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="border border-border rounded-xl p-3 flex gap-3">
      <div className="flex-shrink-0 flex flex-col items-center gap-1 pt-1">
        <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-xs font-bold">
          {index + 1}
        </div>
        <button
          onClick={() => onMove(-1)}
          disabled={index === 0}
          className="p-1 rounded hover:bg-secondary text-muted-foreground disabled:opacity-30"
          title="Move up"
        >
          <ArrowUp className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onMove(1)}
          disabled={index === total - 1}
          className="p-1 rounded hover:bg-secondary text-muted-foreground disabled:opacity-30"
          title="Move down"
        >
          <ArrowDown className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 min-w-0 space-y-2">
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          onBlur={saveDescription}
          placeholder="Describe this step in one or two sentences…"
          rows={3}
          className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
        />
        <div className="flex items-start gap-3">
          {step.hasImage ? (
            <div className="relative w-24 h-24 rounded-lg overflow-hidden border border-border flex-shrink-0 bg-secondary/30">
              <img src={stepImageUrl(step.id, imageBust)} alt="" className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="w-24 h-24 rounded-lg border border-dashed border-border flex items-center justify-center flex-shrink-0 bg-secondary/20">
              <ImageIcon className="w-6 h-6 text-muted-foreground/50" />
            </div>
          )}
          <div className="flex-1 flex flex-wrap items-center gap-2">
            <label className="text-xs px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-secondary cursor-pointer flex items-center gap-1.5">
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              {step.hasImage ? "Replace image" : "Upload image"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) uploadImage(f);
                  e.target.value = "";
                }}
              />
            </label>
            {step.hasImage && (
              <button
                onClick={removeImage}
                disabled={removing}
                className="text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-destructive disabled:opacity-50"
              >
                Remove image
              </button>
            )}
            <button
              onClick={onDelete}
              className="ml-auto text-xs px-3 py-1.5 rounded-lg text-destructive hover:bg-destructive/10 flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete step
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
