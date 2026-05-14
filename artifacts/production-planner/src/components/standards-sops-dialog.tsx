import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen, X, Loader2, Plus, Upload, Trash2, Filter, ChevronLeft, ChevronRight,
  Edit2, ArrowUp, ArrowDown, FileText, Image as ImageIcon, Camera, CheckCircle2,
  Search, ChevronDown, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { STATIONS } from "@/pages/station/shared/constants";

interface SopSummary {
  id: number;
  title: string;
  stations: string[];
  tags: string[];
  authorId: number | null;
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
  hasVideo: boolean;
  videoMime: string | null;
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

function stepVideoUrl(stepId: number, cacheBust?: number): string {
  return `/api/standards/steps/${stepId}/video${cacheBust ? `?v=${cacheBust}` : ""}`;
}

// Detect a video URL in a (possibly multi-line) step description and return
// what we need to render it. Supports YouTube (watch / shorts / youtu.be /
// embed forms), Vimeo, and direct mp4/webm/mov links. We only embed when the
// URL is the *only* meaningful content of the description — when there's
// surrounding text the user probably wants the link displayed as text.
type EmbeddedVideo =
  | { kind: "iframe"; src: string; title: string }
  | { kind: "file"; src: string; mime?: string };

function detectVideoEmbed(description: string): EmbeddedVideo | null {
  const trimmed = description.trim();
  // The entire description must be a single URL with optional surrounding
  // whitespace. Multi-line / sentence-with-link descriptions fall through
  // to the normal text renderer (which still linkifies the URL).
  const match = trimmed.match(/^https?:\/\/\S+$/);
  if (!match) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");

  // YouTube — three URL shapes we care about:
  //   youtube.com/watch?v=ID
  //   youtu.be/ID
  //   youtube.com/shorts/ID
  //   youtube.com/embed/ID (already embed-shaped, just keep)
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
    let videoId: string | null = null;
    if (host === "youtu.be") {
      videoId = url.pathname.split("/").filter(Boolean)[0] ?? null;
    } else if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v");
    } else if (url.pathname.startsWith("/shorts/")) {
      videoId = url.pathname.split("/")[2] ?? null;
    } else if (url.pathname.startsWith("/embed/")) {
      videoId = url.pathname.split("/")[2] ?? null;
    }
    if (videoId) {
      return {
        kind: "iframe",
        src: `https://www.youtube.com/embed/${videoId}`,
        title: "YouTube video",
      };
    }
  }

  // Vimeo — vimeo.com/ID or player.vimeo.com/video/ID
  if (host === "vimeo.com") {
    const id = url.pathname.split("/").filter(Boolean).pop();
    if (id && /^\d+$/.test(id)) {
      return { kind: "iframe", src: `https://player.vimeo.com/video/${id}`, title: "Vimeo video" };
    }
  }
  if (host === "player.vimeo.com") {
    return { kind: "iframe", src: trimmed, title: "Vimeo video" };
  }

  // Direct file — extension hint only; the <video> element will refuse to
  // play if the server actually serves something else.
  if (/\.(mp4|webm|mov|m4v|ogg)(\?|$)/i.test(url.pathname)) {
    return { kind: "file", src: trimmed };
  }

  return null;
}

// Internal tags used by the bulk importer / push-to-live script — kept on
// the row for idempotency but hidden everywhere the user might see them.
// Anything matching these prefixes is filtered out of the visible chips,
// the filter dropdown options, and the free-text search corpus.
const INTERNAL_TAG_PREFIXES = ["ref:", "imported:"];

function isInternalTag(t: string): boolean {
  return INTERNAL_TAG_PREFIXES.some(p => t.startsWith(p));
}

function visibleTags(tags: string[] | null | undefined): string[] {
  if (!tags) return [];
  return tags.filter(t => !isInternalTag(t));
}

// Reusable filter dropdown. Closes on outside click + Escape. Supports both
// single-select (radio behaviour) and multi-select (checkbox behaviour) modes
// from one component so the library row stays visually consistent.
interface FilterDropdownOption {
  value: string;
  label: string;
  /** Optional subtitle shown beneath the label, e.g. role/email. */
  sub?: string;
}
function FilterDropdown({
  label,
  triggerLabel,
  options,
  selected,
  onChange,
  multi,
  align = "left",
}: {
  /** Static label shown to the left of the trigger button. */
  label: string;
  /** Text shown inside the trigger button — caller renders a summary of the
   *  current selection (e.g. "All stations" / "Ovens + 2 more"). */
  triggerLabel: string;
  options: FilterDropdownOption[];
  /** Currently-selected option values. For single-select, expect 0 or 1. */
  selected: Set<string>;
  /** Receives the new selection set. For single-select, contains 0 or 1
   *  entries (caller handles clearing externally). */
  onChange: (next: Set<string>) => void;
  multi: boolean;
  /** Which edge of the trigger the panel anchors to. */
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (value: string) => {
    if (multi) {
      const next = new Set(selected);
      if (next.has(value)) next.delete(value); else next.add(value);
      onChange(next);
    } else {
      // Single-select: clicking a selected item clears; clicking another
      // replaces. The "All" pseudo-option is handled by the caller passing
      // an empty options list, but we cover it here too.
      const next = new Set<string>();
      if (!selected.has(value)) next.add(value);
      onChange(next);
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border bg-background hover:border-primary/40 transition-colors min-w-[160px]"
      >
        <span className="text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">{label}</span>
        <span className="text-foreground flex-1 text-left truncate">{triggerLabel}</span>
        <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div
          className={cn(
            "absolute top-full mt-1 bg-card border border-border rounded-lg shadow-lg min-w-[220px] max-h-72 overflow-y-auto z-20 py-1",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => { onChange(new Set()); if (!multi) setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary/60 border-b border-border"
            >
              Clear
            </button>
          )}
          {options.map(opt => {
            const isSelected = selected.has(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-secondary/60",
                  isSelected && "bg-secondary/40",
                )}
              >
                {multi ? (
                  <span className={cn(
                    "w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0",
                    isSelected ? "bg-primary border-primary" : "border-border",
                  )}>
                    {isSelected && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                  </span>
                ) : (
                  <span className={cn(
                    "w-3.5 h-3.5 rounded-full border flex items-center justify-center flex-shrink-0",
                    isSelected ? "border-primary" : "border-border",
                  )}>
                    {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{opt.label}</span>
                  {opt.sub && <span className="block text-[10px] text-muted-foreground truncate">{opt.sub}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Top-level dialog — library + viewer + editor routing lives here.
// ─────────────────────────────────────────────────────────────────────────

export function StandardsSopsDialog({
  open,
  onClose,
  currentStationType,
  initialSopId,
}: {
  open: boolean;
  onClose: () => void;
  currentStationType?: string | null;
  /** When set, the dialog opens straight into the viewer for this SOP
   *  instead of the library list. Used from the morning meeting's
   *  "New & Updated SOPs" slide to deep-link into a specific SOP. */
  initialSopId?: number;
}) {
  type View = { kind: "library" } | { kind: "viewer"; sopId: number } | { kind: "editor"; sopId: number };
  const [view, setView] = useState<View>({ kind: "library" });

  useEffect(() => {
    if (open) {
      setView(initialSopId ? { kind: "viewer", sopId: initialSopId } : { kind: "library" });
    }
  }, [open, initialSopId]);

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
// SopsBrowser — inline version for hosting on a real page (Lean Cave etc.)
// Same view state machine (library / viewer / editor) as the dialog, but
// renders the components with mode="page" so they flow inside the host
// layout instead of overlaying the screen.
// ─────────────────────────────────────────────────────────────────────────
export function SopsBrowser({ initialSopId }: { initialSopId?: number }) {
  type View = { kind: "library" } | { kind: "viewer"; sopId: number } | { kind: "editor"; sopId: number };
  const [view, setView] = useState<View>(initialSopId ? { kind: "viewer", sopId: initialSopId } : { kind: "library" });

  if (view.kind === "viewer") {
    return (
      <Viewer
        sopId={view.sopId}
        onBack={() => setView({ kind: "library" })}
        onEdit={() => setView({ kind: "editor", sopId: view.sopId })}
        mode="page"
      />
    );
  }
  if (view.kind === "editor") {
    return (
      <Editor
        sopId={view.sopId}
        onBack={() => setView({ kind: "library" })}
        defaultStation={null}
        mode="page"
      />
    );
  }
  return (
    <Library
      currentStationType={null}
      onOpenSop={(sopId) => setView({ kind: "viewer", sopId })}
      onEditSop={(sopId) => setView({ kind: "editor", sopId })}
      mode="page"
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Library
// ─────────────────────────────────────────────────────────────────────────

// "modal" renders the component as an overlaid dialog (existing behaviour
// when launched from the global SOPs button). "page" strips the modal
// chrome — fixed positioning, animations, backdrop X — and lets the
// component flow inline inside a host page like Lean Cave.
type FrameMode = "modal" | "page";

function Library({
  currentStationType,
  onClose,
  onOpenSop,
  onEditSop,
  mode = "modal",
}: {
  currentStationType: string | null;
  /** Required in modal mode (X button closes the overlay). Optional in
   *  page mode — the X button is hidden since there's nothing to close. */
  onClose?: () => void;
  onOpenSop: (sopId: number) => void;
  onEditSop: (sopId: number) => void;
  mode?: FrameMode;
}) {
  const { state } = useAuth();
  const canEdit = state.status === "authenticated" && (state.user.role === "admin" || state.user.role === "manager");

  // Filter model — all three filters are applied client-side. We fetch
  // every SOP once and slice it in the browser; cheap at this scale and
  // means changing filters never re-hits the network.
  //
  // Stations: multi-select. Empty = no filter. When the dialog opens from
  // a station page we pre-select that station so the operator sees their
  // relevant SOPs first.
  // Authors: single-select. null = all. "me" is a virtual key for the
  // current user; otherwise the value is "id:<userId>" or
  // "name:<authorName>" for imported (NULL-author) SOPs.
  const initialStations = useMemo<Set<string>>(() => {
    if (!currentStationType) return new Set();
    return new Set([currentStationType]);
  }, [currentStationType]);
  const [stationFilters, setStationFilters] = useState<Set<string>>(initialStations);
  const [authorFilter, setAuthorFilter] = useState<string | null>(null);
  const [textSearch, setTextSearch] = useState("");
  const [items, setItems] = useState<SopSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const currentUserId = state.status === "authenticated" ? state.user.id : null;

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/standards`, { credentials: "include" });
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
  }, []);

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

  const body = (
    <>
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
          {/* Page mode has no overlay to dismiss; the host page provides
              its own back / nav affordance, so the close X is hidden. */}
          {mode === "modal" && onClose && (
            <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

        {(() => {
          // Build the full list of station options (always includes the 10
          // primary stations + 3 prep sub-keys). The currentStationType
          // doesn't get special placement any more — it's pre-selected
          // in the multi-select instead, surfacing relevant SOPs first.
          // The virtual "Uncategorised" entry surfaces SOPs that haven't
          // been filed against any station yet — useful for triage.
          const seen = new Set<string>();
          const stationOptions: FilterDropdownOption[] = [];
          stationOptions.push({ value: "__uncategorised__", label: "Uncategorised" });
          for (const s of STATIONS) {
            if (seen.has(s.key)) continue;
            seen.add(s.key);
            stationOptions.push({ value: s.key, label: s.label });
          }
          for (const k of ["main_prep", "prep_bases", "prep_meat"]) {
            if (seen.has(k)) continue;
            seen.add(k);
            stationOptions.push({ value: k, label: stationLabel(k) });
          }

          // Distinct authors observed across loaded items. Two virtual keys:
          //   "me"   → current user's authored SOPs (only offered when the
          //            current user has authored at least one).
          //   "id:N" → real user id N.
          //   "name:X" → SOPs whose authorId is null (imports), grouped by
          //            their stored authorName.
          const authorOptions: FilterDropdownOption[] = [];
          const seenAuthorIds = new Set<number>();
          const seenAuthorNames = new Set<string>();
          let currentUserAuthoredAny = false;
          for (const it of items ?? []) {
            if (it.authorId != null) {
              if (it.authorId === currentUserId) currentUserAuthoredAny = true;
              if (!seenAuthorIds.has(it.authorId)) {
                seenAuthorIds.add(it.authorId);
                authorOptions.push({
                  value: `id:${it.authorId}`,
                  label: it.authorName || `User #${it.authorId}`,
                });
              }
            } else if (it.authorName) {
              if (!seenAuthorNames.has(it.authorName)) {
                seenAuthorNames.add(it.authorName);
                authorOptions.push({
                  value: `name:${it.authorName}`,
                  label: it.authorName,
                });
              }
            }
          }
          authorOptions.sort((a, b) => a.label.localeCompare(b.label));
          if (currentUserAuthoredAny) {
            authorOptions.unshift({ value: "me", label: "My SOPs" });
          }

          // Trigger summary lines — keep them compact and consistent
          // ("All …" when nothing selected, "<one label>" for a single
          // selection, "<n> stations" when more than one is selected).
          const selectedStationLabels = Array.from(stationFilters)
            .map(k => stationOptions.find(o => o.value === k)?.label ?? stationLabel(k));
          const stationTrigger = stationFilters.size === 0
            ? "All stations"
            : stationFilters.size === 1
              ? selectedStationLabels[0]
              : `${stationFilters.size} stations`;

          const authorTrigger = (() => {
            if (!authorFilter) return "All authors";
            if (authorFilter === "me") return "My SOPs";
            const match = authorOptions.find(o => o.value === authorFilter);
            return match ? match.label : "Author";
          })();

          return (
            <div className="border-b border-border flex-shrink-0 px-5 py-3 space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={textSearch}
                  onChange={e => setTextSearch(e.target.value)}
                  placeholder="Search title or tags…"
                  className="w-full pl-9 pr-9 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
                {textSearch && (
                  <button
                    type="button"
                    onClick={() => setTextSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Filter className="w-3.5 h-3.5" />
                  Filter
                </div>
                <FilterDropdown
                  label="Station"
                  triggerLabel={stationTrigger}
                  options={stationOptions}
                  selected={stationFilters}
                  onChange={setStationFilters}
                  multi
                />
                {(authorOptions.length > 0) && (
                  <FilterDropdown
                    label="Author"
                    triggerLabel={authorTrigger}
                    options={authorOptions}
                    selected={authorFilter ? new Set([authorFilter]) : new Set()}
                    onChange={(next) => {
                      const first = Array.from(next)[0];
                      setAuthorFilter(first ?? null);
                    }}
                    multi={false}
                  />
                )}
              </div>
            </div>
          );
        })()}

        <div className="flex-1 overflow-y-auto p-5">
          {(() => {
            // All three filters applied client-side (we fetch the full
            // list once per dialog open). An SOP must satisfy every
            // active filter to appear:
            //  - Stations: when one or more stations are selected, the
            //    SOP must have at least one of those stations in its
            //    own list. The virtual "__uncategorised__" key matches
            //    SOPs with no stations assigned — selecting it lets the
            //    user surface SOPs that still need to be filed. SOPs
            //    with no station are otherwise hidden whenever a real
            //    station is selected (so "Building Table 1" doesn't
            //    surface unassigned SOPs alongside real building ones).
            //  - Author: exact authorId match for real users / "me", or
            //    name match for imports (authorId === null).
            //  - Text search: substring of title or any visible tag.
            const q = textSearch.trim().toLowerCase();
            const filtered = (items ?? []).filter(it => {
              if (stationFilters.size > 0) {
                const sopStations = it.stations ?? [];
                let hit = false;
                if (stationFilters.has("__uncategorised__") && sopStations.length === 0) {
                  hit = true;
                } else {
                  for (const s of sopStations) {
                    if (stationFilters.has(s)) { hit = true; break; }
                  }
                }
                if (!hit) return false;
              }
              if (authorFilter) {
                if (authorFilter === "me") {
                  if (it.authorId !== currentUserId) return false;
                } else if (authorFilter.startsWith("id:")) {
                  const wantedId = Number(authorFilter.slice(3));
                  if (it.authorId !== wantedId) return false;
                } else if (authorFilter.startsWith("name:")) {
                  const wantedName = authorFilter.slice(5);
                  if (it.authorId != null || it.authorName !== wantedName) return false;
                }
              }
              if (q) {
                const haystack = [
                  it.title ?? "",
                  ...visibleTags(it.tags),
                ].join(" ").toLowerCase();
                if (!haystack.includes(q)) return false;
              }
              return true;
            });
            if (loading) {
              return (
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              );
            }
            if (items && filtered.length === 0) {
              const searchActive = q.length > 0;
              const anyFilterActive = searchActive || stationFilters.size > 0 || authorFilter != null;
              return (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <BookOpen className="w-12 h-12 text-muted-foreground/40 mb-3" />
                  <p className="font-semibold">No SOPs match</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {searchActive
                      ? `Nothing matches "${textSearch}".`
                      : anyFilterActive
                        ? "Nothing matches the current filters. Adjust station, author, or clear filters."
                        : "Tap \u201cNew SOP\u201d to create your first one."}
                  </p>
                </div>
              );
            }
            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map(item => (
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
            );
          })()}
        </div>
    </>
  );

  // Wrap shared body in either modal (overlay) or page (inline) chrome.
  if (mode === "page") {
    return (
      <div className="bg-card border border-border rounded-2xl flex flex-col w-full h-[78vh] overflow-hidden">
        {body}
      </div>
    );
  }
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: 8 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
    >
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col pointer-events-auto">
        {body}
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
            const stationChips = displayStationTags(item.stations);
            return (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {stationChips.slice(0, 3).map(t => (
                  <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">
                    {t}
                  </span>
                ))}
                {stationChips.length > 3 && (
                  <span className="text-[10px] text-muted-foreground">+{stationChips.length - 3}</span>
                )}
              </div>
            );
          })() : (
            <span className="text-[10px] px-1.5 py-0.5 mt-1.5 inline-block rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              All stations
            </span>
          )}
          {(() => {
            const shownTags = visibleTags(item.tags);
            if (shownTags.length === 0) return null;
            return (
              <div className="flex flex-wrap gap-1 mt-1">
                {shownTags.slice(0, 4).map(t => (
                  <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                    #{t}
                  </span>
                ))}
                {shownTags.length > 4 && (
                  <span className="text-[10px] text-muted-foreground">+{shownTags.length - 4}</span>
                )}
              </div>
            );
          })()}
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
  mode = "modal",
}: {
  sopId: number;
  onBack: () => void;
  onEdit: () => void;
  /** Unused in page mode (no overlay to close). */
  onClose?: () => void;
  mode?: FrameMode;
}) {
  const { state } = useAuth();
  const canEdit = state.status === "authenticated" && (state.user.role === "admin" || state.user.role === "manager");
  void onClose; // kept for backwards-compatible prop signature

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

  const viewerInner = (
    <div
      className={cn(
        "flex flex-col bg-card w-full",
        mode === "modal"
          ? "fixed inset-0 z-50 pointer-events-auto"
          : "rounded-2xl border border-border h-[78vh] overflow-hidden",
      )}
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
          {/* Match the editor: X returns to the library list. Use the
              dialog backdrop / library X to close the whole thing. */}
          <button onClick={onBack} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary">
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
        {!loading && step && (() => {
          // Media priority for the left pane:
          //   1. Native uploaded video (highest fidelity)
          //   2. URL detected in description (YouTube / Vimeo / direct file)
          //   3. Uploaded image
          //   4. Nothing (description occupies the full width)
          //
          // When a description-URL becomes the media, the text pane shows a
          // friendly "Video step" label instead of the raw URL — the URL is
          // now playing as a player, the user doesn't need the address bar.
          const embeddedFromDescription = !step.hasVideo ? detectVideoEmbed(step.description) : null;
          const hasMedia = step.hasVideo || embeddedFromDescription !== null || step.hasImage;
          return (
            <div className="flex-1 flex flex-col lg:flex-row">
              {hasMedia && (
                <div className="lg:w-3/5 bg-secondary/30 flex items-center justify-center p-6 overflow-hidden">
                  {step.hasVideo ? (
                    <video
                      key={step.id}
                      src={stepVideoUrl(step.id)}
                      controls
                      playsInline
                      className="max-w-full max-h-[60vh] lg:max-h-full rounded-lg bg-black"
                    />
                  ) : embeddedFromDescription ? (
                    embeddedFromDescription.kind === "iframe" ? (
                      <div className="w-full aspect-video max-h-[70vh]">
                        <iframe
                          src={embeddedFromDescription.src}
                          title={embeddedFromDescription.title}
                          className="w-full h-full rounded-lg border-0"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                          allowFullScreen
                        />
                      </div>
                    ) : (
                      <video
                        key={step.id}
                        src={embeddedFromDescription.src}
                        controls
                        playsInline
                        className="max-w-full max-h-[60vh] lg:max-h-full rounded-lg bg-black"
                      />
                    )
                  ) : (
                    <img
                      src={stepImageUrl(step.id)}
                      alt={`Step ${stepIndex + 1}`}
                      className="max-w-full max-h-[60vh] lg:max-h-full object-contain rounded-lg"
                    />
                  )}
                </div>
              )}
              <div className={cn(
                "flex-1 flex flex-col items-center justify-center p-8 overflow-y-auto",
                !hasMedia && "lg:items-center",
              )}>
                <div className="max-w-3xl w-full">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
                    Step {stepIndex + 1}
                  </div>
                  <p className="text-2xl md:text-3xl lg:text-4xl leading-relaxed font-medium whitespace-pre-wrap">
                    {embeddedFromDescription
                      ? <span className="text-muted-foreground italic">Video step — see player.</span>
                      : (step.description || <span className="text-muted-foreground italic">No description.</span>)}
                  </p>
                </div>
              </div>
            </div>
          );
        })()}

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
    </div>
  );

  if (mode === "page") return viewerInner;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {viewerInner}
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
  mode = "modal",
}: {
  sopId: number;
  onBack: () => void;
  /** In modal mode this closes the whole dialog. In page mode it falls
   *  back to onBack so the footer "Save & Close" button still has somewhere
   *  to go (back to the library list, no overlay to dismiss). */
  onClose?: () => void;
  defaultStation: string | null;
  mode?: FrameMode;
}) {
  const [sop, setSop] = useState<SopDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  // Picker state tracks virtual picker ids (so "building" is one id that
  // maps to two real station keys). Saved to the server as the flat list
  // of real keys via pickerIdsToRealKeys.
  const [pickerIds, setPickerIds] = useState<Set<string>>(new Set());
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");

  const fetchDetail = useCallback(async () => {
    try {
      const resp = await fetch(`/api/standards/${sopId}`, { credentials: "include" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: SopDetail = await resp.json();
      setSop(data);
      setTitle(data.title);
      setPickerIds(realKeysToPickerIds(data.stations));
      setTags(data.tags ?? []);
    } catch (err) {
      toast({ title: "Failed to load", description: String(err), variant: "destructive" });
    }
  }, [sopId]);

  useEffect(() => {
    setLoading(true);
    fetchDetail().finally(() => setLoading(false));
  }, [fetchDetail]);

  const saveMeta = async (next: { title?: string; stations?: string[]; tags?: string[] }) => {
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

  /** Closing the dialog by clicking X / Library / Save & Close used to
   *  drop pending edits — the title onBlur and step-description onBlur
   *  never fired if the user reached straight for the close button.
   *  Blur the active element first so its onBlur autosave fires, then
   *  flush any stale title before we tear the dialog down. */
  const flushAndClose = (next: () => void) => {
    const active = document.activeElement as HTMLElement | null;
    active?.blur?.();
    if (sop && title !== sop.title) {
      // Fire-and-forget — the network request continues even after the
      // dialog unmounts, so the title still lands server-side.
      saveMeta({ title });
    }
    next();
  };

  const togglePickerId = (id: string) => {
    setPickerIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveMeta({ stations: pickerIdsToRealKeys(next) });
      return next;
    });
  };

  const addTag = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    setTags(prev => {
      if (prev.some(t => t.toLowerCase() === trimmed.toLowerCase())) return prev;
      const next = [...prev, trimmed];
      saveMeta({ tags: next });
      return next;
    });
    setTagDraft("");
  };

  const removeTag = (tag: string) => {
    setTags(prev => {
      const next = prev.filter(t => t !== tag);
      saveMeta({ tags: next });
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

  const editorBody = (
    <>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <button onClick={() => flushAndClose(onBack)} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="w-4 h-4" /> Library
          </button>
          <div className="flex flex-col items-center">
            <h2 className="font-display font-bold text-lg leading-none">Edit SOP</h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">Autosaves as you go</p>
          </div>
          {/* X button returns to the library list rather than closing the
              whole dialog — the close affordance for the entire library is
              the X at the top of the library view. */}
          <button onClick={() => flushAndClose(onBack)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary">
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
                <div>
                  <label className="text-sm font-medium block mb-1.5">Tags</label>
                  <p className="text-xs text-muted-foreground mb-2">
                    Free-form labels for grouping. Type a tag and press Enter to add it.
                    Use them for things like <em>rotation</em>, <em>safety</em>, or <em>changeover</em>.
                  </p>
                  {(() => {
                    // Internal bookkeeping tags (ref:, imported:) live on the
                    // row for backend idempotency but are hidden from the
                    // editor — the user can only see/edit semantic tags.
                    const editableTags = visibleTags(tags);
                    return (
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {editableTags.map(t => (
                          <span
                            key={t}
                            className="text-xs px-2.5 py-1 rounded-full border border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800 flex items-center gap-1"
                          >
                            #{t}
                            <button
                              type="button"
                              onClick={() => removeTag(t)}
                              className="text-amber-700 hover:text-amber-900 dark:text-amber-300"
                              title="Remove tag"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                        <input
                          type="text"
                          value={tagDraft}
                          onChange={e => setTagDraft(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter" || e.key === ",") {
                              e.preventDefault();
                              addTag(tagDraft);
                            } else if (e.key === "Backspace" && tagDraft === "" && editableTags.length > 0) {
                              removeTag(editableTags[editableTags.length - 1]);
                            }
                          }}
                          onBlur={() => { if (tagDraft.trim()) addTag(tagDraft); }}
                          placeholder={editableTags.length === 0 ? "Add a tag…" : ""}
                          className="flex-1 min-w-[120px] text-xs px-2.5 py-1 bg-background border border-border rounded-full focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                    );
                  })()}
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

        {/* Sticky footer — explicit Save & Close so reaching for the
            close button doesn't drop in-flight typing. Pairs with the
            autosave hint in the header. In page mode there's no overlay
            to close, so the primary action returns to the library list. */}
        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-border flex-shrink-0 bg-card/95">
          <button
            onClick={() => flushAndClose(onBack)}
            className="px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-secondary/50"
          >
            Back to library
          </button>
          <button
            onClick={() => flushAndClose(mode === "modal" && onClose ? onClose : onBack)}
            className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4" /> {mode === "modal" ? "Save & Close" : "Save"}
          </button>
        </div>
    </>
  );

  if (mode === "page") {
    return (
      <div className="bg-card border border-border rounded-2xl flex flex-col w-full h-[78vh] overflow-hidden">
        {editorBody}
      </div>
    );
  }
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: 8 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
    >
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[94vh] flex flex-col pointer-events-auto">
        {editorBody}
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
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [removingVideo, setRemovingVideo] = useState(false);
  const [videoBust, setVideoBust] = useState(0);

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

  const uploadVideo = async (file: File) => {
    // 100MB cap matches the backend videoUpload multer config. Surface a
    // friendly toast rather than letting multer reject so the user knows
    // why their drop didn't take.
    const MAX_BYTES = 100 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      toast({
        title: "Video too large",
        description: `Max 100MB. This file is ${(file.size / 1024 / 1024).toFixed(0)}MB.`,
        variant: "destructive",
      });
      return;
    }
    setUploadingVideo(true);
    try {
      const form = new FormData();
      form.append("video", file);
      const resp = await fetch(`/api/standards/steps/${step.id}/video`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${resp.status}`);
      }
      setVideoBust(Date.now());
      onChanged();
    } catch (err) {
      toast({ title: "Video upload failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setUploadingVideo(false);
    }
  };

  const removeVideo = async () => {
    setRemovingVideo(true);
    try {
      await fetch(`/api/standards/steps/${step.id}/video`, { method: "DELETE", credentials: "include" });
      onChanged();
    } catch (err) {
      toast({ title: "Remove failed", description: String(err), variant: "destructive" });
    } finally {
      setRemovingVideo(false);
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
          {step.hasVideo ? (
            // Native uploaded clip — show a small inline player so the user
            // sees what they uploaded without having to open the viewer.
            <video
              key={videoBust}
              src={stepVideoUrl(step.id, videoBust)}
              controls
              playsInline
              muted
              className="w-32 h-24 rounded-lg border border-border flex-shrink-0 bg-black object-cover"
            />
          ) : step.hasImage ? (
            <div className="relative w-24 h-24 rounded-lg overflow-hidden border border-border flex-shrink-0 bg-secondary/30">
              <img src={stepImageUrl(step.id, imageBust)} alt="" className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="w-24 h-24 rounded-lg border border-dashed border-border flex items-center justify-center flex-shrink-0 bg-secondary/20">
              <ImageIcon className="w-6 h-6 text-muted-foreground/50" />
            </div>
          )}
          <div className="flex-1 flex flex-wrap items-center gap-2">
            {/* Take photo — capture="environment" opens the back camera
                directly on mobile/iPad. Desktop browsers with no camera
                fall through to the normal file picker, so this is always
                safe to show. */}
            <label className="text-xs px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-secondary cursor-pointer flex items-center gap-1.5">
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
              Take photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) uploadImage(f);
                  e.target.value = "";
                }}
              />
            </label>
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
            {/* Native video upload — separate file slot from the image. The
                viewer prefers a native video over a description-URL embed,
                so uploading here overrides any link in the description. */}
            <label className="text-xs px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-secondary cursor-pointer flex items-center gap-1.5">
              {uploadingVideo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              {step.hasVideo ? "Replace video" : "Upload video"}
              <input
                type="file"
                accept="video/mp4,video/webm,video/quicktime,video/ogg"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) uploadVideo(f);
                  e.target.value = "";
                }}
              />
            </label>
            {step.hasVideo && (
              <button
                onClick={removeVideo}
                disabled={removingVideo}
                className="text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-destructive disabled:opacity-50"
              >
                Remove video
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
