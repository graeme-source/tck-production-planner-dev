import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  ShoppingCart,
  Package,
  Building2,
  Check,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Truck,
  Filter,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type OrderLine = {
  ingredientId: number;
  ingredientName: string;
  unit: string;
  totalRequired: number;
  stockOnHand: number;
  surplusTarget: number;
  packWeight: number;
  costPerPack: number;
  supplierPartNumber: string | null;
  orderQty: number;
  packsToOrder: number;
  isKanban: boolean;
};

type SupplierOrder = {
  supplier: {
    id: number;
    name: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    website: string | null;
  };
  lines: OrderLine[];
};

type CalculateResponse = {
  planId: number;
  planName: string;
  planDate: string;
  suppliers: SupplierOrder[];
};

type PurchaseOrder = {
  id: number;
  supplierId: number;
  supplierName: string | null;
  planId: number | null;
  status: string;
  createdAt: string;
  placedAt: string | null;
  notes: string | null;
  lines: Array<{
    id: number;
    ingredientId: number;
    ingredientName: string | null;
    quantityRequired: string;
    quantityOrdered: string;
    unit: string;
    unitPrice: string | null;
    checkedOff: boolean;
  }>;
};

type Plan = {
  id: number;
  name: string;
  planDate: string;
  status: string;
};

type EditableLine = OrderLine & {
  checked: boolean;
  editedPacks: number;
};

export default function Orders() {
  const queryClient = useQueryClient();
  const urlPlanId = useRef<number | null>(
    (() => {
      const p = new URLSearchParams(window.location.search).get("planId");
      return p ? Number(p) : null;
    })()
  );
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(urlPlanId.current);
  const [viewFilter, setViewFilter] = useState<"pending" | "placed">("pending");
  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<number>>(new Set());
  const [editableLines, setEditableLines] = useState<Record<number, EditableLine[]>>({});
  const [confirmDialog, setConfirmDialog] = useState<{ supplierId: number; supplierName: string } | null>(null);

  const { data: plans } = useQuery<Plan[]>({
    queryKey: ["production-plans-list"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/production-plans`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load plans");
      return res.json();
    },
  });

  useEffect(() => {
    if (plans && plans.length > 0 && !selectedPlanId) {
      const activePlan = plans.find(p => p.status === "active") ?? plans[0];
      setSelectedPlanId(activePlan.id);
    }
  }, [plans, selectedPlanId]);

  const { data: calculated, isLoading: calcLoading, error: calcError } = useQuery<CalculateResponse>({
    queryKey: ["order-calculate", selectedPlanId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/orders/calculate?planId=${selectedPlanId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to calculate orders");
      return res.json();
    },
    enabled: !!selectedPlanId,
  });

  const { data: placedOrders = [] } = useQuery<PurchaseOrder[]>({
    queryKey: ["purchase-orders-today"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/orders/purchase-orders?filter=today`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load orders");
      return res.json();
    },
  });

  useEffect(() => {
    if (calculated?.suppliers) {
      const newLines: Record<number, EditableLine[]> = {};
      for (const so of calculated.suppliers) {
        newLines[so.supplier.id] = so.lines.map(l => ({
          ...l,
          checked: false,
          editedPacks: l.packsToOrder,
        }));
      }
      setEditableLines(newLines);
      setExpandedSuppliers(new Set(calculated.suppliers.map(s => s.supplier.id)));
    }
  }, [calculated]);

  const placeMutation = useMutation({
    mutationFn: async ({ supplierId, lines }: { supplierId: number; lines: EditableLine[] }) => {
      const createRes = await fetch(`${BASE}/api/orders/purchase-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          supplierId,
          planId: selectedPlanId,
          lines: lines.map(l => ({
            ingredientId: l.ingredientId,
            quantityRequired: l.orderQty,
            quantityOrdered: l.editedPacks * l.packWeight,
            unit: l.unit,
            unitPrice: l.costPerPack > 0 ? l.costPerPack : null,
            checkedOff: l.checked,
          })),
        }),
      });
      if (!createRes.ok) throw new Error("Failed to create order");
      const order = await createRes.json();

      const placeRes = await fetch(`${BASE}/api/orders/purchase-orders/${order.id}/place`, {
        method: "PATCH",
        credentials: "include",
      });
      if (!placeRes.ok) throw new Error("Failed to place order");
      return placeRes.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders-today"] });
      queryClient.invalidateQueries({ queryKey: ["order-calculate"] });
      setConfirmDialog(null);
    },
  });

  const toggleSupplier = (id: number) => {
    setExpandedSuppliers(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleLineCheck = useCallback((supplierId: number, idx: number) => {
    setEditableLines(prev => {
      const updated = { ...prev };
      const lines = [...(updated[supplierId] || [])];
      lines[idx] = { ...lines[idx], checked: !lines[idx].checked };
      updated[supplierId] = lines;
      return updated;
    });
  }, []);

  const updatePacks = useCallback((supplierId: number, idx: number, packs: number) => {
    setEditableLines(prev => {
      const updated = { ...prev };
      const lines = [...(updated[supplierId] || [])];
      lines[idx] = { ...lines[idx], editedPacks: Math.max(0, packs) };
      updated[supplierId] = lines;
      return updated;
    });
  }, []);

  const handlePlaceOrder = (supplierId: number, supplierName: string) => {
    setConfirmDialog({ supplierId, supplierName });
  };

  const confirmPlaceOrder = () => {
    if (!confirmDialog) return;
    const lines = editableLines[confirmDialog.supplierId] || [];
    placeMutation.mutate({ supplierId: confirmDialog.supplierId, lines });
  };

  const suppliers = calculated?.suppliers ?? [];
  const placedSupplierIds = new Set(placedOrders.filter(o => o.status === "placed").map(o => o.supplierId));
  const pendingSuppliers = suppliers.filter(s => !placedSupplierIds.has(s.supplier.id));
  const totalPendingItems = pendingSuppliers.reduce((sum, s) => sum + s.lines.length, 0);
  const totalPlacedToday = placedOrders.filter(o => o.status === "placed").length;

  const estimatedCost = (supplierLines: EditableLine[]) =>
    supplierLines.reduce((sum, l) => sum + l.editedPacks * l.costPerPack, 0);

  const totalEstimatedCost = Object.values(editableLines).reduce(
    (sum, lines) => sum + estimatedCost(lines), 0
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Orders</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Calculate and place supplier orders based on production plan requirements
          </p>
        </div>

        <select
          value={selectedPlanId ?? ""}
          onChange={e => setSelectedPlanId(Number(e.target.value) || null)}
          className="h-10 px-3 rounded-lg border border-border bg-background text-sm w-full sm:w-auto sm:min-w-[240px]"
        >
          <option value="">Select plan...</option>
          {plans?.map(p => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.planDate})
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{pendingSuppliers.length}</p>
              <p className="text-xs text-muted-foreground">Suppliers to order from</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Package className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalPendingItems}</p>
              <p className="text-xs text-muted-foreground">Items to order</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalPlacedToday}</p>
              <p className="text-xs text-muted-foreground">Orders placed today</p>
            </div>
          </div>
        </div>
      </div>

      {totalEstimatedCost > 0 && (
        <div className="rounded-xl border border-border bg-card/50 p-3 text-sm text-muted-foreground flex items-center gap-2">
          <ShoppingCart className="w-4 h-4" />
          Estimated total: <span className="font-semibold text-foreground">&pound;{totalEstimatedCost.toFixed(2)}</span>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => setViewFilter("pending")}
          className={cn(
            "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
            viewFilter === "pending"
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
          )}
        >
          <Filter className="w-4 h-4 inline mr-1.5" />
          To Order ({pendingSuppliers.length})
        </button>
        <button
          onClick={() => setViewFilter("placed")}
          className={cn(
            "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
            viewFilter === "placed"
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
          )}
        >
          <CheckCircle2 className="w-4 h-4 inline mr-1.5" />
          Placed Today ({totalPlacedToday})
        </button>
      </div>

      {calcLoading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          Calculating order requirements...
        </div>
      )}

      {calcError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-destructive flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          {calcError instanceof Error ? calcError.message : "Failed to calculate orders"}
        </div>
      )}

      {!calcLoading && !selectedPlanId && (
        <div className="text-center py-12 text-muted-foreground">
          Select a production plan above to calculate order requirements.
        </div>
      )}

      {viewFilter === "pending" && !calcLoading && pendingSuppliers.length === 0 && selectedPlanId && (
        <div className="text-center py-12 text-muted-foreground">
          No pending orders. All supplier orders have been placed or no ingredients need ordering.
        </div>
      )}

      {viewFilter === "pending" && pendingSuppliers.map(so => {
        const lines = editableLines[so.supplier.id] || [];
        const allChecked = lines.length > 0 && lines.every(l => l.checked);
        const checkedCount = lines.filter(l => l.checked).length;
        const expanded = expandedSuppliers.has(so.supplier.id);
        const cost = estimatedCost(lines);

        return (
          <div key={so.supplier.id} className="rounded-xl border border-border bg-card overflow-hidden">
            <button
              onClick={() => toggleSupplier(so.supplier.id)}
              className="w-full flex items-center justify-between p-4 hover:bg-secondary/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-primary" />
                </div>
                <div className="text-left">
                  <h3 className="font-semibold">{so.supplier.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {lines.length} item{lines.length !== 1 ? "s" : ""} &middot;
                    {checkedCount}/{lines.length} checked
                    {cost > 0 && <> &middot; &pound;{cost.toFixed(2)} est.</>}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {so.supplier.website && (
                  <a
                    href={so.supplier.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                    title="Open supplier website"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
                {expanded ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
              </div>
            </button>

            {expanded && (
              <div className="border-t border-border">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-secondary/30">
                        <th className="p-3 text-left w-10"></th>
                        <th className="p-3 text-left font-medium text-muted-foreground">Ingredient</th>
                        <th className="p-3 text-right font-medium text-muted-foreground">Required</th>
                        <th className="p-3 text-right font-medium text-muted-foreground">In Stock</th>
                        <th className="p-3 text-right font-medium text-muted-foreground">Surplus</th>
                        <th className="p-3 text-right font-medium text-muted-foreground">Pack Size</th>
                        <th className="p-3 text-center font-medium text-muted-foreground">Packs</th>
                        <th className="p-3 text-right font-medium text-muted-foreground">Order Qty</th>
                        {lines.some(l => l.costPerPack > 0) && (
                          <th className="p-3 text-right font-medium text-muted-foreground">Line Total</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, idx) => (
                        <tr
                          key={line.ingredientId}
                          className={cn(
                            "border-b border-border/50 transition-colors",
                            line.checked ? "bg-green-500/5" : "hover:bg-secondary/20"
                          )}
                        >
                          <td className="p-3">
                            <Checkbox
                              checked={line.checked}
                              onCheckedChange={() => toggleLineCheck(so.supplier.id, idx)}
                            />
                          </td>
                          <td className="p-3">
                            <div className="font-medium">{line.ingredientName}</div>
                            {line.supplierPartNumber && (
                              <div className="text-xs text-muted-foreground">#{line.supplierPartNumber}</div>
                            )}
                            {line.isKanban && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-500/10 text-amber-600 mt-0.5">
                                Kanban
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {line.totalRequired.toLocaleString()}{line.unit}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {line.stockOnHand.toLocaleString()}{line.unit}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {line.surplusTarget.toLocaleString()}{line.unit}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {line.packWeight}{line.unit}
                          </td>
                          <td className="p-3 text-center">
                            <input
                              type="number"
                              min={0}
                              value={line.editedPacks}
                              onChange={e => updatePacks(so.supplier.id, idx, parseInt(e.target.value) || 0)}
                              className="w-16 h-8 rounded border border-border bg-background text-center text-sm tabular-nums"
                            />
                          </td>
                          <td className="p-3 text-right tabular-nums font-medium">
                            {(line.editedPacks * line.packWeight).toLocaleString()}{line.unit}
                          </td>
                          {lines.some(l => l.costPerPack > 0) && (
                            <td className="p-3 text-right tabular-nums">
                              {line.costPerPack > 0 ? `\u00A3${(line.editedPacks * line.costPerPack).toFixed(2)}` : "-"}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="p-4 flex items-center justify-between border-t border-border bg-secondary/10">
                  <div className="text-sm text-muted-foreground">
                    {checkedCount === lines.length ? (
                      <span className="text-green-600 font-medium flex items-center gap-1">
                        <Check className="w-4 h-4" /> All items checked
                      </span>
                    ) : (
                      <span>{checkedCount} of {lines.length} items checked</span>
                    )}
                  </div>
                  <button
                    onClick={() => handlePlaceOrder(so.supplier.id, so.supplier.name)}
                    disabled={!allChecked || placeMutation.isPending}
                    className={cn(
                      "px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2",
                      allChecked
                        ? "bg-green-600 text-white hover:bg-green-700"
                        : "bg-secondary text-muted-foreground cursor-not-allowed"
                    )}
                  >
                    {placeMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Truck className="w-4 h-4" />
                    )}
                    Mark as Placed
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {viewFilter === "placed" && (
        <div className="space-y-4">
          {placedOrders.filter(o => o.status === "placed").length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              No orders placed today yet.
            </div>
          )}
          {placedOrders.filter(o => o.status === "placed").map(order => (
            <div key={order.id} className="rounded-xl border border-green-500/30 bg-green-500/5 overflow-hidden">
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{order.supplierName}</h3>
                    <p className="text-xs text-muted-foreground">
                      Placed at {order.placedAt ? new Date(order.placedAt).toLocaleTimeString() : "—"}
                      &middot; {order.lines.length} item{order.lines.length !== 1 ? "s" : ""}
                      &middot; Order #{order.id}
                    </p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-700">
                  Placed
                </span>
              </div>

              <div className="border-t border-green-500/20">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-green-500/10 bg-green-500/5">
                      <th className="p-3 text-left font-medium text-muted-foreground">Ingredient</th>
                      <th className="p-3 text-right font-medium text-muted-foreground">Qty Ordered</th>
                      <th className="p-3 text-right font-medium text-muted-foreground">Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.lines.map(line => (
                      <tr key={line.id} className="border-b border-green-500/10">
                        <td className="p-3 font-medium">{line.ingredientName}</td>
                        <td className="p-3 text-right tabular-nums">{Number(line.quantityOrdered).toLocaleString()}</td>
                        <td className="p-3 text-right">{line.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!confirmDialog} onOpenChange={() => setConfirmDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Order Placement</DialogTitle>
          </DialogHeader>
          {confirmDialog && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Are you sure you want to mark the order for <span className="font-semibold text-foreground">{confirmDialog.supplierName}</span> as placed?
              </p>
              {editableLines[confirmDialog.supplierId] && (
                <div className="rounded-lg border border-border p-3 space-y-1 text-sm max-h-60 overflow-y-auto">
                  {editableLines[confirmDialog.supplierId].map(l => (
                    <div key={l.ingredientId} className="flex justify-between">
                      <span>{l.ingredientName}</span>
                      <span className="tabular-nums font-medium">
                        {l.editedPacks} x {l.packWeight}{l.unit} = {(l.editedPacks * l.packWeight).toLocaleString()}{l.unit}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setConfirmDialog(null)}
                  className="px-4 py-2 rounded-lg text-sm border border-border hover:bg-secondary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmPlaceOrder}
                  disabled={placeMutation.isPending}
                  className="px-4 py-2 rounded-lg text-sm bg-green-600 text-white hover:bg-green-700 transition-colors flex items-center gap-2"
                >
                  {placeMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  Confirm &amp; Place Order
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
