import { useState, useEffect, useCallback, useRef } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
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
  Trash2,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  nextBusinessDay,
  calcExpectedDeliveryDate,
  formatDeliveryDate,
  toISODate,
} from "@workspace/business-days";
import { packNoun } from "@/pages/station/shared/prep-helpers";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type OrderLine = {
  // For miscellaneous lines (operator-typed one-offs) this is a synthetic
  // negative id so React key lookups keep working; the backend receives null
  // plus a description string. See isMisc below.
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
  // When true, Required / Surplus / Ordered render in whole packs; recipes
  // and internal maths still use native units.
  stockInPacks?: boolean;
  // Misc one-off lines not tied to an ingredient record. ingredientId is a
  // synthetic negative number for UI purposes; serialiser sends null.
  isMisc?: boolean;
  description?: string | null;
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
    // Null for miscellaneous one-off lines (samples, packaging trials, etc.).
    // The misc name is stored in `description` and surfaced via ingredientName.
    ingredientId: number | null;
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
  secondarySupplierId: number | null;
};

export default function Orders() {
  const queryClient = useQueryClient();
  const { state: authState } = useAuth();
  const canManageOrders = authState.status === "authenticated"
    && (authState.user.role === "admin" || authState.user.role === "manager");
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
  // Per-row supplier override for the Add Kanbans dialog. Keyed by ingredientId.
  // Defaults to the ingredient's primary supplier; operators can route to any
  // supplier (secondary or otherwise) via the dropdown.
  const [kanbanSupplierOverrides, setKanbanSupplierOverrides] = useState<Record<number, number>>({});

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

  // Operator-dismissed supplier cards for the current plan. Persisted in
  // sessionStorage so a refresh doesn't re-surface them; cleared when the
  // plan selector changes. Used when the system suggests an order the team
  // has decided not to place this round.
  const [dismissedSupplierIds, setDismissedSupplierIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!selectedPlanId) { setDismissedSupplierIds(new Set()); return; }
    const raw = sessionStorage.getItem(`orders_dismissedSuppliers_${selectedPlanId}`);
    if (!raw) { setDismissedSupplierIds(new Set()); return; }
    try {
      const ids = JSON.parse(raw) as number[];
      setDismissedSupplierIds(new Set(ids.filter(n => Number.isFinite(n))));
    } catch {
      setDismissedSupplierIds(new Set());
    }
  }, [selectedPlanId]);
  const persistDismissed = useCallback((next: Set<number>) => {
    if (!selectedPlanId) return;
    if (next.size === 0) sessionStorage.removeItem(`orders_dismissedSuppliers_${selectedPlanId}`);
    else sessionStorage.setItem(`orders_dismissedSuppliers_${selectedPlanId}`, JSON.stringify([...next]));
  }, [selectedPlanId]);

  // Confirmation modal state for dismissing a supplier card. Two-step so the
  // operator can't drop an order accidentally.
  const [dismissConfirm, setDismissConfirm] = useState<{ supplierId: number; supplierName: string } | null>(null);

  // "+ Add Supplier Order" dialog — picks any supplier, even ones the calc
  // didn't suggest. Adds an empty card the operator can fill via the existing
  // "+ Add item" / Misc flow.
  const [addSupplierDialogOpen, setAddSupplierDialogOpen] = useState(false);
  const [addSupplierSearch, setAddSupplierSearch] = useState("");
  const debouncedAddSupplierSearch = useDebouncedValue(addSupplierSearch);

  // Confirmation modal state for deleting a placed PO from the inline edit
  // card (manager / admin only). Mirrors dismissConfirm — second click guard
  // so a fat-finger doesn't nuke a real placed order.
  const [deleteOrderConfirm, setDeleteOrderConfirm] = useState<{ poId: number; supplierId: number; supplierName: string } | null>(null);

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

  // Fetch every placed PO linked to the selected plan so the "Placed for
  // this Plan" tab shows them regardless of when they were placed —
  // yesterday's order shouldn't drop off when the calendar flips.
  const { data: placedOrders = [] } = useQuery<PurchaseOrder[]>({
    queryKey: ["purchase-orders-for-plan", selectedPlanId],
    queryFn: async () => {
      if (!selectedPlanId) return [];
      const res = await fetch(`${BASE}/api/orders/purchase-orders?planId=${selectedPlanId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load orders");
      return res.json();
    },
    enabled: !!selectedPlanId,
  });

  useEffect(() => {
    if (!calculated?.suppliers) return;
    setEditableLines(prev => {
      const next: Record<number, EditableLine[]> = {};
      const calcSupplierIds = new Set(calculated.suppliers.map(s => s.supplier.id));

      for (const so of calculated.suppliers) {
        const existing = prev[so.supplier.id] ?? [];
        const calcIngIds = new Set(so.lines.map(l => l.ingredientId));
        // Preserve operator-added lines that the API doesn't know about:
        //   • manual ingredient adds via "+ Add item"
        //   • misc one-off lines
        //   • kanbans whose orderDayTarget != today (weekly suppliers) and so
        //     don't come back from /calculate, but the operator has explicitly
        //     queued for this round.
        // Otherwise placing an order on supplier A invalidates the calc query,
        // and the refetched response wipes B's queued kanbans on its way back.
        const preservedLocals = existing.filter(l =>
          (l.isManual || l.isMisc || l.isKanban) && !calcIngIds.has(l.ingredientId)
        );
        const merged = so.lines.map(l => {
          // Preserve in-flight operator edits (pack count, stock count, check
          // toggle) so a refetch doesn't blow away their typing.
          const prior = existing.find(e => e.ingredientId === l.ingredientId);
          if (prior && !prior.isManual && !prior.isMisc) {
            return {
              ...l,
              checked: prior.checked,
              editedPacks: prior.stockDirty ? prior.editedPacks : l.packsToOrder,
              editedStock: prior.stockDirty ? prior.editedStock : l.stockOnHand,
              stockDirty: prior.stockDirty,
            };
          }
          return {
            ...l,
            checked: false,
            editedPacks: l.packsToOrder,
            editedStock: l.stockOnHand,
            stockDirty: false,
          };
        });
        next[so.supplier.id] = [...merged, ...preservedLocals];
      }

      // Suppliers that exist only via locally-added kanbans/manual items
      // (not in calculated.suppliers) — keep their lines so they don't
      // vanish when an unrelated supplier's order is placed.
      for (const sidStr of Object.keys(prev)) {
        const sid = Number(sidStr);
        if (calcSupplierIds.has(sid)) continue;
        const preserved = (prev[sid] ?? []).filter(l => l.isManual || l.isMisc || l.isKanban);
        if (preserved.length > 0) next[sid] = preserved;
      }

      return next;
    });
    setExpandedSuppliers(prev => {
      const next = new Set(prev);
      for (const s of calculated.suppliers) next.add(s.supplier.id);
      return next;
    });
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

  const { data: allSuppliers = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["suppliers-for-kanban-dialog"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/suppliers`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load suppliers");
      return res.json();
    },
    enabled: kanbanSearchOpen,
  });

  // For a given kanban row, produce the supplier options in priority order:
  // primary first, then secondary, then the rest alphabetically.
  const supplierOptionsFor = useCallback((k: KanbanIngredient) => {
    const list = allSuppliers ?? [];
    const primary = k.supplierId != null ? list.find(s => s.id === k.supplierId) : undefined;
    const secondary = k.secondarySupplierId != null && k.secondarySupplierId !== k.supplierId
      ? list.find(s => s.id === k.secondarySupplierId)
      : undefined;
    const primaryId = primary?.id;
    const secondaryId = secondary?.id;
    const rest = list
      .filter(s => s.id !== primaryId && s.id !== secondaryId)
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    return [
      ...(primary ? [{ ...primary, label: `${primary.name} (primary)` }] : []),
      ...(secondary ? [{ ...secondary, label: `${secondary.name} (secondary)` }] : []),
      ...rest.map(s => ({ ...s, label: s.name })),
    ];
  }, [allSuppliers]);

  const effectiveSupplierIdFor = useCallback((k: KanbanIngredient) => {
    return kanbanSupplierOverrides[k.ingredientId] ?? k.supplierId ?? null;
  }, [kanbanSupplierOverrides]);

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
      // Misc lines from the API have ingredientId = null; give each a unique
      // synthetic negative id so React keys stay stable and downstream code
      // (which keys by ingredientId) doesn't collapse them into a single row.
      let miscIdCounter = -1;
      while (existing.some(l => l.ingredientId === miscIdCounter)) miscIdCounter--;
      const hydratedFromPO: EditableLine[] = placedPO.lines
        .filter(l => l.ingredientId == null || !existingIngredientIds.has(l.ingredientId))
        .map(l => {
          const qtyOrdered = Number(l.quantityOrdered) || 0;
          const unit = l.unit ?? "kg";
          const isPackUnit = unit === "packs" || unit === "bottles" || unit === "pallets";
          const packs = isPackUnit ? qtyOrdered : Math.max(1, Math.round(qtyOrdered));
          const isMisc = l.ingredientId == null;
          // For misc lines the backend folds the operator-typed name into
          // ingredientName via a description fallback. Keep a copy on the
          // line so the resubmit payload preserves it round-trip.
          const miscName = isMisc ? (l.ingredientName ?? "Misc item") : null;
          const syntheticId = isMisc ? miscIdCounter-- : (l.ingredientId as number);
          return {
            ingredientId: syntheticId,
            ingredientName: l.ingredientName ?? (isMisc ? "Misc item" : `Ingredient #${l.ingredientId}`),
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
            isMisc: isMisc || undefined,
            description: miscName,
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

  // Deep-link from the deliveries page: ?editPo=N pops the matching placed
  // order into edit mode as soon as the placed-orders query lands. We strip
  // the param after handling so a refresh doesn't keep re-opening it.
  useEffect(() => {
    const url = new URL(window.location.href);
    const editPoParam = url.searchParams.get("editPo");
    if (!editPoParam) return;
    const editPoId = Number(editPoParam);
    if (!Number.isFinite(editPoId)) return;
    const target = placedOrders.find(o => o.id === editPoId);
    if (!target) return;
    handleEditPlacedOrder(target);
    url.searchParams.delete("editPo");
    window.history.replaceState({}, "", url.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placedOrders]);

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

  // Drop a single line from the in-progress order. Used when an
  // auto-included stock-check item shouldn't actually be ordered this round —
  // simpler to remove than to leave it sitting at qty 0 and risk it slipping
  // through. Only affects local edit state; the line is never sent to the
  // backend on save (POST/resubmit serialise editableLines).
  const removeLine = useCallback((supplierId: number, ingredientId: number) => {
    setEditableLines(prev => {
      const lines = prev[supplierId] ?? [];
      const next = lines.filter(l => l.ingredientId !== ingredientId);
      return { ...prev, [supplierId]: next };
    });
  }, []);

  // Remove a previously-pulled kanban from the pending order. Used when the
  // operator pulled one by accident — tapping the same item again drops the
  // order-table line, matching the mental model of putting the card back on
  // the board.
  const handleUnpullKanban = (ingredientId: number) => {
    const suppliersLeftEmpty: number[] = [];
    setEditableLines(prev => {
      const updated: Record<number, EditableLine[]> = {};
      for (const [sid, lines] of Object.entries(prev)) {
        const numSid = Number(sid);
        const filtered = lines.filter(l => !(l.ingredientId === ingredientId && l.isKanban));
        if (filtered.length > 0) updated[numSid] = filtered;
        else suppliersLeftEmpty.push(numSid);
      }
      return updated;
    });
    // Drop temporary (kanban-only) supplier entries whose final line just
    // disappeared, so we don't leave an empty supplier header behind.
    if (suppliersLeftEmpty.length > 0) {
      setKanbanOnlySupplierInfo(prev => {
        const next = { ...prev };
        for (const sid of suppliersLeftEmpty) delete next[sid];
        return next;
      });
    }
    setAddedKanbanIngredientIds(prev => {
      const next = new Set(prev);
      next.delete(ingredientId);
      return next;
    });
  };

  const handleAddSelectedKanbans = () => {
    const toAdd = kanbanIngredients.filter(
      k =>
        selectedKanbanIds.has(k.ingredientId) &&
        !addedKanbanIngredientIds.has(k.ingredientId) &&
        effectiveSupplierIdFor(k) != null
    );
    for (const kanban of toAdd) {
      const qty = kanban.kanbanOrderAmount ?? kanban.kanbanQuantity ?? 1;
      const packWeight = kanban.packWeight ?? 1;
      const unit =
        kanban.kanbanUnit === "pack" ? "packs"
        : kanban.kanbanUnit === "bottle" ? "bottles"
        : kanban.kanbanUnit === "pallet" ? "pallets"
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
      const supplierId = effectiveSupplierIdFor(kanban)!;
      const supplierName =
        allSuppliers.find(s => s.id === supplierId)?.name
        ?? (supplierId === kanban.supplierId ? kanban.supplierName : null)
        ?? `Supplier #${supplierId}`;
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
          [supplierId]: { id: supplierId, name: supplierName },
        }));
      }
      setExpandedSuppliers(prev => new Set([...prev, supplierId]));
    }
    setAddedKanbanIngredientIds(prev => new Set([...prev, ...toAdd.map(k => k.ingredientId)]));
    setKanbanSearchOpen(false);
    setKanbanSearch("");
    setSelectedKanbanIds(new Set());
    setKanbanSupplierOverrides({});
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

  // Miscellaneous one-off line — operator types a description + qty instead
  // of picking a real ingredient. Used for samples, packaging trials, etc.
  // Saved with ingredientId null + description on the PO line so goods-in
  // still has something to tick off when it arrives.
  const [miscForm, setMiscForm] = useState<{ description: string; quantity: string; unit: string }>({
    description: "", quantity: "1", unit: "each",
  });
  const miscIdCounter = useRef(-1);
  const handleAddMiscItem = () => {
    if (!addItemDialog) return;
    const desc = miscForm.description.trim();
    const qty = Number(miscForm.quantity);
    if (!desc) { toast({ title: "Description required", variant: "destructive" }); return; }
    if (!Number.isFinite(qty) || qty <= 0) { toast({ title: "Quantity must be > 0", variant: "destructive" }); return; }
    const supplierId = addItemDialog.supplierId;
    reopenPlacedOrderIfAny(supplierId);
    const syntheticId = miscIdCounter.current--;
    const newLine: EditableLine = {
      ingredientId: syntheticId,
      ingredientName: desc,
      description: desc,
      isMisc: true,
      unit: miscForm.unit || "each",
      totalRequired: qty,
      stockOnHand: 0,
      surplusTarget: 0,
      packWeight: 1,
      costPerPack: 0,
      supplierPartNumber: null,
      orderQty: qty,
      packsToOrder: qty,
      isKanban: false,
      orderingUrl: null,
      lastStockCheckAt: null,
      belowRequirement: false,
      checked: false,
      editedPacks: qty,
      editedStock: 0,
      stockDirty: false,
      isManual: true,
    };
    setEditableLines(prev => {
      const existing = prev[supplierId] ?? [];
      return { ...prev, [supplierId]: [...existing, newLine] };
    });
    setExpandedSuppliers(prev => new Set([...prev, supplierId]));
    setMiscForm({ description: "", quantity: "1", unit: "each" });
    setAddItemDialog(null);
    setAddItemSearch("");
  };

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
        // Misc lines carry a synthetic negative id client-side; server wants null.
        ingredientId: l.isMisc ? null : l.ingredientId,
        description: l.isMisc ? (l.description ?? l.ingredientName) : null,
        quantityRequired: l.orderQty,
        // Pack-counted units (packs, bottles, pallets) store the pack
        // count directly. Weight/volume-based units multiply by packWeight
        // to get the native quantity. Pallets were previously missing
        // from this list, so a 1-pallet order with packWeight = 0 saved
        // as quantityOrdered = 0 and showed as zero on deliveries.
        quantityOrdered: l.isMisc
          ? l.editedPacks
          : (l.unit === "packs" || l.unit === "bottles" || l.unit === "pallets")
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
      queryClient.invalidateQueries({ queryKey: ["purchase-orders-for-plan"] });
      queryClient.invalidateQueries({ queryKey: ["order-calculate"] });
      // Drop the placed supplier's editable lines + locally-added-kanban
      // tracking so the merge in the calc useEffect doesn't keep showing
      // already-placed lines as still-pending. Other suppliers' state is
      // untouched — that's the whole point of the merge.
      if (variables?.supplierId) {
        const placedSupplierId = variables.supplierId;
        const placedIngredientIds = new Set(
          (variables.lines ?? [])
            .map(l => l.ingredientId)
            .filter((id): id is number => Number.isFinite(id) && id >= 0),
        );
        setEditableLines(prev => {
          if (!(placedSupplierId in prev)) return prev;
          const next = { ...prev };
          delete next[placedSupplierId];
          return next;
        });
        setKanbanOnlySupplierInfo(prev => {
          if (!(placedSupplierId in prev)) return prev;
          const next = { ...prev };
          delete next[placedSupplierId];
          return next;
        });
        setAddedKanbanIngredientIds(prev => {
          if (placedIngredientIds.size === 0) return prev;
          const next = new Set(prev);
          for (const iid of placedIngredientIds) next.delete(iid);
          return next;
        });
        // After a successful resubmit, drop the supplier from the reopened set
        // so the card moves back to the Placed tab on the next render.
        setReopenedPlacedOrders(prev => {
          if (!prev[placedSupplierId]) return prev;
          const next = { ...prev };
          delete next[placedSupplierId];
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
  const dptPendingSuppliersAll = suppliers.filter(s => !placedSupplierIds.has(s.supplier.id) || reopenedSupplierIds.has(s.supplier.id));
  const kanbanOnlyPendingAll = Object.values(kanbanOnlySupplierInfo)
    .filter(s => (!placedSupplierIds.has(s.id) || reopenedSupplierIds.has(s.id)) && !suppliers.some(ds => ds.supplier.id === s.id))
    .map(s => ({ supplier: { id: s.id, name: s.name, contactName: null, email: null, phone: null, website: null }, lines: [] as OrderLine[] }));
  const allPendingSuppliers = [...dptPendingSuppliersAll, ...kanbanOnlyPendingAll];
  // Operator-dismissed cards drop out of the pending list but stay tracked so
  // a "Show N dismissed" link can restore them. Reopened POs always render
  // even if dismissed — that flow is the user explicitly editing.
  const pendingSuppliers = allPendingSuppliers.filter(s =>
    !dismissedSupplierIds.has(s.supplier.id) || reopenedSupplierIds.has(s.supplier.id)
  );
  const dismissedPendingSuppliers = allPendingSuppliers.filter(s =>
    dismissedSupplierIds.has(s.supplier.id) && !reopenedSupplierIds.has(s.supplier.id)
  );
  const totalPendingItems = pendingSuppliers.reduce((sum, s) => sum + (editableLines[s.supplier.id]?.length ?? 0), 0);
  const totalPlacedForPlan = placedForPlan.length;

  const dismissSupplier = useCallback((supplierId: number) => {
    setDismissedSupplierIds(prev => {
      const next = new Set(prev);
      next.add(supplierId);
      persistDismissed(next);
      return next;
    });
  }, [persistDismissed]);
  const restoreSupplier = useCallback((supplierId: number) => {
    setDismissedSupplierIds(prev => {
      if (!prev.has(supplierId)) return prev;
      const next = new Set(prev);
      next.delete(supplierId);
      persistDismissed(next);
      return next;
    });
  }, [persistDismissed]);

  // Suppliers picker for "+ Add supplier order" — fetched lazily when the
  // dialog opens so the orders page doesn't pay for it on every load.
  const { data: pickerSuppliers = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["suppliers-for-add-supplier-order"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/suppliers`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load suppliers");
      return res.json();
    },
    enabled: addSupplierDialogOpen,
  });
  const filteredPickerSuppliers = debouncedAddSupplierSearch.trim()
    ? pickerSuppliers.filter(s => s.name.toLowerCase().includes(debouncedAddSupplierSearch.toLowerCase()))
    : pickerSuppliers;
  const handleAddManualSupplier = useCallback((supplier: { id: number; name: string }) => {
    // Drop the dismiss state if the operator is re-adding a supplier they'd
    // previously dismissed — otherwise the new card wouldn't appear.
    restoreSupplier(supplier.id);
    setKanbanOnlySupplierInfo(prev => ({ ...prev, [supplier.id]: { id: supplier.id, name: supplier.name } }));
    setEditableLines(prev => prev[supplier.id] ? prev : { ...prev, [supplier.id]: [] });
    setExpandedSuppliers(prev => new Set([...prev, supplier.id]));
    setAddSupplierDialogOpen(false);
    setAddSupplierSearch("");
    // Open the per-supplier "Add item" picker straight away so the operator
    // doesn't land on an empty card with no obvious next step.
    setAddItemDialog({ supplierId: supplier.id, supplierName: supplier.name });
  }, [restoreSupplier]);

  const deleteOrderMutation = useMutation({
    mutationFn: async (poId: number) => {
      const res = await fetch(`${BASE}/api/orders/purchase-orders/${poId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to delete order (${res.status})`);
      }
    },
    onSuccess: (_data, poId) => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders-for-plan"] });
      queryClient.invalidateQueries({ queryKey: ["order-calculate"] });
      const supplierId = deleteOrderConfirm?.supplierId;
      if (supplierId != null) {
        // Drop the local edit state for the deleted PO's supplier so the
        // freshly-recalculated lines show up clean.
        setEditableLines(prev => {
          if (!(supplierId in prev)) return prev;
          const next = { ...prev };
          delete next[supplierId];
          return next;
        });
        setReopenedPlacedOrders(prev => {
          if (!prev[supplierId]) return prev;
          const next = { ...prev };
          delete next[supplierId];
          return next;
        });
      }
      toast({ title: "Order deleted", description: `PO #${poId} has been removed.` });
      setDeleteOrderConfirm(null);
    },
    onError: (err) => {
      toast({
        title: "Couldn't delete order",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

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
              <p className="text-2xl font-bold">{totalPlacedForPlan}</p>
              <p className="text-xs text-muted-foreground">Placed for this plan</p>
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
          Placed for this Plan ({totalPlacedForPlan})
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
          onClick={() => { setKanbanSearchOpen(true); setKanbanSearch(""); setSelectedKanbanIds(new Set()); setKanbanSupplierOverrides({}); }}
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
        <button
          onClick={() => { setAddSupplierDialogOpen(true); setAddSupplierSearch(""); }}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30 flex items-center gap-1.5"
          title="Manually start an order for a supplier the system didn't suggest"
        >
          <Plus className="w-4 h-4" />
          Add supplier order
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
                {!isReopened && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setDismissConfirm({ supplierId: so.supplier.id, supplierName: so.supplier.name }); }}
                    className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    title="Dismiss this draft order — we're not ordering from this supplier today"
                  >
                    <X className="w-4 h-4" />
                  </button>
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
                        <th className="p-3 w-10"></th>
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
                            {(line.stockInPacks || line.unit === "packs" || line.unit === "bottles")
                              ? `${line.editedPacks} ${line.stockInPacks ? packNoun(line.unit, line.editedPacks) : line.unit}`
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
                            {line.isMisc ? "—" : `${line.packWeight} kg`}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {line.isMisc ? "—"
                              : line.stockInPacks && line.packWeight > 0
                              ? `${Math.ceil(line.surplusTarget / line.packWeight)} ${packNoun(line.unit, Math.ceil(line.surplusTarget / line.packWeight))}`
                              : `${line.surplusTarget.toLocaleString()} ${line.unit}`}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {line.isMisc ? "—"
                              : line.stockInPacks && line.packWeight > 0
                              ? `${Math.ceil(line.totalRequired / line.packWeight)} ${packNoun(line.unit, Math.ceil(line.totalRequired / line.packWeight))}`
                              : `${line.totalRequired.toLocaleString()} ${line.unit}`}
                          </td>
                          {lines.some(l => l.costPerPack > 0) && (
                            <td className="p-3 text-right tabular-nums">
                              {line.costPerPack > 0 ? `\u00A3${(line.editedPacks * line.costPerPack).toFixed(2)}` : "-"}
                            </td>
                          )}
                          <td className="p-3 text-right">
                            <button
                              type="button"
                              onClick={() => removeLine(so.supplier.id, line.ingredientId)}
                              className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                              title={`Remove ${line.ingredientName} from this order`}
                              aria-label={`Remove ${line.ingredientName}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                        );
                      })}
                      <tr className="bg-secondary/5">
                        <td colSpan={lines.some(l => l.costPerPack > 0) ? 10 : 9} className="p-2">
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
                  <div className="flex items-center gap-2">
                    {isReopened && canManageOrders && reopenedPOId && (
                      <button
                        onClick={() => setDeleteOrderConfirm({ poId: reopenedPOId, supplierId: so.supplier.id, supplierName: so.supplier.name })}
                        className="px-3 py-2 rounded-lg text-sm font-medium transition-colors border border-destructive/40 text-destructive hover:bg-destructive/10 flex items-center gap-1.5"
                        title="Delete this placed order — for orders placed by mistake (manager / admin only)"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete order
                      </button>
                    )}
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
              </div>
            )}
          </div>
        );
      })}

      {viewFilter === "pending" && dismissedPendingSuppliers.length > 0 && (
        <div className="text-center text-sm text-muted-foreground bg-secondary/20 border border-dashed border-border rounded-xl py-3 px-4">
          <span className="font-medium">{dismissedPendingSuppliers.length}</span> dismissed{" "}
          {dismissedPendingSuppliers.length === 1 ? "order" : "orders"}:
          {" "}
          {dismissedPendingSuppliers.map((s, i) => (
            <span key={s.supplier.id}>
              {i > 0 && ", "}
              <button
                onClick={() => restoreSupplier(s.supplier.id)}
                className="text-primary hover:underline font-medium"
              >
                {s.supplier.name}
              </button>
            </span>
          ))}
          <span className="mx-1">·</span>
          <button
            onClick={() => { dismissedSupplierIds.forEach(id => restoreSupplier(id)); }}
            className="text-primary hover:underline"
          >
            Restore all
          </button>
        </div>
      )}

      {viewFilter === "placed" && (
        <div className="space-y-4">
          {placedForPlan.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              No orders placed for this production plan yet.
            </div>
          )}
          {placedForPlan.map(order => {
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

      <Dialog open={kanbanSearchOpen} onOpenChange={open => { setKanbanSearchOpen(open); if (!open) { setKanbanSearch(""); setSelectedKanbanIds(new Set()); setKanbanSupplierOverrides({}); } }}>
        <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <LayoutGrid className="w-5 h-5 text-amber-500" />
              Pulled Kanbans
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 flex-1 flex flex-col min-h-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={kanbanSearch}
                onChange={e => setKanbanSearch(e.target.value)}
                placeholder="Search by ingredient or supplier…"
                autoFocus
                className="w-full pl-9 pr-4 py-3 rounded-lg border border-border bg-background text-base focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              {kanbanSearch && (
                <button onClick={() => setKanbanSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Status line — counts on both sides so the operator always knows
                what's staged vs already in the order. */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-3">
                {addedKanbanIngredientIds.size > 0 && (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" />
                    {addedKanbanIngredientIds.size} pulled
                  </span>
                )}
                {selectedKanbanIds.size > 0 && (
                  <span className="text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" />
                    {selectedKanbanIds.size} selected
                  </span>
                )}
              </div>
              <span className="text-muted-foreground">
                Tap a pulled item to un-pull it.
              </span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1 -mx-1 px-1 min-h-0">
              {filteredKanbanIngredients.length === 0 && (
                <p className="text-center py-8 text-sm text-muted-foreground">
                  {kanbanIngredients.length === 0 ? "No kanban-enabled ingredients found." : "No ingredients match your search."}
                </p>
              )}
              {/* Pulled items float to the top so the operator can scan what
                  they've already done and spot mis-pulls quickly. */}
              {[...filteredKanbanIngredients].sort((a, b) => {
                const aAdded = addedKanbanIngredientIds.has(a.ingredientId) ? 0 : 1;
                const bAdded = addedKanbanIngredientIds.has(b.ingredientId) ? 0 : 1;
                if (aAdded !== bAdded) return aAdded - bAdded;
                return (a.ingredientName ?? "").localeCompare(b.ingredientName ?? "");
              }).map(k => {
                const alreadyAdded = addedKanbanIngredientIds.has(k.ingredientId);
                const isSelected = selectedKanbanIds.has(k.ingredientId);
                const effectiveSupplierId = effectiveSupplierIdFor(k);
                const noSupplier = effectiveSupplierId == null;
                const orderAmt = k.kanbanOrderAmount ?? k.kanbanQuantity ?? null;
                const unitLabel =
                  k.kanbanUnit === "pack" ? "packs"
                  : k.kanbanUnit === "bottle" ? "bottles"
                  : k.kanbanUnit === "pallet" ? "pallets"
                  : (k.ingredientUnit ?? "");
                const supplierOptions = supplierOptionsFor(k);
                return (
                  <div
                    key={k.ingredientId}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-3 rounded-lg text-base transition-colors border",
                      alreadyAdded
                        ? "bg-emerald-500/10 border-emerald-500/30"
                        : isSelected
                        ? "bg-amber-500/10 border-amber-500/40"
                        : "hover:bg-secondary/60 border-transparent hover:border-border"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (alreadyAdded) handleUnpullKanban(k.ingredientId);
                        else if (!noSupplier) toggleKanbanSelection(k.ingredientId);
                      }}
                      disabled={!alreadyAdded && noSupplier}
                      className={cn(
                        "flex-1 min-w-0 flex items-center gap-3 text-left",
                        !alreadyAdded && noSupplier && "cursor-not-allowed"
                      )}
                    >
                      <div className="shrink-0">
                        {alreadyAdded ? (
                          <div className="w-5 h-5 rounded bg-emerald-500 flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        ) : (
                          <div className={cn(
                            "w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
                            isSelected ? "bg-amber-500 border-amber-500" : "border-border"
                          )}>
                            {isSelected && <Check className="w-3 h-3 text-white" />}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{k.ingredientName ?? "Unknown"}</p>
                        {orderAmt != null && (
                          <p className="text-sm text-muted-foreground truncate">
                            <span className="font-medium text-foreground">{orderAmt} {unitLabel}</span> to order
                          </p>
                        )}
                      </div>
                    </button>
                    <select
                      value={effectiveSupplierId ?? ""}
                      onChange={e => {
                        const v = Number(e.target.value);
                        setKanbanSupplierOverrides(prev => ({ ...prev, [k.ingredientId]: v }));
                      }}
                      disabled={alreadyAdded}
                      className={cn(
                        "shrink-0 max-w-[12rem] text-sm rounded-md border border-border bg-background px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30",
                        alreadyAdded && "opacity-60 cursor-not-allowed"
                      )}
                    >
                      {effectiveSupplierId == null && (
                        <option value="" disabled>Choose supplier…</option>
                      )}
                      {supplierOptions.map(opt => (
                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                      ))}
                    </select>
                    {alreadyAdded && (
                      <button
                        type="button"
                        onClick={() => handleUnpullKanban(k.ingredientId)}
                        className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-emerald-500/40 bg-background text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
                        title="Remove this kanban from the order"
                      >
                        <X className="w-3.5 h-3.5" />
                        Un-pull
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="pt-2 border-t border-border flex items-center justify-between flex-shrink-0">
              <span className="text-sm text-muted-foreground">
                Tick the kanbans you&rsquo;ve physically pulled. Already-pulled items show at the top.
              </span>
              <button
                onClick={handleAddSelectedKanbans}
                disabled={selectedKanbanIds.size === 0}
                className={cn(
                  "px-5 py-2.5 rounded-lg text-base font-medium transition-colors",
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
        onOpenChange={open => { if (!open) { setAddItemDialog(null); setAddItemSearch(""); setMiscForm({ description: "", quantity: "1", unit: "each" }); } }}
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

            {/* Miscellaneous one-off item — collapsed by default so the search
                stays the primary flow; expands on click for the rare case
                where the operator needs to order something without an
                ingredient record (sample, trial, etc.). */}
            <details className="rounded-lg border border-dashed border-border bg-secondary/20 open:border-primary/40 open:bg-primary/5">
              <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium flex items-center gap-2">
                <Plus className="w-4 h-4" />
                Add a miscellaneous item (no ingredient record)
              </summary>
              <div className="px-3 pb-3 pt-1 space-y-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Description</label>
                  <input
                    type="text"
                    value={miscForm.description}
                    onChange={e => setMiscForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="e.g. Sample bottle of new chilli sauce"
                    className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Quantity</label>
                    <input
                      type="number"
                      min="0.01"
                      step="any"
                      value={miscForm.quantity}
                      onChange={e => setMiscForm(f => ({ ...f, quantity: e.target.value }))}
                      className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Unit</label>
                    <input
                      type="text"
                      value={miscForm.unit}
                      onChange={e => setMiscForm(f => ({ ...f, unit: e.target.value }))}
                      placeholder="each / box / kg"
                      className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleAddMiscItem}
                  disabled={!miscForm.description.trim() || !(Number(miscForm.quantity) > 0)}
                  className="w-full px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Add miscellaneous item to order
                </button>
              </div>
            </details>

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

      <Dialog open={!!dismissConfirm} onOpenChange={(open) => !open && setDismissConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dismiss draft order?</DialogTitle>
          </DialogHeader>
          {dismissConfirm && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Hide the draft order for <span className="font-semibold text-foreground">{dismissConfirm.supplierName}</span>?
                Any items the system suggested won't be placed and the card will disappear from the To-Order list.
              </p>
              <p className="text-xs text-muted-foreground">
                You can bring it back via the "Show dismissed" link at the bottom of the list, or click "+ Add supplier order" to start fresh.
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setDismissConfirm(null)}
                  className="px-4 py-2 rounded-lg text-sm border border-border hover:bg-secondary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { dismissSupplier(dismissConfirm.supplierId); setDismissConfirm(null); }}
                  className="px-4 py-2 rounded-lg text-sm bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={addSupplierDialogOpen} onOpenChange={(open) => { setAddSupplierDialogOpen(open); if (!open) setAddSupplierSearch(""); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add supplier order</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Pick a supplier to start a new draft order. You'll then add items to it via the per-supplier "+ Add item" picker.
            </p>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search suppliers..."
                value={addSupplierSearch}
                onChange={e => setAddSupplierSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm"
                autoFocus
              />
            </div>
            <div className="max-h-80 overflow-y-auto border border-border rounded-lg divide-y divide-border">
              {filteredPickerSuppliers.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-8">
                  {pickerSuppliers.length === 0 ? "Loading suppliers…" : "No suppliers match that search."}
                </div>
              ) : filteredPickerSuppliers.map(s => {
                const alreadyPending = allPendingSuppliers.some(p => p.supplier.id === s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => handleAddManualSupplier(s)}
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-secondary/40 transition-colors flex items-center justify-between gap-2"
                  >
                    <span className="font-medium">{s.name}</span>
                    {alreadyPending && (
                      <span className="text-xs text-muted-foreground">already in pending list</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteOrderConfirm} onOpenChange={(open) => !open && setDeleteOrderConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this order?</DialogTitle>
          </DialogHeader>
          {deleteOrderConfirm && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Permanently delete <span className="font-semibold text-foreground">PO #{deleteOrderConfirm.poId}</span> for{" "}
                <span className="font-semibold text-foreground">{deleteOrderConfirm.supplierName}</span>?
                The order will be removed from the deliveries list. This can't be undone.
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
                Use this for orders placed by mistake. Orders that have already been received can't be deleted.
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setDeleteOrderConfirm(null)}
                  className="px-4 py-2 rounded-lg text-sm border border-border hover:bg-secondary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteOrderMutation.mutate(deleteOrderConfirm.poId)}
                  disabled={deleteOrderMutation.isPending}
                  className="px-4 py-2 rounded-lg text-sm bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors flex items-center gap-2"
                >
                  {deleteOrderMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  Delete order
                </button>
              </div>
            </div>
          )}
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
