import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2, Circle, ClipboardCheck, Plus, Minus, Undo2, Loader2, XCircle,
  Sun, Sparkles, Moon, ChevronDown, ChevronUp, GripVertical, Trash2, Pencil, Eye, EyeOff, AlertTriangle,
  BookOpen,
} from "lucide-react";
import { SopChips, useSopViewer, type SopLink } from "@/components/sop-link-chips";
import { PersonalTodosStrip } from "@/components/todo-lists";
import { CuriosityTimeCard } from "@/components/curiosity-time";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useGuardedAction, guardedFetch } from "@/hooks/use-guarded-action";
import { useAuth } from "@/contexts/auth-context";
import { useStationChecklist, useDynamicData, type ChecklistItem } from "./use-station-checklist";
import { batchDispatchVerdict } from "@/lib/julian-batch";
import { ChecklistAdminPanel, DispatchShelfRulesCard } from "./checklist-admin-panel";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const CATEGORY_ORDER = ["opening", "cleaning", "closing"] as const;
type Category = typeof CATEGORY_ORDER[number];

const CATEGORY_META: Record<Category, { label: string; icon: typeof Sun; color: string; bg: string }> = {
  opening: { label: "Opening Checks", icon: Sun, color: "text-amber-700 dark:text-amber-300", bg: "bg-amber-50/60 dark:bg-amber-950/20" },
  cleaning: { label: "Cleaning Checks", icon: Sparkles, color: "text-blue-700 dark:text-blue-300", bg: "bg-blue-50/60 dark:bg-blue-950/20" },
  closing: { label: "Closing Checks", icon: Moon, color: "text-indigo-700 dark:text-indigo-300", bg: "bg-indigo-50/60 dark:bg-indigo-950/20" },
};

interface Props {
  stationType: string;
  planId: number;
  defaultCategory?: Category;
}

export function StationChecklist({ stationType, planId, defaultCategory }: Props) {
  const { data, loading, refetch } = useStationChecklist(stationType, planId);
  const { state } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const isAdmin = user?.role === "admin";

  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
  const [adminMode, setAdminMode] = useState(false);
  const [showCompletedByCategory, setShowCompletedByCategory] = useState<Record<string, boolean>>({});
  const [addingItem, setAddingItem] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addCategory, setAddCategory] = useState<Category>("opening");
  const [addRecurring, setAddRecurring] = useState(true);
  const [completionNotes, setCompletionNotes] = useState("");
  const [skipMode, setSkipMode] = useState(false);
  const [skipReason, setSkipReason] = useState("");

  // Refs to checklist item buttons, keyed by item key. Used for scroll-into-view
  // when the selection auto-advances after completing an item.
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const [runComplete, completeBusy] = useGuardedAction({ onSuccess: refetch });
  const [runUndo, undoBusy] = useGuardedAction({ onSuccess: refetch });
  const [runOneoff, oneoffBusy] = useGuardedAction({ onSuccess: refetch });

  // Flatten items for selection
  const allItems: (ChecklistItem & { category: Category })[] = [];
  if (data) {
    for (const cat of CATEGORY_ORDER) {
      const items = data.categories[cat] ?? [];
      for (const item of items) {
        allItems.push({ ...item, category: cat });
      }
    }
  }

  // Auto-select first incomplete item in default category, or first incomplete overall
  useEffect(() => {
    if (allItems.length === 0) return;
    if (selectedItemKey && allItems.find(i => itemKey(i) === selectedItemKey)) return;

    let target: (ChecklistItem & { category: Category }) | undefined;
    if (defaultCategory) {
      target = allItems.find(i => i.category === defaultCategory && !i.completed);
    }
    if (!target) {
      target = allItems.find(i => !i.completed);
    }
    if (!target) {
      target = allItems[0];
    }
    setSelectedItemKey(itemKey(target));
  }, [allItems.length, data?.summary.done]);

  const selectedItem = allItems.find(i => itemKey(i) === selectedItemKey) ?? null;

  // Scroll the left-panel list so the selected item is visible. Runs after
  // every selection change (including the optimistic advance from
  // handleComplete) so users can keep tapping "Mark Complete" without
  // re-scrolling manually.
  useEffect(() => {
    if (!selectedItemKey) return;
    const el = itemRefs.current[selectedItemKey];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setSkipMode(false);
    setSkipReason("");
  }, [selectedItemKey]);

  // Dynamic data for selected item
  const { data: dynamicData, loading: dynamicLoading } = useDynamicData(
    planId,
    selectedItem?.dynamicDataType ?? null,
  );

  // SOPs attached to this checklist's items — one fetch for the whole list.
  const templateIds = allItems.filter(i => i.type === "template").map(i => i.id).sort((a, b) => a - b);
  const sopLinksKey = ["sop-links-checklist", stationType, templateIds.join(",")];
  const { data: sopLinksByItem } = useQuery<Record<number, SopLink[]>>({
    queryKey: sopLinksKey,
    enabled: templateIds.length > 0,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/standards/links/for-checklist?ids=${templateIds.join(",")}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load SOP links");
      return res.json();
    },
  });
  const sopViewer = useSopViewer(stationType);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading checklist...
      </div>
    );
  }

  if (!data || allItems.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
        <ClipboardCheck className="w-8 h-8 mx-auto mb-3 opacity-50" />
        <p className="font-medium">No checklist items for today</p>
        <p className="text-sm mt-1">Set up a checklist template to get started.</p>
        <button
          onClick={() => setAdminMode(true)}
          className="mt-4 text-sm text-primary font-medium hover:underline"
        >
          Set up checklist templates
        </button>
        {adminMode && (
          <ChecklistAdminPanel stationType={stationType} onClose={() => { setAdminMode(false); refetch(); }} />
        )}
      </div>
    );
  }

  const { summary } = data;
  const pct = summary.total > 0 ? Math.round((summary.done / summary.total) * 100) : 0;

  /** Given the item that was just completed, find the next item the user
   *  should be working on: the first incomplete item after it in the flat
   *  list, wrapping around to the beginning if needed. Returns null if
   *  everything else is already done. */
  function findNextIncompleteItem(
    justCompleted: ChecklistItem & { category: Category },
  ): (ChecklistItem & { category: Category }) | null {
    const currentIdx = allItems.findIndex(i => itemKey(i) === itemKey(justCompleted));
    const isStillOpen = (i: ChecklistItem & { category: Category }) =>
      !i.completed && itemKey(i) !== itemKey(justCompleted);
    const after = allItems.slice(currentIdx + 1).find(isStillOpen);
    if (after) return after;
    const before = allItems.slice(0, currentIdx).find(isStillOpen);
    return before ?? null;
  }

  const handleComplete = (item: ChecklistItem & { category: Category }) => {
    // Optimistically advance selection to the next incomplete item so the
    // user can keep working without scrolling or tapping back to the list.
    const next = findNextIncompleteItem(item);
    runComplete(async (signal) => {
      if (item.type === "template") {
        await guardedFetch(`${BASE}/api/checklists/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateId: item.id,
            planId,
            stationType,
            notes: completionNotes || undefined,
          }),
          signal,
        });
      } else {
        await guardedFetch(`${BASE}/api/checklists/oneoff/${item.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completed: true }),
          signal,
        });
      }
      setCompletionNotes("");
      toast({ title: "Check completed", description: item.title });
    });
    if (next) {
      setSelectedItemKey(itemKey(next));
    }
  };

  const handleUndo = (item: ChecklistItem & { category: Category }) => {
    runUndo(async (signal) => {
      if (item.type === "template" && item.completionId) {
        await guardedFetch(`${BASE}/api/checklists/completions/${item.completionId}`, {
          method: "DELETE",
          signal,
        });
      } else if (item.type === "oneoff") {
        await guardedFetch(`${BASE}/api/checklists/oneoff/${item.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completed: false }),
          signal,
        });
      }
      toast({ title: "Completion undone", description: item.title });
    });
  };

  const handleSkip = (item: ChecklistItem & { category: Category }) => {
    if (!skipReason.trim()) return;
    const next = findNextIncompleteItem(item);
    runComplete(async (signal) => {
      if (item.type === "template") {
        await guardedFetch(`${BASE}/api/checklists/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateId: item.id,
            planId,
            stationType,
            skippedReason: skipReason.trim(),
          }),
          signal,
        });
      } else {
        await guardedFetch(`${BASE}/api/checklists/oneoff/${item.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completed: true, skippedReason: skipReason.trim() }),
          signal,
        });
      }
      setSkipReason("");
      setSkipMode(false);
      toast({ title: "Marked incomplete", description: item.title });
    });
    if (next) {
      setSelectedItemKey(itemKey(next));
    }
  };

  const handleAddItem = () => {
    if (!addTitle.trim()) return;
    runOneoff(async (signal) => {
      if (addRecurring) {
        // Create a template (recurring task)
        await guardedFetch(`${BASE}/api/checklists/templates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stationType,
            category: addCategory,
            title: addTitle.trim(),
            schedule: "daily",
            orderPosition: 999,
          }),
          signal,
        });
        toast({ title: "Recurring task added" });
      } else {
        // Create a one-off item (today only)
        await guardedFetch(`${BASE}/api/checklists/oneoff`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planId,
            stationType,
            category: addCategory,
            title: addTitle.trim(),
          }),
          signal,
        });
        toast({ title: "One-off item added" });
      }
      setAddTitle("");
      setAddingItem(false);
    });
  };

  const handleDeleteOneoff = (item: ChecklistItem & { category: Category }) => {
    if (item.type !== "oneoff") return;
    runOneoff(async (signal) => {
      await guardedFetch(`${BASE}/api/checklists/oneoff/${item.id}`, { method: "DELETE", signal });
      if (selectedItemKey && selectedItemKey === itemKey(item)) setSelectedItemKey(null);
      toast({ title: "Item deleted" });
    });
  };

  const handleDeleteTemplate = (item: ChecklistItem & { category: Category }) => {
    if (item.type !== "template") return;
    // Soft delete — the server deactivates the template (history is kept and
    // it can be restored from Edit Templates). The confirm guards against the
    // stray taps that silently removed HACCP checks in the past.
    if (!window.confirm(`Remove "${item.title}" from this checklist?\n\nIts past records are kept and it can be restored from Edit Templates.`)) return;
    runOneoff(async (signal) => {
      await guardedFetch(`${BASE}/api/checklists/templates/${item.id}`, { method: "DELETE", signal });
      if (selectedItemKey && selectedItemKey === itemKey(item)) setSelectedItemKey(null);
      toast({ title: "Task removed", description: "Restore it anytime from Edit Templates." });
    });
  };

  return (
    <div className="space-y-4">
      {/* The logged-in user's own tasks, surfaced where they already look
          every day. Per-user, not per-station — a different login on the
          same iPad sees their own list here. */}
      <PersonalTodosStrip />

      {/* Curiosity Time — the daily waste-spotting walk. Renders nothing
          until the switch in the meeting page's curriculum editor is on. */}
      <CuriosityTimeCard stationType={stationType} planId={planId} />

      {/* Progress header */}
      <div className="bg-card border border-border rounded-xl px-5 py-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-primary" />
            <h2 className="font-semibold">Station Checklist</h2>
            <span className="text-sm text-muted-foreground">{summary.done}/{summary.total} complete</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAdminMode(!adminMode)}
              className={cn(
                "text-xs px-2.5 py-1 rounded-lg font-medium transition-colors",
                adminMode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
              )}
            >
              {adminMode ? "Done Editing" : "Edit Templates"}
            </button>
            <button
              onClick={() => setAddingItem(!addingItem)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add One-off Task
            </button>
          </div>
        </div>
        <div className="w-full h-2.5 bg-secondary rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", pct >= 100 ? "bg-emerald-500" : "bg-emerald-400")}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
      </div>

      {/* Add item form */}
      {addingItem && (
        <div className="bg-card border border-border rounded-xl px-5 py-4 space-y-3">
          <p className="text-sm font-semibold">Add Checklist Item</p>
          <input
            type="text"
            placeholder="Item title..."
            value={addTitle}
            onChange={e => setAddTitle(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background"
            autoFocus
          />
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={addCategory}
              onChange={e => setAddCategory(e.target.value as Category)}
              className="px-3 py-2 border border-border rounded-lg text-sm bg-background"
            >
              <option value="opening">Opening</option>
              <option value="cleaning">Cleaning</option>
              <option value="closing">Closing</option>
            </select>
            <div className="flex items-center bg-secondary/40 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setAddRecurring(true)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  addRecurring ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                Recurring
              </button>
              <button
                type="button"
                onClick={() => setAddRecurring(false)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  !addRecurring ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                Today Only
              </button>
            </div>
            <button
              onClick={handleAddItem}
              disabled={oneoffBusy || !addTitle.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {oneoffBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add"}
            </button>
            <button
              onClick={() => setAddingItem(false)}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Admin panel */}
      {adminMode && (
        <>
          <ChecklistAdminPanel stationType={stationType} onClose={() => { setAdminMode(false); refetch(); }} />
          {/* Packing only: the min-days-at-customer numbers behind the
              opening batch check's shelf-life verdicts. */}
          <DispatchShelfRulesCard stationType={stationType} />
        </>
      )}

      {/* Two-panel layout */}
      {!adminMode && (
        <div className="flex flex-col lg:flex-row gap-4">
          {/* LEFT — Categorized list. Equal width with the detail panel so
              the list isn't squashed and the bigger row font reads clearly. */}
          <div className="lg:flex-1 min-w-0">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="max-h-[calc(100vh-320px)] overflow-y-auto">
                {CATEGORY_ORDER.map((cat, ci) => {
                  const items = data.categories[cat];
                  if (!items || items.length === 0) return null;
                  const meta = CATEGORY_META[cat];
                  const Icon = meta.icon;
                  const catDone = items.filter(i => i.completed).length;
                  const showCompleted = showCompletedByCategory[cat] ?? false;
                  const visibleItems = showCompleted ? items : items.filter(i => !i.completed);
                  return (
                    <div key={cat} className={cn(ci > 0 && "border-t border-border")}>
                      <div className={cn("px-4 py-2 flex items-center justify-between", meta.bg)}>
                        <div className="flex items-center gap-2">
                          <Icon className={cn("w-4 h-4", meta.color)} />
                          <p className={cn("text-base font-bold uppercase tracking-wider", meta.color)}>
                            {meta.label}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {catDone > 0 && (
                            <button
                              onClick={() => setShowCompletedByCategory(prev => ({ ...prev, [cat]: !showCompleted }))}
                              className={cn("text-xs flex items-center gap-1 font-medium transition-colors", meta.color)}
                              title={showCompleted ? "Hide completed" : "Show completed"}
                            >
                              {showCompleted ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                              {catDone} done
                            </button>
                          )}
                          <span className={cn("text-base font-medium", meta.color)}>
                            {catDone}/{items.length}
                          </span>
                        </div>
                      </div>
                      {visibleItems.length === 0 && (
                        <div className="px-4 py-3 text-center text-xs text-muted-foreground">
                          All tasks complete
                        </div>
                      )}
                      {visibleItems.map(item => {
                        const ik = itemKey({ ...item, category: cat });
                        const isSelected = ik === selectedItemKey;
                        return (
                          <button
                            key={ik}
                            ref={el => { itemRefs.current[ik] = el; }}
                            onClick={() => setSelectedItemKey(ik)}
                            className={cn(
                              "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-t border-border/30",
                              isSelected
                                ? "bg-emerald-500/10 border-l-4 border-l-emerald-500"
                                : "hover:bg-secondary/40 border-l-4 border-l-transparent",
                              item.completed && !isSelected && "opacity-60",
                            )}
                          >
                            <div className="flex-shrink-0">
                              {item.completed && item.skippedReason ? (
                                <XCircle className="w-5 h-5 text-amber-500" />
                              ) : item.completed ? (
                                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                              ) : (
                                <Circle className="w-5 h-5 text-muted-foreground/40" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className={cn(
                                "text-base font-medium truncate",
                                isSelected && "font-semibold",
                                item.completed && !item.skippedReason && "line-through text-muted-foreground",
                                item.completed && item.skippedReason && "text-amber-600 dark:text-amber-400",
                              )}>
                                {item.title}
                                {item.type === "template" && (sopLinksByItem?.[item.id]?.length ?? 0) > 0 && (
                                  <BookOpen className="w-3.5 h-3.5 inline ml-1.5 mb-0.5 text-sky-500" aria-label="Has SOP" />
                                )}
                              </p>
                              {item.completed && item.skippedReason ? (
                                <p className="text-xs text-amber-600/70 dark:text-amber-400/70 truncate">
                                  {item.skippedReason}
                                </p>
                              ) : item.completed && item.completedBy ? (
                                <p className="text-xs text-muted-foreground truncate">
                                  {item.completedBy}
                                </p>
                              ) : null}
                              {item.type === "oneoff" && (
                                <span className="text-xs text-amber-500 font-medium">one-off</span>
                              )}
                            </div>
                            {(item.type === "oneoff" || isAdmin) && (
                              <div
                                className="flex-shrink-0 p-1.5 rounded-lg text-muted-foreground/40 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                                role="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (item.type === "oneoff") handleDeleteOneoff({ ...item, category: cat });
                                  else handleDeleteTemplate({ ...item, category: cat });
                                }}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* RIGHT — Detail panel */}
          <div className="flex-1 min-w-0">
            {selectedItem ? (
              <div
                className={cn(
                  "bg-card border-2 rounded-2xl p-5 transition-colors",
                  selectedItem.completed && selectedItem.skippedReason
                    ? "border-amber-300 dark:border-amber-700 bg-amber-50/20 dark:bg-amber-950/10"
                    : selectedItem.completed
                      ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50/20 dark:bg-emerald-950/10"
                      : "border-border",
                )}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {(() => {
                        const meta = CATEGORY_META[selectedItem.category];
                        const CatIcon = meta.icon;
                        return <CatIcon className={cn("w-4 h-4", meta.color)} />;
                      })()}
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {CATEGORY_META[selectedItem.category].label}
                      </span>
                    </div>
                    <h3 className="text-xl font-bold">{selectedItem.title}</h3>
                    {selectedItem.schedule !== "daily" && selectedItem.schedule !== "oneoff" && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Schedule: {selectedItem.schedule === "weekly" ? "Weekly"
                          : selectedItem.schedule === "periodic" ? "Every 4 weeks"
                          : "Specific days"}
                        {selectedItem.scheduleDays && ` (${JSON.parse(selectedItem.scheduleDays).join(", ")})`}
                      </p>
                    )}
                  </div>
                  <div className="flex-shrink-0">
                    {selectedItem.completed && selectedItem.skippedReason ? (
                      <XCircle className="w-8 h-8 text-amber-500" />
                    ) : selectedItem.completed ? (
                      <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                    ) : (
                      <Circle className="w-8 h-8 text-muted-foreground/30" />
                    )}
                  </div>
                </div>

                {/* Description */}
                {selectedItem.description && (
                  <div className="mb-4 p-3 bg-secondary/30 rounded-lg">
                    <p className="text-sm text-foreground/80 whitespace-pre-wrap">{selectedItem.description}</p>
                  </div>
                )}

                {/* Linked SOPs — the how-to lives ON the check. Tap to read
                    (and edit if it's wrong); + SOP to attach another. */}
                {selectedItem.type === "template" && (
                  <div className="mb-4">
                    <SopChips
                      links={sopLinksByItem?.[selectedItem.id] ?? []}
                      onOpen={sopViewer.open}
                      attach={{
                        targetType: "checklist_template",
                        a: selectedItem.id,
                        label: selectedItem.title,
                        // A new SOP made here is almost always called after
                        // the check itself, and belongs to this station.
                        subject: selectedItem.title,
                        station: stationType,
                      }}
                      queryKeysToInvalidate={[sopLinksKey]}
                    />
                  </div>
                )}

                {/* Dynamic data display */}
                {selectedItem.dynamicDataType && (
                  <DynamicDataDisplay
                    type={selectedItem.dynamicDataType}
                    data={dynamicData}
                    loading={dynamicLoading}
                    planId={planId}
                  />
                )}

                {/* Completion info or action */}
                {selectedItem.completed ? (
                  <div className="mt-4 space-y-3">
                    {selectedItem.skippedReason ? (
                      <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg">
                        <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                          Marked incomplete by {selectedItem.completedBy}
                        </p>
                        {selectedItem.completedAt && (
                          <p className="text-xs text-amber-600/70 dark:text-amber-400/70 mt-0.5">
                            {new Date(selectedItem.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        )}
                        <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">Reason: {selectedItem.skippedReason}</p>
                      </div>
                    ) : (
                      <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg">
                        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                          Completed by {selectedItem.completedBy}
                        </p>
                        {selectedItem.completedAt && (
                          <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70 mt-0.5">
                            {new Date(selectedItem.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        )}
                        {selectedItem.notes && (
                          <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-1">{selectedItem.notes}</p>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => handleUndo(selectedItem)}
                        disabled={undoBusy}
                        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Undo2 className="w-4 h-4" />
                        Undo completion
                      </button>
                      {(selectedItem.type === "oneoff" || isAdmin) && (
                        <button
                          onClick={() => {
                            if (selectedItem.type === "oneoff") handleDeleteOneoff(selectedItem);
                            else handleDeleteTemplate(selectedItem);
                          }}
                          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    {!skipMode ? (
                      <>
                        <textarea
                          placeholder="Notes (optional)..."
                          value={completionNotes}
                          onChange={e => setCompletionNotes(e.target.value)}
                          rows={2}
                          className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background resize-none"
                        />
                        <button
                          onClick={() => handleComplete(selectedItem)}
                          disabled={completeBusy}
                          className="w-full flex items-center justify-center gap-3 px-6 py-5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-lg font-semibold transition-colors disabled:opacity-50 shadow-sm"
                        >
                          {completeBusy ? (
                            <Loader2 className="w-6 h-6 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-6 h-6" />
                          )}
                          Mark Complete
                        </button>
                        <button
                          onClick={() => setSkipMode(true)}
                          className="w-full flex items-center justify-center gap-2 mt-6 px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/40 dark:hover:bg-slate-800/70 text-slate-500 dark:text-slate-400 rounded-lg text-sm font-medium transition-colors"
                        >
                          <XCircle className="w-4 h-4" />
                          Mark Incomplete
                        </button>
                        {(selectedItem.type === "oneoff" || isAdmin) && (
                          <button
                            onClick={() => {
                              if (selectedItem.type === "oneoff") handleDeleteOneoff(selectedItem);
                              else handleDeleteTemplate(selectedItem);
                            }}
                            className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-red-500 transition-colors pt-1"
                          >
                            <Trash2 className="w-4 h-4" />
                            Delete task
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-semibold text-muted-foreground">Why can't this be completed?</p>
                        <textarea
                          placeholder="Enter reason..."
                          value={skipReason}
                          onChange={e => setSkipReason(e.target.value)}
                          rows={2}
                          autoFocus
                          className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background resize-none"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => { setSkipMode(false); setSkipReason(""); }}
                            className="flex-1 flex items-center justify-center gap-2 px-5 py-3 border border-border bg-background hover:bg-secondary/60 rounded-xl text-base font-semibold transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleSkip(selectedItem)}
                            disabled={!skipReason.trim() || completeBusy}
                            className={cn(
                              "flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-base font-semibold transition-colors",
                              skipReason.trim() && !completeBusy
                                ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                                : "bg-muted text-muted-foreground cursor-not-allowed"
                            )}
                          >
                            {completeBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : "Save"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-card border-2 border-dashed border-border rounded-2xl p-8 text-center text-muted-foreground">
                <ClipboardCheck className="w-8 h-8 mx-auto mb-3 opacity-50" />
                <p className="font-medium">Select a checklist item</p>
              </div>
            )}
          </div>
        </div>
      )}
      {sopViewer.dialog}
    </div>
  );
}

function itemKey(item: { type: string; id: number; category: string }): string {
  return `${item.type}:${item.id}:${item.category}`;
}

/** "just now" / "4 min ago" / "09:12" — how old a live sensor reading is,
 *  so staff can spot a reading that isn't actually live. */
function readingAgeLabel(iso: string): string {
  const ageMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ageMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ─── Dynamic Data Display ────────────────────────────────────────────

// Shared shape returned by the server for both first_pack_batch_numbers
// and last_pack_batch_numbers dynamic data types. The component below
// switches its label, suggestion, and POST `kind` based on the `kind`
// prop rather than having two duplicated components.
interface PackBatchRow {
  recipeId: number;
  recipeName: string;
  fridgeQty?: number;
  suggestedBatchNumber: number | null;
  suggestedUseByDate: string | null;
  /** Tap-options: this recipe's fridge batches (FIFO first) + recent plans. */
  candidateBatchNumbers?: number[];
  recordedFirstBatchNumber: number | null;
  recordedLastBatchNumber: number | null;
  firstRecordedAt: string | null;
  lastRecordedAt: string | null;
  // Shelf-life rule context (2026-09-02): the recipe's shelf life and the
  // earliest use-by acceptable for dispatching today (today + overnight
  // delivery + the category's min days at customer). null shelfLifeDays =
  // shelf life not set on the recipe, verdicts can't be computed.
  category?: string | null;
  shelfLifeDays?: number | null;
  earliestOkUseBy?: string | null;
}

/** "2026-09-06" → "Sun 6 Sep" — the way a use-by reads off a label. */
function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/**
 * Tap-to-record (2026-08-19): typing was slow and — worse — nobody could
 * tell whether a number was actually SAVED without pressing an unlabelled
 * green button. Now each recipe offers the batch numbers we already know
 * about as one-tap chips; tapping saves immediately and the row drops into
 * the Recorded list below, so what's left to check is always the visible
 * remainder. "Other…" keeps a manual entry for a number we didn't predict.
 */
function PackBatchNumbers({ data, planId, kind }: { data: unknown[]; planId: number; kind: "first" | "last" }) {
  const items = (data as PackBatchRow[]).filter(i => i.recipeId != null);
  const isLast = kind === "last";

  // Locally-confirmed saves layered over what the server sent — the row
  // moves to Recorded the moment its POST succeeds, no refetch needed.
  const [recordedLocal, setRecordedLocal] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [manualFor, setManualFor] = useState<number | null>(null);
  const [manualValue, setManualValue] = useState("");
  const [changing, setChanging] = useState<number | null>(null);

  useEffect(() => { setRecordedLocal({}); setManualFor(null); setChanging(null); }, [planId, kind]);

  const recordedNumber = (item: PackBatchRow): number | null =>
    recordedLocal[item.recipeId] ?? (isLast ? item.recordedLastBatchNumber : item.recordedFirstBatchNumber);

  const saveBatch = async (recipeId: number, batchNumber: number) => {
    if (!batchNumber || isNaN(batchNumber)) return;
    setSaving(s => ({ ...s, [recipeId]: true }));
    try {
      const res = await fetch(`${BASE}/api/checklists/packing-batch-record`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, recipeId, batchNumber, kind }),
      });
      if (!res.ok) throw new Error("Failed to save");
      // The server recomputes the shelf-life verdict on record; a failing
      // batch gets an immediate loud toast on top of the red block below.
      const body = await res.json().catch(() => null) as { verdict?: { shelfLifeOk: boolean | null } } | null;
      if (body?.verdict?.shelfLifeOk === false) {
        toast({
          title: "Not enough shelf life",
          description: "Recorded — but this batch can't be dispatched today. Set it aside and tell a manager.",
          variant: "destructive",
        });
      }
      setRecordedLocal(r => ({ ...r, [recipeId]: batchNumber }));
      setManualFor(null);
      setManualValue("");
      setChanging(null);
    } catch {
      toast({ title: "Not saved", description: "Couldn't save that batch number — try again", variant: "destructive" });
    } finally {
      setSaving(s => ({ ...s, [recipeId]: false }));
    }
  };

  if (items.length === 0) {
    return (
      <div className="mb-4 p-3 bg-secondary/30 rounded-lg text-sm text-muted-foreground">
        No recipes currently in the production fridge.
      </div>
    );
  }

  const pending = items.filter(i => recordedNumber(i) == null || changing === i.recipeId);
  const done = items.filter(i => recordedNumber(i) != null && changing !== i.recipeId);

  return (
    <div className="mb-4 space-y-2">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-sm font-semibold text-foreground">
          {isLast
            ? "Tap the batch number on the LAST pack of each recipe shipped today"
            : "Tap the batch number on the FIRST pack of each recipe in the fridge"}
        </p>
        <span className={cn(
          "text-xs font-bold tabular-nums px-2 py-0.5 rounded-full shrink-0",
          pending.length === 0 ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/15 text-amber-600",
        )}>
          {pending.length === 0 ? "All recorded ✓" : `${pending.length} to go`}
        </span>
      </div>

      {pending.map(item => {
        // FIFO suggestion leads for first-pack; for last-pack the order is
        // still shown but nothing is highlighted — the operator must read
        // the real pack.
        const candidates = (item.candidateBatchNumbers ?? []).slice(0, 6);
        const current = recordedNumber(item);
        return (
          <div key={item.recipeId} className="p-3 rounded-xl border bg-secondary/20 border-border space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold truncate">{item.recipeName}</p>
              <p className="text-xs text-muted-foreground shrink-0">
                {item.fridgeQty != null ? `${Math.round(item.fridgeQty)} packs in fridge` : ""}
                {isLast && item.recordedFirstBatchNumber != null ? ` · first today #${item.recordedFirstBatchNumber}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {candidates.map(n => {
                // Shelf-life verdict shown on the chip itself, so a too-old
                // batch reads as a warning BEFORE it's tapped (2026-09-02).
                const verdict = !isLast ? batchDispatchVerdict(n, item.shelfLifeDays, item.earliestOkUseBy) : null;
                const tooOld = verdict !== null && !verdict.ok;
                return (
                  <button
                    key={n}
                    onClick={() => saveBatch(item.recipeId, n)}
                    disabled={saving[item.recipeId]}
                    className={cn(
                      "px-3 py-1.5 rounded-lg border font-mono font-bold text-sm tabular-nums transition-colors disabled:opacity-50 flex flex-col items-center",
                      current === n
                        ? "bg-primary text-primary-foreground border-primary"
                        : tooOld
                          ? "border-destructive/60 bg-destructive/10 text-destructive hover:bg-destructive/20"
                          : !isLast && n === item.suggestedBatchNumber
                            ? "border-primary/60 bg-primary/10 text-primary hover:bg-primary/20"
                            : "border-border bg-background hover:border-primary hover:text-primary",
                    )}
                  >
                    <span>
                      #{n}
                      {!isLast && !tooOld && n === item.suggestedBatchNumber && (
                        <span className="ml-1 text-[10px] font-sans font-semibold uppercase">fifo</span>
                      )}
                    </span>
                    {verdict && (
                      <span className={cn("text-[10px] font-sans leading-tight", tooOld ? "font-bold" : "text-muted-foreground")}>
                        {tooOld ? "too old" : `use-by ${shortDate(verdict.useByDate)}`}
                      </span>
                    )}
                  </button>
                );
              })}
              <button
                onClick={() => { setManualFor(m => m === item.recipeId ? null : item.recipeId); setManualValue(""); }}
                disabled={saving[item.recipeId]}
                className="px-3 py-2 rounded-lg border border-dashed border-border bg-background text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors"
              >
                Other…
              </button>
              {saving[item.recipeId] && <Loader2 className="w-4 h-4 animate-spin self-center text-muted-foreground" />}
            </div>
            {manualFor === item.recipeId && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">#</span>
                <input
                  type="number"
                  autoFocus
                  className="w-24 px-2 py-1.5 text-sm text-center font-mono font-bold border border-primary/40 rounded-lg bg-background tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30"
                  value={manualValue}
                  onChange={e => setManualValue(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") saveBatch(item.recipeId, parseInt(manualValue)); }}
                  placeholder="type it"
                />
                <button
                  onClick={() => saveBatch(item.recipeId, parseInt(manualValue))}
                  disabled={!manualValue || saving[item.recipeId]}
                  className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* The escalation block (2026-09-02): a recorded first batch whose
          use-by fails today's dispatch rule is a stop-the-line moment, not a
          footnote — name the batch, the dates, and what to do. */}
      {!isLast && (() => {
        const bad = done
          .map(item => ({ item, n: recordedNumber(item)!, verdict: batchDispatchVerdict(recordedNumber(item)!, item.shelfLifeDays, item.earliestOkUseBy) }))
          .filter(b => b.verdict !== null && !b.verdict.ok);
        if (bad.length === 0) return null;
        return (
          <div className="rounded-xl border-2 border-destructive bg-destructive/10 p-3.5 space-y-2">
            <p className="text-sm font-bold text-destructive flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" /> Do not dispatch — not enough shelf life
            </p>
            {bad.map(({ item, n, verdict }) => (
              <p key={item.recipeId} className="text-sm text-destructive">
                <span className="font-semibold">{item.recipeName}</span> #{n} — use-by {shortDate(verdict!.useByDate)},
                needs {shortDate(item.earliestOkUseBy!)} or later to go out today.
              </p>
            ))}
            <p className="text-sm font-semibold text-destructive">
              Set these packs aside and tell a manager before packing anything from this batch.
            </p>
          </div>
        );
      })()}

      {done.length > 0 && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/20 p-3 space-y-1">
          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> Recorded
          </p>
          {done.map(item => {
            const n = recordedNumber(item)!;
            const verdict = !isLast ? batchDispatchVerdict(n, item.shelfLifeDays, item.earliestOkUseBy) : null;
            return (
              <div key={item.recipeId} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{item.recipeName}</span>
                <span className="flex items-center gap-2 shrink-0">
                  {verdict && (
                    <span className={cn(
                      "text-[11px] font-semibold px-1.5 py-0.5 rounded",
                      verdict.ok
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "bg-destructive text-destructive-foreground",
                    )}>
                      {verdict.ok ? `use-by ${shortDate(verdict.useByDate)} ✓` : "TOO OLD"}
                    </span>
                  )}
                  {!isLast && !verdict && item.shelfLifeDays == null && (
                    <span className="text-[11px] text-amber-600 dark:text-amber-400" title="Set a shelf life on the recipe to check this">
                      no shelf life set
                    </span>
                  )}
                  <span className="font-mono font-bold tabular-nums">#{n}</span>
                  <button
                    onClick={() => setChanging(item.recipeId)}
                    className="text-[11px] text-muted-foreground hover:text-primary underline-offset-2 hover:underline"
                  >
                    change
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Fridge / freezer temperatures, one row per storage_location with
// zone IN (fridge, freezer). Same record-per-(plan, location) carries
// both opening and closing values; this component switches its label
// and which column it POSTs to based on the `kind` prop.
interface LocationTempRow {
  storageLocationId: number;
  locationName: string;
  zone: string;
  // Per-location safe band from Stock Control (null = zone default).
  tempMinC: number | null;
  tempMaxC: number | null;
  openingTemperatureC: number | null;
  closingTemperatureC: number | null;
  openingRecordedAt: string | null;
  closingRecordedAt: string | null;
}

interface LiveSensorReading {
  temperatureC: number;
  readingAt: string | null;
  // Effective ceiling/floor resolved server-side (location band, else zone default).
  thresholdC: number | null;
  minC: number | null;
}

// ── Fridge/freezer temperature checks ────────────────────────────────────
// Session-aware: the London clock decides whether we're recording the
// morning (before midday) or afternoon reading — the checklist template
// type no longer picks the column, so a mis-configured template can't
// leak the morning's numbers into the afternoon check. Every location
// must be recorded each session; recorded rows drop into a collapsible
// "completed" list, and the outstanding list refills itself when the
// session flips at midday. Only locations with a live (non-stale) Govee
// sensor get a pre-set dial value + live badge; everything else starts
// from a neutral default and must be read by hand.

function londonHourNow(): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(new Date()),
  ) % 24;
}

// Big-buttoned temperature dial: − / + nudge 0.1°C (hold to spin), slider
// underneath for coarse jumps. No keyboard needed — far easier than typing
// "3.2" on an iPad with cold hands.
function TempDial({ value, min, max, out, onStep, onSet }: {
  value: number;
  min: number;
  max: number;
  out: boolean;
  onStep: (delta: number) => void;
  onSet: (v: number) => void;
}) {
  const holdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopHold = () => { if (holdRef.current) { clearInterval(holdRef.current); holdRef.current = null; } };
  const startHold = (delta: number) => {
    onStep(delta);
    stopHold();
    holdRef.current = setInterval(() => onStep(delta), 120);
  };
  useEffect(() => stopHold, []);
  const btnClass = "w-12 h-12 rounded-xl border-2 border-border bg-background hover:bg-secondary/60 active:scale-95 flex items-center justify-center select-none touch-none shrink-0";
  return (
    <div className="flex-1 min-w-0 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onPointerDown={() => startHold(-0.1)}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onContextMenu={e => e.preventDefault()}
          className={btnClass}
        >
          <Minus className="w-5 h-5" />
        </button>
        <div className={cn(
          "flex-1 text-center text-3xl font-display font-bold tabular-nums leading-none whitespace-nowrap",
          out ? "text-red-600 dark:text-red-400" : "text-foreground",
        )}>
          {value.toFixed(1)}<span className="text-lg font-semibold text-muted-foreground">°C</span>
        </div>
        <button
          type="button"
          onPointerDown={() => startHold(0.1)}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onContextMenu={e => e.preventDefault()}
          className={btnClass}
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={0.1}
        value={value}
        onChange={e => onSet(Number(e.target.value))}
        className="w-full h-2 accent-primary cursor-pointer"
      />
    </div>
  );
}

function LocationTemperatures({ data, planId }: { data: unknown[]; planId: number; kind: "opening" | "closing" }) {
  const items = data as LocationTempRow[];

  // London hour, ticked every 30s so the AM→PM flip happens live on screen.
  const [hour, setHour] = useState(londonHourNow);
  useEffect(() => {
    const id = setInterval(() => setHour(londonHourNow()), 30_000);
    return () => clearInterval(id);
  }, []);
  const session: "opening" | "closing" = hour < 12 ? "opening" : "closing";
  const isClosing = session === "closing";

  const [values, setValues] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [showCompleted, setShowCompleted] = useState(false);
  const [editing, setEditing] = useState<Set<number>>(new Set());
  // Saves made this visit, per session — moves rows to "completed"
  // instantly without waiting for a dynamic-data refetch.
  const [localRecorded, setLocalRecorded] = useState<Record<string, Record<number, { value: number; at: string | null }>>>({});
  // Live Govee sensor reading per storage location (when checklist-assist is on).
  const [sensorTemps, setSensorTemps] = useState<Record<number, LiveSensorReading>>({});
  // Locations whose sensor is stale/offline — we must NOT preset a frozen
  // reading here; staff read the unit by hand and see a warning instead.
  const [staleSensorLocs, setStaleSensorLocs] = useState<Record<number, boolean>>({});
  const [assistOn, setAssistOn] = useState(false);

  // Pull live sensor readings for prefill (no-op unless the integration + the
  // checklist-assist toggle are on).
  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/govee/live`, { credentials: "include" })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d || !d.enabled || !d.checklistAssistEnabled) return;
        const map: Record<number, LiveSensorReading> = {};
        const stale: Record<number, boolean> = {};
        for (const s of d.sensors ?? []) {
          if (s.storageLocationId == null) continue;
          // A stale sensor's reading is frozen — never prefill it; flag it so
          // staff read the actual unit instead of confirming a dead value.
          if (s.stale) { stale[s.storageLocationId] = true; continue; }
          if (s.temperatureC != null) {
            map[s.storageLocationId] = {
              temperatureC: s.temperatureC,
              readingAt: s.readingAt ?? null,
              thresholdC: s.thresholdC ?? null,
              minC: s.minC ?? null,
            };
          }
        }
        setSensorTemps(map);
        setStaleSensorLocs(stale);
        setAssistOn(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // What's recorded for the CURRENT session (server value merged with
  // saves made just now on this device).
  const recordedFor = (item: LocationTempRow): { value: number; at: string | null } | null => {
    const local = localRecorded[session]?.[item.storageLocationId];
    if (local) return local;
    const v = isClosing ? item.closingTemperatureC : item.openingTemperatureC;
    const at = isClosing ? item.closingRecordedAt : item.openingRecordedAt;
    return v != null ? { value: v, at } : null;
  };

  const zoneDefault = (zone: string) => (zone === "freezer" ? -18 : 3);
  const sliderRange = (item: LocationTempRow): [number, number] => {
    let lo = item.zone === "freezer" ? -30 : -5;
    let hi = item.zone === "freezer" ? 5 : 15;
    if (item.tempMinC != null) lo = Math.min(lo, item.tempMinC - 2);
    if (item.tempMaxC != null) hi = Math.max(hi, item.tempMaxC + 2);
    return [lo, hi];
  };

  // (Re)seed the dial start value when the list, sensors, or session
  // change: live sensor reading where one exists, else the middle of the
  // location's safe band, else a neutral zone default. Purely a starting
  // position — nothing is recorded until the green button is pressed.
  const seededKey = useRef<string>("");
  useEffect(() => {
    const key = `${session}|${items.map(i => i.storageLocationId).join(",")}|${Object.keys(sensorTemps).join(",")}`;
    if (seededKey.current === key) return;
    seededKey.current = key;
    const next: Record<number, number> = {};
    for (const item of items) {
      const sensor = sensorTemps[item.storageLocationId];
      const mid = item.tempMinC != null && item.tempMaxC != null ? (item.tempMinC + item.tempMaxC) / 2 : null;
      const v = sensor?.temperatureC ?? mid ?? zoneDefault(item.zone);
      next[item.storageLocationId] = Math.round(v * 10) / 10;
    }
    setValues(next);
    setEditing(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, items, sensorTemps]);

  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v * 10) / 10));
  const stepValue = (item: LocationTempRow, delta: number) => {
    const [lo, hi] = sliderRange(item);
    setValues(prev => {
      const cur = prev[item.storageLocationId] ?? zoneDefault(item.zone);
      return { ...prev, [item.storageLocationId]: clamp(cur + delta, lo, hi) };
    });
  };
  const setValue = (item: LocationTempRow, v: number) => {
    const [lo, hi] = sliderRange(item);
    setValues(prev => ({ ...prev, [item.storageLocationId]: clamp(v, lo, hi) }));
  };

  const saveTemp = async (locationId: number) => {
    const v = values[locationId];
    if (v == null || Number.isNaN(v)) return;
    setSaving(s => ({ ...s, [locationId]: true }));
    try {
      const res = await fetch(`${BASE}/api/checklists/location-temperature-record`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, storageLocationId: locationId, temperatureC: v, kind: session }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setLocalRecorded(prev => ({
        ...prev,
        [session]: { ...(prev[session] ?? {}), [locationId]: { value: Math.round(v * 10) / 10, at: new Date().toISOString() } },
      }));
      setEditing(prev => { const n = new Set(prev); n.delete(locationId); return n; });
    } catch {
      toast({ title: "Error", description: "Failed to save temperature", variant: "destructive" });
    } finally {
      setSaving(s => ({ ...s, [locationId]: false }));
    }
  };

  if (items.length === 0) {
    return (
      <div className="mb-4 p-3 bg-secondary/30 rounded-lg text-sm text-muted-foreground">
        No fridges or freezers configured. Add them in Settings → Storage Locations.
      </div>
    );
  }

  const bandFor = (item: LocationTempRow) => {
    const sensor = sensorTemps[item.storageLocationId];
    // Safe band: per-location values from Stock Control win; the sensor's
    // server-resolved threshold covers the zone-default fallback.
    const bandMax = item.tempMaxC ?? sensor?.thresholdC ?? null;
    const bandMin = item.tempMinC ?? sensor?.minC ?? null;
    const outOfBand = (t: number) => (bandMax != null && t > bandMax) || (bandMin != null && t < bandMin);
    const bandLabel = bandMin != null || bandMax != null
      ? `safe ${bandMin != null ? `${bandMin}` : ""}${bandMin != null && bandMax != null ? " to " : bandMin != null ? "+" : "≤ "}${bandMax != null ? `${bandMax}` : ""}°C`
      : null;
    return { bandMin, bandMax, outOfBand, bandLabel };
  };

  const outstanding = items.filter(it => recordedFor(it) == null || editing.has(it.storageLocationId));
  const completed = items.filter(it => recordedFor(it) != null && !editing.has(it.storageLocationId));

  const fmtTime = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "";

  return (
    <div className="mb-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          {isClosing ? <Moon className="w-4 h-4 text-indigo-500" /> : <Sun className="w-4 h-4 text-amber-500" />}
          {isClosing ? "Afternoon temperature check" : "Morning temperature check"}
          <span className="text-muted-foreground font-normal">· {completed.length} of {items.length} recorded</span>
        </p>
        {completed.length > 0 && (
          <button
            type="button"
            onClick={() => setShowCompleted(v => !v)}
            className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            {showCompleted ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {showCompleted ? "Hide completed" : `Show completed (${completed.length})`}
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {isClosing
          ? "PM readings — the list refilled at midday for the afternoon round."
          : "AM readings — the list resets at midday for the afternoon round."}
        {" "}Set the dial and press the green button for each unit.
      </p>

      {outstanding.length === 0 && (
        <div className="p-3 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/20 flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="w-5 h-5" />
          All {items.length} {isClosing ? "afternoon" : "morning"} temperatures recorded
        </div>
      )}

      {outstanding.map(item => {
        const val = values[item.storageLocationId] ?? zoneDefault(item.zone);
        const { outOfBand, bandLabel } = bandFor(item);
        const sensor: LiveSensorReading | undefined = sensorTemps[item.storageLocationId];
        const sensorOut = sensor != null && outOfBand(sensor.temperatureC);
        const [lo, hi] = sliderRange(item);
        return (
          <div key={item.storageLocationId} className="p-3 rounded-xl border bg-secondary/20 border-border space-y-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{item.locationName}</p>
              <p className="text-xs text-muted-foreground capitalize">
                {item.zone}
                {bandLabel ? ` · ${bandLabel}` : ""}
              </p>
              {assistOn && sensor != null && (
                <button
                  type="button"
                  onClick={() => setValue(item, sensor.temperatureC)}
                  className={cn(
                    "text-xs mt-0.5 flex items-center gap-1 font-medium hover:underline",
                    sensorOut ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400",
                  )}
                >
                  {sensorOut && <AlertTriangle className="w-3 h-3 shrink-0" />}
                  Live sensor: {sensor.temperatureC.toFixed(1)}°C
                  {sensor.readingAt ? ` · ${readingAgeLabel(sensor.readingAt)}` : ""}
                </button>
              )}
              {assistOn && staleSensorLocs[item.storageLocationId] && (
                <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1 mt-0.5">
                  <AlertTriangle className="w-3 h-3 shrink-0" /> Sensor offline — read the unit by hand
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <TempDial
                value={val}
                min={lo}
                max={hi}
                out={outOfBand(val)}
                onStep={d => stepValue(item, d)}
                onSet={v => setValue(item, v)}
              />
              <button
                onClick={() => saveTemp(item.storageLocationId)}
                disabled={saving[item.storageLocationId]}
                title="Record this temperature"
                className="w-14 h-14 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center active:scale-95 disabled:opacity-50 transition-all shrink-0"
              >
                {saving[item.storageLocationId] ? <Loader2 className="w-6 h-6 animate-spin" /> : <CheckCircle2 className="w-6 h-6" />}
              </button>
            </div>
          </div>
        );
      })}

      {showCompleted && completed.map(item => {
        const rec = recordedFor(item)!;
        const { outOfBand } = bandFor(item);
        return (
          <div key={item.storageLocationId} className="flex items-center gap-3 p-2.5 rounded-xl border bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{item.locationName}</p>
              <p className="text-xs text-muted-foreground capitalize">
                {item.zone}{rec.at ? ` · recorded ${fmtTime(rec.at)}` : ""}
              </p>
            </div>
            <span className={cn(
              "text-base font-bold tabular-nums",
              outOfBand(rec.value) ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-300",
            )}>
              {rec.value.toFixed(1)}°C
            </span>
            <button
              type="button"
              onClick={() => {
                setValues(v => ({ ...v, [item.storageLocationId]: rec.value }));
                setEditing(prev => new Set(prev).add(item.storageLocationId));
              }}
              title="Edit this reading"
              className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Pencil className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Closing fridge check ───────────────────────────────────────────────
// Packs still in the production fridge whose last sellable dispatch was
// today (or earlier) — they must be frozen into Wonky stock before close.
// Deliberately slow to fire: per recipe, the operator taps Freeze, then
// confirms an editable pack count on a second step, so nobody can dump a
// pile of stock into the freezer with one stray tap. Rows disappear as
// they're actioned (the server list self-clears); the all-clear state is
// shown explicitly so "nothing listed" never reads as "didn't load".
interface ClosingFridgeRow {
  recipeId: number;
  recipeName: string;
  recipeColor: string | null;
  fridgeQty: number;
  actionPacks: number;
  batches: Array<{ batchNumber: number; packs: number; useByDate: string; lastDispatchDate: string }>;
}

function ClosingFridgeCheck({ data }: { data: unknown[] }) {
  // Guard the shape: useDynamicData keeps the PREVIOUS item's payload for
  // one render after the selected item changes, so this can briefly receive
  // rows from another dynamic type (e.g. pack-batch rows with no batches).
  const rows = (data as ClosingFridgeRow[]).filter(r => r && typeof r.recipeId === "number" && Array.isArray(r.batches));
  // recipeId → confirm-step state; done map keeps a ✓ row after freezing
  // (the next data fetch no longer contains it).
  const [confirming, setConfirming] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [done, setDone] = useState<Record<number, number>>({});

  const fmtDate = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  const freeze = async (row: ClosingFridgeRow) => {
    const packs = parseInt(confirming[row.recipeId] ?? "");
    if (!packs || isNaN(packs) || packs <= 0) return;
    setSaving(s => ({ ...s, [row.recipeId]: true }));
    try {
      const res = await fetch(`${BASE}/api/checklists/closing-fridge-freeze`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipeId: row.recipeId, packs }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to freeze packs");
      setDone(d => ({ ...d, [row.recipeId]: packs }));
      setConfirming(c => { const n = { ...c }; delete n[row.recipeId]; return n; });
      toast({
        title: `Frozen: ${packs} × ${row.recipeName}`,
        description: `Fridge now ${body.newFridgeQty}, freezer (Wonky) now ${body.newFreezerQty}.`,
      });
    } catch (err) {
      toast({
        title: "Couldn't freeze packs",
        description: err instanceof Error ? err.message : "Try refreshing the checklist.",
        variant: "destructive",
      });
    } finally {
      setSaving(s => ({ ...s, [row.recipeId]: false }));
    }
  };

  const pending = rows.filter(r => done[r.recipeId] == null);

  if (pending.length === 0 && Object.keys(done).length === 0) {
    return (
      <div className="mb-4 p-3 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-xl text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        All clear — everything in the fridge still has enough shelf life to sell.
      </div>
    );
  }

  return (
    <div className="mb-4 space-y-2">
      <p className="text-sm font-semibold text-foreground">
        These packs can no longer be dispatched with enough shelf life — freeze them into Wonky stock now.
      </p>
      {rows.map(row => {
        const doneCount = done[row.recipeId];
        if (doneCount != null) {
          return (
            <div key={row.recipeId} className="flex items-center gap-3 p-3 rounded-xl border bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{row.recipeName}</p>
                <p className="text-xs text-emerald-700 dark:text-emerald-300">{doneCount} pack{doneCount === 1 ? "" : "s"} moved to the freezer (Wonky stock)</p>
              </div>
            </div>
          );
        }
        const confirmVal = confirming[row.recipeId];
        const isConfirming = confirmVal != null;
        return (
          <div key={row.recipeId} className="p-3 rounded-xl border bg-red-50/60 dark:bg-red-950/20 border-red-200 dark:border-red-800 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate" style={row.recipeColor ? { color: row.recipeColor } : undefined}>
                  {row.recipeName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {row.actionPacks} of {row.fridgeQty} pack{row.fridgeQty === 1 ? "" : "s"} in the fridge{" "}
                  {row.batches.map(b => `batch ${b.batchNumber} (${b.packs}p, use by ${fmtDate(b.useByDate)})`).join(", ")}
                </p>
              </div>
              {!isConfirming && (
                <button
                  onClick={() => setConfirming(c => ({ ...c, [row.recipeId]: String(row.actionPacks) }))}
                  className="shrink-0 px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors"
                >
                  Freeze {row.actionPacks}…
                </button>
              )}
            </div>
            {isConfirming && (
              <div className="p-2.5 rounded-lg bg-background border border-border space-y-2">
                <p className="text-xs text-foreground">
                  Count the packs as you move them. How many {row.recipeName} packs are you putting in the freezer?
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={row.actionPacks}
                    value={confirmVal}
                    onChange={e => setConfirming(c => ({ ...c, [row.recipeId]: e.target.value }))}
                    className="w-20 px-2 py-1.5 text-sm text-center font-bold border border-border rounded-lg bg-background tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <span className="text-xs text-muted-foreground">packs → freezer (Wonky)</span>
                  <div className="flex-1" />
                  <button
                    onClick={() => setConfirming(c => { const n = { ...c }; delete n[row.recipeId]; return n; })}
                    className="px-2.5 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => freeze(row)}
                    disabled={saving[row.recipeId] || !confirmVal || parseInt(confirmVal) <= 0 || parseInt(confirmVal) > row.actionPacks}
                    className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                  >
                    {saving[row.recipeId] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    Confirm freeze
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  This takes them out of fridge stock and adds them to freezer (Wonky) stock — it can't be undone from here.
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Duck defrost quantity ──────────────────────────────────────────────
// Duck needs ~2 days defrosting, so the closing check shows the duck (kg)
// needed by the plan TWO production days ahead — the amount to move from
// the freezer to the fridge tonight.
interface DuckDefrostData {
  found: boolean;
  planName?: string;
  planDate?: string;
  plansAhead?: number;
  totalKg?: number;
  perRecipe?: Array<{ recipeName: string; batches: number; kg: number }>;
}

function DuckDefrost({ data }: { data: unknown[] }) {
  const report = (data as DuckDefrostData[])[0];
  if (!report || !report.found) {
    return (
      <div className="mb-4 p-3 bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl text-sm text-amber-700 dark:text-amber-300">
        No future production plan exists yet — create the next plan first, then this shows the duck to defrost.
      </div>
    );
  }
  const dateLabel = report.planDate
    ? new Date(report.planDate + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })
    : "";
  return (
    <div className="mb-4 p-4 bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">Duck to defrost tonight</p>
        <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">for {dateLabel}</span>
      </div>
      {(report.totalKg ?? 0) <= 0 ? (
        <p className="text-sm text-muted-foreground">No duck on that plan — nothing to defrost.</p>
      ) : (
        <>
          <div className="space-y-1 mb-2">
            {(report.perRecipe ?? []).map((r, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="truncate text-foreground/80">{r.recipeName} · {r.batches} batch{r.batches === 1 ? "" : "es"}</span>
                <span className="font-bold tabular-nums text-blue-700 dark:text-blue-300">{r.kg} kg</span>
              </div>
            ))}
          </div>
          <div className="pt-2 border-t border-blue-200 dark:border-blue-700 flex items-center justify-between">
            <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">Move freezer → fridge</span>
            <span className="text-lg font-bold tabular-nums text-blue-700 dark:text-blue-300">{report.totalKg} kg</span>
          </div>
        </>
      )}
      {report.plansAhead === 1 && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-2 flex items-start gap-1">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          Only one plan ahead has been created — this quantity is for that plan. Create the next plan for the usual two-days-ahead figure.
        </p>
      )}
    </div>
  );
}

function DynamicDataDisplay({ type, data, loading, planId }: { type: string; data: unknown[]; loading: boolean; planId: number }) {
  if (type === "ice_packs") {
    if (loading) {
      return (
        <div className="mb-4 p-3 bg-cyan-50/60 dark:bg-cyan-950/20 rounded-lg flex items-center gap-2 text-sm text-cyan-600">
          <Loader2 className="w-4 h-4 animate-spin" />
          Checking the forecast…
        </div>
      );
    }
    const ice = (data as any[])[0] as {
      enabled?: boolean; highTemp?: number | null; smallBoxPacks?: number; largeBoxPacks?: number;
      location?: { name?: string }; message?: string;
    } | undefined;
    if (!ice || ice.enabled === false || typeof ice.smallBoxPacks !== "number") {
      return (
        <div className="mb-4 p-3 bg-secondary/30 rounded-lg text-sm text-muted-foreground">
          Ice-pack rule unavailable — check the packing screen banner.
        </div>
      );
    }
    return (
      <div className="mb-4 p-4 bg-cyan-50/70 dark:bg-cyan-950/20 border border-cyan-200 dark:border-cyan-800 rounded-xl">
        <div className="flex items-center gap-6">
          <div>
            <p className="text-3xl font-bold font-display tabular-nums text-cyan-700 dark:text-cyan-300">
              {ice.smallBoxPacks}
            </p>
            <p className="text-xs font-medium text-cyan-700/80 dark:text-cyan-300/80">per small box</p>
          </div>
          <div>
            <p className="text-3xl font-bold font-display tabular-nums text-cyan-700 dark:text-cyan-300">
              {ice.largeBoxPacks}
            </p>
            <p className="text-xs font-medium text-cyan-700/80 dark:text-cyan-300/80">per large box</p>
          </div>
          <div className="ml-auto text-right text-xs text-muted-foreground">
            {ice.highTemp != null
              ? <>Forecast high <span className="font-semibold text-foreground">{ice.highTemp}°C</span><br />({ice.location?.name ?? "despatch window"}, today/tomorrow)</>
              : <span className="text-amber-600 dark:text-amber-400">{ice.message ?? "Weather unavailable"}</span>}
          </div>
        </div>
      </div>
    );
  }

  if (type === "desserts_report") {
    if (loading) {
      return (
        <div className="mb-4 p-3 bg-blue-50/60 dark:bg-blue-950/20 rounded-lg flex items-center gap-2 text-sm text-blue-600">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading dessert report...
        </div>
      );
    }
    const report = (data as any[])[0] as { tag: string; deliveryLabel: string; products: Array<{ title: string; quantity: number }>; fivePackProducts?: Array<{ title: string; quantity: number }>; fivePackTotal?: number; totalQuantity: number; dessertProductCount: number } | undefined;
    const fivePack = report?.fivePackProducts ?? [];
    // Belt-and-braces shape guard: this renderer crashed the whole checklist
    // when handed another check's rows (see useDynamicData) — never trust
    // the payload shape blindly again.
    if (!report || !Array.isArray(report.products) || (report.products.length === 0 && fivePack.length === 0)) {
      return (
        <div className="mb-4 p-3 bg-secondary/30 rounded-lg text-sm text-muted-foreground">
          No dessert orders found for delivery.
        </div>
      );
    }
    return (
      <div className="mb-4 p-4 bg-purple-50/60 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 rounded-xl">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-purple-700 dark:text-purple-300">
            Dessert Report
          </p>
          <span className="text-xs text-purple-600 dark:text-purple-400 font-medium">
            Delivery: {report.deliveryLabel}
          </span>
        </div>
        {/* Every headline number gets the SAME banner treatment (Graeme,
            2026-08-28): cinnamon buns and the 5-pack label count are equal
            starting numbers for the packer. Cinnamon on top; the 5-pack
            banner keeps its per-recipe breakdown underneath, grouped
            server-side so every surface of this report agrees. */}
        {report.products.map((p, i) => (
          <div key={`prod-${i}`} className="mb-3 p-3 rounded-lg bg-purple-100/70 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-700">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-purple-800 dark:text-purple-200">{p.title}</span>
              <span className="text-2xl font-bold tabular-nums text-purple-800 dark:text-purple-200">{p.quantity}</span>
            </div>
          </div>
        ))}
        {fivePack.length > 0 && (
          <div className="mb-3 p-3 rounded-lg bg-purple-100/70 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-700">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-purple-800 dark:text-purple-200">5-Pack labels to print</span>
              <span className="text-2xl font-bold tabular-nums text-purple-800 dark:text-purple-200">{report.fivePackTotal ?? 0}</span>
            </div>
            <div className="mt-1.5 space-y-1">
              {fivePack.map((p, i) => (
                <div key={i} className="flex items-center justify-between text-xs text-purple-900/80 dark:text-purple-200/80">
                  <span className="truncate">{p.title}</span>
                  <span className="font-semibold tabular-nums w-8 text-right shrink-0 ml-2">{p.quantity}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mt-3 pt-2 border-t border-purple-200 dark:border-purple-700 flex items-center justify-between">
          <span className="text-sm font-semibold text-purple-700 dark:text-purple-300">Total</span>
          <span className="text-lg font-bold tabular-nums text-purple-700 dark:text-purple-300">{report.totalQuantity}</span>
        </div>
      </div>
    );
  }

  if (type === "first_pack_batch_numbers" || type === "last_pack_batch_numbers") {
    if (loading) {
      return (
        <div className="mb-4 p-3 bg-blue-50/60 dark:bg-blue-950/20 rounded-lg flex items-center gap-2 text-sm text-blue-600">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading recipe batch data...
        </div>
      );
    }
    return <PackBatchNumbers data={data} planId={planId} kind={type === "last_pack_batch_numbers" ? "last" : "first"} />;
  }

  if (type === "closing_fridge_check") {
    if (loading) {
      return (
        <div className="mb-4 p-3 bg-blue-50/60 dark:bg-blue-950/20 rounded-lg flex items-center gap-2 text-sm text-blue-600">
          <Loader2 className="w-4 h-4 animate-spin" />
          Checking fridge stock shelf life...
        </div>
      );
    }
    return <ClosingFridgeCheck data={data} />;
  }

  if (type === "duck_defrost_quantity") {
    if (loading) {
      return (
        <div className="mb-4 p-3 bg-blue-50/60 dark:bg-blue-950/20 rounded-lg flex items-center gap-2 text-sm text-blue-600">
          <Loader2 className="w-4 h-4 animate-spin" />
          Working out the duck to defrost...
        </div>
      );
    }
    return <DuckDefrost data={data} />;
  }

  if (type === "fridge_freezer_temps_opening" || type === "fridge_freezer_temps_closing") {
    if (loading) {
      return (
        <div className="mb-4 p-3 bg-blue-50/60 dark:bg-blue-950/20 rounded-lg flex items-center gap-2 text-sm text-blue-600">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading fridge / freezer locations...
        </div>
      );
    }
    return <LocationTemperatures data={data} planId={planId} kind={type === "fridge_freezer_temps_closing" ? "closing" : "opening"} />;
  }

  if (loading) {
    return (
      <div className="mb-4 p-3 bg-blue-50/60 dark:bg-blue-950/20 rounded-lg flex items-center gap-2 text-sm text-blue-600">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading production data...
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="mb-4 p-3 bg-secondary/30 rounded-lg text-sm text-muted-foreground">
        No {type.replace(/_/g, " ")} recorded today yet.
      </div>
    );
  }

  if (type === "temperature_records") {
    return (
      <div className="mb-4 p-3 bg-blue-50/60 dark:bg-blue-950/20 rounded-lg">
        <p className="text-sm font-semibold text-blue-700 dark:text-blue-300 mb-2">
          Temperature Records ({data.length})
        </p>
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {(data as Array<{ recipeName?: string; ingredientName?: string; temperatureC?: string; recordedAt?: string; userName?: string }>).map((r, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="truncate text-foreground/80">
                {r.recipeName ?? ""} {r.ingredientName ? `- ${r.ingredientName}` : ""}
              </span>
              <span className="font-mono font-semibold text-blue-600 ml-2 whitespace-nowrap">
                {r.temperatureC}&deg;C
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (type === "oven_events") {
    return (
      <div className="mb-4 p-3 bg-red-50/60 dark:bg-red-950/20 rounded-lg">
        <p className="text-sm font-semibold text-red-700 dark:text-red-300 mb-2">
          Oven Events ({data.length})
        </p>
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {(data as Array<{ recipeName?: string; ovenInAt?: string; ovenOutAt?: string | null }>).map((r, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="truncate text-foreground/80">{r.recipeName ?? "Unknown"}</span>
              <span className="text-xs text-muted-foreground ml-2 whitespace-nowrap">
                {r.ovenInAt ? new Date(r.ovenInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                {r.ovenOutAt ? ` - ${new Date(r.ovenOutAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : " (in oven)"}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (type === "mozzarella_load") {
    const mozzData = data[0] as { name?: string; unit?: string; totalQty?: number; bags?: number; planDate?: string | null } | undefined;
    if (!mozzData) return null;
    const nextDayLabel = mozzData.planDate
      ? new Date(`${mozzData.planDate}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
      : null;
    const unit = mozzData.unit ?? "g";
    const totalQty = mozzData.totalQty ?? 0;
    const fmtTotal = unit === "kg" ? `${totalQty.toFixed(1)} kg` : `${Math.round(totalQty)} g`;
    return (
      <div className="mb-4 p-4 bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl text-center">
        <p className="text-4xl font-display font-bold text-amber-700 dark:text-amber-300">
          {mozzData.bags}
        </p>
        <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
          x 2kg bags
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {fmtTotal} {mozzData.name ?? "Mozzarella"} total for next production{nextDayLabel ? ` · ${nextDayLabel}` : ""}
        </p>
      </div>
    );
  }

  return null;
}
