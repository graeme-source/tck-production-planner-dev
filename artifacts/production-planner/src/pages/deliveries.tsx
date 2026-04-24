import { useState, useMemo, useEffect } from "react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import {
  Truck, ChevronLeft, ChevronRight, Calendar, Package, Thermometer,
  Check, AlertTriangle, Loader2, ClipboardCheck, X,
  CheckCircle2, AlertCircle, PackageCheck, ArrowRightLeft, Plus, Minus,
  FileText, Boxes, Pencil, Eye, EyeOff,
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
  requiresUseByDate: boolean;
  defaultStorageLocation: string | null;
}

interface DeliveryRecordSummary {
  id: number;
  invoiceFiled: boolean;
  allPutAway: boolean;
  kanbansReplaced: boolean;
  chilledTempC: number | null;
  frozenTempC: number | null;
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
  requiresTemperature?: boolean;
  hasChilled?: boolean;
  hasFrozen?: boolean;
  deliveryRecord?: DeliveryRecordSummary | null;
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
  // Legacy rows from before "any receive → received"; treated like received.
  partially_received: { bg: "bg-green-100 dark:bg-green-900/30",       text: "text-green-700 dark:text-green-300", label: "Received", dot: "bg-green-500" },
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

type DotStatus = "done" | "pending" | "na";

interface ProcessingDots {
  received: DotStatus;
  temperature: DotStatus;
  invoice: DotStatus;
  kanbanPutAway: DotStatus;
  fullyProcessed: boolean;
}

function computeProcessingDots(order: DeliveryOrder): ProcessingDots {
  const rec = order.deliveryRecord ?? null;
  const received: DotStatus = rec ? "done" : "pending";

  let temperature: DotStatus;
  if (!order.requiresTemperature) {
    temperature = "na";
  } else if (!rec) {
    temperature = "pending";
  } else {
    const chilledOk = !order.hasChilled || rec.chilledTempC != null;
    const frozenOk = !order.hasFrozen || rec.frozenTempC != null;
    temperature = chilledOk && frozenOk ? "done" : "pending";
  }

  const invoice: DotStatus = rec?.invoiceFiled ? "done" : "pending";
  const kanbanPutAway: DotStatus =
    rec?.kanbansReplaced && rec?.allPutAway ? "done" : "pending";

  const required: DotStatus[] = [received, invoice, kanbanPutAway];
  if (temperature !== "na") required.push(temperature);
  const fullyProcessed = required.every((d) => d === "done");

  return { received, temperature, invoice, kanbanPutAway, fullyProcessed };
}

interface ReceivingLine {
  lineId: number;
  ingredientName: string;
  ingredientCategory: string | null;
  quantityOrdered: number;
  quantityReceived: number;
  unit: string;
  useByDate: string;
  shelfLifeDays: number | null;
  requiresUseByDate: boolean;
  defaultStorageLocation: string | null;
  useByIsAuto: boolean;
}

interface CheckResult {
  checkConfigId: number;
  passed: boolean;
  notes: string;
}

function Dot({
  label,
  icon: Icon,
  status,
  onClick,
  disabled,
}: {
  label: string;
  icon: typeof PackageCheck;
  status: DotStatus;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const isInteractive = !!onClick;
  const base =
    "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors select-none";
  const styles =
    status === "na"
      ? "bg-muted/30 text-muted-foreground border-border/50 opacity-60"
      : status === "done"
      ? "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800"
      : "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-900/50";
  if (isInteractive) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(base, styles, disabled ? "cursor-not-allowed" : "hover:opacity-80")}
      >
        <span
          className={cn(
            "w-2 h-2 rounded-full",
            status === "done" ? "bg-green-500" : status === "na" ? "bg-muted-foreground" : "bg-red-500"
          )}
        />
        <Icon className="w-3.5 h-3.5" />
        {label}
      </button>
    );
  }
  return (
    <span className={cn(base, styles)}>
      <span
        className={cn(
          "w-2 h-2 rounded-full",
          status === "done" ? "bg-green-500" : status === "na" ? "bg-muted-foreground" : "bg-red-500"
        )}
      />
      <Icon className="w-3.5 h-3.5" />
      {label}
      {status === "na" && <span className="opacity-70">(n/a)</span>}
    </span>
  );
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
            requiresUseByDate: l.requiresUseByDate ?? false,
            defaultStorageLocation: l.defaultStorageLocation,
            useByIsAuto: existingUseBy === "" && useByIsAuto,
          };
        })
      );
      setCheckResults(
        checks.map((c) => ({ checkConfigId: c.id, passed: false, notes: "" }))
      );
      const rec = order.deliveryRecord;
      setChilledTemp(rec?.chilledTempC != null ? String(rec.chilledTempC) : "");
      setFrozenTemp(rec?.frozenTempC != null ? String(rec.frozenTempC) : "");
      setNotes("");
    }
  }, [open, order, checks]);

  const FRIDGE_LOCATIONS = new Set(["prep_fridge", "raw_meat_fridge", "production_fridge"]);
  const FREEZER_LOCATIONS = new Set(["raw_freezer", "production_freezer"]);

  const hasChilled = order.lines.some((l) => l.defaultStorageLocation && FRIDGE_LOCATIONS.has(l.defaultStorageLocation));
  const hasFrozen = order.lines.some((l) => l.defaultStorageLocation && FREEZER_LOCATIONS.has(l.defaultStorageLocation));

  const chilledTempMissing = hasChilled && chilledTemp.trim() === "";
  const frozenTempMissing = hasFrozen && frozenTemp.trim() === "";

  const missingRequiredUseBy = lines.some(
    (l) => l.requiresUseByDate && l.quantityReceived > 0 && !l.useByDate
  );

  const requiredChecks = checks.filter((c) => c.isRequired);
  const allRequiredPassed = requiredChecks.every((rc) => {
    const result = checkResults.find((cr) => cr.checkConfigId === rc.id);
    return result?.passed;
  });

  const isEditMode = order.status === "received" || order.status === "partially_received";

  const canReceive =
    (allRequiredPassed || requiredChecks.length === 0 || isEditMode) &&
    !chilledTempMissing &&
    !frozenTempMissing &&
    !missingRequiredUseBy;

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
          <DialogTitle className="font-display text-3xl font-bold flex items-center gap-3">
            <Truck className="w-7 h-7 text-primary shrink-0" />
            <span>{order.supplierName}</span>
          </DialogTitle>
          {(() => {
            const expectedIsToday = order.expectedDeliveryDate
              ? isToday(parseISO(order.expectedDeliveryDate))
              : false;
            const expectedLabel = order.expectedDeliveryDate
              ? format(parseISO(order.expectedDeliveryDate), "EEE d MMM")
              : "—";
            return (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span className="text-sm text-muted-foreground">PO #{order.id}</span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold text-white",
                    expectedIsToday ? "bg-[#919b5f]" : "bg-red-600"
                  )}
                >
                  <Calendar className="w-4 h-4" />
                  Expected {expectedLabel}
                  {!expectedIsToday && order.expectedDeliveryDate && " (not today)"}
                </span>
              </div>
            );
          })()}
        </DialogHeader>

        <div className="space-y-6 mt-4">
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Package className="w-4 h-4" /> Order Lines
            </h3>
            <div className="space-y-3">
              {lines.map((line, idx) => {
                const discrepancy = line.quantityReceived !== line.quantityOrdered;
                const useByMissing = line.requiresUseByDate && line.quantityReceived > 0 && !line.useByDate;
                const locationLabel = line.defaultStorageLocation ? LOCATION_LABELS[line.defaultStorageLocation] || line.defaultStorageLocation : null;
                return (
                  <div
                    key={line.lineId}
                    className={cn(
                      "rounded-xl border p-3 space-y-2",
                      useByMissing
                        ? "border-destructive bg-destructive/5"
                        : discrepancy
                        ? "border-amber-300 bg-amber-50/30 dark:bg-amber-900/5 dark:border-amber-700"
                        : "border-border"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xl font-bold">{line.ingredientName}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {locationLabel && (
                          <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                            → {locationLabel}
                          </span>
                        )}
                        {useByMissing && (
                          <span className="text-xs font-medium text-destructive bg-destructive/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> Use-by required
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
                        <label className="text-base font-semibold text-muted-foreground block mb-1">Ordered</label>
                        <span className="text-xl font-bold tabular-nums">
                          {line.quantityOrdered} {line.unit}
                        </span>
                      </div>
                      <div>
                        <label className="text-base font-semibold text-muted-foreground block mb-1">Received</label>
                        <div className={cn(
                          "flex items-stretch rounded-lg border bg-background overflow-hidden focus-within:ring-2 focus-within:ring-primary/30",
                          discrepancy ? "border-amber-400" : "border-border"
                        )}>
                          <button
                            type="button"
                            aria-label="Decrease received by 0.5"
                            onClick={() => {
                              const next = [...lines];
                              const current = Number(next[idx].quantityReceived) || 0;
                              next[idx] = { ...next[idx], quantityReceived: Math.max(0, Number((current - 0.5).toFixed(2))) };
                              setLines(next);
                            }}
                            className="px-3 bg-secondary/40 hover:bg-secondary/70 active:bg-secondary text-foreground transition-colors flex items-center justify-center shrink-0"
                          >
                            <Minus className="w-5 h-5" />
                          </button>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            value={line.quantityReceived}
                            onChange={(e) => {
                              const next = [...lines];
                              next[idx] = { ...next[idx], quantityReceived: Number(e.target.value) };
                              setLines(next);
                            }}
                            className="flex-1 min-w-0 px-2 py-2 bg-background text-center text-xl font-bold tabular-nums text-[#919b5f] focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <button
                            type="button"
                            aria-label="Increase received by 0.5"
                            onClick={() => {
                              const next = [...lines];
                              const current = Number(next[idx].quantityReceived) || 0;
                              next[idx] = { ...next[idx], quantityReceived: Number((current + 0.5).toFixed(2)) };
                              setLines(next);
                            }}
                            className="px-3 bg-secondary/40 hover:bg-secondary/70 active:bg-secondary text-foreground transition-colors flex items-center justify-center shrink-0"
                          >
                            <Plus className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="text-base font-semibold text-muted-foreground block mb-1">
                          Use-by Date
                          {line.requiresUseByDate && <span className="text-destructive ml-1">*</span>}
                          {!line.requiresUseByDate && (
                            <span className="ml-1 text-xs font-normal text-muted-foreground">(optional)</span>
                          )}
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
                            "w-full px-3 py-2 bg-background border rounded-lg text-xl font-bold focus:outline-none focus:ring-2 focus:ring-primary/30",
                            useByMissing ? "border-destructive" : "border-border"
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
              <h3 className="text-xl font-bold mb-1 flex items-center gap-2">
                <Thermometer className="w-6 h-6" /> Temperature Checks
                <span className="text-sm font-semibold text-destructive ml-1">Required</span>
              </h3>
              <p className="text-sm text-muted-foreground mb-3">
                Temperature must be recorded for all chilled and frozen items before the delivery can be marked as received.
              </p>
              <div className="grid grid-cols-2 gap-4">
                {hasChilled && (
                  <div>
                    <label className="text-base font-semibold block mb-1">
                      Chilled Temp (°C) <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={chilledTemp}
                      onChange={(e) => setChilledTemp(e.target.value)}
                      placeholder="e.g. 3.5"
                      className={cn(
                        "w-full px-3 py-2 bg-background border rounded-lg text-xl font-bold tabular-nums focus:outline-none focus:ring-2",
                        chilledTempMissing
                          ? "border-destructive focus:ring-destructive/30"
                          : "border-border focus:ring-primary/30"
                      )}
                    />
                    {chilledTempMissing && (
                      <p className="text-sm text-destructive mt-1 flex items-center gap-1">
                        <AlertCircle className="w-4 h-4" /> Chilled temperature is required
                      </p>
                    )}
                  </div>
                )}
                {hasFrozen && (
                  <div>
                    <label className="text-base font-semibold block mb-1">
                      Frozen Temp (°C) <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={frozenTemp}
                      onChange={(e) => setFrozenTemp(e.target.value)}
                      placeholder="e.g. -18.0"
                      className={cn(
                        "w-full px-3 py-2 bg-background border rounded-lg text-xl font-bold tabular-nums focus:outline-none focus:ring-2",
                        frozenTempMissing
                          ? "border-destructive focus:ring-destructive/30"
                          : "border-border focus:ring-primary/30"
                      )}
                    />
                    {frozenTempMissing && (
                      <p className="text-sm text-destructive mt-1 flex items-center gap-1">
                        <AlertCircle className="w-4 h-4" /> Frozen temperature is required
                      </p>
                    )}
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
            ) : missingRequiredUseBy ? (
              <><AlertCircle className="w-4 h-4" /> Set use-by dates for required items</>
            ) : !canReceive ? (
              <><AlertCircle className="w-4 h-4" /> Complete all required checks first</>
            ) : isEditMode ? (
              <><Pencil className="w-4 h-4" /> Update quantities</>
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
  const queryClient = useQueryClient();
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
  const [showProcessed, setShowProcessed] = useState(false);

  const checksMutation = useMutation({
    mutationFn: async (payload: { orderId: number; invoiceFiled?: boolean; kanbansAndPutAway?: boolean }) => {
      const res = await fetch(`${BASE}/api/deliveries/${payload.orderId}/checks`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          invoiceFiled: payload.invoiceFiled,
          kanbansAndPutAway: payload.kanbansAndPutAway,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to update check");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).includes("/api/deliveries") });
    },
  });

  const [movingOrderId, setMovingOrderId] = useState<number | null>(null);
  const moveMutation = useMutation({
    mutationFn: async ({ orderId, newDate }: { orderId: number; newDate: string }) => {
      const res = await fetch(`${BASE}/api/deliveries/${orderId}/move`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ expectedDeliveryDate: newDate }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to move delivery");
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/deliveries/weekly"] });
      setMovingOrderId(null);
      const newDateObj = parseISO(variables.newDate);
      const newWeekStart = startOfWeek(newDateObj, { weekStartsOn: 1 });
      if (format(newWeekStart, "yyyy-MM-dd") !== weekOfStr) {
        setCurrentDate(newDateObj);
      }
      setSelectedDate(newDateObj);
    },
  });

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

  const selectedDayOrdersAll = ordersByDay[selectedDateStr] || [];
  const selectedDayOrders = useMemo(() => {
    if (showProcessed) return selectedDayOrdersAll;
    return selectedDayOrdersAll.filter((o) => !computeProcessingDots(o).fullyProcessed);
  }, [selectedDayOrdersAll, showProcessed]);
  const hiddenProcessedCount =
    selectedDayOrdersAll.length - selectedDayOrders.length;

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
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-semibold text-lg">
            {isToday(selectedDate) ? "Today" : format(selectedDate, "EEEE, d MMMM")}
            {selectedDayOrdersAll.length > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {selectedDayOrders.length} of {selectedDayOrdersAll.length} shown
              </span>
            )}
          </h2>
          {selectedDayOrdersAll.length > 0 && (
            <button
              onClick={() => setShowProcessed((v) => !v)}
              className="px-3 py-1.5 border border-border rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-secondary/50 transition-colors"
              title={showProcessed ? "Hide fully processed orders" : "Show fully processed orders"}
            >
              {showProcessed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              {showProcessed ? "Hide processed" : `Show processed${hiddenProcessedCount > 0 ? ` (${hiddenProcessedCount})` : ""}`}
            </button>
          )}
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
              const isReceived = order.status === "received" || order.status === "partially_received";
              const dots = computeProcessingDots(order);
              const cardIsClickable = canEdit;
              return (
                <div
                  key={order.id}
                  onClick={cardIsClickable ? () => openReceiving(order.id) : undefined}
                  role={cardIsClickable ? "button" : undefined}
                  tabIndex={cardIsClickable ? 0 : undefined}
                  onKeyDown={cardIsClickable ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openReceiving(order.id);
                    }
                  } : undefined}
                  className={cn(
                    "rounded-2xl border bg-card overflow-hidden transition-all",
                    dots.fullyProcessed
                      ? "border-green-200 dark:border-green-800 opacity-75"
                      : "border-border hover:border-primary/50 hover:shadow-md",
                    cardIsClickable && "cursor-pointer"
                  )}
                >
                  <div className="p-4 flex items-center gap-4">
                    <div className={cn(
                      "w-12 h-12 rounded-xl flex items-center justify-center shrink-0",
                      dots.fullyProcessed ? "bg-green-100 dark:bg-green-900/30" : "bg-primary/10"
                    )}>
                      {dots.fullyProcessed
                        ? <PackageCheck className="w-6 h-6 text-green-600 dark:text-green-400" />
                        : <Truck className="w-6 h-6 text-primary" />
                      }
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-bold text-2xl truncate">{order.supplierName}</h3>
                        {dots.fullyProcessed ? (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            Fully processed
                          </span>
                        ) : (
                          <StatusBadge status={order.status} />
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        PO #{order.id} &middot; {order.lines.length} {order.lines.length === 1 ? "item" : "items"}
                      </p>
                    </div>

                    <div className="shrink-0 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      {canEdit && !isReceived && (
                        movingOrderId === order.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="date"
                              className="px-2 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                              defaultValue={order.expectedDeliveryDate || ""}
                              onChange={(e) => {
                                if (e.target.value && e.target.value !== order.expectedDeliveryDate) {
                                  moveMutation.mutate({ orderId: order.id, newDate: e.target.value });
                                }
                              }}
                              autoFocus
                            />
                            <button
                              onClick={() => setMovingOrderId(null)}
                              className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setMovingOrderId(order.id)}
                            className="p-2 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                            title="Move to another day"
                          >
                            <ArrowRightLeft className="w-4 h-4" />
                          </button>
                        )
                      )}
                      {canEdit && !isReceived && (
                        <button
                          onClick={(e) => { e.stopPropagation(); openReceiving(order.id); }}
                          className="px-5 py-3 rounded-xl bg-primary text-primary-foreground text-lg font-bold hover:bg-primary/90 transition-colors flex items-center gap-2"
                        >
                          <PackageCheck className="w-5 h-5" />
                          Receive Goods
                        </button>
                      )}
                      {canEdit && isReceived && (
                        <button
                          onClick={(e) => { e.stopPropagation(); openReceiving(order.id); }}
                          className="px-3 py-2 rounded-xl border border-border text-sm font-medium hover:bg-secondary/50 transition-colors flex items-center gap-1.5"
                          title="Edit received quantities"
                        >
                          <Pencil className="w-4 h-4" />
                          Edit
                        </button>
                      )}
                    </div>
                  </div>

                  <div
                    className="border-t border-border/50 px-4 py-2.5 bg-secondary/10 flex items-center gap-2 flex-wrap"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Dot
                      label="Received"
                      icon={PackageCheck}
                      status={dots.received}
                    />
                    <Dot
                      label={order.hasFrozen && order.hasChilled ? "Temps" : order.hasFrozen ? "Frozen temp" : "Chilled temp"}
                      icon={Thermometer}
                      status={dots.temperature}
                    />
                    <Dot
                      label="Invoice filed"
                      icon={FileText}
                      status={dots.invoice}
                      disabled={!canEdit || dots.received !== "done" || checksMutation.isPending}
                      onClick={() => {
                        checksMutation.mutate({
                          orderId: order.id,
                          invoiceFiled: dots.invoice !== "done",
                        });
                      }}
                    />
                    <Dot
                      label="Kanbans & put away"
                      icon={Boxes}
                      status={dots.kanbanPutAway}
                      disabled={!canEdit || dots.received !== "done" || checksMutation.isPending}
                      onClick={() => {
                        checksMutation.mutate({
                          orderId: order.id,
                          kanbansAndPutAway: dots.kanbanPutAway !== "done",
                        });
                      }}
                    />
                  </div>

                  {order.lines.length > 0 && (
                    <div className="border-t border-border/50 px-4 py-3 bg-secondary/20">
                      <div className="flex flex-wrap gap-2">
                        {order.lines.map((line) => (
                          <span
                            key={line.id}
                            className="text-base bg-background border border-border rounded-full px-4 py-1.5 flex items-center gap-2"
                          >
                            <span className="font-bold">{line.ingredientName}</span>
                            <span className="font-bold tabular-nums">
                              {line.quantityOrdered} {line.unit}
                            </span>
                            {line.quantityReceived > 0 && (
                              <span className="text-green-600 dark:text-green-400 font-semibold">
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
