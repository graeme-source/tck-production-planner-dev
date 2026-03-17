import { useState } from "react";
import { useListSalesEntries, useListRecipes } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { PageHeader } from "@/components/page-header";
import { TrendingUp, Plus, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const schema = z.object({
  recipeId: z.coerce.number().min(1, "Select product"),
  saleDate: z.string(),
  quantitySold: z.coerce.number().min(1),
  channel: z.string().optional(),
});

export default function Sales() {
  const { data: sales, isLoading } = useListSalesEntries();
  const { data: recipes } = useListRecipes();
  const { createSale, deleteSale } = useAppMutations();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { register, handleSubmit, reset } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { saleDate: format(new Date(), 'yyyy-MM-dd'), quantitySold: 1, channel: "Retail" }
  });

  const onSubmit = (data: z.infer<typeof schema>) => {
    createSale.mutate({ data: { ...data, saleDate: new Date(data.saleDate).toISOString() } }, {
      onSuccess: () => { setIsDialogOpen(false); reset(); }
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Sales Records" 
        description="Track product sales across different channels to inform future production plans."
        action={
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <button className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-medium shadow-md shadow-emerald-500/20 hover-lift flex items-center gap-2">
                <Plus className="w-5 h-5" /> Log Sale
              </button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] bg-card border-border rounded-2xl">
              <DialogHeader>
                <DialogTitle className="font-display text-xl">Record New Sale</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Product Sold</label>
                  <select {...register("recipeId")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring appearance-none">
                     <option value={0} disabled>Select product...</option>
                     {recipes?.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">Date</label>
                    <input type="date" {...register("saleDate")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Quantity</label>
                    <input type="number" {...register("quantitySold")} className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring" />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Sales Channel</label>
                  <input {...register("channel")} placeholder="e.g. Farmer's Market, Wholesale" className="w-full px-3 py-2 bg-background border border-border rounded-lg focus-ring" />
                </div>
                <button type="submit" disabled={createSale.isPending} className="w-full py-3 bg-emerald-600 text-white rounded-xl font-semibold mt-2 hover:bg-emerald-700">
                  Log Record
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
              <th className="px-6 py-4 font-medium">Date</th>
              <th className="px-6 py-4 font-medium">Product</th>
              <th className="px-6 py-4 font-medium">Channel</th>
              <th className="px-6 py-4 font-medium">Qty Sold</th>
              <th className="px-6 py-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {isLoading && <tr><td colSpan={5} className="p-4 text-center">Loading...</td></tr>}
            {sales?.map((sale) => (
              <tr key={sale.id} className="hover:bg-secondary/10">
                <td className="px-6 py-4 text-muted-foreground">{format(new Date(sale.saleDate), 'MMM do, yyyy')}</td>
                <td className="px-6 py-4 font-bold text-foreground">{sale.recipeName}</td>
                <td className="px-6 py-4">
                  <span className="bg-secondary px-2 py-1 rounded-md text-xs">{sale.channel || 'Direct'}</span>
                </td>
                <td className="px-6 py-4 text-emerald-600 font-bold">+{sale.quantitySold}</td>
                <td className="px-6 py-4 text-right">
                  <button onClick={() => { if(confirm('Delete?')) deleteSale.mutate({ id: sale.id }) }} className="text-destructive hover:bg-destructive/10 p-2 rounded-lg">
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
