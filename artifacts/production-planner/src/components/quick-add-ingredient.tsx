import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAppMutations } from "@/hooks/use-mutations";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  unit: z.string().min(1, "Unit is required"),
  packWeight: z.coerce.number().min(0, "Must be ≥ 0"),
  costPerPack: z.coerce.number().min(0, "Must be ≥ 0"),
  brand: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface QuickAddIngredientDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Called with the newly created ingredient's id and name */
  onCreated: (ingredient: { id: number; name: string; unit: string }) => void;
}

export function QuickAddIngredientDialog({
  open,
  onOpenChange,
  onCreated,
}: QuickAddIngredientDialogProps) {
  const { createIngredient } = useAppMutations();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", unit: "kg", packWeight: 0, costPerPack: 0, brand: "", notes: "" },
  });

  const onSubmit = (data: FormValues) => {
    createIngredient.mutate(
      {
        data: {
          name: data.name,
          unit: data.unit,
          packWeight: data.packWeight,
          costPerPack: data.costPerPack,
          brand: data.brand || null,
          notes: data.notes || null,
        },
      },
      {
        onSuccess: (newIngredient) => {
          onCreated({ id: newIngredient.id, name: newIngredient.name, unit: newIngredient.unit });
          reset();
          onOpenChange(false);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] bg-card border-border rounded-2xl z-[200]">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">Quick-Add Ingredient</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Add a new ingredient to the database and it will be selected automatically.
          </p>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-sm font-medium mb-1 block">Name *</label>
              <input
                {...register("name")}
                autoFocus
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="e.g. Organic Flour"
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

          <div>
            <label className="text-sm font-medium mb-1 block">Brand (optional)</label>
            <input
              {...register("brand")}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="e.g. Shipton Mill"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Pack Size</label>
              <input
                type="number"
                step="0.001"
                {...register("packWeight")}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground mt-0.5">Qty per pack</p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Cost / Pack (£)</label>
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
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">Notes (optional)</label>
            <input
              {...register("notes")}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="Allergens, storage..."
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={() => { reset(); onOpenChange(false); }}
              className="flex-1 py-2 border border-border rounded-xl text-sm font-medium hover:bg-secondary/50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createIngredient.isPending}
              className="flex-1 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {createIngredient.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {createIngredient.isPending ? "Adding..." : "Add & Select"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
