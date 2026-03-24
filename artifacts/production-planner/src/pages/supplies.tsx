import { useState, useEffect } from "react";
import { useListStockItems, useListSuppliers } from "@workspace/api-client-react";
import type { StockItem } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { PageHeader } from "@/components/page-header";
import { Search, Plus, Trash2, Edit2, Loader2, ExternalLink, Settings2, X } from "lucide-react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface StockItemCategory {
  id: number;
  name: string;
  created_at: string;
}

function useCategories() {
  const [categories, setCategories] = useState<StockItemCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCategories = async () => {
    try {
      const res = await fetch(`${BASE}/api/stock-items/categories/list`, { credentials: "include" });
      if (res.ok) setCategories(await res.json());
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { fetchCategories(); }, []);

  return { categories, loading, refetch: fetchCategories };
}

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.string().min(1, "Category is required"),
  unit: z.string().min(1, "Unit is required"),
  packWeight: z.coerce.number().min(0, "Must be positive"),
  costPerPack: z.coerce.number().min(0, "Must be positive"),
  supplierPartNumber: z.string().optional(),
  supplierId: z.coerce.number().optional(),
  secondarySupplierId: z.coerce.number().optional(),
  orderingUrl: z.string().optional(),
  notes: z.string().optional(),
  stockCheckEnabled: z.boolean().optional(),
  stockCheckFrequency: z.enum(["daily", "weekly"]).optional(),
  stockCheckDay: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

const emptyDefaults: FormValues = {
  name: "", category: "", unit: "each", packWeight: 0, costPerPack: 0,
  supplierPartNumber: "", supplierId: 0, secondarySupplierId: 0,
  orderingUrl: "", notes: "", stockCheckEnabled: false,
  stockCheckFrequency: "daily", stockCheckDay: "",
};

function CategoryManager({ categories, onRefetch }: { categories: StockItemCategory[]; onRefetch: () => void }) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);

  const addCategory = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/stock-items/categories`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) { setNewName(""); onRefetch(); }
    } finally { setSaving(false); }
  };

  const updateCategory = async (id: number) => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      await fetch(`${BASE}/api/stock-items/categories/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ name: editName.trim() }),
      });
      setEditId(null);
      onRefetch();
    } finally { setSaving(false); }
  };

  const deleteCategory = async (id: number) => {
    if (!confirm("Delete this category? Stock items using it will not be removed.")) return;
    await fetch(`${BASE}/api/stock-items/categories/${id}`, {
      method: "DELETE", credentials: "include",
    });
    onRefetch();
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2.5 border border-border rounded-xl font-medium flex items-center gap-2 hover:bg-secondary/50 transition-colors text-sm"
      >
        <Settings2 className="w-4 h-4" /> Categories
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[420px] bg-card border-border rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Manage Categories</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div className="flex gap-2">
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="New category name"
                className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                onKeyDown={e => e.key === "Enter" && addCategory()}
              />
              <button
                onClick={addCategory}
                disabled={saving || !newName.trim()}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50"
              >
                Add
              </button>
            </div>
            <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
              {categories.length === 0 && (
                <div className="p-4 text-center text-sm text-muted-foreground">No categories yet</div>
              )}
              {categories.map(cat => (
                <div key={cat.id} className="flex items-center gap-2 px-4 py-2.5">
                  {editId === cat.id ? (
                    <>
                      <input
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        className="flex-1 px-2 py-1 bg-background border border-border rounded text-sm"
                        onKeyDown={e => e.key === "Enter" && updateCategory(cat.id)}
                        autoFocus
                      />
                      <button onClick={() => updateCategory(cat.id)} className="text-primary text-xs font-medium">Save</button>
                      <button onClick={() => setEditId(null)} className="text-muted-foreground text-xs">Cancel</button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm">{cat.name}</span>
                      <button
                        onClick={() => { setEditId(cat.id); setEditName(cat.name); }}
                        className="text-muted-foreground hover:text-foreground p-1"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => deleteCategory(cat.id)}
                        className="text-muted-foreground hover:text-destructive p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function Supplies() {
  const { data: stockItems, isLoading } = useListStockItems();
  const { data: suppliers } = useListSuppliers();
  const { createStockItem, updateStockItem, deleteStockItem } = useAppMutations();
  const { categories, refetch: refetchCategories } = useCategories();

  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const filtered = stockItems?.filter(i => {
    const matchesSearch = i.name.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = filterCategory === "all" || i.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const supplierMap = Object.fromEntries((suppliers ?? []).map(s => [s.id, s.name]));

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: emptyDefaults,
  });

  const watchedUnit = watch("unit");
  const watchedPackWeight = watch("packWeight");
  const watchedCostPerPack = watch("costPerPack");
  const watchedStockCheckEnabled = watch("stockCheckEnabled");
  const watchedStockCheckFrequency = watch("stockCheckFrequency");
  const liveCostPerUnit = watchedPackWeight > 0 ? watchedCostPerPack / watchedPackWeight : null;

  const openAdd = () => {
    setEditingId(null);
    reset(emptyDefaults);
    setIsDialogOpen(true);
  };

  const openEdit = (item: StockItem) => {
    setEditingId(item.id);
    reset({
      name: item.name,
      category: item.category,
      unit: item.unit,
      packWeight: Number(item.packWeight),
      costPerPack: Number(item.costPerPack),
      supplierPartNumber: item.supplierPartNumber ?? "",
      supplierId: item.supplierId ?? 0,
      secondarySupplierId: item.secondarySupplierId ?? 0,
      orderingUrl: item.orderingUrl ?? "",
      notes: item.notes ?? "",
      stockCheckEnabled: item.stockCheckEnabled ?? false,
      stockCheckFrequency: (item.stockCheckFrequency as "daily" | "weekly") ?? "daily",
      stockCheckDay: item.stockCheckDay ?? "",
    });
    setIsDialogOpen(true);
  };

  const buildPayload = (data: FormValues) => ({
    name: data.name,
    category: data.category,
    unit: data.unit,
    packWeight: data.packWeight,
    costPerPack: data.costPerPack,
    supplierPartNumber: data.supplierPartNumber || null,
    supplierId: data.supplierId && data.supplierId > 0 ? data.supplierId : null,
    secondarySupplierId: data.secondarySupplierId && data.secondarySupplierId > 0 ? data.secondarySupplierId : null,
    orderingUrl: data.orderingUrl || null,
    notes: data.notes || null,
    stockCheckEnabled: data.stockCheckEnabled ?? false,
    stockCheckFrequency: data.stockCheckFrequency ?? "daily",
    stockCheckDay: data.stockCheckFrequency === "weekly" ? (data.stockCheckDay || null) : null,
  });

  const onSubmit = (data: FormValues) => {
    if (editingId !== null) {
      updateStockItem.mutate({ id: editingId, data: buildPayload(data) }, {
        onSuccess: () => { setIsDialogOpen(false); reset(); setEditingId(null); }
      });
    } else {
      createStockItem.mutate({ data: buildPayload(data) }, {
        onSuccess: () => { setIsDialogOpen(false); reset(); }
      });
    }
  };

  const isPending = createStockItem.isPending || updateStockItem.isPending;

  const categoryNames = categories.map(c => c.name);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Non Perishable Stock"
        description="Manage packaging, cleaning materials, chemicals and other non-food items."
        action={
          <div className="flex items-center gap-2">
            <CategoryManager categories={categories} onRefetch={refetchCategories} />
            <button
              onClick={openAdd}
              className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium shadow-md shadow-primary/20 flex items-center gap-2 hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-5 h-5" /> Add Item
            </button>
          </div>
        }
      />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[620px] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {editingId !== null ? "Edit Stock Item" : "Add New Stock Item"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 mt-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="text-sm font-medium mb-1 block">Name *</label>
                <input
                  {...register("name")}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="e.g. Pizza Box 12 inch"
                />
                {errors.name && <span className="text-destructive text-xs">{errors.name.message}</span>}
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Unit *</label>
                <select
                  {...register("unit")}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="each">each</option>
                  <option value="pcs">pcs</option>
                  <option value="box">box</option>
                  <option value="bag">bag</option>
                  <option value="roll">roll</option>
                  <option value="pack">pack</option>
                  <option value="bottle">bottle</option>
                  <option value="tub">tub</option>
                  <option value="kg">kg</option>
                  <option value="g">g</option>
                  <option value="l">L</option>
                  <option value="ml">ml</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Category *</label>
              <select
                {...register("category")}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">— Select category —</option>
                {categoryNames.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              {errors.category && <span className="text-destructive text-xs">{errors.category.message}</span>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Pack size ({watchedUnit || "unit"}) *
                </label>
                <input
                  type="number"
                  step="0.001"
                  {...register("packWeight")}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="e.g. 100"
                />
                <p className="text-xs text-muted-foreground mt-1">How many {watchedUnit || "units"} in one pack</p>
                {errors.packWeight && <span className="text-destructive text-xs">{errors.packWeight.message}</span>}
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Cost per pack (£) *</label>
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
                {errors.costPerPack && <span className="text-destructive text-xs">{errors.costPerPack.message}</span>}
              </div>
            </div>
            {liveCostPerUnit !== null && (
              <div className="rounded-lg bg-secondary/30 border border-border px-3.5 py-2.5 text-sm flex items-center justify-between">
                <span className="text-muted-foreground">Implied cost per {watchedUnit || "unit"}:</span>
                <span className="font-semibold tabular-nums">
                  £{liveCostPerUnit.toFixed(4)} / {watchedUnit || "unit"}
                </span>
              </div>
            )}

            <div>
              <label className="text-sm font-medium mb-1 block">Supplier Part Number</label>
              <input
                {...register("supplierPartNumber")}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="e.g. PKG-BOX-12"
              />
            </div>

            <div className="flex items-center gap-3 py-1">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  {...register("stockCheckEnabled")}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
              </label>
              <div>
                <span className="text-sm font-medium">Requires Stock Check</span>
                <p className="text-xs text-muted-foreground">
                  When enabled, this item will appear in stock checks alongside ingredients.
                </p>
              </div>
            </div>

            {watchedStockCheckEnabled && (
              <div className="pl-4 border-l-2 border-primary/20 flex flex-col gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Check Frequency</label>
                  <select
                    {...register("stockCheckFrequency")}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>
                {watchedStockCheckFrequency === "weekly" && (
                  <div>
                    <label className="text-sm font-medium mb-1 block">Check Day</label>
                    <select
                      {...register("stockCheckDay")}
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      <option value="">— Select a day —</option>
                      {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Supplier</label>
                <select
                  {...register("supplierId")}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value={0}>— None —</option>
                  {(suppliers ?? []).map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Secondary Supplier</label>
                <select
                  {...register("secondarySupplierId")}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value={0}>— None —</option>
                  {(suppliers ?? []).map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Ordering URL</label>
              <input
                {...register("orderingUrl")}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="https://supplier.co.uk/product/boxes"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Notes</label>
              <textarea
                {...register("notes")}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[64px] resize-none"
                placeholder="Storage instructions, handling notes..."
              />
            </div>

            <button
              type="submit"
              disabled={isPending}
              className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {isPending ? "Saving..." : editingId !== null ? "Save Changes" : "Add Item"}
            </button>
          </form>
        </DialogContent>
      </Dialog>

      <div className="rounded-2xl border border-border overflow-hidden bg-card">
        <div className="p-4 border-b border-border flex flex-wrap items-center gap-3 bg-secondary/20">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name..."
              className="w-full pl-9 pr-4 py-2 bg-background border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setFilterCategory("all")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filterCategory === "all"
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/50 text-muted-foreground hover:text-foreground"
              }`}
            >
              All
            </button>
            {categoryNames.map(cat => (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filterCategory === cat
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary/50 text-muted-foreground hover:text-foreground"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <span className="text-sm text-muted-foreground whitespace-nowrap ml-auto">{filtered?.length ?? 0} items</span>
        </div>

        {isLoading ? (
          <div className="p-12 flex justify-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : filtered?.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <p className="text-lg font-medium">No stock items found</p>
            <p className="text-sm mt-1">Add your first non-food stock item to get started</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-secondary/30 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium text-right">Pack Size</th>
                  <th className="px-4 py-3 font-medium text-right">Cost</th>
                  <th className="px-4 py-3 font-medium">Supplier</th>
                  <th className="px-4 py-3 font-medium text-center">Stock Check</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filtered?.map(item => (
                  <tr key={item.id} className="hover:bg-secondary/10 transition-colors">
                    <td className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-2">
                        {item.name}
                        {item.orderingUrl && (
                          <a href={item.orderingUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                      {item.supplierPartNumber && (
                        <span className="text-xs text-muted-foreground font-mono">{item.supplierPartNumber}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-1 rounded-md bg-secondary/50 text-foreground">
                        {item.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {item.packWeight} {item.unit}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      £{Number(item.costPerPack).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {item.supplierId ? supplierMap[item.supplierId] ?? "—" : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {item.stockCheckEnabled ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                          {item.stockCheckFrequency === "weekly" ? `Weekly (${item.stockCheckDay ?? ""})` : "Daily"}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(item)}
                          className="text-primary hover:bg-primary/10 p-1.5 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete "${item.name}"?`))
                              deleteStockItem.mutate({ id: item.id });
                          }}
                          className="text-destructive hover:bg-destructive/10 p-1.5 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
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
