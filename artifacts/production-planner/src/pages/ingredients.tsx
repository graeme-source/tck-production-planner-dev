import { useState } from "react";
import { useListIngredients, useListSuppliers } from "@workspace/api-client-react";
import type { Ingredient } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { PageHeader } from "@/components/page-header";
import { Search, Plus, Trash2, Edit2, Loader2, ExternalLink } from "lucide-react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  unit: z.string().min(1, "Unit is required"),
  packWeight: z.coerce.number().min(0, "Must be positive"),
  costPerPack: z.coerce.number().min(0, "Must be positive"),
  brand: z.string().optional(),
  supplierPartNumber: z.string().optional(),
  supplierId: z.coerce.number().optional(),
  secondarySupplierId: z.coerce.number().optional(),
  orderingUrl: z.string().optional(),
  notes: z.string().optional(),
  processingRatioPct: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().min(0).max(100).nullable().optional()
  ),
});

type FormValues = z.infer<typeof schema>;

const emptyDefaults: FormValues = {
  name: "", unit: "kg", packWeight: 0, costPerPack: 0,
  brand: "", supplierPartNumber: "", supplierId: 0, secondarySupplierId: 0,
  orderingUrl: "", notes: "", processingRatioPct: null,
};

export default function Ingredients() {
  const { data: ingredients, isLoading } = useListIngredients();
  const { data: suppliers } = useListSuppliers();
  const { createIngredient, updateIngredient, deleteIngredient } = useAppMutations();
  const [search, setSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const filtered = ingredients?.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    (i.brand ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const supplierMap = Object.fromEntries((suppliers ?? []).map(s => [s.id, s.name]));

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: emptyDefaults,
  });

  const watchedUnit = watch("unit");
  const watchedPackWeight = watch("packWeight");
  const watchedCostPerPack = watch("costPerPack");
  const liveCostPerUnit = watchedPackWeight > 0 ? watchedCostPerPack / watchedPackWeight : null;

  const openAdd = () => {
    setEditingId(null);
    reset(emptyDefaults);
    setIsDialogOpen(true);
  };

  const openEdit = (item: Ingredient) => {
    setEditingId(item.id);
    reset({
      name: item.name,
      unit: item.unit,
      packWeight: Number(item.packWeight),
      costPerPack: Number(item.costPerPack),
      brand: item.brand ?? "",
      supplierPartNumber: item.supplierPartNumber ?? "",
      supplierId: item.supplierId ?? 0,
      secondarySupplierId: item.secondarySupplierId ?? 0,
      orderingUrl: item.orderingUrl ?? "",
      notes: item.notes ?? "",
      processingRatioPct: item.processingRatio != null
        ? parseFloat((item.processingRatio * 100).toFixed(4))
        : null,
    });
    setIsDialogOpen(true);
  };

  const buildPayload = (data: FormValues) => ({
    name: data.name,
    unit: data.unit,
    packWeight: data.packWeight,
    costPerPack: data.costPerPack,
    brand: data.brand || null,
    supplierPartNumber: data.supplierPartNumber || null,
    supplierId: data.supplierId && data.supplierId > 0 ? data.supplierId : null,
    secondarySupplierId: data.secondarySupplierId && data.secondarySupplierId > 0 ? data.secondarySupplierId : null,
    orderingUrl: data.orderingUrl || null,
    notes: data.notes || null,
    processingRatio: data.processingRatioPct != null ? data.processingRatioPct / 100 : null,
  });

  const onSubmit = (data: FormValues) => {
    if (editingId !== null) {
      updateIngredient.mutate({ id: editingId, data: buildPayload(data) }, {
        onSuccess: () => { setIsDialogOpen(false); reset(); setEditingId(null); }
      });
    } else {
      createIngredient.mutate({ data: buildPayload(data) }, {
        onSuccess: () => { setIsDialogOpen(false); reset(); }
      });
    }
  };

  const isPending = createIngredient.isPending || updateIngredient.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ingredients Library"
        description="Manage your raw materials, pack sizes, costs and supplier information."
        action={
          <button
            onClick={openAdd}
            className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium shadow-md shadow-primary/20 flex items-center gap-2 hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-5 h-5" /> Add Ingredient
          </button>
        }
      />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[620px] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {editingId !== null ? "Edit Ingredient" : "Add New Ingredient"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 mt-4">

            {/* Name + Unit */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="text-sm font-medium mb-1 block">Name *</label>
                <input
                  {...register("name")}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="e.g. Organic Plain Flour"
                />
                {errors.name && <span className="text-destructive text-xs">{errors.name.message}</span>}
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Unit *</label>
                <select
                  {...register("unit")}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="kg">kg</option>
                  <option value="g">g</option>
                  <option value="l">L</option>
                  <option value="ml">ml</option>
                  <option value="pcs">pcs</option>
                  <option value="box">box</option>
                  <option value="bag">bag</option>
                  <option value="tub">tub</option>
                  <option value="each">each</option>
                </select>
              </div>
            </div>

            {/* Brand + Part Number */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Brand</label>
                <input
                  {...register("brand")}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="e.g. Shipton Mill"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Supplier Part Number</label>
                <input
                  {...register("supplierPartNumber")}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="e.g. HF-0042"
                />
              </div>
            </div>

            {/* Pack Weight + Cost per Pack */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Pack size ({watchedUnit || "unit"}) *
                </label>
                <input
                  type="number"
                  step="0.001"
                  {...register("packWeight")}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="e.g. 500"
                />
                <p className="text-xs text-muted-foreground mt-1">How many {watchedUnit || "units"} in one pack</p>
                {errors.packWeight && <span className="text-destructive text-xs">{errors.packWeight.message}</span>}
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Cost per pack (£) *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">£</span>
                  <input
                    type="number"
                    step="0.01"
                    {...register("costPerPack")}
                    className="w-full pl-7 pr-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="0.00"
                  />
                </div>
                {errors.costPerPack && <span className="text-destructive text-xs">{errors.costPerPack.message}</span>}
              </div>
            </div>
            {liveCostPerUnit !== null && (
              <div className="rounded-lg bg-secondary/30 border border-border px-3.5 py-2.5 text-sm flex items-center justify-between">
                <span className="text-muted-foreground">Implied cost per {watchedUnit || "unit"}:</span>
                <span className="font-semibold tabular-nums">
                  £{liveCostPerUnit.toFixed(4)} / {watchedUnit || "unit"}
                </span>
              </div>
            )}

            {/* Processing Ratio */}
            <div>
              <label className="text-sm font-medium mb-1 block">
                Processing Ratio
                <span className="ml-2 text-xs font-normal text-muted-foreground">(unchopped → chopped / raw → cooked)</span>
              </label>
              <div className="relative max-w-[160px]">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  {...register("processingRatioPct")}
                  className="w-full px-3 pr-8 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="e.g. 84.70"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">%</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Leave blank for 100% (no processing loss). Used to adjust sub-recipe yield calculations.
              </p>
              {errors.processingRatioPct && <span className="text-destructive text-xs">{String(errors.processingRatioPct.message)}</span>}
            </div>

            {/* Supplier + Secondary Supplier */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Supplier</label>
                <select
                  {...register("supplierId")}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value={0}>— None —</option>
                  {(suppliers ?? []).map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Secondary Supplier</label>
                <select
                  {...register("secondarySupplierId")}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value={0}>— None —</option>
                  {(suppliers ?? []).map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Ordering URL */}
            <div>
              <label className="text-sm font-medium mb-1 block">Ordering URL</label>
              <input
                {...register("orderingUrl")}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="https://supplier.co.uk/product/flour-25kg"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="text-sm font-medium mb-1 block">Notes</label>
              <textarea
                {...register("notes")}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[64px] resize-none"
                placeholder="Allergens, storage, quality notes..."
              />
            </div>

            <button
              type="submit"
              disabled={isPending}
              className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {isPending ? "Saving..." : editingId !== null ? "Save Changes" : "Add Ingredient"}
            </button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Table */}
      <div className="rounded-2xl border border-border overflow-hidden bg-card">
        <div className="p-4 border-b border-border flex items-center gap-4 bg-secondary/20">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or brand..."
              className="w-full pl-9 pr-4 py-2 bg-background border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <span className="text-sm text-muted-foreground whitespace-nowrap">{filtered?.length ?? 0} items</span>
        </div>

        {isLoading ? (
          <div className="p-12 flex justify-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : filtered?.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <p className="text-lg font-medium">No ingredients found</p>
            <p className="text-sm mt-1">Add your first ingredient to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-secondary/30 text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Brand</th>
                  <th className="px-5 py-3 font-medium">Part No.</th>
                  <th className="px-5 py-3 font-medium">Unit</th>
                  <th className="px-5 py-3 font-medium">Pack Size</th>
                  <th className="px-5 py-3 font-medium">Cost / Pack</th>
                  <th className="px-5 py-3 font-medium">Cost / Unit</th>
                  <th className="px-5 py-3 font-medium">Proc. Ratio</th>
                  <th className="px-5 py-3 font-medium">Supplier</th>
                  <th className="px-5 py-3 font-medium">2nd Supplier</th>
                  <th className="px-5 py-3 font-medium">Order</th>
                  <th className="px-5 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filtered?.map((item) => {
                  const packWeight = Number(item.packWeight);
                  const costPerPack = Number(item.costPerPack);
                  const costPerUnit = packWeight > 0 ? costPerPack / packWeight : 0;
                  return (
                    <tr key={item.id} className="hover:bg-secondary/10 transition-colors">
                      <td className="px-5 py-3 font-medium whitespace-nowrap">{item.name}</td>
                      <td className="px-5 py-3 text-muted-foreground">{item.brand || <span className="text-border">—</span>}</td>
                      <td className="px-5 py-3 text-muted-foreground font-mono text-xs">{item.supplierPartNumber || <span className="text-border">—</span>}</td>
                      <td className="px-5 py-3 text-muted-foreground">{item.unit}</td>
                      <td className="px-5 py-3">{packWeight} {item.unit}</td>
                      <td className="px-5 py-3 font-medium">£{costPerPack.toFixed(2)}</td>
                      <td className="px-5 py-3 text-muted-foreground">£{costPerUnit.toFixed(4)}/{item.unit}</td>
                      <td className="px-5 py-3">
                        {item.processingRatio != null ? (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${item.processingRatio < 1 ? "bg-amber-50 text-amber-700" : "bg-secondary/60 text-muted-foreground"}`}>
                            {(item.processingRatio * 100).toFixed(2)}%
                          </span>
                        ) : (
                          <span className="text-border">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {item.supplierId ? supplierMap[item.supplierId] ?? <span className="text-border">—</span> : <span className="text-border">—</span>}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {item.secondarySupplierId ? supplierMap[item.secondarySupplierId] ?? <span className="text-border">—</span> : <span className="text-border">—</span>}
                      </td>
                      <td className="px-5 py-3">
                        {item.orderingUrl ? (
                          <a
                            href={item.orderingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline text-xs"
                          >
                            <ExternalLink className="w-3 h-3" /> Link
                          </a>
                        ) : (
                          <span className="text-border">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(item)}
                            className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors"
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => { if (confirm(`Delete "${item.name}"?`)) deleteIngredient.mutate({ id: item.id }); }}
                            className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
