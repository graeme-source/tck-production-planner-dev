import { useState, useEffect, useRef } from "react";
import {
  CheckCircle2, Circle, ClipboardCheck, Plus, Undo2, Loader2, XCircle,
  Sun, Sparkles, Moon, ChevronDown, ChevronUp, GripVertical, Trash2, Pencil, Eye, EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useGuardedAction, guardedFetch } from "@/hooks/use-guarded-action";
import { useAuth } from "@/contexts/auth-context";
import { useStationChecklist, useDynamicData, type ChecklistItem } from "./use-station-checklist";
import { ChecklistAdminPanel } from "./checklist-admin-panel";

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

  const handleDeleteOneoff = (item: ChecklistItem) => {
    if (item.type !== "oneoff") return;
    runOneoff(async (signal) => {
      await guardedFetch(`${BASE}/api/checklists/oneoff/${item.id}`, { method: "DELETE", signal });
      if (selectedItemKey && selectedItemKey === itemKey(item)) setSelectedItemKey(null);
      toast({ title: "Item deleted" });
    });
  };

  const handleDeleteTemplate = (item: ChecklistItem) => {
    if (item.type !== "template") return;
    runOneoff(async (signal) => {
      await guardedFetch(`${BASE}/api/checklists/templates/${item.id}`, { method: "DELETE", signal });
      if (selectedItemKey && selectedItemKey === itemKey(item)) setSelectedItemKey(null);
      toast({ title: "Recurring task deleted" });
    });
  };

  return (
    <div className="space-y-4">
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
        <ChecklistAdminPanel stationType={stationType} onClose={() => { setAdminMode(false); refetch(); }} />
      )}

      {/* Two-panel layout */}
      {!adminMode && (
        <div className="flex flex-col lg:flex-row gap-4">
          {/* LEFT — Categorized list. Equal width with the detail panel so
              the list isn't squashed and the bigger row font reads clearly. */}
          <div className="lg:flex-1 lg:basis-1/2 min-w-0">
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
                            <div
                              className="flex-shrink-0 p-1.5 rounded-lg text-muted-foreground/40 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                              role="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (item.type === "oneoff") handleDeleteOneoff(item);
                                else handleDeleteTemplate(item);
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </div>
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
                        Schedule: {selectedItem.schedule === "weekly" ? "Weekly" : "Specific days"}
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
    </div>
  );
}

function itemKey(item: { type: string; id: number; category: string }): string {
  return `${item.type}:${item.id}:${item.category}`;
}

// ─── Dynamic Data Display ────────────────────────────────────────────

function FirstPackBatchNumbers({ data, planId }: { data: unknown[]; planId: number }) {
  const items = data as Array<{
    recipeId: number;
    recipeName: string;
    fridgeQty?: number;
    suggestedBatchNumber: number | null;
    suggestedUseByDate: string | null;
    recordedBatchNumber: number | null;
    recordedAt: string | null;
  }>;
  const [values, setValues] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});

  // Initialize values from recorded or suggested
  useEffect(() => {
    const init: Record<number, string> = {};
    for (const item of items) {
      if (item.recipeId != null) {
        init[item.recipeId] = String(item.recordedBatchNumber ?? item.suggestedBatchNumber ?? "");
      }
    }
    setValues(init);
  }, [data]);

  const saveBatch = async (recipeId: number) => {
    const val = parseInt(values[recipeId]);
    if (!val || isNaN(val)) return;
    setSaving(s => ({ ...s, [recipeId]: true }));
    try {
      const res = await fetch(`${BASE}/api/checklists/packing-batch-record`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, recipeId, batchNumber: val }),
      });
      if (!res.ok) throw new Error("Failed to save");
      toast({ title: "Saved", description: "Batch number recorded" });
    } catch {
      toast({ title: "Error", description: "Failed to save batch number", variant: "destructive" });
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

  return (
    <div className="mb-4 space-y-2">
      <p className="text-sm font-semibold text-foreground mb-2">
        Record first pack batch number for each recipe in the fridge
      </p>
      {items.map(item => {
        if (!item.recipeId) return null;
        const val = values[item.recipeId] ?? "";
        const isSaved = item.recordedBatchNumber != null && String(item.recordedBatchNumber) === val;
        return (
          <div key={item.recipeId} className={cn(
            "flex items-center gap-3 p-3 rounded-xl border transition-colors",
            isSaved ? "bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800" : "bg-secondary/20 border-border"
          )}>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{item.recipeName}</p>
              <p className="text-xs text-muted-foreground">
                {item.fridgeQty != null ? `${Math.round(item.fridgeQty)} packs in fridge` : ""}
                {item.suggestedBatchNumber && !isSaved ? ` · Suggested: #${item.suggestedBatchNumber}` : ""}
              </p>
              {isSaved && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Recorded
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs text-muted-foreground">#</span>
              <input
                type="number"
                className="w-20 px-2 py-1.5 text-sm text-center font-mono font-bold border border-border rounded-lg bg-background tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={val}
                onChange={e => setValues(v => ({ ...v, [item.recipeId!]: e.target.value }))}
                onKeyDown={e => { if (e.key === "Enter") saveBatch(item.recipeId!); }}
                placeholder="—"
              />
              <button
                onClick={() => saveBatch(item.recipeId!)}
                disabled={!val || saving[item.recipeId!]}
                className="p-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {saving[item.recipeId!] ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DynamicDataDisplay({ type, data, loading, planId }: { type: string; data: unknown[]; loading: boolean; planId: number }) {
  if (type === "desserts_report") {
    if (loading) {
      return (
        <div className="mb-4 p-3 bg-blue-50/60 dark:bg-blue-950/20 rounded-lg flex items-center gap-2 text-sm text-blue-600">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading dessert report...
        </div>
      );
    }
    const report = (data as any[])[0] as { tag: string; deliveryLabel: string; products: Array<{ title: string; quantity: number; orderCount: number }>; totalQuantity: number; dessertProductCount: number } | undefined;
    if (!report || report.products.length === 0) {
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
        <div className="space-y-1.5">
          {report.products.map((p, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="truncate text-foreground/80">{p.title}</span>
              <div className="flex items-center gap-3 shrink-0 ml-2">
                <span className="text-xs text-muted-foreground">{p.orderCount} order{p.orderCount !== 1 ? "s" : ""}</span>
                <span className="font-bold tabular-nums text-purple-700 dark:text-purple-300 w-8 text-right">{p.quantity}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-2 border-t border-purple-200 dark:border-purple-700 flex items-center justify-between">
          <span className="text-sm font-semibold text-purple-700 dark:text-purple-300">Total</span>
          <span className="text-lg font-bold tabular-nums text-purple-700 dark:text-purple-300">{report.totalQuantity}</span>
        </div>
      </div>
    );
  }

  if (type === "first_pack_batch_numbers") {
    if (loading) {
      return (
        <div className="mb-4 p-3 bg-blue-50/60 dark:bg-blue-950/20 rounded-lg flex items-center gap-2 text-sm text-blue-600">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading recipe batch data...
        </div>
      );
    }
    return <FirstPackBatchNumbers data={data} planId={planId} />;
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
    const mozzData = data[0] as { name?: string; unit?: string; totalQty?: number; bags?: number } | undefined;
    if (!mozzData) return null;
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
          {fmtTotal} {mozzData.name ?? "Mozzarella"} total for today's production
        </p>
      </div>
    );
  }

  return null;
}
