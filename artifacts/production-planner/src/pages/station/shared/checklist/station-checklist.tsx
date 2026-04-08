import { useState, useEffect } from "react";
import {
  CheckCircle2, Circle, ClipboardCheck, Plus, Undo2, Loader2,
  Sun, Sparkles, Moon, ChevronDown, ChevronUp, GripVertical, Trash2, Pencil,
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
  const [addingOneoff, setAddingOneoff] = useState(false);
  const [oneoffTitle, setOneoffTitle] = useState("");
  const [oneoffCategory, setOneoffCategory] = useState<Category>("opening");
  const [completionNotes, setCompletionNotes] = useState("");

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
        <p className="text-sm mt-1">Check back later or ask an admin to set up checklist templates.</p>
        {isAdmin && (
          <button
            onClick={() => setAdminMode(true)}
            className="mt-4 text-sm text-primary font-medium hover:underline"
          >
            Set up checklist templates
          </button>
        )}
        {adminMode && (
          <ChecklistAdminPanel stationType={stationType} onClose={() => { setAdminMode(false); refetch(); }} />
        )}
      </div>
    );
  }

  const { summary } = data;
  const pct = summary.total > 0 ? Math.round((summary.done / summary.total) * 100) : 0;

  const handleComplete = (item: ChecklistItem & { category: Category }) => {
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

  const handleAddOneoff = () => {
    if (!oneoffTitle.trim()) return;
    runOneoff(async (signal) => {
      await guardedFetch(`${BASE}/api/checklists/oneoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId,
          stationType,
          category: oneoffCategory,
          title: oneoffTitle.trim(),
        }),
        signal,
      });
      setOneoffTitle("");
      setAddingOneoff(false);
      toast({ title: "Item added" });
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
            {isAdmin && (
              <button
                onClick={() => setAdminMode(!adminMode)}
                className={cn(
                  "text-xs px-2.5 py-1 rounded-lg font-medium transition-colors",
                  adminMode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
                )}
              >
                {adminMode ? "Done Editing" : "Edit Templates"}
              </button>
            )}
            <button
              onClick={() => setAddingOneoff(!addingOneoff)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Item
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

      {/* Add one-off item form */}
      {addingOneoff && (
        <div className="bg-card border border-border rounded-xl px-5 py-4 space-y-3">
          <p className="text-sm font-semibold">Add One-off Item</p>
          <input
            type="text"
            placeholder="Item title..."
            value={oneoffTitle}
            onChange={e => setOneoffTitle(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <select
              value={oneoffCategory}
              onChange={e => setOneoffCategory(e.target.value as Category)}
              className="px-3 py-2 border border-border rounded-lg text-sm bg-background"
            >
              <option value="opening">Opening</option>
              <option value="cleaning">Cleaning</option>
              <option value="closing">Closing</option>
            </select>
            <button
              onClick={handleAddOneoff}
              disabled={oneoffBusy || !oneoffTitle.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {oneoffBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add"}
            </button>
            <button
              onClick={() => setAddingOneoff(false)}
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
          {/* LEFT — Categorized list */}
          <div className="lg:w-80 xl:w-96 flex-shrink-0">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="max-h-[calc(100vh-320px)] overflow-y-auto">
                {CATEGORY_ORDER.map((cat, ci) => {
                  const items = data.categories[cat];
                  if (!items || items.length === 0) return null;
                  const meta = CATEGORY_META[cat];
                  const Icon = meta.icon;
                  const catDone = items.filter(i => i.completed).length;
                  return (
                    <div key={cat} className={cn(ci > 0 && "border-t border-border")}>
                      <div className={cn("px-4 py-2 flex items-center justify-between", meta.bg)}>
                        <div className="flex items-center gap-2">
                          <Icon className={cn("w-4 h-4", meta.color)} />
                          <p className={cn("text-sm font-bold uppercase tracking-wider", meta.color)}>
                            {meta.label}
                          </p>
                        </div>
                        <span className={cn("text-sm font-medium", meta.color)}>
                          {catDone}/{items.length}
                        </span>
                      </div>
                      {items.map(item => {
                        const ik = itemKey({ ...item, category: cat });
                        const isSelected = ik === selectedItemKey;
                        return (
                          <button
                            key={ik}
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
                              {item.completed ? (
                                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                              ) : (
                                <Circle className="w-5 h-5 text-muted-foreground/40" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className={cn(
                                "text-sm font-medium truncate",
                                isSelected && "font-semibold",
                                item.completed && "line-through text-muted-foreground",
                              )}>
                                {item.title}
                              </p>
                              {item.completed && item.completedBy && (
                                <p className="text-xs text-muted-foreground truncate">
                                  {item.completedBy}
                                </p>
                              )}
                              {item.type === "oneoff" && (
                                <span className="text-xs text-amber-500 font-medium">one-off</span>
                              )}
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
                  selectedItem.completed
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
                    {selectedItem.completed ? (
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
                  />
                )}

                {/* Completion info or action */}
                {selectedItem.completed ? (
                  <div className="mt-4 space-y-3">
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
                    <button
                      onClick={() => handleUndo(selectedItem)}
                      disabled={undoBusy}
                      className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Undo2 className="w-4 h-4" />
                      Undo completion
                    </button>
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
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
                      className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-base font-semibold transition-colors disabled:opacity-50"
                    >
                      {completeBusy ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-5 h-5" />
                      )}
                      Mark Complete
                    </button>
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

function DynamicDataDisplay({ type, data, loading }: { type: string; data: unknown[]; loading: boolean }) {
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

  return null;
}
