import { useState, useMemo } from "react";
import { useListKanbans, useListIngredients, useListSuppliers } from "@workspace/api-client-react";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Plus,
  Trash2,
  ArrowDownCircle,
  ShoppingCart,
  Clock,
  CheckCircle2,
  Search,
  Building2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { format } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type KanbanItemData = {
  id: number;
  ingredientId: number;
  ingredientName: string | null;
  ingredientUnit: string | null;
  kanbanQuantity: number | null;
  supplierId: number | null;
  supplierName: string | null;
  orderFrequency: string;
  orderDays: string | null;
  status: string;
  pulledAt: string | null;
  pulledByUserId: number | null;
  pulledByName: string | null;
  orderDayTarget: string | null;
  orderDayLabel: string;
  isDueToday: boolean;
  notes: string | null;
  createdAt: string | null;
};

function StatusBadge({ status, orderDayLabel, isDueToday }: { status: string; orderDayLabel: string; isDueToday: boolean }) {
  if (status === "ordered") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600">
        <CheckCircle2 className="w-3 h-3" /> Ordered
      </span>
    );
  }
  if (status === "pulled") {
    if (isDueToday) {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600">
          <AlertCircle className="w-3 h-3" /> Due today
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-600">
        <Clock className="w-3 h-3" /> {orderDayLabel}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-secondary text-muted-foreground">
      Active
    </span>
  );
}

export default function Kanbans() {
  const { data: kanbans, isLoading } = useListKanbans();
  const { data: ingredients } = useListIngredients();
  const { data: suppliers } = useListSuppliers();
  const { state } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canEdit = state.status === "authenticated" && (state.user.role === "admin" || state.user.role === "manager");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newIngredientId, setNewIngredientId] = useState<number>(0);
  const [newSupplierId, setNewSupplierId] = useState<number>(0);
  const [newNotes, setNewNotes] = useState("");

  const kanbanIngredients = useMemo(() => {
    return (ingredients ?? []).filter((i: any) => i.kanbanEnabled);
  }, [ingredients]);

  const createMutation = useMutation({
    mutationFn: async (data: { ingredientId: number; supplierId: number | null; notes: string | null }) => {
      const res = await fetch(`${BASE}/api/kanbans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to create");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kanbans"] });
      setIsAddOpen(false);
      setNewIngredientId(0);
      setNewSupplierId(0);
      setNewNotes("");
      toast({ title: "Success", description: "Kanban created" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const pullMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}/api/kanbans/${id}/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to pull");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kanbans"] });
      toast({ title: "Success", description: "Kanban pulled" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const orderMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}/api/kanbans/${id}/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to mark ordered");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kanbans"] });
      toast({ title: "Success", description: "Kanban marked as ordered" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}/api/kanbans/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kanbans"] });
      toast({ title: "Success", description: "Kanban deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/kanbans/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Sync failed");
      return res.json() as Promise<{ created: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/kanbans"] });
      toast({
        title: "Sync complete",
        description: data.created === 0
          ? "All kanban-enabled ingredients already have cards."
          : `Created ${data.created} new kanban card${data.created === 1 ? "" : "s"}.`,
      });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const filtered = useMemo(() => {
    let items = (kanbans ?? []) as KanbanItemData[];
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(k =>
        (k.ingredientName ?? "").toLowerCase().includes(q) ||
        (k.supplierName ?? "").toLowerCase().includes(q)
      );
    }
    if (filterStatus !== "all") {
      if (filterStatus === "due") {
        items = items.filter(k => k.status === "pulled" && k.isDueToday);
      } else {
        items = items.filter(k => k.status === filterStatus);
      }
    }
    return items;
  }, [kanbans, search, filterStatus]);

  const grouped = useMemo(() => {
    const map = new Map<string, KanbanItemData[]>();
    for (const k of filtered) {
      const key = k.supplierName ?? "No Supplier";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(k);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const dueCount = ((kanbans ?? []) as KanbanItemData[]).filter(k => k.status === "pulled" && k.isDueToday).length;
  const pulledCount = ((kanbans ?? []) as KanbanItemData[]).filter(k => k.status === "pulled").length;
  const activeCount = ((kanbans ?? []) as KanbanItemData[]).filter(k => k.status === "active").length;

  const handleCreate = () => {
    if (!newIngredientId) return;
    const ing = (ingredients ?? []).find((i: any) => i.id === newIngredientId) as any;
    createMutation.mutate({
      ingredientId: newIngredientId,
      supplierId: newSupplierId > 0 ? newSupplierId : (ing?.supplierId ?? null),
      notes: newNotes || null,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kanbans"
        description="Track kanban pulls and order scheduling. Pull a kanban when stock runs low, and it will queue for ordering on the supplier's next order day."
        action={
          canEdit ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                className="px-4 py-2.5 bg-secondary text-foreground border border-border rounded-xl font-medium flex items-center gap-2 hover:bg-secondary/80 transition-colors disabled:opacity-50"
                title="Create kanban cards for all kanban-enabled ingredients that don't have one yet"
              >
                {syncMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Sync from Ingredients
              </button>
              <button
                onClick={() => setIsAddOpen(true)}
                className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium shadow-md shadow-primary/20 flex items-center gap-2 hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-5 h-5" /> New Kanban
              </button>
            </div>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-border bg-card p-4 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-amber-500/10">
            <AlertCircle className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums">{dueCount}</p>
            <p className="text-xs text-muted-foreground">Due today</p>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-blue-500/10">
            <Clock className="w-5 h-5 text-blue-500" />
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums">{pulledCount}</p>
            <p className="text-xs text-muted-foreground">Pulled (pending)</p>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-secondary">
            <ArrowDownCircle className="w-5 h-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums">{activeCount}</p>
            <p className="text-xs text-muted-foreground">Active (not pulled)</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by ingredient or supplier..."
            className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="pulled">Pulled</option>
          <option value="due">Due Today</option>
          <option value="ordered">Ordered</option>
        </select>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <ArrowDownCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No kanbans found</p>
          <p className="text-sm mt-1">Enable kanban tracking on ingredients, then create kanban items here.</p>
        </div>
      )}

      {grouped.map(([supplierName, items]) => (
        <div key={supplierName} className="rounded-2xl border border-border overflow-hidden bg-card">
          <div className="px-5 py-3 bg-secondary/30 border-b border-border flex items-center gap-2">
            <Building2 className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">{supplierName}</h3>
            <span className="text-xs text-muted-foreground ml-auto">
              {items.length} {items.length === 1 ? "kanban" : "kanbans"}
            </span>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-secondary/10 text-muted-foreground">
              <tr>
                <th className="px-5 py-2.5 font-medium">Ingredient</th>
                <th className="px-5 py-2.5 font-medium">Order when using last</th>
                <th className="px-5 py-2.5 font-medium">Status</th>
                <th className="px-5 py-2.5 font-medium">Pulled By</th>
                <th className="px-5 py-2.5 font-medium">Pulled At</th>
                {canEdit && <th className="px-5 py-2.5 font-medium text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {items.map(k => (
                <tr key={k.id} className={cn(
                  "transition-colors",
                  k.status === "pulled" && k.isDueToday && "bg-amber-50/50 dark:bg-amber-950/10"
                )}>
                  <td className="px-5 py-3 font-medium">{k.ingredientName ?? `#${k.ingredientId}`}</td>
                  <td className="px-5 py-3 text-muted-foreground tabular-nums">
                    {k.kanbanQuantity != null ? `${k.kanbanQuantity} ${k.ingredientUnit ?? ""}` : "—"}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={k.status} orderDayLabel={k.orderDayLabel} isDueToday={k.isDueToday} />
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{k.pulledByName ?? "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground text-xs">
                    {k.pulledAt ? format(new Date(k.pulledAt), "MMM do, h:mm a") : "—"}
                  </td>
                  {canEdit && (
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {k.status === "active" && (
                          <button
                            onClick={() => pullMutation.mutate(k.id)}
                            disabled={pullMutation.isPending}
                            className="px-2.5 py-1 bg-primary text-primary-foreground rounded-lg text-xs font-medium flex items-center gap-1 hover:bg-primary/90 transition-colors disabled:opacity-50"
                            title="Pull kanban"
                          >
                            <ArrowDownCircle className="w-3 h-3" /> Pull
                          </button>
                        )}
                        {k.status === "pulled" && k.isDueToday && (
                          <button
                            onClick={() => orderMutation.mutate(k.id)}
                            disabled={orderMutation.isPending}
                            className="px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-xs font-medium flex items-center gap-1 hover:bg-emerald-600/90 transition-colors disabled:opacity-50"
                            title="Mark as ordered"
                          >
                            <ShoppingCart className="w-3 h-3" /> Order
                          </button>
                        )}
                        <button
                          onClick={() => { if (confirm("Delete this kanban?")) deleteMutation.mutate(k.id); }}
                          className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[480px] bg-card border-border rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">New Kanban</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Ingredient *</label>
              <select
                value={newIngredientId}
                onChange={e => {
                  const id = Number(e.target.value);
                  setNewIngredientId(id);
                  const ing = (ingredients ?? []).find((i: any) => i.id === id) as any;
                  if (ing?.supplierId) setNewSupplierId(ing.supplierId);
                }}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value={0}>— Select ingredient —</option>
                {kanbanIngredients.map((i: any) => (
                  <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>
                ))}
              </select>
              {kanbanIngredients.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">No kanban-enabled ingredients. Enable kanban tracking in the ingredient edit form first.</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Supplier</label>
              <select
                value={newSupplierId}
                onChange={e => setNewSupplierId(Number(e.target.value))}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value={0}>— None —</option>
                {(suppliers ?? []).map((s: any) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Notes</label>
              <textarea
                value={newNotes}
                onChange={e => setNewNotes(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[60px] resize-none"
                placeholder="Optional notes..."
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={!newIngredientId || createMutation.isPending}
              className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {createMutation.isPending ? "Creating..." : "Create Kanban"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
