import { useState } from "react";
import { useListSubRecipes, useListIngredients } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { PageHeader } from "@/components/page-header";
import { Search, Plus, Trash2, BookOpen, X } from "lucide-react";
import { useForm, useFieldArray } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  yield: z.coerce.number().min(0.1, "Must be > 0"),
  yieldUnit: z.string().min(1, "Unit required"),
  notes: z.string().optional(),
  ingredients: z.array(z.object({
    ingredientId: z.coerce.number().min(1, "Select ingredient"),
    quantity: z.coerce.number().min(0.01, "Must be > 0")
  })).min(1, "Add at least one ingredient")
});

export default function SubRecipes() {
  const { data: subRecipes, isLoading } = useListSubRecipes();
  const { data: ingredients } = useListIngredients();
  const { createSubRecipe, deleteSubRecipe } = useAppMutations();
  const [search, setSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const filtered = subRecipes?.filter(r => r.name.toLowerCase().includes(search.toLowerCase()));

  const { register, control, handleSubmit, reset, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { 
      name: "", description: "", yield: 1, yieldUnit: "kg", notes: "",
      ingredients: [{ ingredientId: 0, quantity: 1 }]
    }
  });

  const { fields, append, remove } = useFieldArray({ control, name: "ingredients" });

  const onSubmit = (data: z.infer<typeof schema>) => {
    createSubRecipe.mutate({ data }, {
      onSuccess: () => { setIsDialogOpen(false); reset(); }
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Sub-Recipes (Prep)" 
        description="Manage intermediate preparations like sauces, doughs, or spice mixes."
        action={
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <button className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium shadow-md shadow-primary/20 hover-lift flex items-center gap-2">
                <Plus className="w-5 h-5" /> Create Sub-Recipe
              </button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="font-display text-xl">New Sub-Recipe</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="text-sm font-medium mb-1 block">Name</label>
                    <input {...register("name")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring" placeholder="e.g. Tomato Base Sauce" />
                    {errors.name && <span className="text-destructive text-xs">{errors.name.message}</span>}
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Expected Yield</label>
                    <input type="number" step="0.1" {...register("yield")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Yield Unit</label>
                    <input {...register("yieldUnit")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring" placeholder="kg, L, batches" />
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-sm font-bold block">Ingredients</label>
                    <button type="button" onClick={() => append({ ingredientId: 0, quantity: 1 })} className="text-xs font-medium text-primary hover:underline flex items-center">
                      <Plus className="w-3 h-3 mr-1" /> Add Ingredient
                    </button>
                  </div>
                  {errors.ingredients?.message && <span className="text-destructive text-xs block mb-2">{errors.ingredients.message}</span>}
                  
                  <div className="space-y-3">
                    {fields.map((field, index) => (
                      <div key={field.id} className="flex gap-2 items-start">
                        <div className="flex-1">
                          <select {...register(`ingredients.${index}.ingredientId`)} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring appearance-none text-sm">
                            <option value={0} disabled>Select ingredient...</option>
                            {ingredients?.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                          </select>
                        </div>
                        <div className="w-24">
                          <input type="number" step="0.01" {...register(`ingredients.${index}.quantity`)} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring text-sm" placeholder="Qty" />
                        </div>
                        <button type="button" onClick={() => remove(index)} className="p-2 text-muted-foreground hover:text-destructive transition-colors mt-0.5">
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <button type="submit" disabled={createSubRecipe.isPending} className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50">
                  {createSubRecipe.isPending ? "Creating..." : "Save Sub-Recipe"}
                </button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading && <p className="text-muted-foreground col-span-full">Loading...</p>}
        {filtered?.map((recipe) => (
          <div key={recipe.id} className="glass-panel rounded-2xl p-6 hover-lift relative group">
            <button 
              onClick={() => { if(confirm('Delete?')) deleteSubRecipe.mutate({ id: recipe.id }) }}
              className="absolute top-4 right-4 p-2 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center mb-4">
              <BookOpen className="w-5 h-5" />
            </div>
            <h3 className="font-display font-bold text-lg mb-1">{recipe.name}</h3>
            <p className="text-sm text-muted-foreground mb-4">Yield: {recipe.yield} {recipe.yieldUnit}</p>
            {recipe.description && <p className="text-sm mb-4 line-clamp-2">{recipe.description}</p>}
            <div className="text-xs text-muted-foreground bg-secondary/50 p-2 rounded-lg inline-block">
              ID: SR-{recipe.id.toString().padStart(4, '0')}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
