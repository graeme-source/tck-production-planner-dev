import { useState } from "react";
import { useListRecipes, useListIngredients, useListSubRecipes, useGetRecipe } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { PageHeader } from "@/components/page-header";
import { Plus, Trash2, ChefHat, X, Edit2, Loader2 } from "lucide-react";
import { useForm, useFieldArray } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.string().optional(),
  description: z.string().optional(),
  servings: z.coerce.number().min(0.01, "Must be > 0"),
  servingUnit: z.string().min(1, "Unit is required"),
  notes: z.string().optional(),
  ingredients: z.array(z.object({
    ingredientId: z.coerce.number().min(1, "Select ingredient"),
    quantity: z.coerce.number().min(0.001, "Must be > 0"),
  })),
  subRecipes: z.array(z.object({
    subRecipeId: z.coerce.number().min(1, "Select sub-recipe"),
    quantity: z.coerce.number().min(0.001, "Must be > 0"),
  })),
});

type FormValues = z.infer<typeof schema>;

function RecipeForm({
  defaultValues,
  onSubmit,
  isPending,
  isEdit,
  ingredients,
  subRecipes,
}: {
  defaultValues: FormValues;
  onSubmit: (data: FormValues) => void;
  isPending: boolean;
  isEdit: boolean;
  ingredients: { id: number; name: string; unit: string }[];
  subRecipes: { id: number; name: string; yieldUnit: string }[];
}) {
  const { register, control, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });
  const { fields: ingFields, append: appendIng, remove: removeIng } = useFieldArray({ control, name: "ingredients" });
  const { fields: subFields, append: appendSub, remove: removeSub } = useFieldArray({ control, name: "subRecipes" });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 mt-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="text-sm font-medium mb-1 block">Product Name</label>
          <input
            {...register("name")}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="e.g. Classic Sourdough Loaf"
          />
          {errors.name && <span className="text-destructive text-xs">{errors.name.message}</span>}
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">Category</label>
          <input
            {...register("category")}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="Bread, Sauce, Pastry…"
          />
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">Output / Servings</label>
          <div className="flex gap-2">
            <input
              type="number"
              step="0.001"
              {...register("servings")}
              className="w-24 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <input
              {...register("servingUnit")}
              className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="loaf, pack, slice…"
            />
          </div>
          {errors.servings && <span className="text-destructive text-xs">{errors.servings.message}</span>}
          {errors.servingUnit && <span className="text-destructive text-xs">{errors.servingUnit.message}</span>}
        </div>
        <div className="col-span-2">
          <label className="text-sm font-medium mb-1 block">Description (optional)</label>
          <textarea
            {...register("description")}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[56px] resize-none"
            placeholder="Brief description of the product…"
          />
        </div>
      </div>

      <div className="border-t border-border pt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Raw Ingredients */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-bold text-primary">Raw Ingredients</label>
            <button
              type="button"
              onClick={() => appendIng({ ingredientId: 0, quantity: 1 })}
              className="text-xs font-medium bg-secondary px-2 py-1 rounded-md hover:bg-secondary/80 transition-colors"
            >
              + Add
            </button>
          </div>
          {ingFields.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No raw ingredients added</p>
          )}
          <div className="space-y-2">
            {ingFields.map((field, index) => (
              <div key={field.id} className="flex gap-2 items-center">
                <select
                  {...register(`ingredients.${index}.ingredientId`)}
                  className="flex-1 px-2 py-1.5 bg-background border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value={0} disabled>Select…</option>
                  {ingredients.map(i => (
                    <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.001"
                  {...register(`ingredients.${index}.quantity`)}
                  className="w-20 px-2 py-1.5 bg-background border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="Qty"
                />
                <button type="button" onClick={() => removeIng(index)} className="text-muted-foreground hover:text-destructive">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Sub-Recipes */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-bold text-accent">Prep Items (Sub-recipes)</label>
            <button
              type="button"
              onClick={() => appendSub({ subRecipeId: 0, quantity: 1 })}
              className="text-xs font-medium bg-secondary px-2 py-1 rounded-md hover:bg-secondary/80 transition-colors"
            >
              + Add
            </button>
          </div>
          {subFields.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No prep items added</p>
          )}
          <div className="space-y-2">
            {subFields.map((field, index) => (
              <div key={field.id} className="flex gap-2 items-center">
                <select
                  {...register(`subRecipes.${index}.subRecipeId`)}
                  className="flex-1 px-2 py-1.5 bg-background border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value={0} disabled>Select…</option>
                  {subRecipes.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.yieldUnit})</option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.001"
                  {...register(`subRecipes.${index}.quantity`)}
                  className="w-20 px-2 py-1.5 bg-background border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="Qty"
                />
                <button type="button" onClick={() => removeSub(index)} className="text-muted-foreground hover:text-destructive">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium mb-1 block">Notes (optional)</label>
        <textarea
          {...register("notes")}
          className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[60px] resize-none"
          placeholder="Allergens, packaging notes, shelf life…"
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
        {isPending ? "Saving..." : isEdit ? "Save Changes" : "Create Recipe"}
      </button>
    </form>
  );
}

function EditRecipeDialog({
  id,
  open,
  onOpenChange,
  ingredients,
  subRecipes,
}: {
  id: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ingredients: { id: number; name: string; unit: string }[];
  subRecipes: { id: number; name: string; yieldUnit: string }[];
}) {
  const { data: detail, isLoading } = useGetRecipe(id, { query: { enabled: open } });
  const { updateRecipe } = useAppMutations();

  if (!open) return null;

  const defaultValues: FormValues = detail
    ? {
        name: detail.name,
        category: detail.category ?? "",
        description: detail.description ?? "",
        servings: Number(detail.servings),
        servingUnit: detail.servingUnit,
        notes: detail.notes ?? "",
        ingredients: (detail.ingredients ?? []).map((i: { ingredientId: number; quantity: number }) => ({
          ingredientId: i.ingredientId,
          quantity: Number(i.quantity),
        })),
        subRecipes: (detail.subRecipes ?? []).map((s: { subRecipeId: number; quantity: number }) => ({
          subRecipeId: s.subRecipeId,
          quantity: Number(s.quantity),
        })),
      }
    : { name: "", category: "", description: "", servings: 1, servingUnit: "portion", notes: "", ingredients: [], subRecipes: [] };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Edit Recipe</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <RecipeForm
            key={id}
            defaultValues={defaultValues}
            isEdit
            isPending={updateRecipe.isPending}
            ingredients={ingredients}
            subRecipes={subRecipes}
            onSubmit={(data) => updateRecipe.mutate({ id, data }, { onSuccess: () => onOpenChange(false) })}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Recipes() {
  const { data: recipes, isLoading } = useListRecipes();
  const { data: ingredients } = useListIngredients();
  const { data: subRecipesData } = useListSubRecipes();
  const { createRecipe, deleteRecipe } = useAppMutations();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const ingredientList = ingredients ?? [];
  const subRecipeList = subRecipesData ?? [];

  const addDefaults: FormValues = {
    name: "", category: "", description: "", servings: 1, servingUnit: "portion", notes: "",
    ingredients: [], subRecipes: [],
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Final Product Recipes"
        description="Master recipes for your finished goods, combining raw ingredients and prep items."
        action={
          <button
            onClick={() => setIsAddOpen(true)}
            className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium shadow-md shadow-primary/20 flex items-center gap-2 hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-5 h-5" /> Create Recipe
          </button>
        }
      />

      {/* Add dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[700px] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">New Final Product</DialogTitle>
          </DialogHeader>
          <RecipeForm
            defaultValues={addDefaults}
            isEdit={false}
            isPending={createRecipe.isPending}
            ingredients={ingredientList}
            subRecipes={subRecipeList}
            onSubmit={(data) => createRecipe.mutate({ data }, { onSuccess: () => setIsAddOpen(false) })}
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      {editingId !== null && (
        <EditRecipeDialog
          id={editingId}
          open={editingId !== null}
          onOpenChange={(v) => { if (!v) setEditingId(null); }}
          ingredients={ingredientList}
          subRecipes={subRecipeList}
        />
      )}

      {isLoading && (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      )}

      {!isLoading && recipes?.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <ChefHat className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No recipes yet</p>
          <p className="text-sm mt-1">Create your first product recipe above.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {recipes?.map((recipe) => (
          <div
            key={recipe.id}
            className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col group hover:shadow-md transition-shadow"
          >
            <div className="h-28 bg-gradient-to-br from-primary/10 to-accent/10 relative flex items-center justify-center">
              <ChefHat className="w-10 h-10 text-primary/30" />
              <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => setEditingId(recipe.id)}
                  className="w-8 h-8 rounded-full bg-background/90 backdrop-blur text-muted-foreground flex items-center justify-center hover:text-foreground transition-colors shadow-sm"
                  title="Edit"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => { if (confirm(`Delete "${recipe.name}"?`)) deleteRecipe.mutate({ id: recipe.id }); }}
                  className="w-8 h-8 rounded-full bg-background/90 backdrop-blur text-destructive flex items-center justify-center hover:bg-destructive hover:text-white transition-colors shadow-sm"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="p-5 flex flex-col flex-1 gap-2">
              {recipe.category && (
                <span className="text-xs font-semibold text-primary uppercase tracking-wider">{recipe.category}</span>
              )}
              <h3 className="font-semibold text-lg leading-tight">{recipe.name}</h3>
              {recipe.description && (
                <p className="text-sm text-muted-foreground line-clamp-2">{recipe.description}</p>
              )}
              <div className="mt-auto pt-3 border-t border-border/60 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Makes {recipe.servings} {recipe.servingUnit}</span>
                <span className="text-xs text-muted-foreground bg-secondary/50 px-2 py-1 rounded-md">
                  PR-{recipe.id.toString().padStart(3, '0')}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
