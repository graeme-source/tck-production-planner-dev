import { useState } from "react";
import { useListRecipes, useListIngredients, useListSubRecipes } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { PageHeader } from "@/components/page-header";
import { Plus, Trash2, ChefHat, X } from "lucide-react";
import { useForm, useFieldArray } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.string().optional(),
  servings: z.coerce.number().min(1),
  servingUnit: z.string().min(1),
  notes: z.string().optional(),
  ingredients: z.array(z.object({
    ingredientId: z.coerce.number().min(1),
    quantity: z.coerce.number().min(0.01)
  })),
  subRecipes: z.array(z.object({
    subRecipeId: z.coerce.number().min(1),
    quantity: z.coerce.number().min(0.01)
  }))
});

export default function Recipes() {
  const { data: recipes, isLoading } = useListRecipes();
  const { data: ingredients } = useListIngredients();
  const { data: subRecipes } = useListSubRecipes();
  const { createRecipe, deleteRecipe } = useAppMutations();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { register, control, handleSubmit, reset, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { 
      name: "", category: "Main", servings: 1, servingUnit: "portion", notes: "",
      ingredients: [], subRecipes: []
    }
  });

  const { fields: ingFields, append: appendIng, remove: removeIng } = useFieldArray({ control, name: "ingredients" });
  const { fields: subFields, append: appendSub, remove: removeSub } = useFieldArray({ control, name: "subRecipes" });

  const onSubmit = (data: z.infer<typeof schema>) => {
    createRecipe.mutate({ data }, {
      onSuccess: () => { setIsDialogOpen(false); reset(); }
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Final Product Recipes" 
        description="Master recipes for your finished goods, combining raw ingredients and prep items."
        action={
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <button className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium shadow-md shadow-primary/20 hover-lift flex items-center gap-2">
                <Plus className="w-5 h-5" /> Create Recipe
              </button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[700px] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="font-display text-2xl">New Final Product</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="text-sm font-medium mb-1 block">Product Name</label>
                    <input {...register("name")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring" placeholder="e.g. Classic Sourdough Loaf" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Servings / Output</label>
                    <input type="number" step="1" {...register("servings")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Serving Unit</label>
                    <input {...register("servingUnit")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring" placeholder="loaf, slice, pack" />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-border">
                  {/* Ingredients List */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-sm font-bold text-primary">Raw Ingredients</label>
                      <button type="button" onClick={() => appendIng({ ingredientId: 0, quantity: 1 })} className="text-xs font-medium bg-secondary px-2 py-1 rounded-md hover:bg-secondary/80">
                        + Add Raw
                      </button>
                    </div>
                    <div className="space-y-2">
                      {ingFields.length === 0 && <p className="text-xs text-muted-foreground italic">No raw ingredients</p>}
                      {ingFields.map((field, index) => (
                        <div key={field.id} className="flex gap-2">
                          <select {...register(`ingredients.${index}.ingredientId`)} className="flex-1 px-2 py-1.5 bg-background border border-border rounded-lg focus-ring appearance-none text-xs">
                            <option value={0} disabled>Select...</option>
                            {ingredients?.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                          </select>
                          <input type="number" step="0.01" {...register(`ingredients.${index}.quantity`)} className="w-16 px-2 py-1.5 bg-background border border-border rounded-lg focus-ring text-xs" />
                          <button type="button" onClick={() => removeIng(index)} className="text-muted-foreground hover:text-destructive"><X className="w-4 h-4"/></button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Sub-Recipes List */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-sm font-bold text-accent">Prep Items (Sub-recipes)</label>
                      <button type="button" onClick={() => appendSub({ subRecipeId: 0, quantity: 1 })} className="text-xs font-medium bg-secondary px-2 py-1 rounded-md hover:bg-secondary/80">
                        + Add Prep
                      </button>
                    </div>
                    <div className="space-y-2">
                      {subFields.length === 0 && <p className="text-xs text-muted-foreground italic">No prep items</p>}
                      {subFields.map((field, index) => (
                        <div key={field.id} className="flex gap-2">
                          <select {...register(`subRecipes.${index}.subRecipeId`)} className="flex-1 px-2 py-1.5 bg-background border border-border rounded-lg focus-ring appearance-none text-xs">
                            <option value={0} disabled>Select...</option>
                            {subRecipes?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                          <input type="number" step="0.01" {...register(`subRecipes.${index}.quantity`)} className="w-16 px-2 py-1.5 bg-background border border-border rounded-lg focus-ring text-xs" />
                          <button type="button" onClick={() => removeSub(index)} className="text-muted-foreground hover:text-destructive"><X className="w-4 h-4"/></button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <button type="submit" disabled={createRecipe.isPending} className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-semibold hover:bg-primary/90 transition-colors shadow-lg shadow-primary/25 disabled:opacity-50 mt-6">
                  {createRecipe.isPending ? "Saving..." : "Save Final Product"}
                </button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading && <p>Loading recipes...</p>}
        {recipes?.map((recipe) => (
          <div key={recipe.id} className="glass-panel rounded-2xl overflow-hidden hover-lift flex flex-col group">
            <div className="h-32 bg-secondary/50 relative">
              {/* Fallback image style since we don't have user uploads */}
              <div className="absolute inset-0 opacity-20 bg-[url('https://pixabay.com/get/ga68bd8da78696c5e4d6c2c3556b13a39b1673e5d3b56b1cb203909337c015a9b97f11794fe53d79bd6734bba6f8089000310715c1b82c859a8f101cbf6a7aad2_1280.jpg')] bg-cover bg-center mix-blend-multiply" />
              <div className="absolute top-4 right-4 flex gap-2">
                <button 
                  onClick={() => { if(confirm('Delete recipe?')) deleteRecipe.mutate({ id: recipe.id }) }}
                  className="w-8 h-8 rounded-full bg-background/80 backdrop-blur text-destructive flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-white"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-6 flex-1 flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <ChefHat className="w-4 h-4 text-primary" />
                <span className="text-xs font-medium text-primary uppercase tracking-wider">{recipe.category || 'General'}</span>
              </div>
              <h3 className="font-display font-bold text-xl mb-1 text-foreground">{recipe.name}</h3>
              <p className="text-sm text-muted-foreground mb-4 flex-1">Makes {recipe.servings} {recipe.servingUnit}</p>
              
              <div className="pt-4 border-t border-border flex justify-between items-center">
                <span className="text-xs text-muted-foreground">ID: PR-{recipe.id.toString().padStart(3, '0')}</span>
                <button className="text-sm font-medium text-primary hover:underline">View Spec</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
