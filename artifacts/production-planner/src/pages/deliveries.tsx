import { useState, useMemo, useEffect } from "react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import {
  Truck, ChevronLeft, ChevronRight, Calendar, Package, Thermometer,
  Check, AlertTriangle, Loader2, ClipboardCheck, X, Clock,
  CheckCircle2, AlertCircle,
} from "lucide-react";
import { format, startOfWeek, addDays, isSameDay, parseISO, isToday } from "date-fns";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/auth-context";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface POLine {
  id: number;
  purchaseOrderId: number;
  ingredientId: number;
  ingredientName: string;
  ingredientCategory: string | null;
  quantityRequired: number;
  quantityOrdered: number;
  quantityReceived: number;
  unit: string;
  unitPrice: number | null;
  checkedOff: boolean;
  notes: string | null;
  useByDate: string | null;
}

interface DeliveryOrder {
  id: number;
  supplierId: number;
  supplierName: string;
  status: string;
  expectedDeliveryDate: string | null;
  notes: string | null;
  createdAt: string;
  lines: POLine[];
}

interface CheckConfig {
  id: number;
  supplierId: number;
  label: string;
  isRequired: boolean;
  sortOrder: number;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: "bg-gray-100 dark:bg-gray-800", text: "text-gray-600 dark:text-gray-400", label: "Draft" },
  placed: { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-300", label: "Expected" },
  partially_received: { bg: "bg-amber-100 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-300", label: "Partial" },
  received: { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-700 dark:text-green-300", label: "Received" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_COLORS[status] || STATUS_COLORS.draft;
  return (
    <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", s.bg, s.text)}>
      {s.label}
    </span>
  );
}

function useWeeklyDeliveries(weekOf: string) {
  return useQuery({
    queryKey: ["/api/deliveries/weekly", weekOf],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/deliveries/weekly?weekOf=${weekOf}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch deliveries");
      return res.json() as Promise<{ weekOf: string; orders: DeliveryOrder[] }>;
    },
  });
}

function useDeliveryDetail(orderId: number | null) {
  return useQuery({
    queryKey: ["/api/deliveries", orderId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/deliveries/${orderId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch delivery detail");
      return res.json() as Promise<DeliveryOrder & { checks: CheckConfig[] }>;
    },
    enabled: orderId != null,
  });
}

interface ReceivingLine {
  lineId: number;
  ingredientName: string;
  ingredientCategory: string | null;
  quantityOrdered: number;
  quantityReceived: number;
  unit: string;
  useByDate: string;
}

interface CheckResult {
  checkConfigId: number;
  passed: boolean;
  notes: string;
}

function ReceivingDialog({
  order,
  checks,
  open,
  onClose,
}: {
  order: DeliveryOrder;
  checks: CheckConfig[];
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [lines, setLines] = useState<ReceivingLine[]>([]);
  const [chilledTemp, setChilledTemp] = useState("");
  const [frozenTemp, setFrozenTemp] = useState("");
  const [checkResults, setCheckResults] = useState<CheckResult[]>([]);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open && order) {
      setLines(
        order.lines.map((l) => ({
          lineId: l.id,
          ingredientName: l.ingredientName,
          ingredientCategory: l.ingredientCategory,
          quantityOrdered: l.quantityOrdered,
          quantityReceived: l.quantityReceived > 0 ? l.quantityReceived : l.quantityOrdered,
          unit: l.unit,
          useByDate: l.useByDate || "",
        }))
      );
      setCheckResults(
        checks.map((c) => ({ checkConfigId: c.id, passed: false, notes: "" }))
      );
      setChilledTemp("");
      setFrozenTemp("");
      setNotes("");
    }
  }, [open, order, checks]);

  const hasChilled = order.lines.some(
    (l) => l.ingredientCategory && !l.ingredientCategory.toLowerCase().includes("frozen") && !l.ingredientCategory.toLowerCase().includes("ambient") && !l.ingredientCategory.toLowerCase().includes("dry")
  );
  const hasFrozen = order.lines.some(
    (l) => l.ingredientCategory && l.ingredientCategory.toLowerCase().includes("frozen")
  );

  const requiredChecks = checks.filter((c) => c.isRequired);
  const allRequiredPassed = requiredChecks.every((rc) => {
    const result = checkResults.find((cr) => cr.checkConfigId === rc.id);
    return result?.passed;
  });

  const canReceive = allRequiredPassed || requiredChecks.length === 0;

  const receiveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/deliveries/${order.id}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          lines: lines.map((l) => ({
            lineId: l.lineId,
            quantityReceived: l.quantityReceived,
            useByDate: l.useByDate || null,
          })),
          chilledTempC: chilledTemp ? Number(chilledTemp) : null,
          frozenTempC: frozenTemp ? Number(frozenTemp) : null,
          checkResults,
          notes: notes || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to receive delivery");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).includes("/api/deliveries") });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-entries"] });
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[700px] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            <Truck className="w-5 h-5 text-primary" />
            Receive Delivery — {order.supplierName}
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            PO #{order.id} · Expected {order.expectedDeliveryDate ? format(parseISO(order.expectedDeliveryDate), "EEE d MMM") : "—"}
          </p>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Package className="w-4 h-4" /> Order Lines
            </h3>
            <div className="space-y-3">
              {lines.map((line, idx) => {
                const discrepancy = line.quantityReceived !== line.quantityOrdered;
                return (
                  <div
                    key={line.lineId}
                    className={cn(
                      "rounded-xl border p-3 space-y-2",
                      discrepancy ? "border-amber-300 bg-amber-50/50 dark:bg-amber-900/10 dark:border-amber-700" : "border-border"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{line.ingredientName}</span>
                      {line.ingredientCategory && (
                        <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                          {line.ingredientCategory}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">Ordered</label>
                        <span className="text-sm font-medium tabular-nums">
                          {line.quantityOrdered} {line.unit}
                        </span>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">Received</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.quantityReceived}
                          onChange={(e) => {
                            const next = [...lines];
                            next[idx] = { ...next[idx], quantityReceived: Number(e.target.value) };
                            setLines(next);
                          }}
                          className={cn(
                            "w-full px-2 py-1 bg-background border rounded-lg text-sm font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30",
                            discrepancy ? "border-amber-400" : "border-border"
                          )}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">Use-by Date</label>
                        <input
                          type="date"
                          value={line.useByDate}
                          onChange={(e) => {
                            const next = [...lines];
                            next[idx] = { ...next[idx], useByDate: e.target.value };
                            setLines(next);
                          }}
                          className="w-full px-2 py-1 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                    </div>
                    {discrepancy && (
                      <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Quantity differs from order ({line.quantityOrdered} ordered)
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {(hasChilled || hasFrozen) && (
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Thermometer className="w-4 h-4" /> Temperature Checks
              </h3>
              <div className="grid grid-cols-2 gap-4">
                {hasChilled && (
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Chilled Temp (°C)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={chilledTemp}
                      onChange={(e) => setChilledTemp(e.target.value)}
                      placeholder="e.g. 3.5"
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                )}
                {hasFrozen && (
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Frozen Temp (°C)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={frozenTemp}
                      onChange={(e) => setFrozenTemp(e.target.value)}
                      placeholder="e.g. -18.0"
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {checks.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4" /> Delivery Checks
              </h3>
              <div className="space-y-2">
                {checks.map((check) => {
                  const result = checkResults.find((cr) => cr.checkConfigId === check.id);
                  return (
                    <div
                      key={check.id}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors cursor-pointer",
                        result?.passed
                          ? "border-green-300 bg-green-50/50 dark:bg-green-900/10 dark:border-green-700"
                          : "border-border hover:bg-secondary/30"
                      )}
                      onClick={() => {
                        setCheckResults((prev) =>
                          prev.map((cr) =>
                            cr.checkConfigId === check.id ? { ...cr, passed: !cr.passed } : cr
                          )
                        );
                      }}
                    >
                      <div
                        className={cn(
                          "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all flex-shrink-0",
                          result?.passed
                            ? "bg-green-500 border-green-500"
                            : "border-border"
                        )}
                      >
                        {result?.passed && <Check className="w-3.5 h-3.5 text-white" />}
                      </div>
                      <span className="text-sm flex-1">{check.label}</span>
                      {check.isRequired && (
                        <span className="text-xs text-muted-foreground">Required</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label className="text-sm font-medium mb-1 block">Delivery Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[60px] resize-none"
              placeholder="Any notes about this delivery..."
            />
          </div>

          <button
            onClick={() => receiveMutation.mutate()}
            disabled={!canReceive || receiveMutation.isPending}
            className={cn(
              "w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors",
              canReceive
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-secondary text-muted-foreground cursor-not-allowed"
            )}
          >
            {receiveMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Processing...
              </>
            ) : !canReceive ? (
              <>
                <AlertCircle className="w-4 h-4" /> Complete all required checks first
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" /> Mark as Received
              </>
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Deliveries() {
  const { state } = useAuth();
  const canEdit = state.status === "authenticated" && (state.user.role === "admin" || state.user.role === "manager");

  const [currentDate, setCurrentDate] = useState(() => new Date());
  const weekStart = useMemo(() => startOfWeek(currentDate, { weekStartsOn: 1 }), [currentDate]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekOfStr = format(weekStart, "yyyy-MM-dd");

  const { data, isLoading } = useWeeklyDeliveries(weekOfStr);

  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const { data: orderDetail } = useDeliveryDetail(selectedOrderId);
  const [receivingOpen, setReceivingOpen] = useState(false);

  const ordersByDay = useMemo(() => {
    const map: Record<string, DeliveryOrder[]> = {};
    for (const day of weekDays) {
      map[format(day, "yyyy-MM-dd")] = [];
    }
    if (data?.orders) {
      for (const order of data.orders) {
        const dateKey = order.expectedDeliveryDate;
        if (dateKey && map[dateKey]) {
          map[dateKey].push(order);
        }
      }
    }
    return map;
  }, [data, weekDays]);

  const prevWeek = () => setCurrentDate((d) => addDays(d, -7));
  const nextWeek = () => setCurrentDate((d) => addDays(d, 7));
  const goToday = () => setCurrentDate(new Date());

  const openReceiving = (orderId: number) => {
    setSelectedOrderId(orderId);
    setReceivingOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deliveries & Goods In"
        description="Track expected deliveries, receive goods, and record temperatures and checks."
        action={
          <button
            onClick={goToday}
            className="px-4 py-2.5 border border-border rounded-xl font-medium flex items-center gap-2 hover:bg-secondary/50 transition-colors text-sm"
          >
            <Calendar className="w-4 h-4" /> Today
          </button>
        }
      />

      <div className="flex items-center justify-between">
        <button
          onClick={prevWeek}
          className="p-2 rounded-lg hover:bg-secondary/50 transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-semibold">
          {format(weekStart, "d MMM")} — {format(addDays(weekStart, 6), "d MMM yyyy")}
        </h2>
        <button
          onClick={nextWeek}
          className="p-2 rounded-lg hover:bg-secondary/50 transition-colors"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-7 gap-3">
          {weekDays.map((day) => {
            const dateKey = format(day, "yyyy-MM-dd");
            const orders = ordersByDay[dateKey] || [];
            const today = isToday(day);

            return (
              <div
                key={dateKey}
                className={cn(
                  "rounded-2xl border p-4 min-h-[160px] transition-all",
                  today
                    ? "border-primary/50 bg-primary/5 ring-2 ring-primary/20"
                    : "border-border bg-card"
                )}
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className={cn("text-xs font-medium uppercase tracking-wide", today ? "text-primary" : "text-muted-foreground")}>
                      {format(day, "EEE")}
                    </p>
                    <p className={cn("text-lg font-bold", today ? "text-primary" : "text-foreground")}>
                      {format(day, "d")}
                    </p>
                  </div>
                  {today && (
                    <span className="text-xs font-medium bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
                      Today
                    </span>
                  )}
                </div>

                {orders.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No deliveries</p>
                ) : (
                  <div className="space-y-2">
                    {orders.map((order) => (
                      <button
                        key={order.id}
                        onClick={() => canEdit && order.status !== "received" ? openReceiving(order.id) : undefined}
                        className={cn(
                          "w-full text-left rounded-xl border p-3 transition-all",
                          order.status === "received"
                            ? "border-green-200 bg-green-50/50 dark:bg-green-900/10 dark:border-green-800"
                            : "border-border hover:border-primary/30 hover:shadow-sm cursor-pointer"
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium truncate">{order.supplierName}</span>
                          <StatusBadge status={order.status} />
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {order.lines.length} {order.lines.length === 1 ? "item" : "items"}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {data?.orders && data.orders.length > 0 && (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Delivery History This Week</h3>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-secondary/30 text-muted-foreground">
              <tr>
                <th className="px-6 py-3 font-medium">Supplier</th>
                <th className="px-6 py-3 font-medium">Expected</th>
                <th className="px-6 py-3 font-medium">Items</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {data.orders.map((order) => (
                <tr key={order.id} className="hover:bg-secondary/10 transition-colors">
                  <td className="px-6 py-3 font-medium">{order.supplierName}</td>
                  <td className="px-6 py-3 text-muted-foreground">
                    {order.expectedDeliveryDate ? format(parseISO(order.expectedDeliveryDate), "EEE d MMM") : "—"}
                  </td>
                  <td className="px-6 py-3 text-muted-foreground">
                    {order.lines.length} {order.lines.length === 1 ? "item" : "items"}
                  </td>
                  <td className="px-6 py-3">
                    <StatusBadge status={order.status} />
                  </td>
                  <td className="px-6 py-3 text-right">
                    {canEdit && order.status !== "received" && (
                      <button
                        onClick={() => openReceiving(order.id)}
                        className="text-xs text-primary hover:underline"
                      >
                        Receive
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {receivingOpen && orderDetail && (
        <ReceivingDialog
          order={orderDetail}
          checks={(orderDetail as any).checks || []}
          open={receivingOpen}
          onClose={() => {
            setReceivingOpen(false);
            setSelectedOrderId(null);
          }}
        />
      )}
    </div>
  );
}
