/**
 * Thin wrapper around the full IngredientFormDialog used by the recipe
 * and sub-recipe edit screens. Before, this offered a stripped-down
 * five-field form which meant operators had to save the recipe, leave
 * to add a supplier / category / packaging detail in Inventory, then
 * come back — exactly the friction the user flagged. Now it surfaces
 * the same full form Inventory uses, so an ingredient can be created
 * end-to-end without leaving the recipe screen.
 *
 * `lockMode="ingredient"` hides the ingredient/supply toggle since
 * a recipe is always pulling in food items, not packaging.
 */
import { useListSuppliers } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import {
  IngredientFormDialog,
} from "@/components/ingredient-form-dialog";
import {
  buildIngredientPayload,
  type IngredientFormValues,
} from "@/lib/ingredient-form";

interface QuickAddIngredientDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Fired with the newly-created ingredient so the parent can select
   *  it into the row that opened the dialog. */
  onCreated: (ingredient: { id: number; name: string; unit: string }) => void;
}

export function QuickAddIngredientDialog({ open, onOpenChange, onCreated }: QuickAddIngredientDialogProps) {
  const { createIngredient } = useAppMutations();
  const { data: suppliers } = useListSuppliers();

  const handleSave = (data: IngredientFormValues) => {
    const payload = buildIngredientPayload(data);
    createIngredient.mutate(
      { data: payload },
      {
        onSuccess: (newIngredient) => {
          onCreated({ id: newIngredient.id, name: newIngredient.name, unit: newIngredient.unit });
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <IngredientFormDialog
      open={open}
      onClose={() => onOpenChange(false)}
      editingItem={null}
      defaultMode="ingredient"
      lockMode
      suppliers={suppliers ?? []}
      onSave={handleSave}
    />
  );
}
