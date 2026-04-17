import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { useRefreshSpin } from "@/hooks/use-refresh-spin";
import { Thermometer, Snowflake, Package, RefreshCw, ChevronRight, ChevronDown, Settings2, Plus, Pencil, Trash2, X, Save, Loader2, Lock, LockOpen, Check, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProcessFulfilledTodayButton } from "@/components/process-fulfilled-today-button";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface StockItem {
  stockEntryIds: number[];
  id: number;
  name: string;
  color: string | null;
  qty: number;
  unit: string;
  type: string;
  recipeId: number | null;
  ingredientId: number | null;
  orderPosition: number;
}

interface StockLocation {
  key: string;
  label: string;
  zone: string;
  icon: string;
  dbId: number | null;
  totalPacks: number;
  items: StockItem[];
}

interface StockControlData {
  productionFridgeTotal: number;
  locations: StockLocation[];
}

interface StorageLocation {
  id: number;
  name: string;
  zone: string;
  isSystem: boolean;
  createdAt: string;
  racks: { id: number; locationId: number; label: string }[];
}

interface Recipe {
  id: number;
  name: string;
  color?: string | null;
}

interface Ingredient {
  id: number;
  name: string;
}

async function fetchStorageLocations(): Promise<StorageLocation[]> {
  const res = await fetch(`${BASE}/api/storage-locations`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch storage locations");
  return res.json();
}

async function createStorageLocation(data: { name: string; zone: string }): Promise<StorageLocation> {
  const res = await fetch(`${BASE}/api/storage-locations`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to create location");
  return json;
}

async function updateStorageLocation(id: number, data: { name: string; zone: string }): Promise<StorageLocation> {
  const res = await fetch(`${BASE}/api/storage-locations/${id}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to update location");
  return json;
}

async function deleteStorageLocation(id: number): Promise<void> {
  const res = await fetch(`${BASE}/api/storage-locations/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error((json as { error?: string }).error ?? "Failed to delete location");
  }
}

async function fetchStockControl(): Promise<StockControlData> {
  const res = await fetch(`${BASE}/api/stock-control`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch stock control data");
  return res.json();
}

async function fetchRecipes(): Promise<Recipe[]> {
  const res = await fetch(`${BASE}/api/recipes`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch recipes");
  return res.json();
}

async function fetchIngredients(): Promise<Ingredient[]> {
  const res = await fetch(`${BASE}/api/ingredients`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch ingredients");
  return res.json();
}

async function updateStockEntry(id: number, data: {
  recipeId?: number | null;
  ingredientId?: number | null;
  itemType: string;
  quantity: number;
  unit: string;
  location: string;
}): Promise<void> {
  const res = await fetch(`${BASE}/api/stock-entries/${id}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error((json as { error?: string }).error ?? "Failed to update stock entry");
  }
}

async function deleteStockEntry(id: number): Promise<void> {
  const res = await fetch(`${BASE}/api/stock-entries/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error((json as { error?: string }).error ?? "Failed to delete stock entry");
  }
}

async function createStockEntry(data: {
  recipeId?: number | null;
  ingredientId?: number | null;
  itemType: string;
  quantity: number;
  unit: string;
  location: string;
}): Promise<void> {
  const res = await fetch(`${BASE}/api/stock-entries`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error((json as { error?: string }).error ?? "Failed to create stock entry");
  }
}

interface FridgeStockBatch {
  id: number;
  batchNumber: number;
  packSize: number;
  quantity: number;
  useByDate: string;
  createdAt: string;
}

async function fetchFridgeBatches(recipeId: number): Promise<FridgeStockBatch[]> {
  const res = await fetch(`${BASE}/api/stock/fridge-batches/${recipeId}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch batch data");
  return res.json();
}

function formatBatchNumber(bn: number): string {
  const year = 2000 + Math.floor(bn / 1000);
  const dayOfYear = bn % 1000;
  const d = new Date(year, 0, dayOfYear);
  return `${bn} (${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })})`;
}

function useByDateStatus(dateStr: string): "ok" | "warning" | "expired" {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const useBy = new Date(dateStr + "T00:00:00");
  const diffDays = Math.floor((useBy.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "expired";
  if (diffDays <= 2) return "warning";
  return "ok";
}

function ZoneIcon({ zone, className }: { zone: string; className?: string }) {
  if (zone === "freezer") return <Snowflake className={className} />;
  if (zone === "fridge") return <Thermometer className={className} />;
  return <Package className={className} />;
}

function zoneColors(zone: string) {
  if (zone === "freezer")
    return { icon: "text-blue-500", bg: "bg-blue-500/10", ring: "ring-blue-400/60", activeBg: "bg-blue-500/15" };
  if (zone === "fridge")
    return { icon: "text-cyan-500", bg: "bg-cyan-500/10", ring: "ring-cyan-400/60", activeBg: "bg-cyan-500/15" };
  return { icon: "text-amber-500", bg: "bg-amber-500/10", ring: "ring-amber-400/60", activeBg: "bg-amber-500/15" };
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-20 text-muted-foreground gap-3">
      <Package className="w-12 h-12 opacity-15" />
      <p className="text-sm">No stock recorded for {label}</p>
    </div>
  );
}

interface FocusPanelProps {
  location: StockLocation;
  onRefresh: () => void;
}

function FocusPanel({ location, onRefresh }: FocusPanelProps) {
  const queryClient = useQueryClient();
  const colors = zoneColors(location.zone);
  const totalQty = location.items.reduce((s, i) => s + i.qty, 0);
  const maxQty = Math.max(1, ...location.items.map(i => i.qty));

  const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editUnit, setEditUnit] = useState("");
  const [deletingEntryId, setDeletingEntryId] = useState<number | null>(null);
  const [addingStock, setAddingStock] = useState(false);
  const [addItemType, setAddItemType] = useState<"recipe" | "ingredient">("recipe");
  const [addSelectedId, setAddSelectedId] = useState<number | null>(null);
  const [addQty, setAddQty] = useState("");
  const [addUnit, setAddUnit] = useState("packs");
  const [stockError, setStockError] = useState<string | null>(null);

  // Batch detail expansion (production fridge recipes only)
  const [expandedRecipeId, setExpandedRecipeId] = useState<number | null>(null);
  const isFridgeLocation = location.key === "production_fridge";

  const { data: batchData, isLoading: batchLoading } = useQuery<FridgeStockBatch[]>({
    queryKey: ["fridge-batches", expandedRecipeId],
    queryFn: () => fetchFridgeBatches(expandedRecipeId!),
    enabled: isFridgeLocation && expandedRecipeId !== null,
    staleTime: 30_000,
  });

  // Bulk edit mode
  const [bulkEdit, setBulkEdit] = useState(false);
  const [bulkValues, setBulkValues] = useState<Record<number, string>>({});
  const [bulkSaving, setBulkSaving] = useState(false);

  const enterBulkEdit = () => {
    const initial: Record<number, string> = {};
    for (const item of location.items) {
      initial[item.stockEntryIds[0]] = String(item.qty);
    }
    setBulkValues(initial);
    setBulkEdit(true);
    setEditingEntryId(null);
    setDeletingEntryId(null);
    setAddingStock(false);
    setStockError(null);
  };

  const exitBulkEdit = () => {
    setBulkEdit(false);
    setBulkValues({});
    setStockError(null);
  };

  const saveAll = async () => {
    setBulkSaving(true);
    setStockError(null);
    try {
      const ops: Promise<void>[] = [];
      for (const item of location.items) {
        const primaryId = item.stockEntryIds[0];
        const raw = bulkValues[primaryId];
        const parsed = raw !== undefined ? parseFloat(raw) : NaN;
        const qtyChanged = !isNaN(parsed) && parsed >= 0 && parsed !== item.qty;
        const hasDuplicates = item.stockEntryIds.length > 1;

        if (qtyChanged) {
          ops.push(
            updateStockEntry(primaryId, {
              recipeId: item.recipeId,
              ingredientId: item.ingredientId,
              itemType: item.type,
              quantity: parsed,
              unit: item.unit,
              location: location.key,
            })
          );
        }

        if (hasDuplicates) {
          if (!qtyChanged) {
            ops.push(
              updateStockEntry(primaryId, {
                recipeId: item.recipeId,
                ingredientId: item.ingredientId,
                itemType: item.type,
                quantity: item.qty,
                unit: item.unit,
                location: location.key,
              })
            );
          }
          for (const extraId of item.stockEntryIds.slice(1)) {
            ops.push(deleteStockEntry(extraId));
          }
        }
      }
      await Promise.all(ops);
      invalidate();
      exitBulkEdit();
    } catch (err: unknown) {
      setStockError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkSaving(false);
    }
  };

  // Reset state when location changes
  useEffect(() => {
    setEditingEntryId(null);
    setDeletingEntryId(null);
    setAddingStock(false);
    setBulkEdit(false);
    setBulkValues({});
    setStockError(null);
    setExpandedRecipeId(null);
  }, [location.key]);

  const { data: recipes } = useQuery<Recipe[]>({
    queryKey: ["recipes"],
    queryFn: fetchRecipes,
    staleTime: 5 * 60 * 1000,
  });

  const { data: ingredients } = useQuery<Ingredient[]>({
    queryKey: ["ingredients"],
    queryFn: fetchIngredients,
    staleTime: 5 * 60 * 1000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["stock-control"] });
    onRefresh();
  };

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: number; recipeId?: number | null; ingredientId?: number | null; itemType: string; quantity: number; unit: string; location: string }) =>
      updateStockEntry(id, data),
    onSuccess: () => { invalidate(); setEditingEntryId(null); setStockError(null); },
    onError: (err: unknown) => setStockError(err instanceof Error ? err.message : String(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteStockEntry,
    onSuccess: () => { invalidate(); setDeletingEntryId(null); setStockError(null); },
    onError: (err: unknown) => setStockError(err instanceof Error ? err.message : String(err)),
  });

  const createMutation = useMutation({
    mutationFn: createStockEntry,
    onSuccess: () => {
      invalidate();
      setAddingStock(false);
      setAddSelectedId(null);
      setAddQty("");
      setAddUnit("packs");
      setStockError(null);
    },
    onError: (err: unknown) => setStockError(err instanceof Error ? err.message : String(err)),
  });

  const startEdit = (item: StockItem) => {
    setEditingEntryId(item.stockEntryIds[0]);
    setEditQty(String(item.qty));
    setEditUnit(item.unit);
    setDeletingEntryId(null);
    setAddingStock(false);
    setStockError(null);
  };

  const saveEdit = (item: StockItem) => {
    const qty = parseFloat(editQty);
    if (isNaN(qty) || qty < 0) { setStockError("Please enter a valid quantity"); return; }
    for (const extraId of item.stockEntryIds.slice(1)) {
      deleteMutation.mutate(extraId);
    }
    updateMutation.mutate({
      id: item.stockEntryIds[0],
      recipeId: item.recipeId,
      ingredientId: item.ingredientId,
      itemType: item.type,
      quantity: qty,
      unit: editUnit.trim() || item.unit,
      location: location.key,
    });
  };

  const handleAddStock = () => {
    const qty = parseFloat(addQty);
    if (isNaN(qty) || qty <= 0) { setStockError("Please enter a valid quantity"); return; }
    if (!addSelectedId) { setStockError("Please select an item"); return; }
    createMutation.mutate({
      recipeId: addItemType === "recipe" ? addSelectedId : null,
      ingredientId: addItemType === "ingredient" ? addSelectedId : null,
      itemType: addItemType,
      quantity: qty,
      unit: addUnit.trim() || "packs",
      location: location.key,
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-5 border-b border-border">
        <div className={cn("p-3 rounded-xl", colors.bg)}>
          <ZoneIcon zone={location.zone} className={cn("w-5 h-5", colors.icon)} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-display font-bold text-xl leading-tight">{location.label}</h2>
          <p className="text-xs text-muted-foreground capitalize mt-0.5">{location.zone} storage</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right shrink-0">
            <p className="text-3xl font-display font-bold tabular-nums leading-none">
              {Math.round(
                bulkEdit
                  ? location.items.reduce((s, i) => {
                      const v = parseFloat(bulkValues[i.stockEntryIds[0]] ?? String(i.qty));
                      return s + (isNaN(v) ? i.qty : v);
                    }, 0)
                  : totalQty
              ).toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {location.items.length} {location.items.length === 1 ? "item" : "items"}
            </p>
          </div>

          {bulkEdit ? (
            <div className="flex items-center gap-2">
              <button
                onClick={exitBulkEdit}
                disabled={bulkSaving}
                className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
              >
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
              <button
                onClick={saveAll}
                disabled={bulkSaving}
                className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 font-medium"
              >
                {bulkSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save All
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {isFridgeLocation && (
                <ProcessFulfilledTodayButton size="sm" />
              )}
              {location.items.length > 0 && (
                <button
                  onClick={enterBulkEdit}
                  className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  title="Edit all quantities at once"
                >
                  <LockOpen className="w-3.5 h-3.5" />
                  Unlock
                </button>
              )}
              <button
                onClick={() => { setAddingStock(a => !a); setEditingEntryId(null); setDeletingEntryId(null); setStockError(null); }}
                className={cn(
                  "flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border transition-colors",
                  addingStock
                    ? "bg-primary/10 text-primary border-primary/30"
                    : "text-muted-foreground hover:text-foreground border-border hover:bg-secondary"
                )}
                title="Add stock entry"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Stock
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Add Stock Form */}
      {addingStock && (
        <div className="px-6 py-4 border-b border-border bg-secondary/20 space-y-3">
          <p className="text-xs font-semibold text-primary">Add Stock Entry</p>
          <div className="flex gap-2">
            <button
              onClick={() => { setAddItemType("recipe"); setAddSelectedId(null); }}
              className={cn("px-3 py-1.5 text-xs rounded-lg border transition-colors", addItemType === "recipe" ? "bg-primary text-primary-foreground border-transparent" : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary")}
            >Recipe</button>
            <button
              onClick={() => { setAddItemType("ingredient"); setAddSelectedId(null); }}
              className={cn("px-3 py-1.5 text-xs rounded-lg border transition-colors", addItemType === "ingredient" ? "bg-primary text-primary-foreground border-transparent" : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary")}
            >Ingredient</button>
          </div>
          <select
            className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
            value={addSelectedId ?? ""}
            onChange={e => setAddSelectedId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Select {addItemType}…</option>
            {addItemType === "recipe"
              ? (recipes ?? []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)
              : (ingredients ?? []).map(i => <option key={i.id} value={i.id}>{i.name}</option>)
            }
          </select>
          <div className="flex gap-2">
            <input
              type="number"
              min="0"
              step="any"
              placeholder="Quantity"
              className="flex-1 px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
              value={addQty}
              onChange={e => setAddQty(e.target.value)}
            />
            <input
              type="text"
              placeholder="Unit"
              className="w-24 px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
              value={addUnit}
              onChange={e => setAddUnit(e.target.value)}
            />
          </div>
          {stockError && <p className="text-xs text-destructive">{stockError}</p>}
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setAddingStock(false); setStockError(null); }}
              className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg"
            >Cancel</button>
            <button
              disabled={!addSelectedId || !addQty || createMutation.isPending}
              onClick={handleAddStock}
              className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
            >
              {createMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              Save
            </button>
          </div>
        </div>
      )}

      {/* Bulk edit banner */}
      {bulkEdit && (
        <div className="px-6 py-2.5 border-b border-primary/20 bg-primary/5 flex items-center justify-between">
          <p className="text-xs text-primary font-medium flex items-center gap-1.5">
            <LockOpen className="w-3.5 h-3.5" />
            Editing mode — type new quantities, then click Save All
          </p>
          {stockError && <p className="text-xs text-destructive">{stockError}</p>}
        </div>
      )}

      {/* Item list */}
      <div className="flex-1 overflow-y-auto">
        {location.items.length === 0 ? (
          <EmptyState label={location.label} />
        ) : (
          <div className="divide-y divide-border/40">
            {location.items.map((item, idx) => {
              const barWidth = Math.max(3, (item.qty / maxQty) * 100);
              const pct = totalQty > 0 ? Math.round((item.qty / totalQty) * 100) : 0;
              const primaryId = item.stockEntryIds[0];
              const isEditing = editingEntryId === primaryId;
              const isDeleting = deletingEntryId === primaryId;

              if (isDeleting) {
                return (
                  <div key={primaryId} className="px-6 py-4 bg-destructive/5">
                    <p className="text-xs font-medium text-destructive mb-1">Remove "{item.name}" from this location?</p>
                    <p className="text-xs text-muted-foreground mb-3">This will delete the stock entry.</p>
                    {stockError && <p className="text-xs text-destructive mb-2">{stockError}</p>}
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setDeletingEntryId(null); setStockError(null); }}
                        className="flex-1 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg"
                      >Cancel</button>
                      <button
                        disabled={deleteMutation.isPending}
                        onClick={() => { for (const eid of item.stockEntryIds) { deleteMutation.mutate(eid); } }}
                        className="flex-1 px-3 py-1.5 text-xs bg-destructive text-destructive-foreground rounded-lg font-medium hover:bg-destructive/90 disabled:opacity-50 flex items-center justify-center gap-1"
                      >
                        {deleteMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                        Delete
                      </button>
                    </div>
                  </div>
                );
              }

              if (isEditing) {
                return (
                  <div key={primaryId} className="px-6 py-4 bg-secondary/20">
                    <div className="flex items-center gap-2 mb-3">
                      <span
                        className="flex-1 font-medium text-sm truncate"
                        style={item.color ? { color: item.color } : undefined}
                      >
                        {item.name}
                      </span>
                    </div>
                    <div className="flex gap-2 mb-2">
                      <input
                        autoFocus
                        type="number"
                        min="0"
                        step="any"
                        className="flex-1 px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                        value={editQty}
                        onChange={e => setEditQty(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") saveEdit(item); if (e.key === "Escape") setEditingEntryId(null); }}
                      />
                      <input
                        type="text"
                        className="w-24 px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                        value={editUnit}
                        onChange={e => setEditUnit(e.target.value)}
                        placeholder="Unit"
                      />
                    </div>
                    {stockError && <p className="text-xs text-destructive mb-2">{stockError}</p>}
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => { setEditingEntryId(null); setStockError(null); }}
                        className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg flex items-center gap-1"
                      >
                        <X className="w-3 h-3" /> Cancel
                      </button>
                      <button
                        disabled={updateMutation.isPending}
                        onClick={() => saveEdit(item)}
                        className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
                      >
                        {updateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                        Save
                      </button>
                    </div>
                  </div>
                );
              }

              // ── Bulk-edit row ──────────────────────────────────────────
              if (bulkEdit) {
                const bulkVal = bulkValues[primaryId] ?? String(item.qty);
                const parsed = parseFloat(bulkVal);
                const changed = !isNaN(parsed) && parsed !== item.qty;
                return (
                  <div key={primaryId} className={cn("px-6 py-3 transition-colors", changed && "bg-primary/5")}>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold text-muted-foreground w-5 tabular-nums shrink-0">{idx + 1}</span>
                      <span
                        className="flex-1 font-medium text-sm truncate"
                        style={item.color ? { color: item.color } : undefined}
                      >
                        {item.name}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={bulkVal}
                          onChange={e => setBulkValues(v => ({ ...v, [primaryId]: e.target.value }))}
                          onFocus={e => e.target.select()}
                          className={cn(
                            "w-20 px-2 py-1 text-sm font-bold tabular-nums text-right bg-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30",
                            changed ? "border-primary text-primary" : "border-border text-foreground"
                          )}
                        />
                        <span className="text-xs text-muted-foreground">{item.unit}</span>
                      </div>
                    </div>
                  </div>
                );
              }

              // ── Normal row ─────────────────────────────────────────────
              const canExpand = isFridgeLocation && item.type === "recipe" && item.recipeId !== null;
              const isExpanded = canExpand && expandedRecipeId === item.recipeId;

              return (
                <div key={primaryId}>
                  <div
                    className={cn("px-6 py-4 hover:bg-secondary/30 transition-colors group", canExpand && "cursor-pointer")}
                    onClick={canExpand ? () => setExpandedRecipeId(isExpanded ? null : item.recipeId) : undefined}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      {canExpand ? (
                        <span className="w-5 shrink-0 flex items-center justify-center">
                          {isExpanded
                            ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                            : <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          }
                        </span>
                      ) : (
                        <span className="text-xs font-semibold text-muted-foreground w-5 tabular-nums shrink-0">
                          {idx + 1}
                        </span>
                      )}
                      <span
                        className="flex-1 font-medium text-sm truncate"
                        style={item.color ? { color: item.color } : undefined}
                      >
                        {item.name}
                      </span>
                      <span className="text-sm font-bold tabular-nums shrink-0">
                        {Math.round(item.qty).toLocaleString()}
                        <span className="text-xs font-normal text-muted-foreground ml-1">{item.unit}</span>
                      </span>
                      <span className="text-xs text-muted-foreground w-9 text-right shrink-0">{pct}%</span>
                      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => startEdit(item)}
                          className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary/60 rounded-lg transition-colors"
                          title="Edit quantity"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => { setDeletingEntryId(primaryId); setEditingEntryId(null); setAddingStock(false); setStockError(null); }}
                          className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                          title="Remove stock entry"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="ml-8 h-2 bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${barWidth}%`,
                          background: item.color ?? "hsl(var(--primary))",
                        }}
                      />
                    </div>
                  </div>

                  {/* Batch breakdown sub-rows */}
                  {isExpanded && (
                    <div className="bg-secondary/10 border-t border-border/30">
                      {batchLoading ? (
                        <div className="px-6 py-3 flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading batch data…
                        </div>
                      ) : !batchData || batchData.length === 0 ? (
                        <div className="px-6 py-3 text-xs text-muted-foreground italic">
                          No batch data available — tracking starts from next wrapping
                        </div>
                      ) : (
                        <div className="divide-y divide-border/20">
                          <div className="px-6 py-2 flex items-center gap-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                            <span className="w-5 shrink-0" />
                            <span className="flex-1">Batch</span>
                            <span className="w-16 text-right">Qty</span>
                            <span className="w-24 text-right">Use by</span>
                            <span className="w-5 shrink-0" />
                          </div>
                          {batchData.map((batch) => {
                            const status = useByDateStatus(batch.useByDate);
                            const ubDate = new Date(batch.useByDate + "T00:00:00");
                            return (
                              <div key={batch.id} className="px-6 py-2.5 flex items-center gap-3">
                                <span className="w-5 shrink-0" />
                                <span className="flex-1 text-xs font-medium text-foreground/80">
                                  {formatBatchNumber(batch.batchNumber)}
                                  {batch.packSize === 8 && <span className="ml-1.5 text-[10px] text-muted-foreground">(8-pack)</span>}
                                </span>
                                <span className="w-16 text-right text-xs font-bold tabular-nums">
                                  {batch.quantity}
                                </span>
                                <span className={cn(
                                  "w-24 text-right text-xs tabular-nums font-medium",
                                  status === "expired" && "text-red-500",
                                  status === "warning" && "text-amber-500",
                                  status === "ok" && "text-muted-foreground",
                                )}>
                                  {ubDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                                </span>
                                <span className="w-5 shrink-0 flex items-center justify-center">
                                  {status === "expired" && <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
                                  {status === "warning" && <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const ZONE_OPTIONS = [
  { value: "fridge", label: "Fridge" },
  { value: "freezer", label: "Freezer" },
  { value: "ambient", label: "Ambient" },
];

export default function StockControl() {
  const stockRefresh = useRefreshSpin();
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["stock-control"],
    queryFn: fetchStockControl,
    staleTime: 2 * 60 * 1000,
  });

  const [selectedKey, setSelectedKey] = useState<string>("production_fridge");
  const [managing, setManaging] = useState(false);
  const [addingLoc, setAddingLoc] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", zone: "fridge" });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: "", zone: "fridge" });
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["storage-locations"] });
    queryClient.invalidateQueries({ queryKey: ["stock-control"] });
  };

  const createMutation = useMutation({
    mutationFn: createStorageLocation,
    onSuccess: () => { invalidate(); setAddingLoc(false); setAddForm({ name: "", zone: "fridge" }); setMutationError(null); },
    onError: (err: unknown) => setMutationError(err instanceof Error ? err.message : String(err)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: number; name: string; zone: string }) => updateStorageLocation(id, data),
    onSuccess: () => { invalidate(); setEditingId(null); setMutationError(null); },
    onError: (err: unknown) => setMutationError(err instanceof Error ? err.message : String(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteStorageLocation,
    onSuccess: () => { invalidate(); setDeleteId(null); setMutationError(null); },
    onError: (err: unknown) => setMutationError(err instanceof Error ? err.message : String(err)),
  });

  // When data loads, ensure selected key is valid; keep production_fridge as default
  useEffect(() => {
    if (!data) return;
    const keys = data.locations.map(l => l.key);
    if (!keys.includes(selectedKey)) {
      setSelectedKey(keys[0] ?? "production_fridge");
    }
  }, [data]);

  const selectedLocation = data?.locations.find(l => l.key === selectedKey) ?? null;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] -mt-0">
      <div className="px-6 pt-6 pb-0 flex-shrink-0">
        <PageHeader
          title="Stock Control"
          description="Current stock levels across all storage locations"
          action={
            <button
              onClick={() => { stockRefresh.triggerSpin(); refetch(); }}
              disabled={isFetching}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-2 hover:bg-secondary transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", (isFetching || stockRefresh.spinning) && "animate-spin")} />
              Refresh
            </button>
          }
        />
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <RefreshCw className="w-6 h-6 animate-spin mr-2" />
          <span className="text-sm">Loading stock levels…</span>
        </div>
      ) : error ? (
        <div className="m-6 glass-panel rounded-2xl p-8 text-center text-destructive text-sm">
          Failed to load stock data. Please refresh and try again.
        </div>
      ) : (
        <div className="flex flex-1 gap-4 px-6 pb-6 pt-4 overflow-hidden min-h-0">

          {/* ── LEFT — location list ─────────────────────────────── */}
          <div className="w-64 xl:w-72 flex-shrink-0 glass-panel rounded-2xl overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Locations</p>
              <div className="flex items-center gap-1">
                {managing && (
                  <button
                    onClick={() => { setAddingLoc(true); setEditingId(null); setDeleteId(null); setMutationError(null); }}
                    className="p-1.5 text-primary hover:bg-primary/10 rounded-lg transition-colors"
                    title="Add location"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => { setManaging(m => !m); setAddingLoc(false); setEditingId(null); setDeleteId(null); setMutationError(null); }}
                  className={cn("p-1.5 rounded-lg transition-colors", managing ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50")}
                  title={managing ? "Done managing" : "Manage locations"}
                >
                  <Settings2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <nav className="flex-1 overflow-y-auto py-1.5">
              {/* Add location form */}
              {managing && addingLoc && (
                <div className="px-3 py-3 border-b border-border/60 space-y-2">
                  <p className="text-xs font-semibold text-primary">New Location</p>
                  <input
                    autoFocus
                    className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="Location name"
                    value={addForm.name}
                    onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                    onKeyDown={e => { if (e.key === "Escape") { setAddingLoc(false); } }}
                  />
                  <select
                    className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none"
                    value={addForm.zone}
                    onChange={e => setAddForm(f => ({ ...f, zone: e.target.value }))}
                  >
                    {ZONE_OPTIONS.map(z => <option key={z.value} value={z.value}>{z.label}</option>)}
                  </select>
                  {mutationError && <p className="text-xs text-destructive">{mutationError}</p>}
                  <div className="flex gap-1.5 justify-end">
                    <button onClick={() => { setAddingLoc(false); setMutationError(null); }} className="px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg">Cancel</button>
                    <button
                      disabled={!addForm.name.trim() || createMutation.isPending}
                      onClick={() => createMutation.mutate(addForm)}
                      className="px-2.5 py-1 text-xs bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
                    >
                      {createMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      Save
                    </button>
                  </div>
                </div>
              )}

              {data?.locations.map((loc) => {
                const colors = zoneColors(loc.zone);
                const qty = Math.round(loc.items.reduce((s, i) => s + i.qty, 0));
                const isSelected = loc.key === selectedKey;
                const isUserLoc = loc.key.startsWith("sl_");
                const locDbId = loc.dbId;
                const isEditing = managing && editingId !== null && editingId === locDbId;
                const isDeleting = managing && deleteId !== null && deleteId === locDbId;

                if (isEditing) {
                  return (
                    <div key={loc.key} className="px-3 py-3 border-b border-border/40 space-y-2 bg-secondary/20">
                      <input
                        autoFocus
                        className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                        value={editForm.name}
                        onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                        onKeyDown={e => { if (e.key === "Escape") setEditingId(null); }}
                      />
                      <select
                        className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none"
                        value={editForm.zone}
                        onChange={e => setEditForm(f => ({ ...f, zone: e.target.value }))}
                      >
                        {ZONE_OPTIONS.map(z => <option key={z.value} value={z.value}>{z.label}</option>)}
                      </select>
                      {mutationError && <p className="text-xs text-destructive">{mutationError}</p>}
                      <div className="flex gap-1.5 justify-end">
                        <button onClick={() => { setEditingId(null); setMutationError(null); }} className="px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg">Cancel</button>
                        <button
                          disabled={!editForm.name.trim() || updateMutation.isPending}
                          onClick={() => updateMutation.mutate({ id: editingId!, ...editForm })}
                          className="px-2.5 py-1 text-xs bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
                        >
                          {updateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                          Save
                        </button>
                      </div>
                    </div>
                  );
                }

                if (isDeleting) {
                  return (
                    <div key={loc.key} className="px-3 py-3 border-b border-border/40 bg-destructive/5">
                      <p className="text-xs font-medium text-destructive mb-1">Delete "{loc.label}"?</p>
                      <p className="text-xs text-muted-foreground mb-2">This cannot be undone.</p>
                      {mutationError && <p className="text-xs text-destructive mb-1">{mutationError}</p>}
                      <div className="flex gap-1.5">
                        <button onClick={() => { setDeleteId(null); setMutationError(null); }} className="flex-1 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg">Cancel</button>
                        <button
                          disabled={deleteMutation.isPending}
                          onClick={() => deleteMutation.mutate(locDbId!)}
                          className="flex-1 px-2.5 py-1 text-xs bg-destructive text-destructive-foreground rounded-lg font-medium hover:bg-destructive/90 disabled:opacity-50 flex items-center justify-center gap-1"
                        >
                          {deleteMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={loc.key}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 text-left transition-all duration-150 relative group",
                      isSelected
                        ? "bg-secondary/80 text-foreground"
                        : "hover:bg-secondary/40 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {isSelected && (
                      <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-full bg-primary" />
                    )}
                    <button
                      onClick={() => !managing && setSelectedKey(loc.key)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      <div className={cn("p-2 rounded-lg flex-shrink-0", isSelected ? colors.bg : "bg-secondary/60")}>
                        <ZoneIcon zone={loc.zone} className={cn("w-4 h-4", isSelected ? colors.icon : "text-muted-foreground")} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn("text-sm font-medium leading-tight truncate", isSelected && "text-foreground")}>
                          {loc.label}
                        </p>
                        <p className="text-xs text-muted-foreground capitalize">{loc.zone}</p>
                      </div>
                      {!managing && (
                        <div className="shrink-0 text-right">
                          <p className={cn("text-base font-display font-bold tabular-nums leading-tight", isSelected ? "text-foreground" : "text-muted-foreground")}>
                            {qty.toLocaleString()}
                          </p>
                          {loc.items.length > 0 && (
                            <p className="text-xs text-muted-foreground">{loc.items.length} item{loc.items.length !== 1 ? "s" : ""}</p>
                          )}
                        </div>
                      )}
                      {!managing && isSelected && <ChevronRight className="w-3.5 h-3.5 text-primary shrink-0" />}
                    </button>

                    {managing && (
                      <div className="flex items-center gap-1 shrink-0">
                        {locDbId !== null ? (
                          <>
                            <button
                              onClick={() => { setEditingId(locDbId); setEditForm({ name: loc.label, zone: loc.zone }); setAddingLoc(false); setDeleteId(null); setMutationError(null); }}
                              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary/60 rounded-lg transition-colors"
                              title="Edit"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            {isUserLoc && (
                              <button
                                onClick={() => { setDeleteId(locDbId); setEditingId(null); setAddingLoc(false); setMutationError(null); }}
                                className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                                title="Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </>
                        ) : (
                          <span title="No database record for this location" className="p-1.5 text-muted-foreground/40">
                            <Lock className="w-3.5 h-3.5" />
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          </div>

          {/* ── RIGHT — focus panel ──────────────────────────────── */}
          <div className="flex-1 glass-panel rounded-2xl overflow-hidden min-w-0">
            {selectedLocation ? (
              <FocusPanel
                location={selectedLocation}
                onRefresh={() => queryClient.invalidateQueries({ queryKey: ["stock-control"] })}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Select a location to view its stock
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
