import { useState, useEffect } from "react";
import {
  DndContext, closestCenter, type DragEndEvent, PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Plus, Trash2, GripVertical, Loader2, Save, X,
  Sun, Sparkles, Moon, ChevronDown, ArchiveRestore,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useGuardedAction, guardedFetch } from "@/hooks/use-guarded-action";
import { useAuth } from "@/contexts/auth-context";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Category = "opening" | "cleaning" | "closing";

interface Template {
  id: number;
  stationType: string;
  category: string;
  title: string;
  description: string | null;
  schedule: string;
  scheduleDays: string | null;
  scheduleAnchorDate: string | null;
  orderPosition: number;
  dynamicDataType: string | null;
  isActive: boolean;
}

const CATEGORY_META: Record<Category, { label: string; icon: typeof Sun; color: string }> = {
  opening: { label: "Opening", icon: Sun, color: "text-amber-600" },
  cleaning: { label: "Cleaning", icon: Sparkles, color: "text-blue-600" },
  closing: { label: "Closing", icon: Moon, color: "text-indigo-600" },
};

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
// Weekdays default — almost no checks in this kitchen run seven days a
// week, so new templates land on Mon–Fri and the operator opts into
// weekends if they need them.
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];

interface Props {
  stationType: string;
  onClose: () => void;
}

export function ChecklistAdminPanel({ stationType, onClose }: Props) {
  const { state: authState } = useAuth();
  const isAdmin = authState.status === "authenticated" && authState.user.role === "admin";
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showDeactivated, setShowDeactivated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<Category>("opening");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  // Form state
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formSchedule, setFormSchedule] = useState<"daily" | "weekly" | "specific_days" | "periodic">("specific_days");
  // For "periodic" (every 4 weeks — 13 periods a year): the anchor date
  // whose week starts the 4-week cycle. Defaults to today for new tasks.
  const [formAnchorDate, setFormAnchorDate] = useState<string>("");
  const [formDays, setFormDays] = useState<string[]>(WEEKDAYS);
  const [formDynamic, setFormDynamic] = useState<string>("");

  const [runSave, saveBusy] = useGuardedAction();
  const [runDelete, deleteBusy] = useGuardedAction();
  const [runReorder, reorderBusy] = useGuardedAction();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const fetchTemplates = async () => {
    try {
      const res = await fetch(`${BASE}/api/checklists/templates?station=${encodeURIComponent(stationType)}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchTemplates(); }, [stationType]);

  const filtered = templates.filter(t => t.category === activeCategory && t.isActive);
  // Soft-deleted templates for this category — kept so they can be restored
  // (removal only deactivates; history is preserved).
  const deactivated = templates.filter(t => t.category === activeCategory && !t.isActive);

  const resetForm = () => {
    setFormTitle("");
    setFormDescription("");
    setFormSchedule("specific_days");
    setFormDays(WEEKDAYS);
    setFormAnchorDate(new Date().toISOString().slice(0, 10));
    setFormDynamic("");
    setEditingId(null);
    setAdding(false);
  };

  const openEditForm = (t: Template) => {
    setFormTitle(t.title);
    setFormDescription(t.description ?? "");
    setFormSchedule(t.schedule as "daily" | "weekly" | "specific_days" | "periodic");
    setFormDays(t.scheduleDays ? JSON.parse(t.scheduleDays) : ["monday"]);
    setFormAnchorDate(t.scheduleAnchorDate ?? new Date().toISOString().slice(0, 10));
    setFormDynamic(t.dynamicDataType ?? "");
    setEditingId(t.id);
    setAdding(false);
  };

  const openAddForm = () => {
    resetForm();
    setAdding(true);
  };

  const handleSave = () => {
    if (!formTitle.trim()) return;
    runSave(async (signal) => {
      const body: Record<string, unknown> = {
        title: formTitle.trim(),
        description: formDescription.trim() || null,
        schedule: formSchedule,
        scheduleDays: formSchedule !== "daily" ? formDays : null,
        scheduleAnchorDate: formSchedule === "periodic" ? (formAnchorDate || null) : null,
        dynamicDataType: formDynamic || null,
      };

      if (adding) {
        body.stationType = stationType;
        body.category = activeCategory;
        body.orderPosition = filtered.length;
        await guardedFetch(`${BASE}/api/checklists/templates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal,
        });
        toast({ title: "Template created" });
      } else if (editingId) {
        await guardedFetch(`${BASE}/api/checklists/templates/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal,
        });
        toast({ title: "Template updated" });
      }
      resetForm();
      fetchTemplates();
    });
  };

  const handleDelete = (id: number) => {
    const t = templates.find(x => x.id === id);
    // Soft delete — deactivates only; history is kept and it's restorable below.
    if (!window.confirm(`Remove "${t?.title ?? "this task"}" from this checklist?\n\nIts past records are kept and it can be restored from the Removed list.`)) return;
    runDelete(async (signal) => {
      await guardedFetch(`${BASE}/api/checklists/templates/${id}`, { method: "DELETE", signal });
      toast({ title: "Task removed", description: "Restore it anytime from the Removed list." });
      if (editingId === id) resetForm();
      fetchTemplates();
    });
  };

  const handleRestore = (id: number) => {
    runDelete(async (signal) => {
      await guardedFetch(`${BASE}/api/checklists/templates/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
        signal,
      });
      toast({ title: "Task restored" });
      fetchTemplates();
    });
  };

  // Admin-only: irreversible — removes the template AND its completion history.
  const handlePermanentDelete = (id: number) => {
    const t = templates.find(x => x.id === id);
    if (!window.confirm(`Permanently delete "${t?.title ?? "this task"}" and ALL its past completion records? This CANNOT be undone.`)) return;
    runDelete(async (signal) => {
      await guardedFetch(`${BASE}/api/checklists/templates/${id}/permanent`, { method: "DELETE", signal });
      toast({ title: "Template permanently deleted" });
      fetchTemplates();
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = filtered.findIndex(t => t.id === active.id);
    const newIndex = filtered.findIndex(t => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(filtered, oldIndex, newIndex);
    // Optimistically update
    const newTemplates = templates.map(t => {
      const idx = reordered.findIndex(r => r.id === t.id);
      return idx >= 0 ? { ...t, orderPosition: idx } : t;
    });
    setTemplates(newTemplates);

    runReorder(async (signal) => {
      await guardedFetch(`${BASE}/api/checklists/templates/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order: reordered.map((t, i) => ({ id: t.id, orderPosition: i })),
        }),
        signal,
      });
    });
  };

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading templates...
      </div>
    );
  }

  return (
    <div className="bg-card border-2 border-primary/30 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 bg-primary/5 border-b border-border flex items-center justify-between">
        <h3 className="font-semibold text-sm">Manage Checklist Templates</h3>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-secondary/60 text-muted-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Category tabs */}
      <div className="flex border-b border-border">
        {(["opening", "cleaning", "closing"] as const).map(cat => {
          const meta = CATEGORY_META[cat];
          const Icon = meta.icon;
          const count = templates.filter(t => t.category === cat && t.isActive).length;
          return (
            <button
              key={cat}
              onClick={() => { setActiveCategory(cat); resetForm(); }}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors",
                activeCategory === cat
                  ? "bg-secondary/50 border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className={cn("w-4 h-4", meta.color)} />
              {meta.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Template list with drag-and-drop */}
      <div className="p-4 space-y-2">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={filtered.map(t => t.id)} strategy={verticalListSortingStrategy}>
            {filtered.map(t => (
              <SortableTemplateRow
                key={t.id}
                template={t}
                isEditing={editingId === t.id}
                onEdit={() => openEditForm(t)}
                onDelete={() => handleDelete(t.id)}
                deleteBusy={deleteBusy}
              />
            ))}
          </SortableContext>
        </DndContext>

        {filtered.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No {activeCategory} check templates yet. Add one below.
          </p>
        )}

        {/* Removed (soft-deleted) templates — restorable by anyone; permanent
            deletion is admin-only. */}
        {deactivated.length > 0 && (
          <div className="border border-dashed border-border rounded-lg">
            <button
              onClick={() => setShowDeactivated(!showDeactivated)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <span>Removed ({deactivated.length})</span>
              <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", showDeactivated && "rotate-180")} />
            </button>
            {showDeactivated && (
              <div className="px-3 pb-2 space-y-1.5">
                {deactivated.map(t => (
                  <div key={t.id} className="flex items-center gap-2 px-3 py-2 border border-border/60 rounded-lg bg-secondary/20">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate text-muted-foreground line-through">{t.title}</p>
                    </div>
                    <button
                      onClick={() => handleRestore(t.id)}
                      disabled={deleteBusy}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                    >
                      <ArchiveRestore className="w-3.5 h-3.5" />
                      Restore
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() => handlePermanentDelete(t.id)}
                        disabled={deleteBusy}
                        title="Permanently delete (admin)"
                        className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Add button */}
        {!adding && editingId === null && (
          <button
            onClick={openAddForm}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-dashed border-border rounded-lg text-sm text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add {CATEGORY_META[activeCategory].label} Check
          </button>
        )}

        {/* Add/Edit form */}
        {(adding || editingId !== null) && (
          <div className="border border-border rounded-lg p-4 space-y-3 bg-secondary/10">
            <p className="text-sm font-semibold">{adding ? "New Template" : "Edit Template"}</p>

            <input
              type="text"
              placeholder="Title *"
              value={formTitle}
              onChange={e => setFormTitle(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background"
              autoFocus
            />

            <textarea
              placeholder="Description (optional)"
              value={formDescription}
              onChange={e => setFormDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background resize-none"
            />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Schedule</label>
                <select
                  value={formSchedule}
                  onChange={e => setFormSchedule(e.target.value as "daily" | "weekly" | "specific_days" | "periodic")}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="specific_days">Specific Days</option>
                  <option value="periodic">Every 4 Weeks (periodic)</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Dynamic Data</label>
                <select
                  value={formDynamic}
                  onChange={e => setFormDynamic(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background"
                >
                  <option value="">None</option>
                  <option value="temperature_records">Temperature Records</option>
                  <option value="oven_events">Oven Events</option>
                  <option value="mozzarella_load">Mozzarella Load</option>
                  <option value="desserts_report">Desserts Report</option>
                  <option value="first_pack_batch_numbers">First Pack Batch Numbers</option>
                  <option value="last_pack_batch_numbers">Last Pack Batch Numbers</option>
                  <option value="fridge_freezer_temps_opening">Fridge/Freezer Temps (Opening)</option>
                  <option value="fridge_freezer_temps_closing">Fridge/Freezer Temps (Closing)</option>
                </select>
              </div>
            </div>

            {formSchedule !== "daily" && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Days</label>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setFormDays(["monday", "tuesday", "wednesday", "thursday", "friday"])}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-xs font-medium transition-colors",
                      formDays.length === 5 &&
                        ["monday", "tuesday", "wednesday", "thursday", "friday"].every(d => formDays.includes(d))
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Weekdays
                  </button>
                  {DAYS.map(day => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => {
                        setFormDays(prev =>
                          prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
                        );
                      }}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-xs font-medium transition-colors capitalize",
                        formDays.includes(day)
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {day.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {formSchedule === "periodic" && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  First due week (repeats every 4 weeks — 13 periods a year)
                </label>
                <input
                  type="date"
                  value={formAnchorDate}
                  onChange={e => setFormAnchorDate(e.target.value)}
                  className="px-3 py-2 border border-border rounded-lg text-sm bg-background"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  The task is due on the selected day(s) in this date's week, then every 4th week after.
                  Stagger different periodic tasks by picking different weeks.
                </p>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleSave}
                disabled={saveBusy || !formTitle.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {saveBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {adding ? "Create" : "Save"}
              </button>
              <button
                onClick={resetForm}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sortable Row ────────────────────────────────────────────────────

function SortableTemplateRow({
  template,
  isEditing,
  onEdit,
  onDelete,
  deleteBusy,
}: {
  template: Template;
  isEditing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  deleteBusy: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: template.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 px-3 py-2.5 border border-border rounded-lg bg-background transition-opacity",
        isDragging && "opacity-50",
        isEditing && "ring-2 ring-primary/30",
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="flex-shrink-0 cursor-grab active:cursor-grabbing p-1 text-muted-foreground/50 hover:text-muted-foreground"
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{template.title}</p>
        <p className="text-xs text-muted-foreground">
          {template.schedule === "daily" ? "Daily" :
            template.schedule === "weekly" ? "Weekly" :
            template.schedule === "periodic" ? "Every 4 weeks" : "Specific days"}
          {template.dynamicDataType && ` · ${template.dynamicDataType.replace(/_/g, " ")}`}
        </p>
      </div>
      <button
        onClick={onEdit}
        className="flex-shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>
      <button
        onClick={onDelete}
        disabled={deleteBusy}
        className="flex-shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
