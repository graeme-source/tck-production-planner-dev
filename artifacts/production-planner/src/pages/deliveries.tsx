import { useState, useMemo, useEffect } from "react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import {
  Truck, ChevronLeft, ChevronRight, Calendar, Package, Thermometer,
  Check, AlertTriangle, Loader2, ClipboardCheck, X,
  CheckCircle2, AlertCircle, PackageCheck,
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
  shelfLifeDays: number | null;
  defaultStorageLocation: string | null;
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

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string; dot: string }> = {
  draft:              { bg: "bg-gray-100 dark:bg-gray-800",           text: "text-gray-600 dark:text-gray-400",   label: "Draft",    dot: "bg-gray-400" },
  placed:             { bg: "bg-blue-100 dark:bg-blue-900/30",         text: "text-blue-700 dark:text-blue-300",   label: "Expected", dot: "bg-blue-500" },
  partially_received: { bg: "bg-amber-100 dark:bg-amber-900/30",       text: "text-amber-700 dark:text-amber-300", label: "Partial",  dot: "bg-amber-500" },
  received:           { bg: "bg-green-100 dark:bg-green-900/30",       text: "text-green-700 dark:text-green-300", label: "Received", dot: "bg-green-500" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_COLORS[status] || STATUS_COLORS.draft;
  return (
    <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1.5", s.bg, s.text)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", s.dot)} />
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

const LOCATION_LABELS: Record<string, string> = {
  prep_fridge: "Prep Fridge",
  raw_meat_fridge: "Raw Meat Fridge",
  production_fridge: "Production Fridge",
  raw_freezer: "Raw Freezer",
  production_freezer: "Production Freezer",
  dry_store: "Dry Store",
};

interface ReceivingLine {
  lineId: number;
  ingredientName: string;
  ingredientCategory: string | null;
  quantityOrdered: number;
  quantityReceived: number;
  unit: string;
  useByDate: string;
  shelfLifeDays: number | null;
  defaultStorageLocation: string | null;
  useByIsAuto: boolean;
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
      const deliveryDate = order.expectedDeliveryDate ? new Date(order.expectedDeliveryDate + "T00:00:00") : new Date();

      setLines(
        order.lines.map((l) => {
          let autoUseByDate = "";
          let useByIsAuto = false;
          if (l.shelfLifeDays != null && l.shelfLifeDays > 0) {
            const d = new Date(deliveryDate);
            d.setDate(d.getDate() + l.shelfLifeDays);
            autoUseByDate = d.toISOString().split("T")[0];
            useByIsAuto = true;
          }
          const existingUseBy = l.useByDate || "";
          return {
            lineId: l.id,
            ingredientName: l.ingredientName,
            ingredientCategory: l.ingredientCategory,
            quantityOrdered: l.quantityOrdered,
            quantityReceived: l.quantityReceived > 0 ? l.quantityReceived : l.quantityOrdered,
            unit: l.unit,
            useByDate: existingUseBy || autoUseByDate,
            shelfLifeDays: l.shelfLifeDays,
            defaultStorageLocation: l.defaultStorageLocation,
            useByIsAuto: existingUseBy === "" && useByIsAuto,
          };
        })
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
                const needsManualUseBy = !line.useByDate && line.shelfLifeDays == null;
                const locationLabel = line.defaultStorageLocation ? LOCATION_LABELS[line.defaultStorageLocation] || line.defaultStorageLocation : null;
                return (
                  <div
                    key={line.lineId}
                    className={cn(
                      "rounded-xl border p-3 space-y-2",
                      needsManualUseBy
                        ? "border-amber-300 bg-amber-50/50 dark:bg-amber-900/10 dark:border-amber-700"
                        : discrepancy
                        ? "border-amber-300 bg-amber-50/30 dark:bg-amber-900/5 dark:border-amber-700"
                        : "border-border"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{line.ingredientName}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {locationLabel && (
                          <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                            → {locationLabel}
                          </span>
                        )}
                        {needsManualUseBy && (
                          <span className="text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> Check use-by
                          </span>
                        )}
                        {line.useByIsAuto && (
                          <span className="text-xs font-medium text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded-full">
                            Auto-dated
                          </span>
                        )}
                      </div>
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
                        <label className="text-xs text-muted-foreground block mb-1">
                          Use-by Date
                          {needsManualUseBy && <span className="text-amber-500 ml-1">*</span>}
                        </label>
                        <input
                          type="date"
                          value={line.useByDate}
                          onChange={(e) => {
                            const next = [...lines];
                            next[idx] = { ...next[idx], useByDate: e.target.value, useByIsAuto: false };
                            setLines(next);
                          }}
                          className={cn(
                            "w-full px-2 py-1 bg-background border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30",
                            needsManualUseBy ? "border-amber-400" : "border-border"
                          )}
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
                          result?.passed ? "bg-green-500 border-green-500" : "border-border"
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
              <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
            ) : !canReceive ? (
              <><AlertCircle className="w-4 h-4" /> Complete all required checks first</>
            ) : (
              <><CheckCircle2 className="w-4 h-4" /> Mark as Received</>
            )}
          </button>

          {receiveMutation.isError && (
            <p className="text-sm text-destructive text-center">
              {receiveMutation.error instanceof Error ? receiveMutation.error.message : "Failed to receive delivery"}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Deliveries() {
  const { state } = useAuth();
  const canEdit = state.status === "authenticated" && (state.user.role === "admin" || state.user.role === "manager");

  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());

  const weekStart = useMemo(() => startOfWeek(currentDate, { weekStartsOn: 1 }), [currentDate]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekOfStr = format(weekStart, "yyyy-MM-dd");
  const selectedDateStr = format(selectedDate, "yyyy-MM-dd");

  const { data, isLoading, error } = useWeeklyDeliveries(weekOfStr);

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
        if (dateKey && map[dateKey] !== undefined) {
          map[dateKey].push(order);
        }
      }
    }
    return map;
  }, [data, weekDays]);

  const selectedDayOrders = ordersByDay[selectedDateStr] || [];

  const prevWeek = () => {
    setCurrentDate((d) => addDays(d, -7));
  };
  const nextWeek = () => {
    setCurrentDate((d) => addDays(d, 7));
  };
  const goToday = () => {
    const now = new Date();
    setCurrentDate(now);
    setSelectedDate(now);
  };

  const selectDay = (day: Date) => {
    setSelectedDate(day);
    const dayWeekStart = startOfWeek(day, { weekStartsOn: 1 });
    if (format(dayWeekStart, "yyyy-MM-dd") !== weekOfStr) {
      setCurrentDate(day);
    }
  };

  const openReceiving = (orderId: number) => {
    setSelectedOrderId(orderId);
    setReceivingOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deliveries & Goods In"
        description="Track expected deliveries and receive goods into storage."
        action={
          <button
            onClick={goToday}
            className="px-4 py-2.5 border border-border rounded-xl font-medium flex items-center gap-2 hover:bg-secondary/50 transition-colors text-sm"
          >
            <Calendar className="w-4 h-4" /> Today
          </button>
        }
      />

      <div className="glass-panel rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <button onClick={prevWeek} className="p-2 rounded-lg hover:bg-secondary/50 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-sm font-semibold text-muted-foreground">
            {format(weekStart, "d MMM")} — {format(addDays(weekStart, 6), "d MMM yyyy")}
          </span>
          <button onClick={nextWeek} className="p-2 rounded-lg hover:bg-secondary/50 transition-colors">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-2">
          {weekDays.map((day) => {
            const dateKey = format(day, "yyyy-MM-dd");
            const ordersCount = (ordersByDay[dateKey] || []).length;
            const today = isToday(day);
            const selected = isSameDay(day, selectedDate);

            return (
              <button
                key={dateKey}
                onClick={() => selectDay(day)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl py-3 px-1 transition-all border",
                  selected
                    ? "bg-primary text-primary-foreground border-primary shadow-md"
                    : today
                    ? "border-primary/40 bg-primary/5 hover:bg-primary/10"
                    : "border-border hover:bg-secondary/50"
                )}
              >
                <span className={cn("text-xs font-medium uppercase tracking-wide", selected ? "text-primary-foreground/70" : today ? "text-primary" : "text-muted-foreground")}>
                  {format(day, "EEE")}
                </span>
                <span className={cn("text-lg font-bold leading-none", selected ? "text-primary-foreground" : today ? "text-primary" : "text-foreground")}>
                  {format(day, "d")}
                </span>
                {ordersCount > 0 ? (
                  <span className={cn(
                    "text-xs font-semibold px-1.5 py-0.5 rounded-full min-w-[20px] text-center",
                    selected ? "bg-white/20 text-primary-foreground" : "bg-primary/10 text-primary"
                  )}>
                    {ordersCount}
                  </span>
                ) : (
                  <span className="h-5" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">
            {isToday(selectedDate) ? "Today" : format(selectedDate, "EEEE, d MMMM")}
            {selectedDayOrders.length > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {selectedDayOrders.length} delivery{selectedDayOrders.length !== 1 ? " orders" : " order"}
              </span>
            )}
          </h2>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-destructive text-sm">
            Failed to load deliveries. Please refresh.
          </div>
        ) : selectedDayOrders.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card flex flex-col items-center justify-center py-14 text-muted-foreground">
            <Truck className="w-10 h-10 mb-3 opacity-20" />
            <p className="text-sm font-medium">No deliveries expected for this day</p>
            <p className="text-xs mt-1 opacity-70">Select another day or place an order from the Orders page</p>
          </div>
        ) : (
          <div className="space-y-3">
            {selectedDayOrders.map((order) => {
              const isReceived = order.status === "received";
              return (
                <div
                  key={order.id}
                  className={cn(
                    "rounded-2xl border bg-card overflow-hidden transition-all",
                    isReceived
                      ? "border-green-200 dark:border-green-800 opacity-75"
                      : "border-border hover:border-primary/30 hover:shadow-sm"
                  )}
                >
                  <div className="p-4 flex items-center gap-4">
                    <div className={cn(
                      "w-12 h-12 rounded-xl flex items-center justify-center shrink-0",
                      isReceived ? "bg-green-100 dark:bg-green-900/30" : "bg-primary/10"
                    )}>
                      {isReceived
                        ? <PackageCheck className="w-6 h-6 text-green-600 dark:text-green-400" />
                        : <Truck className="w-6 h-6 text-primary" />
                      }
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-base truncate">{order.supplierName}</h3>
                        <StatusBadge status={order.status} />
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        PO #{order.id} &middot; {order.lines.length} {order.lines.length === 1 ? "item" : "items"}
                        {order.lines.length > 0 && (
                          <span className="ml-1">
                            ({order.lines.map(l => l.ingredientName).slice(0, 3).join(", ")}
                            {order.lines.length > 3 ? ` +${order.lines.length - 3} more` : ""})
                          </span>
                        )}
                      </p>
                    </div>

                    {canEdit && !isReceived && (
                      <button
                        onClick={() => openReceiving(order.id)}
                        className="shrink-0 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors flex items-center gap-2"
                      >
                        <PackageCheck className="w-4 h-4" />
                        Receive Goods
                      </button>
                    )}
                    {isReceived && (
                      <span className="shrink-0 flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400 font-medium">
                        <CheckCircle2 className="w-4 h-4" />
                        Received
                      </span>
                    )}
                  </div>

                  {order.lines.length > 0 && (
                    <div className="border-t border-border/50 px-4 py-3 bg-secondary/20">
                      <div className="flex flex-wrap gap-2">
                        {order.lines.map((line) => (
                          <span
                            key={line.id}
                            className="text-xs bg-background border border-border rounded-full px-3 py-1 flex items-center gap-1.5"
                          >
                            <span className="font-medium">{line.ingredientName}</span>
                            <span className="text-muted-foreground">
                              {line.quantityOrdered} {line.unit}
                            </span>
                            {line.quantityReceived > 0 && (
                              <span className="text-green-600 dark:text-green-400">
                                ✓ {line.quantityReceived} received
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {orderDetail && (
        <ReceivingDialog
          order={orderDetail}
          checks={orderDetail.checks || []}
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
