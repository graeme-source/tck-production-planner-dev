import { useState, useMemo } from "react";
import { useListStockEntries, useListIngredients, useListRecipes, useListStockItems } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { PageHeader } from "@/components/page-header";
import { PackageSearch, Plus, Trash2, Pencil, Refrigerator, Snowflake, ThermometerSun, Warehouse, X, ChevronRight, Check, Save, Beef, ArrowRightLeft, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const LOCATIONS = [
  {
    key: "production_fridge",
    label: "Production Fridge",
    subtitle: "Finished products only",
    icon: Refrigerator,
    color: "from-blue-500/20 to-blue-600/10",
    borderColor: "border-blue-500/30",
    iconColor: "text-blue-500",
    badgeColor: "bg-blue-500/10 text-blue-600",
    finishedProductOnly: true,
    defaultUnit: "2 Packs",
  },
  {
    key: "production_freezer",
    label: "Production Freezer",
    subtitle: "Frozen stock",
    icon: Snowflake,
    color: "from-cyan-500/20 to-cyan-600/10",
    borderColor: "border-cyan-500/30",
    iconColor: "text-cyan-500",
    badgeColor: "bg-cyan-500/10 text-cyan-600",
    finishedProductOnly: false,
    defaultUnit: "kg",
  },
  {
    key: "prep_fridge",
    label: "Prep Fridge",
    subtitle: "Ingredients & prep",
    icon: ThermometerSun,
    color: "from-green-500/20 to-green-600/10",
    borderColor: "border-green-500/30",
    iconColor: "text-green-500",
    badgeColor: "bg-green-500/10 text-green-600",
    finishedProductOnly: false,
    defaultUnit: "kg",
  },
  {
    key: "raw_meat_fridge",
    label: "Raw Meat Fridge",
    subtitle: "Raw meats only",
    icon: Beef,
    color: "from-red-500/20 to-red-600/10",
    borderColor: "border-red-500/30",
    iconColor: "text-red-500",
    badgeColor: "bg-red-500/10 text-red-600",
    finishedProductOnly: false,
    defaultUnit: "kg",
  },
  {
    key: "raw_freezer",
    label: "Raw Freezer",
    subtitle: "Frozen raw materials",
    icon: Snowflake,
    color: "from-indigo-500/20 to-indigo-600/10",
    borderColor: "border-indigo-500/30",
    iconColor: "text-indigo-500",
    badgeColor: "bg-indigo-500/10 text-indigo-600",
    finishedProductOnly: false,
    defaultUnit: "kg",
  },
  {
    key: "dry_store",
    label: "Dry Store",
    subtitle: "Ambient items",
    icon: Warehouse,
    color: "from-amber-500/20 to-amber-600/10",
    borderColor: "border-amber-500/30",
    iconColor: "text-amber-500",
    badgeColor: "bg-amber-500/10 text-amber-600",
    finishedProductOnly: false,
    defaultUnit: "kg",
  },
] as const;

type LocationKey = typeof LOCATIONS[number]["key"];

const schema = z.object({
  itemType: z.enum(["recipe", "ingredient", "stock_item"]),
  ingredientId: z.coerce.number().optional(),
  recipeId: z.coerce.number().optional(),
  stockItemId: z.coerce.number().optional(),
  quantity: z.coerce.number().min(0),
  unit: z.string().min(1),
  location: z.string().min(1),
  notes: z.string().optional(),
});

interface EditRow {
  quantity: number;
  unit: string;
  dirty: boolean;
}

export default function Stock() {
  const { data: stock, isLoading } = useListStockEntries();
  const { data: ingredients } = useListIngredients();
  const { data: recipes } = useListRecipes();
  const { data: stockItems } = useListStockItems();
  const { createStock, deleteStock } = useAppMutations();
  const { state } = useAuth();
  const canEdit = state.status === "authenticated" && (state.user.role === "admin" || state.user.role === "manager");

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [dialogLocation, setDialogLocation] = useState<LocationKey>("production_fridge");

  const [isEditing, setIsEditing] = useState(false);
  const [editRows, setEditRows] = useState<Record<string, EditRow>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [transferFrom, setTransferFrom] = useState<string>("production_fridge");
  const [transferTo, setTransferTo] = useState<string>("prep_fridge");
  const [transferIngredientId, setTransferIngredientId] = useState<number | null>(null);
  const [transferQty, setTransferQty] = useState<number>(0);
  const [transferUnit, setTransferUnit] = useState<string>("kg");
  const [transferNotes, setTransferNotes] = useState<string>("");
  const queryClient = useQueryClient();

  const transferMutation = useMutation({
    mutationFn: async (data: { ingredientId: number | null; fromLocation: string; toLocation: string; quantity: number; unit: string; notes: string | null }) => {
      const res = await fetch(`${BASE}/api/stock-transfers`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Transfer failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-entries"] });
      setIsTransferOpen(false);
      setTransferQty(0);
      setTransferNotes("");
      setTransferIngredientId(null);
    },
  });

  const locConfig = useMemo(() => LOCATIONS.find(l => l.key === dialogLocation), [dialogLocation]);
  const isFinishedProductOnly = locConfig?.finishedProductOnly ?? false;

  const { register, watch, handleSubmit, reset, setValue } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { itemType: "recipe" as "recipe" | "ingredient" | "stock_item", recipeId: 0, ingredientId: 0, stockItemId: 0, quantity: 0, unit: "2 Packs", location: "production_fridge", notes: "" },
  });

  const selectedType = watch("itemType") as string;
  const watchedLocation = watch("location");
  const watchedLocConfig = LOCATIONS.find(l => l.key === watchedLocation);
  const watchedFinishedOnly = watchedLocConfig?.finishedProductOnly ?? false;

  const onSubmit = (data: any) => {
    const payload = { ...data };
    if (payload.itemType === "ingredient") { delete payload.recipeId; delete payload.stockItemId; }
    if (payload.itemType === "recipe") { delete payload.ingredientId; delete payload.stockItemId; }
    if (payload.itemType === "stock_item") { delete payload.recipeId; delete payload.ingredientId; }
    createStock.mutate({ data: payload }, {
      onSuccess: () => { setIsDialogOpen(false); reset(); },
    });
  };

  const stockByLocation = useMemo(() => {
    const map: Record<string, typeof stock> = {};
    for (const loc of LOCATIONS) map[loc.key] = [];
    if (stock) {
      for (const entry of stock) {
        const loc = (entry as any).location || "production_fridge";
        if (!map[loc]) map[loc] = [];
        map[loc]!.push(entry);
      }
    }
    return map;
  }, [stock]);

  const latestByLocation = useMemo(() => {
    const result: Record<string, Record<string, { quantity: number; unit: string; name: string; itemType: string; checkedAt: string; color?: string | null; ingredientId?: number; recipeId?: number; stockItemId?: number }>> = {};
    for (const loc of LOCATIONS) result[loc.key] = {};
    if (stock) {
      for (const entry of stock) {
        const loc = (entry as any).location || "production_fridge";
        const key = entry.itemType === "recipe" ? `r-${entry.recipeId}` : entry.itemType === "stock_item" ? `s-${(entry as any).stockItemId}` : `i-${entry.ingredientId}`;
        const name = entry.itemType === "recipe" ? (entry as any).recipeName : entry.itemType === "stock_item" ? (entry as any).stockItemName : (entry as any).ingredientName;
        if (!result[loc]) result[loc] = {};
        result[loc][key] = {
          quantity: Number(entry.quantity),
          unit: entry.unit,
          name: name || "Unknown",
          itemType: entry.itemType,
          checkedAt: entry.checkedAt,
          color: (entry as any).recipeColor ?? null,
          ingredientId: entry.ingredientId ?? undefined,
          recipeId: entry.recipeId ?? undefined,
          stockItemId: (entry as any).stockItemId ?? undefined,
        };
      }
    }
    if (recipes) {
      const fridgeItems = result["production_fridge"];
      for (const r of recipes as any[]) {
        if (r.isCoreMenu) {
          const key = `r-${r.id}`;
          if (!fridgeItems[key]) {
            fridgeItems[key] = {
              quantity: 0,
              unit: "2 Packs",
              name: r.name,
              itemType: "recipe",
              checkedAt: "",
              color: r.color ?? null,
              recipeId: r.id,
            };
          }
        }
      }
    }
    return result;
  }, [stock, recipes]);

  const selectedLocData = LOCATIONS.find(l => l.key === selectedLocation);
  const selectedItems = selectedLocation ? (stockByLocation[selectedLocation] ?? []) : [];
  const latestItems = selectedLocation
    ? Object.entries(latestByLocation[selectedLocation] ?? {}).map(([k, v]) => ({ key: k, ...v }))
    : [];

  const openAddDialog = (locationKey: string) => {
    const cfg = LOCATIONS.find(l => l.key === locationKey);
    const defaultType = cfg?.finishedProductOnly ? "recipe" : "ingredient";
    setDialogLocation(locationKey as LocationKey);
    setValue("location", locationKey);
    setValue("itemType", defaultType as "recipe" | "ingredient");
    setValue("unit", cfg?.defaultUnit ?? "kg");
    setValue("quantity", 0);
    setIsDialogOpen(true);
  };

  const startEditing = () => {
    const rows: Record<string, EditRow> = {};
    for (const item of latestItems) {
      rows[item.key] = { quantity: item.quantity, unit: item.unit, dirty: false };
    }
    setEditRows(rows);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditRows({});
  };

  const saveAll = async () => {
    if (!selectedLocation) return;
    const cfg = LOCATIONS.find(l => l.key === selectedLocation);
    setIsSaving(true);
    const dirtyKeys = Object.keys(editRows).filter(k => editRows[k].dirty);
    await Promise.all(
      dirtyKeys.map(k => {
        const item = latestItems.find(i => i.key === k);
        if (!item) return Promise.resolve();
        const row = editRows[k];
        const payload: any = {
          itemType: item.itemType,
          quantity: row.quantity,
          unit: row.unit,
          location: selectedLocation,
        };
        if (item.itemType === "recipe") payload.recipeId = item.recipeId;
        else if (item.itemType === "stock_item") payload.stockItemId = item.stockItemId;
        else payload.ingredientId = item.ingredientId;
        return new Promise<void>(resolve => {
          createStock.mutate({ data: payload }, { onSuccess: resolve, onError: resolve });
        });
      })
    );
    setIsSaving(false);
    setIsEditing(false);
    setEditRows({});
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock & Inventory"
        description="Visual map of storage locations. Click a location to view and manage its contents."
        action={
          canEdit ? (
            <button
              onClick={() => setIsTransferOpen(true)}
              className="px-4 py-2.5 border border-border rounded-xl font-medium flex items-center gap-2 hover:bg-secondary/50 transition-colors text-sm"
            >
              <ArrowRightLeft className="w-4 h-4" /> Transfer Stock
            </button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {LOCATIONS.map((loc) => {
          const items = latestByLocation[loc.key] ?? {};
          const itemCount = Object.keys(items).length;
          const totalQty = Object.values(items).reduce((s, i) => s + i.quantity, 0);
          const isSelected = selectedLocation === loc.key;
          const Icon = loc.icon;
          return (
            <button
              key={loc.key}
              onClick={() => { setSelectedLocation(isSelected ? null : loc.key); setIsEditing(false); setEditRows({}); }}
              className={`relative group text-left rounded-2xl border-2 p-5 transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 bg-gradient-to-br ${loc.color} ${
                isSelected
                  ? `${loc.borderColor} shadow-lg ring-2 ring-offset-2 ring-offset-background ring-current ${loc.iconColor}`
                  : "border-border/50 hover:border-border"
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className={`p-2.5 rounded-xl bg-background/80 shadow-sm ${loc.iconColor}`}>
                  <Icon className="w-6 h-6" />
                </div>
                <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${isSelected ? "rotate-90" : "group-hover:translate-x-0.5"}`} />
              </div>
              <h3 className="font-semibold text-sm">{loc.label}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{loc.subtitle}</p>
              <div className="mt-3 flex items-center gap-2">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${loc.badgeColor}`}>
                  {itemCount} {itemCount === 1 ? "item" : "items"}
                </span>
                {totalQty > 0 && <span className="text-xs text-muted-foreground">{Math.round(totalQty)} total</span>}
              </div>
            </button>
          );
        })}
      </div>

      {selectedLocation && selectedLocData && (
        <div className="glass-panel rounded-2xl overflow-hidden animate-in slide-in-from-top-2 duration-300">
          {/* Panel header */}
          <div className={`flex items-center justify-between px-6 py-4 border-b border-border bg-gradient-to-r ${selectedLocData.color}`}>
            <div className="flex items-center gap-3">
              <selectedLocData.icon className={`w-5 h-5 ${selectedLocData.iconColor}`} />
              <div>
                <h3 className="font-semibold text-sm">{selectedLocData.label}</h3>
                <p className="text-xs text-muted-foreground">{latestItems.length} unique {latestItems.length === 1 ? "item" : "items"} recorded</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {canEdit && !isEditing && latestItems.length > 0 && (
                <>
                  <button
                    onClick={() => {
                      setTransferFrom(selectedLocation!);
                      const otherLoc = LOCATIONS.find(l => l.key !== selectedLocation);
                      if (otherLoc) setTransferTo(otherLoc.key);
                      setIsTransferOpen(true);
                    }}
                    className="px-3 py-1.5 bg-secondary text-foreground border border-border rounded-lg text-xs font-medium flex items-center gap-1.5 hover:bg-secondary/80 transition-colors"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5" /> Transfer
                  </button>
                  <button
                    onClick={startEditing}
                    className="px-3 py-1.5 bg-secondary text-foreground border border-border rounded-lg text-xs font-medium flex items-center gap-1.5 hover:bg-secondary/80 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit Stock
                  </button>
                </>
              )}
              {canEdit && isEditing && (
                <>
                  <button
                    onClick={saveAll}
                    disabled={isSaving}
                    className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium flex items-center gap-1.5 hover:opacity-90 transition-opacity disabled:opacity-60"
                  >
                    <Save className="w-3.5 h-3.5" /> {isSaving ? "Saving…" : "Save All"}
                  </button>
                  <button
                    onClick={cancelEditing}
                    className="px-3 py-1.5 bg-secondary text-foreground border border-border rounded-lg text-xs font-medium flex items-center gap-1.5 hover:bg-secondary/80 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" /> Cancel
                  </button>
                </>
              )}
              {canEdit && !isEditing && (
                <button
                  onClick={(e) => { e.stopPropagation(); openAddDialog(selectedLocation); }}
                  className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium flex items-center gap-1.5 hover:opacity-90 transition-opacity"
                >
                  <Plus className="w-3.5 h-3.5" /> Log Stock
                </button>
              )}
              <button
                onClick={() => { setSelectedLocation(null); setIsEditing(false); setEditRows({}); }}
                className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Edit mode hint */}
          {isEditing && (
            <div className="px-6 py-2.5 bg-primary/5 border-b border-primary/20 text-xs text-primary flex items-center gap-2">
              <Pencil className="w-3.5 h-3.5" />
              Edit quantities below, then hit <strong>Save All</strong> to record a new stock check for all changed items.
            </div>
          )}

          {latestItems.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <PackageSearch className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No stock recorded in this location yet.</p>
              {canEdit && (
                <button onClick={() => openAddDialog(selectedLocation)} className="mt-3 text-xs text-primary hover:underline">
                  Log the first stock check
                </button>
              )}
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-secondary/30 text-muted-foreground">
                <tr>
                  <th className="px-6 py-3 font-medium">Item Name</th>
                  <th className="px-6 py-3 font-medium">Type</th>
                  <th className={cn("px-6 py-3 font-medium", isEditing ? "text-left" : "text-right")}>
                    {isEditing ? "Update Quantity" : "Latest Quantity"}
                  </th>
                  {!isEditing && <th className="px-6 py-3 font-medium">Last Checked</th>}
                  {canEdit && !isEditing && <th className="px-6 py-3 font-medium text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {[...latestItems]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((item) => {
                    const row = editRows[item.key];
                    const isDirty = row?.dirty ?? false;
                    return (
                      <tr key={item.key} className={cn("transition-colors", isEditing && isDirty ? "bg-primary/5" : "hover:bg-secondary/10")}>
                        <td className="px-6 py-3 font-medium flex items-center gap-2">
                          <PackageSearch className={`w-4 h-4 ${item.itemType === "recipe" ? "text-accent" : "text-primary"}`} />
                          <span style={item.itemType === "recipe" && item.color ? { color: item.color } : undefined}>{item.name}</span>
                          {isEditing && isDirty && <span className="text-xs text-primary font-normal ml-1">•</span>}
                        </td>
                        <td className="px-6 py-3">
                          <span className={`text-xs px-2 py-1 rounded-md uppercase tracking-wider ${item.itemType === "recipe" ? "bg-accent/10 text-accent" : item.itemType === "stock_item" ? "bg-orange-500/10 text-orange-600" : "bg-primary/10 text-primary"}`}>
                            {item.itemType === "recipe" ? "product" : item.itemType === "stock_item" ? "supply" : "ingredient"}
                          </span>
                        </td>
                        <td className="px-6 py-3">
                          {isEditing && row ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={row.quantity}
                                onChange={e => setEditRows(prev => ({
                                  ...prev,
                                  [item.key]: { ...prev[item.key], quantity: Number(e.target.value), dirty: true },
                                }))}
                                className="w-24 px-2 py-1 bg-background border border-primary/40 rounded-lg text-sm font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30"
                              />
                              <span className="text-xs text-muted-foreground">{row.unit}</span>
                            </div>
                          ) : (
                            <span className="font-bold tabular-nums float-right">
                              {item.quantity} <span className="font-normal text-muted-foreground">{item.unit}</span>
                            </span>
                          )}
                        </td>
                        {!isEditing && (
                          <td className="px-6 py-3 text-muted-foreground text-xs">
                            {item.checkedAt ? format(new Date(item.checkedAt), "MMM do, h:mm a") : "—"}
                          </td>
                        )}
                        {canEdit && !isEditing && (
                          <td className="px-6 py-3 text-right">
                            <button
                              onClick={() => openAddDialog(selectedLocation)}
                              className="text-primary hover:bg-primary/10 p-1.5 rounded-lg transition-colors"
                              title="Update stock"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}

          {/* Save All sticky bar when in edit mode and any row is dirty */}
          {isEditing && Object.values(editRows).some(r => r.dirty) && (
            <div className="px-6 py-3 border-t border-primary/20 bg-primary/5 flex items-center justify-between">
              <span className="text-xs text-primary">
                {Object.values(editRows).filter(r => r.dirty).length} item{Object.values(editRows).filter(r => r.dirty).length !== 1 ? "s" : ""} changed
              </span>
              <button
                onClick={saveAll}
                disabled={isSaving}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold flex items-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                <Check className="w-4 h-4" /> {isSaving ? "Saving…" : "Save All Changes"}
              </button>
            </div>
          )}

          {selectedItems.length > 0 && !isEditing && (
            <details className="border-t border-border">
              <summary className="px-6 py-3 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                View full history ({selectedItems.length} {selectedItems.length === 1 ? "entry" : "entries"})
              </summary>
              <table className="w-full text-left text-xs">
                <thead className="bg-secondary/20 text-muted-foreground">
                  <tr>
                    <th className="px-6 py-2 font-medium">Item</th>
                    <th className="px-6 py-2 font-medium text-right">Quantity</th>
                    <th className="px-6 py-2 font-medium">Date</th>
                    <th className="px-6 py-2 font-medium">Notes</th>
                    {canEdit && <th className="px-6 py-2 font-medium text-right" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {[...selectedItems].reverse().map((entry) => (
                    <tr key={entry.id} className="hover:bg-secondary/10">
                      <td className="px-6 py-2">
                        <span style={entry.itemType === "recipe" && (entry as any).recipeColor ? { color: (entry as any).recipeColor } : undefined}>
                          {entry.itemType === "recipe" ? (entry as any).recipeName : (entry as any).ingredientName}
                        </span>
                      </td>
                      <td className="px-6 py-2 text-right tabular-nums font-medium">
                        {entry.quantity} <span className="font-normal text-muted-foreground">{entry.unit}</span>
                      </td>
                      <td className="px-6 py-2 text-muted-foreground">
                        {entry.checkedAt ? format(new Date(entry.checkedAt), "MMM do, h:mm a") : "—"}
                      </td>
                      <td className="px-6 py-2 text-muted-foreground">{entry.notes || "—"}</td>
                      {canEdit && (
                        <td className="px-6 py-2 text-right">
                          <button
                            onClick={() => { if (confirm("Delete this entry?")) deleteStock.mutate({ id: entry.id }); }}
                            className="text-destructive hover:bg-destructive/10 p-1.5 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[425px] bg-card border-border rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Log Stock Check</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Storage Location</label>
              <select
                {...register("location")}
                onChange={e => {
                  const cfg = LOCATIONS.find(l => l.key === e.target.value);
                  setValue("location", e.target.value);
                  setValue("unit", cfg?.defaultUnit ?? "kg");
                  if (cfg?.finishedProductOnly) setValue("itemType", "recipe");
                }}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring appearance-none text-sm"
              >
                {LOCATIONS.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
              </select>
            </div>

            {!watchedFinishedOnly && (
              <div>
                <label className="text-sm font-medium mb-1 block">Item Type</label>
                <div className="flex bg-secondary/50 rounded-lg p-1 border border-border">
                  <label className={`flex-1 text-center py-2 rounded-md text-sm font-medium cursor-pointer transition-colors ${selectedType === "ingredient" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                    <input type="radio" value="ingredient" {...register("itemType")} className="hidden" />
                    Ingredient
                  </label>
                  <label className={`flex-1 text-center py-2 rounded-md text-sm font-medium cursor-pointer transition-colors ${selectedType === "recipe" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                    <input type="radio" value="recipe" {...register("itemType")} className="hidden" />
                    Product
                  </label>
                  <label className={`flex-1 text-center py-2 rounded-md text-sm font-medium cursor-pointer transition-colors ${selectedType === "stock_item" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                    <input type="radio" value="stock_item" {...register("itemType")} className="hidden" />
                    Supply
                  </label>
                </div>
              </div>
            )}

            {watchedFinishedOnly && (
              <div className="px-3 py-2 bg-accent/10 text-accent rounded-lg text-xs font-medium flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5" /> Finished products only for this location
              </div>
            )}

            <div>
              <label className="text-sm font-medium mb-1 block">Select Item</label>
              {(watchedFinishedOnly || selectedType === "recipe") ? (
                <select {...register("recipeId")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring appearance-none">
                  {recipes?.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              ) : selectedType === "stock_item" ? (
                <select {...register("stockItemId")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring appearance-none">
                  {stockItems?.map(s => <option key={s.id} value={s.id}>{s.name} ({s.category})</option>)}
                </select>
              ) : (
                <select {...register("ingredientId")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring appearance-none">
                  {ingredients?.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Quantity</label>
                <input type="number" step="0.01" {...register("quantity")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Unit</label>
                <input {...register("unit")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring" />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Notes (optional)</label>
              <input {...register("notes")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring" placeholder="e.g. End-of-shift count" />
            </div>

            <button type="submit" disabled={createStock.isPending} className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-semibold mt-2">
              Save Record
            </button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isTransferOpen} onOpenChange={setIsTransferOpen}>
        <DialogContent className="sm:max-w-[480px] bg-card border-border rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-primary" /> Transfer Stock
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block">From</label>
                <select
                  value={transferFrom}
                  onChange={e => setTransferFrom(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {LOCATIONS.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">To</label>
                <select
                  value={transferTo}
                  onChange={e => setTransferTo(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {LOCATIONS.filter(l => l.key !== transferFrom).map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Ingredient (optional)</label>
              <select
                value={transferIngredientId ?? ""}
                onChange={e => setTransferIngredientId(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">— General transfer —</option>
                {ingredients?.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Quantity</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={transferQty}
                  onChange={e => setTransferQty(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Unit</label>
                <input
                  value={transferUnit}
                  onChange={e => setTransferUnit(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="kg"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Notes (optional)</label>
              <input
                value={transferNotes}
                onChange={e => setTransferNotes(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="e.g. Moving to prep for tomorrow"
              />
            </div>

            <button
              onClick={() => transferMutation.mutate({
                ingredientId: transferIngredientId,
                fromLocation: transferFrom,
                toLocation: transferTo,
                quantity: transferQty,
                unit: transferUnit,
                notes: transferNotes || null,
              })}
              disabled={transferMutation.isPending || transferQty <= 0 || !transferUnit || transferFrom === transferTo}
              className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-semibold mt-2 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {transferMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {transferMutation.isPending ? "Transferring..." : "Record Transfer"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
