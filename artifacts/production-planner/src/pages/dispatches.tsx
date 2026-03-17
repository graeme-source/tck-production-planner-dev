import { useState } from "react";
import { useListDispatchOrders, useListRecipes } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { PageHeader } from "@/components/page-header";
import { Truck, Plus, Trash2, CheckCircle2 } from "lucide-react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { format, isPast, isToday } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const schema = z.object({
  recipeId: z.coerce.number().min(1),
  dispatchDate: z.string(),
  quantity: z.coerce.number().min(1),
  customer: z.string().min(1),
  status: z.enum(['pending', 'dispatched', 'cancelled'])
});

export default function Dispatches() {
  const { data: dispatches, isLoading } = useListDispatchOrders();
  const { data: recipes } = useListRecipes();
  const { createDispatch, updateDispatch, deleteDispatch } = useAppMutations();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { register, handleSubmit, reset } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { dispatchDate: format(new Date(), 'yyyy-MM-dd'), quantity: 10, status: 'pending' as const, customer: "" }
  });

  const onSubmit = (data: z.infer<typeof schema>) => {
    createDispatch.mutate({ data: { ...data, dispatchDate: new Date(data.dispatchDate).toISOString() } }, {
      onSuccess: () => { setIsDialogOpen(false); reset(); }
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Dispatch Schedule" 
        description="Manage wholesale orders and outgoing deliveries."
        action={
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <button className="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-medium shadow-md shadow-blue-500/20 hover-lift flex items-center gap-2">
                <Plus className="w-5 h-5" /> Schedule Delivery
              </button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] bg-card border-border rounded-2xl">
              <DialogHeader>
                <DialogTitle className="font-display text-xl">New Dispatch Order</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Customer / Destination</label>
                  <input {...register("customer")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring" placeholder="Cafe Name" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Product</label>
                  <select {...register("recipeId")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring appearance-none">
                     <option value={0} disabled>Select product...</option>
                     {recipes?.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">Dispatch Date</label>
                    <input type="date" {...register("dispatchDate")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Quantity</label>
                    <input type="number" {...register("quantity")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring" />
                  </div>
                </div>
                <button type="submit" disabled={createDispatch.isPending} className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold mt-2 hover:bg-blue-700">
                  Schedule Order
                </button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {isLoading && <p>Loading orders...</p>}
        {dispatches?.map((order) => {
          const date = new Date(order.dispatchDate);
          const urgency = isPast(date) && order.status === 'pending' ? 'border-destructive shadow-destructive/10' : 
                         isToday(date) && order.status === 'pending' ? 'border-accent shadow-accent/10' : 'border-border';
                         
          return (
            <div key={order.id} className={`glass-panel p-6 rounded-2xl border-2 ${urgency} relative overflow-hidden`}>
              {order.status === 'dispatched' && (
                <div className="absolute -right-6 top-6 bg-emerald-500 text-white px-8 py-1 rotate-45 text-xs font-bold uppercase tracking-wider shadow-sm">
                  Shipped
                </div>
              )}
              
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-display font-bold text-xl text-foreground">{order.customer}</h3>
                  <p className="text-sm font-medium text-blue-600 mt-1">{format(date, 'EEEE, MMM do')}</p>
                </div>
                <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-muted-foreground">
                  <Truck className="w-5 h-5" />
                </div>
              </div>

              <div className="bg-secondary/40 rounded-xl p-4 mb-6">
                <div className="flex justify-between items-center">
                  <span className="font-medium">{order.recipeName}</span>
                  <span className="font-bold text-lg bg-background px-3 py-1 rounded-lg border border-border shadow-sm">x{order.quantity}</span>
                </div>
              </div>

              <div className="flex gap-2">
                {order.status === 'pending' && (
                  <button 
                    onClick={() => updateDispatch.mutate({ id: order.id, data: { status: 'dispatched' } })}
                    className="flex-1 py-2 bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400 font-medium rounded-xl text-sm flex items-center justify-center gap-2 hover:bg-emerald-100 transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Mark Dispatched
                  </button>
                )}
                <button 
                  onClick={() => { if(confirm('Delete order?')) deleteDispatch.mutate({ id: order.id }) }}
                  className="p-2 text-destructive border border-border rounded-xl hover:bg-destructive hover:text-white transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
