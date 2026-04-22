import { useState, useEffect, useCallback, useRef } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
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
  Search,
  X,
  LayoutGrid,
  Plus,
  ChevronLeft,
  ChevronRight,
  Calendar,
  RefreshCw,
  Clock,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  nextBusinessDay,
  calcExpectedDeliveryDate,
  formatDeliveryDate,
  toISODate,
} from "@workspace/business-days";

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
  orderingUrl: string | null;
  lastStockCheckAt: string | null;
  // True when this item is daily-stock-checked but has enough stock to not
  // need ordering this round. Hidden by default; surfaced via the "Show
  // non-required stock-checked items" toggle so operators can verify their
  // stock checks went through.
  belowRequirement?: boolean;
};

type SupplierOrder = {
  supplier: {
    id: number;
    name: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    website: string | null;
    leadTimeDays?: number;
    cutoffTime?: string;
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
    orderingUrl: string | null;
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
  editedStock: number;
  stockDirty: boolean;
  // Manual additions from the per-supplier "+ Add item" picker. These are
  // always orderable regardless of belowRequirement state.
  isManual?: boolean;
};

type SupplierIngredient = {
  id: number;
  name: string;
  unit: string;
  packWeight: number | string | null;
  costPerPack: number | string | null;
  supplierPartNumber: string | null;
  orderingUrl: string | null;
};

type KanbanIngredient = {
  ingredientId: number;
  ingredientName: string | null;
  ingredientUnit: string | null;
  kanbanQuantity: number | null;
  kanbanOrderAmount: number | null;
  kanbanUnit: string;
  packWeight: number | null;
  costPerPack: number | null;
  supplierId: number | null;
  supplierName: string | null;
};

export default function Orders() {
  const queryClient = useQueryClient();
  const initialPlanId = (() => {
    const urlParam = new URLSearchParams(window.location.search).get("planId");
    if (urlParam) return Number(urlParam);
    const stored = sessionStorage.getItem("orders_selectedPlanId");
    if (stored) return Number(stored);
    return null;
  })();
  const [selectedPlanId, setSelectedPlanIdRaw] = useState<number | null>(initialPlanId);
  const setSelectedPlanId = useCallback((id: number | null) => {
    setSelectedPlanIdRaw(id);
    setDeliveryDates({});
    if (id) {
      sessionStorage.setItem("orders_selectedPlanId", String(id));
    } else {
      sessionStorage.removeItem("orders_selectedPlanId");
    }
  }, []);
  const [viewFilter, setViewFilter] = useState<"pending" | "placed">("pending");
  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<number>>(new Set());
  const [editableLines, setEditableLines] = useState<Record<number, EditableLine[]>>({});
  const [confirmDialog, setConfirmDialog] = useState<{ supplierId: number; supplierName: string; deliveryDate: string } | null>(null);
  const [deliveryDates, setDeliveryDates] = useState<Record<number, Date>>({});

  const [kanbanSearchOpen, setKanbanSearchOpen] = useState(false);
  const [kanbanSearch, setKanbanSearch] = useState("");
  const debouncedKanbanSearch = useDebouncedValue(kanbanSearch);
  const [selectedKanbanIds, setSelectedKanbanIds] = useState<Set<number>>(new Set());
  const [addedKanbanIngredientIds, setAddedKanbanIngredientIds] = useState<Set<number>>(new Set());
  const [kanbanOnlySupplierInfo, setKanbanOnlySupplierInfo] = useState<Record<number, { id: number; name: string }>>({});

  // When the operator adds a kanban/manual item to a supplier whose order
  // was already placed today, we "reopen" that PO into the pending view so
  // they can edit + resubmit. Maps supplierId → existing PO id so the place
  // mutation can route to the resubmit endpoint instead of creating a new PO.
  const [reopenedPlacedOrders, setReopenedPlacedOrders] = useState<Record<number, number>>({});

  // Issue 5: global toggle to show items that are daily stock-checked but
  // aren't required because we have enough stock. Default hidden.
  const [showNonRequired, setShowNonRequired] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem("orders_showNonRequired") === "true";
  });
  useEffect(() => {
    sessionStorage.setItem("orders_showNonRequired", String(showNonRequired));
  }, [showNonRequired]);

  // Issue 4: per-supplier "Add item" picker. Opens a dialog listing every
  // ingredient assigned to that supplier so operators can add one-off
  // manual lines without waiting for an auto-calc.
  const [addItemDialog, setAddItemDialog] = useState<{ supplierId: number; supplierName: string } | null>(null);
  const [addItemSearch, setAddItemSearch] = useState("");
  const debouncedAddItemSearch = useDebouncedValue(addItemSearch);

  const { data: plans } = useQuery<Plan[]>({
    queryKey: ["production-plans-list"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/production-plans`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load plans");
      return res.json();
    },
  });

  const activePlans = (plans ?? []).filter(p => p.status === "active");

  useEffect(() => {
    if (activePlans.length > 0 && !selectedPlanId) {
      setSelectedPlanId(activePlans[activePlans.length - 1].id);
    }
  }, [activePlans.length, selectedPlanId, setSelectedPlanId]);

  const { data: calculated, isLoading: calcLoading, error: calcError } = useQuery<CalculateResponse>({
    queryKey: ["order-calculate", selectedPlanId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/orders/calculate?planId=${selectedPlanId}`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || body.error || "Failed to calculate orders");
      }
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
          editedStock: l.stockOnHand,
          stockDirty: false,
        }));
      }
      setEditableLines(newLines);
      setExpandedSuppliers(new Set(calculated.suppliers.map(s => s.supplier.id)));
    }
  }, [calculated]);

  const { data: kanbanIngredients = [] } = useQuery<KanbanIngredient[]>({
    queryKey: ["kanbans-ingredients-for-orders"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/kanbans/ingredients`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load kanban ingredients");
      return res.json();
    },
    enabled: kanbanSearchOpen,
  });

  const filteredKanbanIngredients = debouncedKanbanSearch.trim()
    ? kanbanIngredients.filter(k =>
        (k.ingredientName ?? "").toLowerCase().includes(debouncedKanbanSearch.toLowerCase()) ||
        (k.supplierName ?? "").toLowerCase().includes(debouncedKanbanSearch.toLowerCase())
      )
    : kanbanIngredients;

  const toggleKanbanSelection = (ingredientId: number) => {
    setSelectedKanbanIds(prev => {
      const next = new Set(prev);
      if (next.has(ingredientId)) next.delete(ingredientId);
      else next.add(ingredientId);
      return next;
    });
  };

  // Core reopen routine — given a placed PO, hydrate its lines into
  // editableLines, register it as reopened so the place mutation routes to
  // resubmit, and make the supplier visible in the pending view.
  const reopenPlacedOrder = useCallback((placedPO: PurchaseOrder) => {
    const supplierId = placedPO.supplierId;
    if (reopenedPlacedOrders[supplierId]) return; // already reopened — no-op

    setEditableLines(prev => {
      const existing = prev[supplierId] ?? [];
      const existingIngredientIds = new Set(existing.map(l => l.ingredientId));
      const hydratedFromPO: EditableLine[] = placedPO.lines
        .filter(l => !existingIngredientIds.has(l.ingredientId))
        .map(l => {
          const qtyOrdered = Number(l.quantityOrdered) || 0;
          const unit = l.unit ?? "kg";
          const isPackUnit = unit === "packs" || unit === "bottles";
          const packs = isPackUnit ? qtyOrdered : Math.max(1, Math.round(qtyOrdered));
          return {
            ingredientId: l.ingredientId,
            ingredientName: l.ingredientName ?? `Ingredient #${l.ingredientId}`,
            unit,
            totalRequired: Number(l.quantityRequired) || 0,
            stockOnHand: 0,
            surplusTarget: 0,
            packWeight: 1,
            costPerPack: Number(l.unitPrice) || 0,
            supplierPartNumber: null,
            orderQty: qtyOrdered,
            packsToOrder: packs,
            isKanban: false,
            orderingUrl: l.orderingUrl ?? null,
            lastStockCheckAt: null,
            belowRequirement: false,
            checked: true, // it was already placed; pre-check so resend works
            editedPacks: packs,
            editedStock: 0,
            stockDirty: false,
          };
        });
      return { ...prev, [supplierId]: [...hydratedFromPO, ...existing] };
    });

    // Make the supplier appear in the pending view even though it's placed
    const dptSupplierIds = new Set((calculated?.suppliers ?? []).map(s => s.supplier.id));
    if (!dptSupplierIds.has(supplierId)) {
      setKanbanOnlySupplierInfo(prev => ({
        ...prev,
        [supplierId]: { id: supplierId, name: placedPO.supplierName ?? `Supplier #${supplierId}` },
      }));
    }

    setReopenedPlacedOrders(prev => ({ ...prev, [supplierId]: placedPO.id }));
    setExpandedSuppliers(prev => new Set([...prev, supplierId]));
  }, [reopenedPlacedOrders, calculated?.suppliers]);

  // Used by kanban/manual add flows: looks up the placed PO for a supplier
  // in the currently-selected plan and reopens it if found.
  const reopenPlacedOrderIfAny = useCallback((supplierId: number) => {
    if (reopenedPlacedOrders[supplierId]) return;
    const placedPO = placedOrders.find(o =>
      o.status === "placed" &&
      o.planId === selectedPlanId &&
      o.supplierId === supplierId,
    );
    if (!placedPO) return;
    reopenPlacedOrder(placedPO);
  }, [placedOrders, selectedPlanId, reopenedPlacedOrders, reopenPlacedOrder]);

  // Used by the "Edit" button on a placed order card — switches the plan
  // selector (if needed) and view filter, then reopens the PO for editing.
  const handleEditPlacedOrder = useCallback((order: PurchaseOrder) => {
    // If the placed order belongs to a different plan than the currently
    // selected one, switch the plan selector so the reopened card appears
    // in the pending view for that plan.
    if (order.planId && order.planId !== selectedPlanId) {
      setSelectedPlanId(order.planId);
    }
    reopenPlacedOrder(order);
    setViewFilter("pending");
  }, [selectedPlanId, setSelectedPlanId, reopenPlacedOrder]);

  const handleAddSelectedKanbans = () => {
    const toAdd = kanbanIngredients.filter(
      k => selectedKanbanIds.has(k.ingredientId) && !addedKanbanIngredientIds.has(k.ingredientId) && k.supplierId
    );
    for (const kanban of toAdd) {
      const qty = kanban.kanbanOrderAmount ?? kanban.kanbanQuantity ?? 1;
      const packWeight = kanban.packWeight ?? 1;
      const unit =
        kanban.kanbanUnit === "pack" ? "packs"
        : kanban.kanbanUnit === "bottle" ? "bottles"
        : (kanban.ingredientUnit ?? "kg");
      const newLine: EditableLine = {
        ingredientId: kanban.ingredientId,
        ingredientName: kanban.ingredientName ?? "Unknown",
        unit,
        totalRequired: 0,
        stockOnHand: 0,
        surplusTarget: 0,
        packWeight,
        costPerPack: kanban.costPerPack ?? 0,
        supplierPartNumber: null,
        orderQty: qty,
        packsToOrder: qty,
        isKanban: true,
        lastStockCheckAt: null,
        checked: false,
        editedPacks: qty,
        editedStock: 0,
        stockDirty: false,
      };
      const supplierId = kanban.supplierId!;
      // If this supplier already has a placed PO for the current plan, pull
      // that PO's lines into view so the operator can resubmit with the new
      // kanban item included, rather than losing the addition.
      reopenPlacedOrderIfAny(supplierId);
      setEditableLines(prev => {
        const existing = prev[supplierId] ?? [];
        const alreadyHas = existing.some(l => l.ingredientId === kanban.ingredientId);
        if (alreadyHas) return prev;
        return { ...prev, [supplierId]: [...existing, newLine] };
      });
      const dptSupplierIds = new Set((calculated?.suppliers ?? []).map(s => s.supplier.id));
      if (!dptSupplierIds.has(supplierId)) {
        setKanbanOnlySupplierInfo(prev => ({
          ...prev,
          [supplierId]: { id: supplierId, name: kanban.supplierName ?? `Supplier #${supplierId}` },
        }));
      }
      setExpandedSuppliers(prev => new Set([...prev, supplierId]));
    }
    setAddedKanbanIngredientIds(prev => new Set([...prev, ...toAdd.map(k => k.ingredientId)]));
    setKanbanSearchOpen(false);
    setKanbanSearch("");
    setSelectedKanbanIds(new Set());
  };

  // Issue 4: fetch every ingredient belonging to the supplier whose "Add
  // item" picker is open. Keyed by supplierId so switching suppliers
  // re-fetches fresh data.
  const { data: addItemIngredients = [], isLoading: addItemLoading, error: addItemError } = useQuery<SupplierIngredient[]>({
    queryKey: ["supplier-ingredients", addItemDialog?.supplierId],
    queryFn: async () => {
      if (!addItemDialog) return [];
      const res = await fetch(`${BASE}/api/orders/suppliers/${addItemDialog.supplierId}/ingredients`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status} — ${body.slice(0, 200)}`);
      }
      const data = await res.json();
      return data.ingredients ?? [];
    },
    enabled: !!addItemDialog,
    retry: false,
  });

  const filteredAddItemIngredients = debouncedAddItemSearch.trim()
    ? addItemIngredients.filter(i => i.name.toLowerCase().includes(debouncedAddItemSearch.toLowerCase()))
    : addItemIngredients;

  const handleAddManualItem = (ingredient: SupplierIngredient) => {
    if (!addItemDialog) return;
    const supplierId = addItemDialog.supplierId;
    // Same reopen-if-placed logic as kanban adds — an operator adding an
    // item to a supplier whose order already went through should see the
    // previous lines and be able to resubmit with the addition.
    reopenPlacedOrderIfAny(supplierId);
    const packWeight = Number(ingredient.packWeight) || 1;
    const costPerPack = Number(ingredient.costPerPack) || 0;
    const newLine: EditableLine = {
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      unit: ingredient.unit ?? "kg",
      totalRequired: 0,
      stockOnHand: 0,
      surplusTarget: 0,
      packWeight,
      costPerPack,
      supplierPartNumber: ingredient.supplierPartNumber,
      orderQty: packWeight,
      packsToOrder: 1,
      isKanban: false,
      orderingUrl: ingredient.orderingUrl,
      lastStockCheckAt: null,
      belowRequirement: false,
      checked: false,
      editedPacks: 1,
      editedStock: 0,
      stockDirty: false,
      isManual: true,
    };
    setEditableLines(prev => {
      const existing = prev[supplierId] ?? [];
      // If the line already exists (e.g. auto-calc added it but non-required
      // and toggle was off), just bump it to orderable rather than duplicate.
      const dupIdx = existing.findIndex(l => l.ingredientId === ingredient.id);
      if (dupIdx >= 0) {
        const updated = [...existing];
        updated[dupIdx] = { ...updated[dupIdx], isManual: true, belowRequirement: false, editedPacks: Math.max(1, updated[dupIdx].editedPacks) };
        return { ...prev, [supplierId]: updated };
      }
      return { ...prev, [supplierId]: [...existing, newLine] };
    });
    setExpandedSuppliers(prev => new Set([...prev, supplierId]));
    setAddItemDialog(null);
    setAddItemSearch("");
  };

  const placeMutation = useMutation({
    mutationFn: async ({ supplierId, lines, deliveryDate }: { supplierId: number; lines: EditableLine[]; deliveryDate?: string }) => {
      // Never send non-required informational lines to the PO endpoint —
      // they're display-only. Manual-added and kanban lines always go through.
      const orderableLines = lines.filter(l => l.isKanban || l.isManual || !l.belowRequirement);
      const payloadLines = orderableLines.map(l => ({
        ingredientId: l.ingredientId,
        quantityRequired: l.orderQty,
        quantityOrdered: (l.unit === "packs" || l.unit === "bottles")
          ? l.editedPacks
          : l.editedPacks * l.packWeight,
        unit: l.unit,
        unitPrice: l.costPerPack > 0 ? l.costPerPack : null,
        checkedOff: l.checked,
      }));

      // Reopened placed order → hit the resubmit endpoint instead of create+place.
      // This REPLACES the old lines with the new full set and bumps placedAt.
      const reopenedPOId = reopenedPlacedOrders[supplierId];
      if (reopenedPOId) {
        const resubmitRes = await fetch(`${BASE}/api/orders/purchase-orders/${reopenedPOId}/resubmit`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ lines: payloadLines, expectedDeliveryDate: deliveryDate }),
        });
        if (!resubmitRes.ok) {
          const body = await resubmitRes.text();
          throw new Error(`Failed to resubmit order: ${body.slice(0, 200)}`);
        }
        return resubmitRes.json();
      }

      const createRes = await fetch(`${BASE}/api/orders/purchase-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          supplierId,
          planId: selectedPlanId,
          lines: payloadLines,
        }),
      });
      if (!createRes.ok) throw new Error("Failed to create order");
      const order = await createRes.json();

      const placeRes = await fetch(`${BASE}/api/orders/purchase-orders/${order.id}/place`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ expectedDeliveryDate: deliveryDate }),
      });
      if (!placeRes.ok) throw new Error("Failed to place order");
      return placeRes.json();
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders-today"] });
      queryClient.invalidateQueries({ queryKey: ["order-calculate"] });
      // After a successful resubmit, drop the supplier from the reopened set
      // so the card moves back to the Placed tab on the next render.
      if (variables?.supplierId) {
        setReopenedPlacedOrders(prev => {
          if (!prev[variables.supplierId]) return prev;
          const next = { ...prev };
          delete next[variables.supplierId];
          return next;
        });
      }
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

  const updateStock = useCallback((supplierId: number, idx: number, newStock: number) => {
    setEditableLines(prev => {
      const updated = { ...prev };
      const lines = [...(updated[supplierId] || [])];
      const line = { ...lines[idx], editedStock: Math.max(0, newStock), stockDirty: true };
      // Recalculate packs based on new stock
      const rawOrderQty = Math.max(0, line.totalRequired + line.surplusTarget - Math.max(0, newStock));
      const packsToOrder = line.packWeight > 0 ? Math.ceil(rawOrderQty / line.packWeight) : 0;
      line.editedPacks = packsToOrder;
      lines[idx] = line;
      updated[supplierId] = lines;
      return updated;
    });
  }, []);

  const saveStockCheck = useCallback(async (ingredientId: number, quantity: number) => {
    try {
      const res = await fetch(`${BASE}/api/orders/stock-check`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ingredientId, quantity }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const data = await res.json();
      // Update the lastStockCheckAt for this ingredient across all suppliers
      setEditableLines(prev => {
        const updated = { ...prev };
        for (const [sid, lines] of Object.entries(updated)) {
          updated[Number(sid)] = lines.map(l =>
            l.ingredientId === ingredientId
              ? { ...l, stockOnHand: quantity, lastStockCheckAt: data.checkedAt, stockDirty: false }
              : l
          );
        }
        return updated;
      });
    } catch (err) {
      console.error("Stock check save failed:", err);
    }
  }, []);

  const handleRecalculate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["order-calculate", selectedPlanId] });
  }, [queryClient, selectedPlanId]);

  const getDeliveryDateForSupplier = useCallback((supplierId: number, leadTimeDays?: number, cutoffTime?: string): Date => {
    if (deliveryDates[supplierId]) return deliveryDates[supplierId];
    return calcExpectedDeliveryDate(leadTimeDays, cutoffTime);
  }, [deliveryDates]);

  const suppliers = calculated?.suppliers ?? [];

  const handlePlaceOrder = (supplierId: number, supplierName: string, leadTimeDays?: number, cutoffTime?: string) => {
    const date = getDeliveryDateForSupplier(supplierId, leadTimeDays, cutoffTime);
    setConfirmDialog({ supplierId, supplierName, deliveryDate: formatDeliveryDate(date) });
  };

  const confirmPlaceOrder = () => {
    if (!confirmDialog) return;
    const lines = editableLines[confirmDialog.supplierId] || [];
    const supplier = suppliers.find(s => s.supplier.id === confirmDialog.supplierId);
    const date = getDeliveryDateForSupplier(confirmDialog.supplierId, supplier?.supplier.leadTimeDays, supplier?.supplier.cutoffTime);
    const deliveryDateStr = toISODate(date);
    placeMutation.mutate({ supplierId: confirmDialog.supplierId, lines, deliveryDate: deliveryDateStr });
  };
  const placedForPlan = placedOrders.filter(o => o.status === "placed" && o.planId === selectedPlanId);
  const placedSupplierIds = new Set(placedForPlan.map(o => o.supplierId));
  // Suppliers whose placed order has been "reopened" via a kanban/manual add
  // are shown in the pending view so the operator can resubmit.
  const reopenedSupplierIds = new Set(Object.keys(reopenedPlacedOrders).map(Number));
  const dptPendingSuppliers = suppliers.filter(s => !placedSupplierIds.has(s.supplier.id) || reopenedSupplierIds.has(s.supplier.id));
  const kanbanOnlyPending = Object.values(kanbanOnlySupplierInfo)
    .filter(s => (!placedSupplierIds.has(s.id) || reopenedSupplierIds.has(s.id)) && !suppliers.some(ds => ds.supplier.id === s.id))
    .map(s => ({ supplier: { id: s.id, name: s.name, contactName: null, email: null, phone: null, website: null }, lines: [] as OrderLine[] }));
  const pendingSuppliers = [...dptPendingSuppliers, ...kanbanOnlyPending];
  const totalPendingItems = pendingSuppliers.reduce((sum, s) => sum + (editableLines[s.supplier.id]?.length ?? 0), 0);
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
          disabled={activePlans.length === 0}
        >
          <option value="">{activePlans.length === 0 ? "No active plans" : "Select plan..."}</option>
          {activePlans.map(p => (
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

      <div className="flex items-center gap-2 flex-wrap">
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
        <label
          className="ml-auto flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-secondary/40 hover:bg-secondary/60 cursor-pointer transition-colors"
          title="Show items that are daily stock-checked but have enough stock this round. Useful for verifying stock checks were taken."
        >
          <input
            type="checkbox"
            checked={showNonRequired}
            onChange={e => setShowNonRequired(e.target.checked)}
            className="rounded border-border"
          />
          <span>Show stocked items</span>
        </label>
        <button
          onClick={handleRecalculate}
          disabled={calcLoading}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-secondary text-secondary-foreground hover:bg-secondary/80 flex items-center gap-1.5 disabled:opacity-50"
          title="Recalculate orders using latest stock check values"
        >
          <RefreshCw className={cn("w-4 h-4", calcLoading && "animate-spin")} />
          Recalculate
        </button>
        <button
          onClick={() => { setKanbanSearchOpen(true); setKanbanSearch(""); setSelectedKanbanIds(new Set()); }}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 border border-amber-500/30 flex items-center gap-1.5"
        >
          <LayoutGrid className="w-4 h-4" />
          Add Kanbans
          {addedKanbanIngredientIds.size > 0 && (
            <span className="ml-1 bg-amber-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
              {addedKanbanIngredientIds.size}
            </span>
          )}
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
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          {activePlans.length === 0 ? (
            <>
              <ShoppingCart className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium text-muted-foreground">No active production plans</p>
              <p className="text-sm text-muted-foreground mt-1">
                Activate a production plan first — orders can only be placed against active plans.
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">Select an active production plan above to calculate order requirements.</p>
          )}
        </div>
      )}

      {viewFilter === "pending" && !calcLoading && pendingSuppliers.length === 0 && selectedPlanId && (
        <div className="text-center py-12 text-muted-foreground">
          No pending orders. All supplier orders have been placed or no ingredients need ordering.
        </div>
      )}

      {viewFilter === "pending" && pendingSuppliers.map(so => {
        const allLines = editableLines[so.supplier.id] || [];
        // Orderable = things that actually go onto a PO. Non-required lines
        // are hidden by default; when shown they're informational only.
        const orderableLines = allLines.filter(l => l.isKanban || l.isManual || !l.belowRequirement);
        const lines = showNonRequired ? allLines : orderableLines;
        // If the toggle is off and every line for this supplier is non-required,
        // skip the supplier card entirely — otherwise you'd see empty cards.
        if (!showNonRequired && orderableLines.length === 0) return null;
        const allChecked = orderableLines.length > 0 && orderableLines.every(l => l.checked);
        const checkedCount = orderableLines.filter(l => l.checked).length;
        const nonRequiredCount = allLines.length - orderableLines.length;
        const expanded = expandedSuppliers.has(so.supplier.id);
        const cost = estimatedCost(orderableLines);
        const reopenedPOId = reopenedPlacedOrders[so.supplier.id];
        const isReopened = !!reopenedPOId;

        return (
          <div key={so.supplier.id} className={cn(
            "rounded-xl border bg-card overflow-hidden",
            isReopened ? "border-amber-500/40 ring-1 ring-amber-500/20" : "border-border"
          )}>
            <button
              onClick={() => toggleSupplier(so.supplier.id)}
              className="w-full flex items-center justify-between p-4 hover:bg-secondary/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-primary" />
                </div>
                <div className="text-left">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{so.supplier.name}</h3>
                    {isReopened && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                        <RefreshCw className="w-2.5 h-2.5" />
                        Editing placed order #{reopenedPOId}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {orderableLines.length} item{orderableLines.length !== 1 ? "s" : ""} &middot;
                    {checkedCount}/{orderableLines.length} checked
                    {showNonRequired && nonRequiredCount > 0 && (
                      <> &middot; {nonRequiredCount} stocked</>
                    )}
                    {cost > 0 && <> &middot; &pound;{cost.toFixed(2)} est.</>}
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Truck className="w-3 h-3 inline shrink-0" />
                    Est. delivery: {formatDeliveryDate(getDeliveryDateForSupplier(so.supplier.id, so.supplier.leadTimeDays, so.supplier.cutoffTime))}
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
                        <th className="p-3 text-right font-medium text-muted-foreground">In Stock</th>
                        <th className="p-3 text-right font-semibold text-green-600 dark:text-green-400">Order Quantity</th>
                        <th className="p-3 text-center font-medium text-muted-foreground">Packs</th>
                        <th className="p-3 text-right font-medium text-muted-foreground">Pack Size</th>
                        <th className="p-3 text-right font-medium text-muted-foreground">Surplus</th>
                        <th className="p-3 text-right font-medium text-muted-foreground">Required</th>
                        {lines.some(l => l.costPerPack > 0) && (
                          <th className="p-3 text-right font-medium text-muted-foreground">Line Total</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line) => {
                        // Find the real index in the full allLines array so
                        // toggleLineCheck/updatePacks/updateStock continue to
                        // mutate the correct row when the view is filtered.
                        const idx = allLines.findIndex(l => l.ingredientId === line.ingredientId);
                        const isNonOrderable = !!line.belowRequirement && !line.isKanban && !line.isManual;
                        return (
                        <tr
                          key={line.ingredientId}
                          className={cn(
                            "border-b border-border/50 transition-colors",
                            isNonOrderable ? "opacity-60 bg-secondary/10" :
                            line.checked ? "bg-green-500/5" : "hover:bg-secondary/20"
                          )}
                        >
                          <td className="p-3">
                            <Checkbox
                              checked={line.checked}
                              onCheckedChange={() => toggleLineCheck(so.supplier.id, idx)}
                              disabled={isNonOrderable}
                            />
                          </td>
                          <td className="p-3">
                            <div className="font-medium">
                              {line.orderingUrl ? (
                                <a href={line.orderingUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                                  {line.ingredientName}
                                  <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                </a>
                              ) : line.ingredientName}
                            </div>
                            {line.supplierPartNumber && (
                              <div className="text-xs text-muted-foreground">#{line.supplierPartNumber}</div>
                            )}
                            {line.isKanban && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-500/10 text-amber-600 mt-0.5">
                                Kanban
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex flex-col items-end gap-0.5">
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min={0}
                                  step="any"
                                  value={line.editedStock === 0 ? "" : line.editedStock}
                                  onChange={e => updateStock(so.supplier.id, idx, e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                                  onFocus={e => e.currentTarget.select()}
                                  onBlur={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    saveStockCheck(line.ingredientId, val);
                                  }}
                                  placeholder="0"
                                  className="w-20 h-7 rounded border border-border bg-background text-right text-sm tabular-nums px-1.5"
                                />
                                <span className="text-xs text-muted-foreground">{line.unit}</span>
                              </div>
                              {line.lastStockCheckAt ? (() => {
                                const d = new Date(line.lastStockCheckAt);
                                const now = new Date();
                                const isToday = d.toDateString() === now.toDateString();
                                const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
                                const isYesterday = d.toDateString() === yesterday.toDateString();
                                const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                                const label = isToday ? `Today ${timeStr}` : isYesterday ? `Yesterday ${timeStr}` : `${d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" })} ${timeStr}`;
                                return (
                                  <span className={cn("text-[10px] flex items-center gap-0.5", isToday ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
                                    <Clock className="w-2.5 h-2.5" />
                                    {label}
                                  </span>
                                );
                              })() : (
                                <span className="text-[10px] text-red-500 flex items-center gap-0.5">
                                  <AlertCircle className="w-2.5 h-2.5" />
                                  No stock check
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-3 text-right tabular-nums font-bold text-lg text-green-600 dark:text-green-400">
                            {(line.unit === "packs" || line.unit === "bottles")
                              ? `${line.editedPacks} ${line.unit}`
                              : `${(line.editedPacks * line.packWeight).toLocaleString()} ${line.unit}`}
                          </td>
                          <td className="p-3 text-center">
                            <input
                              type="number"
                              min={0}
                              value={line.editedPacks === 0 ? "" : line.editedPacks}
                              onChange={e => updatePacks(so.supplier.id, idx, e.target.value === "" ? 0 : parseInt(e.target.value) || 0)}
                              onFocus={e => e.currentTarget.select()}
                              disabled={isNonOrderable}
                              placeholder="0"
                              className="w-16 h-8 rounded border border-border bg-background text-center text-sm tabular-nums disabled:opacity-40"
                            />
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {line.packWeight} kg
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {line.surplusTarget.toLocaleString()} {line.unit}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {line.totalRequired.toLocaleString()} {line.unit}
                          </td>
                          {lines.some(l => l.costPerPack > 0) && (
                            <td className="p-3 text-right tabular-nums">
                              {line.costPerPack > 0 ? `\u00A3${(line.editedPacks * line.costPerPack).toFixed(2)}` : "-"}
                            </td>
                          )}
                        </tr>
                        );
                      })}
                      <tr className="bg-secondary/5">
                        <td colSpan={lines.some(l => l.costPerPack > 0) ? 9 : 8} className="p-2">
                          <button
                            type="button"
                            onClick={() => { setAddItemDialog({ supplierId: so.supplier.id, supplierName: so.supplier.name }); setAddItemSearch(""); }}
                            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/60 border border-dashed border-border hover:border-primary/40 transition-colors"
                          >
                            <Plus className="w-4 h-4" />
                            Add item to this order
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="px-4 py-3 border-t border-border bg-secondary/5 flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>Delivery date:</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        const current = getDeliveryDateForSupplier(so.supplier.id, so.supplier.leadTimeDays, so.supplier.cutoffTime);
                        const prev = nextBusinessDay(current, -1);
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        if (prev >= today) {
                          setDeliveryDates(d => ({ ...d, [so.supplier.id]: prev }));
                        }
                      }}
                      className="p-1 rounded hover:bg-secondary transition-colors"
                      title="Previous business day"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <input
                      type="date"
                      value={toISODate(getDeliveryDateForSupplier(so.supplier.id, so.supplier.leadTimeDays, so.supplier.cutoffTime))}
                      min={toISODate(new Date())}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val) {
                          const parts = val.split("-").map(Number);
                          let chosen = new Date(parts[0], parts[1] - 1, parts[2]);
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          if (chosen < today) return;
                          if (chosen.getDay() === 0 || chosen.getDay() === 6) {
                            chosen = nextBusinessDay(chosen, 1);
                          }
                          setDeliveryDates(d => ({ ...d, [so.supplier.id]: chosen }));
                        }
                      }}
                      className="px-2 py-1 text-sm border border-border rounded-md bg-background w-[140px]"
                    />
                    <button
                      onClick={() => {
                        const current = getDeliveryDateForSupplier(so.supplier.id, so.supplier.leadTimeDays, so.supplier.cutoffTime);
                        const nxt = nextBusinessDay(current, 1);
                        setDeliveryDates(d => ({ ...d, [so.supplier.id]: nxt }));
                      }}
                      className="p-1 rounded hover:bg-secondary transition-colors"
                      title="Next business day"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDeliveryDate(getDeliveryDateForSupplier(so.supplier.id, so.supplier.leadTimeDays, so.supplier.cutoffTime))}
                  </span>
                </div>

                <div className="p-4 flex items-center justify-between border-t border-border bg-secondary/10">
                  <div className="text-sm text-muted-foreground">
                    {checkedCount === orderableLines.length && orderableLines.length > 0 ? (
                      <span className="text-green-600 font-medium flex items-center gap-1">
                        <Check className="w-4 h-4" /> All items checked
                      </span>
                    ) : (
                      <span>{checkedCount} of {orderableLines.length} items checked</span>
                    )}
                  </div>
                  <button
                    onClick={() => handlePlaceOrder(so.supplier.id, so.supplier.name, so.supplier.leadTimeDays, so.supplier.cutoffTime)}
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
                    {isReopened ? "Update & Resend Order" : "Mark as Placed"}
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
          {placedOrders.filter(o => o.status === "placed").map(order => {
            const isReopened = !!reopenedPlacedOrders[order.supplierId];
            return (
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
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-700">
                    Placed
                  </span>
                  <button
                    type="button"
                    onClick={() => handleEditPlacedOrder(order)}
                    disabled={isReopened}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                    title={isReopened ? "Already being edited in the To Order tab" : "Reopen this order so you can add or change items, then resubmit"}
                  >
                    <RefreshCw className="w-3 h-3" />
                    {isReopened ? "Being edited…" : "Edit order"}
                  </button>
                </div>
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
                        <td className="p-3 font-medium">
                          {line.orderingUrl ? (
                            <a href={line.orderingUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                              {line.ingredientName}
                              <ExternalLink className="w-3 h-3 flex-shrink-0" />
                            </a>
                          ) : line.ingredientName}
                        </td>
                        <td className="p-3 text-right tabular-nums">{Number(line.quantityOrdered).toLocaleString()}</td>
                        <td className="p-3 text-right">{line.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            );
          })}
        </div>
      )}

      <Dialog open={kanbanSearchOpen} onOpenChange={open => { setKanbanSearchOpen(open); if (!open) { setKanbanSearch(""); setSelectedKanbanIds(new Set()); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LayoutGrid className="w-5 h-5 text-amber-500" />
              Add Pulled Kanbans
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={kanbanSearch}
                onChange={e => setKanbanSearch(e.target.value)}
                placeholder="Search by ingredient or supplier…"
                autoFocus
                className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              {kanbanSearch && (
                <button onClick={() => setKanbanSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {selectedKanbanIds.size > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
                <Check className="w-3.5 h-3.5" />
                {selectedKanbanIds.size} item{selectedKanbanIds.size !== 1 ? "s" : ""} selected
              </p>
            )}

            <div className="max-h-80 overflow-y-auto space-y-1 -mx-1 px-1">
              {filteredKanbanIngredients.length === 0 && (
                <p className="text-center py-8 text-sm text-muted-foreground">
                  {kanbanIngredients.length === 0 ? "No kanban-enabled ingredients found." : "No ingredients match your search."}
                </p>
              )}
              {filteredKanbanIngredients.map(k => {
                const alreadyAdded = addedKanbanIngredientIds.has(k.ingredientId);
                const isSelected = selectedKanbanIds.has(k.ingredientId);
                const noSupplier = !k.supplierId;
                const orderAmt = k.kanbanOrderAmount ?? k.kanbanQuantity ?? null;
                const unitLabel =
                  k.kanbanUnit === "pack" ? "packs"
                  : k.kanbanUnit === "bottle" ? "bottles"
                  : (k.ingredientUnit ?? "");
                return (
                  <button
                    key={k.ingredientId}
                    type="button"
                    onClick={() => !alreadyAdded && !noSupplier && toggleKanbanSelection(k.ingredientId)}
                    disabled={alreadyAdded || noSupplier}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left transition-colors",
                      alreadyAdded
                        ? "bg-emerald-500/10 border border-emerald-500/30 cursor-default"
                        : noSupplier
                        ? "opacity-50 cursor-not-allowed bg-secondary/30 border border-transparent"
                        : isSelected
                        ? "bg-amber-500/10 border border-amber-500/40"
                        : "hover:bg-secondary/60 border border-transparent hover:border-border"
                    )}
                  >
                    <div className="shrink-0">
                      {alreadyAdded ? (
                        <div className="w-4 h-4 rounded bg-emerald-500 flex items-center justify-center">
                          <Check className="w-2.5 h-2.5 text-white" />
                        </div>
                      ) : (
                        <div className={cn(
                          "w-4 h-4 rounded border-2 flex items-center justify-center transition-colors",
                          isSelected ? "bg-amber-500 border-amber-500" : "border-border"
                        )}>
                          {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{k.ingredientName ?? "Unknown"}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {noSupplier ? "No supplier" : k.supplierName}
                        {orderAmt != null && <> &middot; <span className="font-medium text-foreground">{orderAmt} {unitLabel}</span> to order</>}
                      </p>
                    </div>
                    {alreadyAdded && (
                      <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400 font-medium">Added</span>
                    )}
                    {noSupplier && !alreadyAdded && (
                      <span className="shrink-0 text-xs text-muted-foreground">No supplier</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="pt-2 border-t border-border flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Select the kanbans you have physically pulled
              </span>
              <button
                onClick={handleAddSelectedKanbans}
                disabled={selectedKanbanIds.size === 0}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                  selectedKanbanIds.size > 0
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-secondary text-muted-foreground cursor-not-allowed"
                )}
              >
                {selectedKanbanIds.size > 0 ? `Add ${selectedKanbanIds.size} to Order` : "Done"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Issue 4: per-supplier Add Item picker */}
      <Dialog
        open={!!addItemDialog}
        onOpenChange={open => { if (!open) { setAddItemDialog(null); setAddItemSearch(""); } }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" />
              Add item{addItemDialog ? ` to ${addItemDialog.supplierName}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={addItemSearch}
                onChange={e => setAddItemSearch(e.target.value)}
                placeholder="Search ingredient…"
                autoFocus
                className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              {addItemSearch && (
                <button onClick={() => setAddItemSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto space-y-1 -mx-1 px-1">
              {addItemLoading && (
                <p className="text-center py-8 text-sm text-muted-foreground flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading ingredients…
                </p>
              )}
              {!addItemLoading && addItemError && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-3 text-sm text-destructive flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Couldn't load ingredients</p>
                    <p className="text-xs mt-0.5 font-mono">{addItemError instanceof Error ? addItemError.message : String(addItemError)}</p>
                    <p className="text-xs mt-1">If the API server was just updated, it may need to be restarted.</p>
                  </div>
                </div>
              )}
              {!addItemLoading && !addItemError && filteredAddItemIngredients.length === 0 && (
                <p className="text-center py-8 text-sm text-muted-foreground">
                  {addItemIngredients.length === 0 ? "This supplier has no ingredients assigned." : "No ingredients match your search."}
                </p>
              )}
              {!addItemLoading && filteredAddItemIngredients.map(ing => {
                const existingLine = addItemDialog
                  ? (editableLines[addItemDialog.supplierId] ?? []).find(l => l.ingredientId === ing.id)
                  : undefined;
                const alreadyOrderable = !!existingLine && (existingLine.isKanban || existingLine.isManual || !existingLine.belowRequirement);
                return (
                  <button
                    key={ing.id}
                    type="button"
                    onClick={() => !alreadyOrderable && handleAddManualItem(ing)}
                    disabled={alreadyOrderable}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left transition-colors",
                      alreadyOrderable
                        ? "bg-emerald-500/10 border border-emerald-500/30 cursor-default"
                        : "hover:bg-secondary/60 border border-transparent hover:border-border"
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{ing.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {Number(ing.packWeight) || 1} {ing.unit ?? "kg"} per pack
                        {Number(ing.costPerPack) > 0 && <> &middot; &pound;{Number(ing.costPerPack).toFixed(2)}/pack</>}
                        {ing.supplierPartNumber && <> &middot; #{ing.supplierPartNumber}</>}
                      </p>
                    </div>
                    {alreadyOrderable && (
                      <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400 font-medium">Already on order</span>
                    )}
                    {!alreadyOrderable && (
                      <Plus className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
              <div className="flex items-center gap-2 text-sm bg-secondary/30 rounded-lg px-3 py-2">
                <Truck className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Expected delivery:</span>
                <span className="font-medium">{confirmDialog.deliveryDate}</span>
              </div>
              {editableLines[confirmDialog.supplierId] && (
                <div className="rounded-lg border border-border p-3 space-y-1 text-sm max-h-60 overflow-y-auto">
                  {editableLines[confirmDialog.supplierId]
                    .filter(l => l.isKanban || l.isManual || !l.belowRequirement)
                    .map(l => (
                    <div key={l.ingredientId} className="flex justify-between">
                      <span>
                        {l.orderingUrl ? (
                          <a href={l.orderingUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                            {l.ingredientName}
                            <ExternalLink className="w-3 h-3 flex-shrink-0" />
                          </a>
                        ) : l.ingredientName}
                      </span>
                      <span className="tabular-nums font-medium">
                        {(l.unit === "packs" || l.unit === "bottles")
                          ? `${l.editedPacks} ${l.unit} (${l.packWeight} kg each)`
                          : `${l.editedPacks} x ${l.packWeight} kg = ${(l.editedPacks * l.packWeight).toLocaleString()} ${l.unit}`}
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
