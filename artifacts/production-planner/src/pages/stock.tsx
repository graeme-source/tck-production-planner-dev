import { useState, useMemo } from "react";
import { useListStockEntries, useListIngredients, useListRecipes } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { PageHeader } from "@/components/page-header";
import { PackageSearch, Plus, Trash2, Pencil, Refrigerator, Snowflake, ThermometerSun, Warehouse, X, ChevronRight } from "lucide-react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/auth-context";

const LOCATIONS = [
  {
    key: "production_fridge",
    label: "Production Fridge",
    subtitle: "Factory Number",
    icon: Refrigerator,
    color: "from-blue-500/20 to-blue-600/10",
    borderColor: "border-blue-500/30",
    iconColor: "text-blue-500",
    badgeColor: "bg-blue-500/10 text-blue-600",
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
  },
  {
    key: "walk_in_chiller",
    label: "Walk-in Chiller",
    subtitle: "Bulk cold storage",
    icon: Refrigerator,
    color: "from-violet-500/20 to-violet-600/10",
    borderColor: "border-violet-500/30",
    iconColor: "text-violet-500",
    badgeColor: "bg-violet-500/10 text-violet-600",
  },
] as const;

const schema = z.object({
  itemType: z.enum(['recipe', 'ingredient']),
  ingredientId: z.coerce.number().optional(),
  recipeId: z.coerce.number().optional(),
  quantity: z.coerce.number().min(0),
  unit: z.string().min(1),
  location: z.string().min(1),
  notes: z.string().optional()
});

export default function Stock() {
  const { data: stock, isLoading } = useListStockEntries();
  const { data: ingredients } = useListIngredients();
  const { data: recipes } = useListRecipes();
  const { createStock, deleteStock } = useAppMutations();
  const { state } = useAuth();
  const canEdit = state.status === "authenticated" && (state.user.role === "admin" || state.user.role === "manager");

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [dialogLocation, setDialogLocation] = useState<string>("production_fridge");

  const { register, watch, handleSubmit, reset, setValue } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { itemType: 'ingredient' as const, quantity: 0, unit: 'kg', location: 'production_fridge' }
  });

  const selectedType = watch('itemType');

  const onSubmit = (data: any) => {
    const payload = { ...data };
    if (payload.itemType === 'ingredient') delete payload.recipeId;
    if (payload.itemType === 'recipe') delete payload.ingredientId;

    createStock.mutate({ data: payload }, {
      onSuccess: () => { setIsDialogOpen(false); reset(); }
    });
  };

  const stockByLocation = useMemo(() => {
    const map: Record<string, typeof stock> = {};
    for (const loc of LOCATIONS) {
      map[loc.key] = [];
    }
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
    const result: Record<string, Record<string, { quantity: number; unit: string; name: string; itemType: string; checkedAt: string }>> = {};
    for (const loc of LOCATIONS) {
      result[loc.key] = {};
    }
    if (stock) {
      for (const entry of stock) {
        const loc = (entry as any).location || "production_fridge";
        const key = entry.itemType === 'recipe' ? `r-${entry.recipeId}` : `i-${entry.ingredientId}`;
        const name = entry.itemType === 'recipe' ? (entry as any).recipeName : (entry as any).ingredientName;
        if (!result[loc]) result[loc] = {};
        result[loc][key] = {
          quantity: Number(entry.quantity),
          unit: entry.unit,
          name: name || 'Unknown',
          itemType: entry.itemType,
          checkedAt: entry.checkedAt,
        };
      }
    }
    return result;
  }, [stock]);

  const selectedLocData = LOCATIONS.find(l => l.key === selectedLocation);
  const selectedItems = selectedLocation ? (stockByLocation[selectedLocation] ?? []) : [];
  const latestItems = selectedLocation ? Object.values(latestByLocation[selectedLocation] ?? {}) : [];

  const openAddDialog = (locationKey: string) => {
    setDialogLocation(locationKey);
    setValue("location", locationKey);
    setIsDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock & Inventory"
        description="Visual map of storage locations. Click a location to view and manage its contents."
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
              onClick={() => setSelectedLocation(isSelected ? null : loc.key)}
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
                {totalQty > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {Math.round(totalQty)} total
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {selectedLocation && selectedLocData && (
        <div className="glass-panel rounded-2xl overflow-hidden animate-in slide-in-from-top-2 duration-300">
          <div className={`flex items-center justify-between px-6 py-4 border-b border-border bg-gradient-to-r ${selectedLocData.color}`}>
            <div className="flex items-center gap-3">
              <selectedLocData.icon className={`w-5 h-5 ${selectedLocData.iconColor}`} />
              <div>
                <h3 className="font-semibold text-sm">{selectedLocData.label}</h3>
                <p className="text-xs text-muted-foreground">{latestItems.length} unique {latestItems.length === 1 ? "item" : "items"} recorded</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {canEdit && (
                <button
                  onClick={(e) => { e.stopPropagation(); openAddDialog(selectedLocation); }}
                  className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium flex items-center gap-1.5 hover:opacity-90 transition-opacity"
                >
                  <Plus className="w-3.5 h-3.5" /> Log Stock
                </button>
              )}
              <button
                onClick={() => setSelectedLocation(null)}
                className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {latestItems.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <PackageSearch className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No stock recorded in this location yet.</p>
              {canEdit && (
                <button
                  onClick={() => openAddDialog(selectedLocation)}
                  className="mt-3 text-xs text-primary hover:underline"
                >
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
                  <th className="px-6 py-3 font-medium text-right">Latest Quantity</th>
                  <th className="px-6 py-3 font-medium">Last Checked</th>
                  {canEdit && <th className="px-6 py-3 font-medium text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {latestItems
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((item, idx) => (
                    <tr key={idx} className="hover:bg-secondary/10">
                      <td className="px-6 py-3 font-medium flex items-center gap-2">
                        <PackageSearch className={`w-4 h-4 ${item.itemType === 'recipe' ? 'text-accent' : 'text-primary'}`} />
                        {item.name}
                      </td>
                      <td className="px-6 py-3">
                        <span className={`text-xs px-2 py-1 rounded-md uppercase tracking-wider ${item.itemType === 'recipe' ? 'bg-accent/10 text-accent' : 'bg-primary/10 text-primary'}`}>
                          {item.itemType === 'recipe' ? 'product' : 'ingredient'}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right font-bold tabular-nums">
                        {item.quantity} <span className="font-normal text-muted-foreground">{item.unit}</span>
                      </td>
                      <td className="px-6 py-3 text-muted-foreground text-xs">
                        {format(new Date(item.checkedAt), 'MMM do, h:mm a')}
                      </td>
                      {canEdit && (
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
                  ))}
              </tbody>
            </table>
          )}

          {selectedItems.length > 0 && (
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
                        {entry.itemType === 'recipe' ? (entry as any).recipeName : (entry as any).ingredientName}
                      </td>
                      <td className="px-6 py-2 text-right tabular-nums font-medium">
                        {entry.quantity} <span className="font-normal text-muted-foreground">{entry.unit}</span>
                      </td>
                      <td className="px-6 py-2 text-muted-foreground">
                        {format(new Date(entry.checkedAt), 'MMM do, h:mm a')}
                      </td>
                      <td className="px-6 py-2 text-muted-foreground">{entry.notes || "—"}</td>
                      {canEdit && (
                        <td className="px-6 py-2 text-right">
                          <button
                            onClick={() => { if(confirm('Delete this entry?')) deleteStock.mutate({ id: entry.id }) }}
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
              <select {...register("location")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring appearance-none text-sm">
                {LOCATIONS.map(l => (
                  <option key={l.key} value={l.key}>{l.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Item Type</label>
              <div className="flex bg-secondary/50 rounded-lg p-1 border border-border">
                <label className={`flex-1 text-center py-2 rounded-md text-sm font-medium cursor-pointer transition-colors ${selectedType === 'ingredient' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                  <input type="radio" value="ingredient" {...register("itemType")} className="hidden" />
                  Raw Ingredient
                </label>
                <label className={`flex-1 text-center py-2 rounded-md text-sm font-medium cursor-pointer transition-colors ${selectedType === 'recipe' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                  <input type="radio" value="recipe" {...register("itemType")} className="hidden" />
                  Finished Product
                </label>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Select Item</label>
              {selectedType === 'ingredient' ? (
                <select {...register("ingredientId")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring appearance-none">
                   {ingredients?.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              ) : (
                <select {...register("recipeId")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring appearance-none">
                   {recipes?.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
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
    </div>
  );
}
