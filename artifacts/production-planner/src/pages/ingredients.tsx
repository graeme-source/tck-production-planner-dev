import { useState } from "react";
import { useListIngredients } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { PageHeader } from "@/components/page-header";
import { Search, Plus, Trash2, Edit2, Loader2 } from "lucide-react";
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
  costPerUnit: z.coerce.number().min(0, "Must be positive"),
  notes: z.string().optional(),
});

export default function Ingredients() {
  const { data: ingredients, isLoading } = useListIngredients();
  const { createIngredient, deleteIngredient } = useAppMutations();
  const [search, setSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const filtered = ingredients?.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));

  const { register, handleSubmit, reset, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { name: "", unit: "kg", costPerUnit: 0, notes: "" }
  });

  const onSubmit = (data: z.infer<typeof schema>) => {
    createIngredient.mutate({ data }, {
      onSuccess: () => {
        setIsDialogOpen(false);
        reset();
      }
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Ingredients Library" 
        description="Manage your raw materials, costs, and standard units."
        action={
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <button className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium shadow-md shadow-primary/20 hover-lift flex items-center gap-2">
                <Plus className="w-5 h-5" /> Add Ingredient
              </button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] bg-card border-border rounded-2xl">
              <DialogHeader>
                <DialogTitle className="font-display text-xl">Add New Ingredient</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Name</label>
                  <input {...register("name")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring" placeholder="e.g. Organic Flour" />
                  {errors.name && <span className="text-destructive text-xs">{errors.name.message}</span>}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">Unit</label>
                    <select {...register("unit")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring appearance-none">
                      <option value="kg">Kilogram (kg)</option>
                      <option value="g">Gram (g)</option>
                      <option value="l">Liter (L)</option>
                      <option value="ml">Milliliter (ml)</option>
                      <option value="pcs">Pieces</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Cost per unit ($)</label>
                    <input type="number" step="0.01" {...register("costPerUnit")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring" />
                    {errors.costPerUnit && <span className="text-destructive text-xs">{errors.costPerUnit.message}</span>}
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Notes (Optional)</label>
                  <textarea {...register("notes")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring min-h-[80px]" />
                </div>
                <button 
                  type="submit" 
                  disabled={createIngredient.isPending}
                  className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {createIngredient.isPending ? "Saving..." : "Save Ingredient"}
                </button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="glass-panel rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-border flex items-center bg-secondary/20">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ingredients..." 
              className="w-full pl-9 pr-4 py-2 bg-background border border-border rounded-xl focus-ring text-sm"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="p-8 flex justify-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : filtered?.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <p>No ingredients found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-secondary/30 text-muted-foreground">
                <tr>
                  <th className="px-6 py-4 font-medium">Name</th>
                  <th className="px-6 py-4 font-medium">Base Unit</th>
                  <th className="px-6 py-4 font-medium">Cost / Unit</th>
                  <th className="px-6 py-4 font-medium">Notes</th>
                  <th className="px-6 py-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filtered?.map((item) => (
                  <tr key={item.id} className="hover:bg-secondary/10 transition-colors">
                    <td className="px-6 py-4 font-medium">{item.name}</td>
                    <td className="px-6 py-4 text-muted-foreground">{item.unit}</td>
                    <td className="px-6 py-4">${item.costPerUnit.toFixed(2)}</td>
                    <td className="px-6 py-4 text-muted-foreground truncate max-w-[200px]">{item.notes || '-'}</td>
                    <td className="px-6 py-4 text-right">
                      <button 
                        onClick={() => {
                          if (confirm('Are you sure you want to delete this ingredient?')) {
                            deleteIngredient.mutate({ id: item.id });
                          }
                        }}
                        className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors inline-block"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
