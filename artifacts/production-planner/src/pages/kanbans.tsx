import { useState, useMemo, useCallback } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
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
  ScanLine,
  Package,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import { QrScanner } from "@/components/qr-scanner";

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

type ScanKanbanInfo = {
  id: number;
  ingredientId: number;
  ingredientName: string | null;
  ingredientUnit: string | null;
  kanbanQuantity: number | null;
  supplierId: number | null;
  supplierName: string | null;
  status: string;
  pulledAt: string | null;
  pulledByName: string | null;
  orderDayLabel: string;
  isDueToday: boolean;
  notes: string | null;
};

type ScanResult = {
  found: boolean;
  kanban?: ScanKanbanInfo;
  kanbans?: ScanKanbanInfo[];
  ingredientName?: string;
  sourceName?: string;
  sourceType?: string;
  message?: string;
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
  const debouncedSearch = useDebouncedValue(search);
  const [filterStatus, setFilterStatus] = useState("all");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newIngredientId, setNewIngredientId] = useState<number>(0);
  const [newSupplierId, setNewSupplierId] = useState<number>(0);
  const [newNotes, setNewNotes] = useState("");

  const [isScanOpen, setIsScanOpen] = useState(false);
  const [scanStep, setScanStep] = useState<"scanning" | "loading" | "result" | "pulling" | "done" | "error">("scanning");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

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

  const parseQrData = useCallback((raw: string): { type: string; id: number } | null => {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.type && parsed.id) return { type: parsed.type, id: Number(parsed.id) };
    } catch {}
    const urlMatch = raw.match(/[?&]type=([\w-]+)&id=(\d+)/);
    if (urlMatch) return { type: urlMatch[1].replace(/-/g, "_"), id: Number(urlMatch[2]) };
    const simpleMatch = raw.match(/^([\w-]+):(\d+)$/);
    if (simpleMatch) return { type: simpleMatch[1].replace(/-/g, "_"), id: Number(simpleMatch[2]) };
    const numOnly = raw.match(/^(\d+)$/);
    if (numOnly) return { type: "ingredient", id: Number(numOnly[1]) };
    return null;
  }, []);

  const handleScanQr = useCallback(async (data: string) => {
    setScanStep("loading");
    setScanError(null);
    const parsed = parseQrData(data);
    if (!parsed) {
      setScanStep("error");
      setScanError(`Could not parse QR code data: "${data}"`);
      return;
    }
    try {
      const res = await fetch(`${BASE}/api/kanbans/lookup?type=${parsed.type}&id=${parsed.id}`, { credentials: "include" });
      if (res.status === 404) {
        const errData = await res.json().catch(() => ({}));
        setScanStep("error");
        setScanError(errData.error || "Item not found");
        return;
      }
      if (!res.ok) {
        setScanStep("error");
        setScanError("Failed to look up kanban");
        return;
      }
      const result = await res.json();
      setScanResult(result);
      setScanStep("result");
    } catch {
      setScanStep("error");
      setScanError("Network error");
    }
  }, [parseQrData]);

  const handleScanPull = useCallback(async (kanbanId: number) => {
    setScanStep("pulling");
    try {
      const res = await fetch(`${BASE}/api/kanbans/${kanbanId}/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setScanStep("error");
        setScanError(errData.error || "Failed to pull kanban");
        return;
      }
      setScanStep("done");
      queryClient.invalidateQueries({ queryKey: ["/api/kanbans"] });
    } catch {
      setScanStep("error");
      setScanError("Network error");
    }
  }, [queryClient]);

  const handleScanReset = useCallback(() => {
    setScanStep("scanning");
    setScanResult(null);
    setScanError(null);
  }, []);

  const openScanDialog = useCallback(() => {
    handleScanReset();
    setIsScanOpen(true);
  }, [handleScanReset]);

  const filtered = useMemo(() => {
    let items = (kanbans ?? []) as KanbanItemData[];
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
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
  }, [kanbans, debouncedSearch, filterStatus]);

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
          <div className="flex items-center gap-2">
            <button
              onClick={openScanDialog}
              className="px-4 py-2.5 bg-blue-500 text-white border border-blue-500 rounded-xl font-medium flex items-center gap-2 hover:bg-blue-600 transition-colors shadow-md shadow-blue-500/20"
            >
              <ScanLine className="w-4 h-4" />
              Scan & Pull
            </button>
            {canEdit && (
              <>
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
              </>
            )}
          </div>
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
                          disabled={deleteMutation.isPending}
                          className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors disabled:opacity-50 disabled:pointer-events-none"
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

      <Dialog open={isScanOpen} onOpenChange={(v) => { setIsScanOpen(v); if (!v) handleScanReset(); }}>
        <DialogContent className="sm:max-w-[480px] bg-card border-border rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <ScanLine className="w-5 h-5" />
              Scan & Pull Kanban
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2">
            {scanStep === "scanning" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground text-center">
                  Scan an ingredient QR code to pull its kanban
                </p>
                <QrScanner onScan={handleScanQr} active={isScanOpen && scanStep === "scanning"} />
              </div>
            )}

            {scanStep === "loading" && (
              <div className="flex flex-col items-center gap-3 py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Looking up kanban...</p>
              </div>
            )}

            {scanStep === "result" && scanResult && (
              <div className="space-y-4">
                {scanResult.found && scanResult.kanban ? (
                  <>
                    <div className="rounded-xl border border-border bg-secondary/20 p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Package className="w-5 h-5 text-primary" />
                        <h3 className="font-semibold text-base">
                          {scanResult.kanban.ingredientName ?? `Ingredient #${scanResult.kanban.ingredientId}`}
                        </h3>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">Quantity:</span>{" "}
                          <span className="font-medium">
                            {scanResult.kanban.kanbanQuantity != null
                              ? `${scanResult.kanban.kanbanQuantity} ${scanResult.kanban.ingredientUnit ?? ""}`
                              : "—"}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Supplier:</span>{" "}
                          <span className="font-medium">{scanResult.kanban.supplierName ?? "—"}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Status:</span>{" "}
                          <span className={cn(
                            "font-medium",
                            scanResult.kanban.status === "active" ? "text-emerald-600" : "text-blue-600"
                          )}>
                            {scanResult.kanban.status.charAt(0).toUpperCase() + scanResult.kanban.status.slice(1)}
                          </span>
                        </div>
                      </div>
                    </div>
                    {scanResult.kanban.status === "active" ? (
                      <button
                        onClick={() => handleScanPull(scanResult.kanban.id)}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors shadow-md"
                      >
                        <ArrowDownCircle className="w-5 h-5" />
                        Pull Kanban
                      </button>
                    ) : (
                      <p className="text-sm text-amber-600 font-medium text-center py-2">
                        This kanban has already been pulled
                      </p>
                    )}
                    <button
                      onClick={handleScanReset}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground rounded-lg border border-border hover:bg-secondary/50 transition-colors"
                    >
                      <ScanLine className="w-4 h-4" />
                      Scan Another
                    </button>
                  </>
                ) : (
                  <div className="text-center py-6 space-y-3">
                    <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
                    <p className="font-medium">
                      {scanResult.sourceName
                        ? `No active kanban for "${scanResult.sourceName}"`
                        : scanResult.ingredientName
                        ? `No active kanban for "${scanResult.ingredientName}"`
                        : "No active kanban found"}
                    </p>
                    <p className="text-sm text-muted-foreground">{scanResult.message || "This ingredient does not have an active kanban card."}</p>
                    <button
                      onClick={handleScanReset}
                      className="flex items-center justify-center gap-2 mx-auto px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      <ScanLine className="w-4 h-4" />
                      Scan Again
                    </button>
                  </div>
                )}
              </div>
            )}

            {scanStep === "pulling" && (
              <div className="flex flex-col items-center gap-3 py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Pulling kanban...</p>
              </div>
            )}

            {scanStep === "done" && (
              <div className="flex flex-col items-center gap-4 py-10">
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
                  <CheckCircle className="w-8 h-8 text-emerald-500" />
                </div>
                <div className="text-center">
                  <p className="font-semibold text-lg">Kanban Pulled!</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {scanResult?.kanban?.ingredientName ?? "Ingredient"} has been pulled successfully.
                  </p>
                </div>
                <div className="flex gap-3 mt-2">
                  <button
                    onClick={handleScanReset}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-border hover:bg-secondary/50 transition-colors"
                  >
                    <ScanLine className="w-4 h-4" />
                    Scan Another
                  </button>
                  <button
                    onClick={() => setIsScanOpen(false)}
                    className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}

            {scanStep === "error" && (
              <div className="flex flex-col items-center gap-4 py-8">
                <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
                  <AlertTriangle className="w-7 h-7 text-destructive" />
                </div>
                <div className="text-center">
                  <p className="font-medium text-destructive">Error</p>
                  <p className="text-sm text-muted-foreground mt-1 max-w-[300px]">
                    {scanError || "Something went wrong"}
                  </p>
                </div>
                <button
                  onClick={handleScanReset}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <ScanLine className="w-4 h-4" />
                  Try Again
                </button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
