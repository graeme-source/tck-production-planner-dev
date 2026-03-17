import { useState } from "react";
import { useListIngredients } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { PageHeader } from "@/components/page-header";
import { Search, Plus, Trash2, Edit2, Loader2, X } from "lucide-react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  unit: z.string().min(1, "Unit is required"),
  packWeight: z.coerce.number().min(0, "Must be positive"),
  costPerPack: z.coerce.number().min(0, "Must be positive"),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

type IngredientItem = {
  id: number;
  name: string;
  unit: string;
  packWeight: number;
  costPerPack: number;
  notes?: string | null;
  createdAt: string;
};

export default function Ingredients() {
  const { data: ingredients, isLoading } = useListIngredients();
  const { createIngredient, updateIngredient, deleteIngredient } = useAppMutations();
  const [search, setSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<IngredientItem | null>(null);

  const filtered = ingredients?.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", unit: "kg", packWeight: 0, costPerPack: 0, notes: "" }
  });

  const openAdd = () => {
    setEditingItem(null);
    reset({ name: "", unit: "kg", packWeight: 0, costPerPack: 0, notes: "" });
    setIsDialogOpen(true);
  };

  const openEdit = (item: IngredientItem) => {
    setEditingItem(item);
    reset({
      name: item.name,
      unit: item.unit,
      packWeight: item.packWeight,
      costPerPack: item.costPerPack,
      notes: item.notes ?? "",
    });
    setIsDialogOpen(true);
  };

  const onSubmit = (data: FormValues) => {
    if (editingItem) {
      updateIngredient.mutate({ id: editingItem.id, data }, {
        onSuccess: () => { setIsDialogOpen(false); reset(); setEditingItem(null); }
      });
    } else {
      createIngredient.mutate({ data }, {
        onSuccess: () => { setIsDialogOpen(false); reset(); }
      });
    }
  };

  const isPending = createIngredient.isPending || updateIngredient.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ingredients Library"
        description="Manage your raw materials, pack sizes, and costs."
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
        <DialogContent className="sm:max-w-[480px] bg-card border-border rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {editingItem ? "Edit Ingredient" : "Add New Ingredient"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Name</label>
              <input
                {...register("name")}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="e.g. Organic Flour"
              />
              {errors.name && <span className="text-destructive text-xs">{errors.name.message}</span>}
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Unit</label>
              <select
                {...register("unit")}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="kg">Kilogram (kg)</option>
                <option value="g">Gram (g)</option>
                <option value="l">Litre (L)</option>
                <option value="ml">Millilitre (ml)</option>
                <option value="pcs">Pieces</option>
                <option value="box">Box</option>
                <option value="bag">Bag</option>
                <option value="tub">Tub</option>
              </select>
              {errors.unit && <span className="text-destructive text-xs">{errors.unit.message}</span>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Pack Weight / Size</label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.001"
                    {...register("packWeight")}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="0.00"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">Qty per pack (in chosen unit)</p>
                {errors.packWeight && <span className="text-destructive text-xs">{errors.packWeight.message}</span>}
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Cost per Pack (£)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
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

            <div>
              <label className="text-sm font-medium mb-1 block">Notes (optional)</label>
              <textarea
                {...register("notes")}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[72px] resize-none"
                placeholder="Supplier, quality notes..."
              />
            </div>

            <button
              type="submit"
              disabled={isPending}
              className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {isPending ? "Saving..." : editingItem ? "Save Changes" : "Add Ingredient"}
            </button>
          </form>
        </DialogContent>
      </Dialog>

      <div className="rounded-2xl border border-border overflow-hidden bg-card">
        <div className="p-4 border-b border-border flex items-center gap-4 bg-secondary/20">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ingredients..."
              className="w-full pl-9 pr-4 py-2 bg-background border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <span className="text-sm text-muted-foreground">{filtered?.length ?? 0} items</span>
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
                  <th className="px-6 py-3 font-medium">Name</th>
                  <th className="px-6 py-3 font-medium">Unit</th>
                  <th className="px-6 py-3 font-medium">Pack Weight</th>
                  <th className="px-6 py-3 font-medium">Cost / Pack</th>
                  <th className="px-6 py-3 font-medium">Cost / Unit</th>
                  <th className="px-6 py-3 font-medium">Notes</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filtered?.map((item) => {
                  const costPerUnit = item.packWeight > 0 ? item.costPerPack / item.packWeight : 0;
                  return (
                    <tr key={item.id} className="hover:bg-secondary/10 transition-colors">
                      <td className="px-6 py-4 font-medium">{item.name}</td>
                      <td className="px-6 py-4 text-muted-foreground">{item.unit}</td>
                      <td className="px-6 py-4">{item.packWeight} {item.unit}</td>
                      <td className="px-6 py-4">£{item.costPerPack.toFixed(2)}</td>
                      <td className="px-6 py-4 text-muted-foreground">
                        £{costPerUnit.toFixed(4)}/{item.unit}
                      </td>
                      <td className="px-6 py-4 text-muted-foreground truncate max-w-[180px]">
                        {item.notes || <span className="text-border">—</span>}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(item as IngredientItem)}
                            className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors"
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`Delete "${item.name}"?`)) {
                                deleteIngredient.mutate({ id: item.id });
                              }
                            }}
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
