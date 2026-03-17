import { useState } from "react";
import { useListProductionPlans, useListRecipes } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { PageHeader } from "@/components/page-header";
import { CalendarDays, Plus, Trash2, Edit } from "lucide-react";
import { useForm, useFieldArray } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const schema = z.object({
  planDate: z.string(),
  name: z.string().min(1, "Name required"),
  notes: z.string().optional(),
  items: z.array(z.object({
    recipeId: z.coerce.number().min(1, "Select product"),
    targetQuantity: z.coerce.number().min(1, "Min 1")
  })).min(1, "Add at least one product")
});

export default function ProductionPlans() {
  const { data: plans, isLoading } = useListProductionPlans();
  const { data: recipes } = useListRecipes();
  const { createPlan, deletePlan, updatePlan } = useAppMutations();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { register, control, handleSubmit, reset } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { 
      planDate: format(new Date(), 'yyyy-MM-dd'),
      name: `Plan for ${format(new Date(), 'MMM do')}`,
      items: [{ recipeId: 0, targetQuantity: 10 }]
    }
  });
  const { fields, append, remove } = useFieldArray({ control, name: "items" });

  const onSubmit = (data: z.infer<typeof schema>) => {
    createPlan.mutate({ data: { ...data, planDate: new Date(data.planDate).toISOString() } }, {
      onSuccess: () => { setIsDialogOpen(false); reset(); }
    });
  };

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'active': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
      case 'completed': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
      default: return 'bg-secondary text-secondary-foreground';
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Production Planning" 
        description="Schedule daily production runs based on targets and orders."
        action={
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <button className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium shadow-md shadow-primary/20 hover-lift flex items-center gap-2">
                <Plus className="w-5 h-5" /> Create Plan
              </button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px] bg-card border-border rounded-2xl">
              <DialogHeader>
                <DialogTitle className="font-display text-xl">New Production Plan</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">Date</label>
                    <input type="date" {...register("planDate")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Plan Name</label>
                    <input {...register("name")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring" />
                  </div>
                </div>

                <div className="bg-secondary/20 p-4 rounded-xl border border-border/50">
                  <div className="flex justify-between items-center mb-3">
                    <label className="font-bold text-sm">Products to Produce</label>
                    <button type="button" onClick={() => append({ recipeId: 0, targetQuantity: 1 })} className="text-xs bg-background shadow-sm px-2 py-1 rounded-md border border-border">
                      + Add Target
                    </button>
                  </div>
                  <div className="space-y-2">
                    {fields.map((field, index) => (
                      <div key={field.id} className="flex gap-2">
                        <select {...register(`items.${index}.recipeId`)} className="flex-1 px-3 py-2 bg-background border border-border rounded-lg focus-ring appearance-none text-sm">
                          <option value={0} disabled>Select product...</option>
                          {recipes?.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                        <input type="number" {...register(`items.${index}.targetQuantity`)} placeholder="Qty" className="w-24 px-3 py-2 bg-background border border-border rounded-lg focus-ring text-sm" />
                        <button type="button" onClick={() => remove(index)} className="text-muted-foreground hover:text-destructive px-2">X</button>
                      </div>
                    ))}
                  </div>
                </div>

                <button type="submit" disabled={createPlan.isPending} className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-semibold hover:bg-primary/90 transition-colors mt-4">
                  Create Production Plan
                </button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="space-y-4">
        {isLoading && <p>Loading plans...</p>}
        {plans?.map((plan) => (
          <div key={plan.id} className="glass-panel p-6 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-6 hover:shadow-md transition-shadow">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 text-muted-foreground">
                <CalendarDays className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-display font-bold text-lg">{plan.name}</h3>
                <p className="text-sm text-muted-foreground">
                  Scheduled for: {format(new Date(plan.planDate), "EEEE, MMM do, yyyy")}
                </p>
                <div className="mt-2 flex gap-2">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${getStatusColor(plan.status)} uppercase tracking-wider`}>
                    {plan.status}
                  </span>
                </div>
              </div>
            </div>
            
            <div className="flex gap-3 md:flex-col lg:flex-row w-full md:w-auto">
              {plan.status === 'draft' && (
                <button 
                  onClick={() => updatePlan.mutate({ id: plan.id, data: { status: 'active' } })}
                  className="flex-1 px-4 py-2 bg-primary/10 text-primary hover:bg-primary/20 rounded-xl font-medium text-sm transition-colors"
                >
                  Start Production
                </button>
              )}
              {plan.status === 'active' && (
                <button 
                  onClick={() => updatePlan.mutate({ id: plan.id, data: { status: 'completed' } })}
                  className="flex-1 px-4 py-2 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 rounded-xl font-medium text-sm transition-colors"
                >
                  Mark Completed
                </button>
              )}
              <button className="p-2 border border-border text-muted-foreground rounded-xl hover:bg-secondary transition-colors" title="Edit Plan">
                <Edit className="w-4 h-4" />
              </button>
              <button 
                onClick={() => { if(confirm('Delete?')) deletePlan.mutate({ id: plan.id }) }}
                className="p-2 border border-border text-destructive hover:bg-destructive/10 rounded-xl transition-colors" 
                title="Delete Plan"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
