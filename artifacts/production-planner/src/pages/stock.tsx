import { useState } from "react";
import { useListStockEntries, useListIngredients, useListRecipes } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { PageHeader } from "@/components/page-header";
import { PackageSearch, Plus, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const schema = z.object({
  itemType: z.enum(['recipe', 'ingredient']),
  ingredientId: z.coerce.number().optional(),
  recipeId: z.coerce.number().optional(),
  quantity: z.coerce.number().min(0),
  unit: z.string().min(1),
  notes: z.string().optional()
});

export default function Stock() {
  const { data: stock, isLoading } = useListStockEntries();
  const { data: ingredients } = useListIngredients();
  const { data: recipes } = useListRecipes();
  const { createStock, deleteStock } = useAppMutations();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { register, watch, handleSubmit, reset } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { itemType: 'ingredient' as const, quantity: 0, unit: 'kg' }
  });

  const selectedType = watch('itemType');

  const onSubmit = (data: any) => {
    // Clean up payload based on type
    const payload = { ...data };
    if (payload.itemType === 'ingredient') delete payload.recipeId;
    if (payload.itemType === 'recipe') delete payload.ingredientId;
    
    createStock.mutate({ data: payload }, {
      onSuccess: () => { setIsDialogOpen(false); reset(); }
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Stock Inventory" 
        description="Log manual stock checks for ingredients and finished products."
        action={
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <button className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium shadow-md shadow-primary/20 hover-lift flex items-center gap-2">
                <Plus className="w-5 h-5" /> Log Stock Check
              </button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] bg-card border-border rounded-2xl">
              <DialogHeader>
                <DialogTitle className="font-display text-xl">Record Stock Level</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-4">
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

                <button type="submit" disabled={createStock.isPending} className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-semibold mt-2">
                  Save Record
                </button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="glass-panel rounded-2xl overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-secondary/30 text-muted-foreground">
            <tr>
              <th className="px-6 py-4 font-medium">Item Name</th>
              <th className="px-6 py-4 font-medium">Type</th>
              <th className="px-6 py-4 font-medium">Recorded Quantity</th>
              <th className="px-6 py-4 font-medium">Checked Date</th>
              <th className="px-6 py-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {isLoading && <tr><td colSpan={5} className="p-4 text-center">Loading...</td></tr>}
            {stock?.map((entry) => (
              <tr key={entry.id} className="hover:bg-secondary/10">
                <td className="px-6 py-4 font-medium flex items-center gap-2">
                  <PackageSearch className={`w-4 h-4 ${entry.itemType === 'recipe' ? 'text-accent' : 'text-primary'}`} />
                  {entry.itemType === 'recipe' ? entry.recipeName : entry.ingredientName}
                </td>
                <td className="px-6 py-4">
                  <span className={`text-xs px-2 py-1 rounded-md uppercase tracking-wider ${entry.itemType === 'recipe' ? 'bg-accent/10 text-accent' : 'bg-primary/10 text-primary'}`}>
                    {entry.itemType}
                  </span>
                </td>
                <td className="px-6 py-4 font-bold">{entry.quantity} <span className="font-normal text-muted-foreground">{entry.unit}</span></td>
                <td className="px-6 py-4 text-muted-foreground">{format(new Date(entry.checkedAt), 'MMM do, h:mm a')}</td>
                <td className="px-6 py-4 text-right">
                  <button onClick={() => { if(confirm('Delete?')) deleteStock.mutate({ id: entry.id }) }} className="text-destructive hover:bg-destructive/10 p-2 rounded-lg">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
