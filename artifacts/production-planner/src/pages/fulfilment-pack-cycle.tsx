import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { QrScanner } from "@/components/qr-scanner";
import { CheckCircle2, AlertCircle, ArrowLeft, Loader2, PackageCheck, ScanLine, SkipForward } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface LineItem {
  id: number;
  variant_id: number | null;
  title: string;
  variant_title: string | null;
  quantity: number;
  sku: string;
}

interface ScanQueueOrder {
  id: number;
  name: string;
  tags: string;
  shipping_address: {
    name: string;
    company?: string;
    address1: string;
    city: string;
    zip: string;
  } | null;
  customer: { first_name: string; last_name: string } | null;
  line_items: LineItem[];
}

interface ScanQueueResponse {
  tag: string;
  orders: ScanQueueOrder[];
  barcodes: Record<string, string>;
}

async function fetchScanQueue(tag: string, category: string | null): Promise<ScanQueueResponse> {
  const params = new URLSearchParams({ tag });
  if (category) params.set("category", category);
  const res = await fetch(`${BASE}/api/fulfilment/scan-queue?${params}`, { credentials: "include" });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Failed to load scan queue: ${res.status}`);
  }
  return res.json();
}

async function postScanComplete(orderId: number): Promise<void> {
  const res = await fetch(`${BASE}/api/fulfilment/orders/${orderId}/scan-complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Failed to complete order: ${res.status}`);
  }
}

function shippingName(order: ScanQueueOrder): string {
  return (
    order.shipping_address?.name ||
    `${order.customer?.first_name ?? ""} ${order.customer?.last_name ?? ""}`.trim() ||
    "Unknown"
  );
}

// Per-order ticked map: line-item id → ticked count.
// Lives in a ref-keyed Map so flipping orders preserves state if the
// operator skips ahead and comes back.
type TickedState = Record<number, number>;

export default function FulfilmentPackCycle() {
  const [, navigate] = useLocation();
  const urlParams = new URLSearchParams(window.location.search);
  const tag = urlParams.get("tag") ?? "";
  const category = urlParams.get("category");

  const queryEnabled = !!tag;
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["scan-queue", tag, category],
    queryFn: () => fetchScanQueue(tag, category),
    enabled: queryEnabled,
    refetchOnWindowFocus: false,
  });

  const orders = data?.orders ?? [];
  const barcodes = data?.barcodes ?? {};

  // Index into orders[] of the order currently being packed.
  const [activeIdx, setActiveIdx] = useState(0);
  // Ticked counts per orderId → { lineItemId → count }.
  const [tickedByOrder, setTickedByOrder] = useState<Record<number, TickedState>>({});
  // Flash state for visual feedback.
  const [flash, setFlash] = useState<null | { kind: "good" | "bad"; message?: string }>(null);
  const flashTimer = useRef<NodeJS.Timeout | null>(null);

  const activeOrder = orders[activeIdx];

  const ticked: TickedState = activeOrder ? (tickedByOrder[activeOrder.id] ?? {}) : {};

  // Line items sorted ascending by SKU. Empty SKUs sort last.
  const sortedItems = useMemo(() => {
    if (!activeOrder) return [];
    return [...activeOrder.line_items].sort((a, b) => {
      const aSku = (a.sku ?? "").trim();
      const bSku = (b.sku ?? "").trim();
      if (!aSku && !bSku) return 0;
      if (!aSku) return 1;
      if (!bSku) return -1;
      return aSku.localeCompare(bSku);
    });
  }, [activeOrder]);

  // Build a flat list of expected scans for the active order. Each line
  // contributes `quantity` slots. variantId → barcode resolves through the
  // queue-wide barcodes map.
  const expectedTotal = sortedItems.reduce((s, li) => s + li.quantity, 0);
  const tickedTotal = sortedItems.reduce((s, li) => s + (ticked[li.id] ?? 0), 0);
  const allTicked = expectedTotal > 0 && tickedTotal >= expectedTotal;

  const fulfilMutation = useMutation({
    mutationFn: (orderId: number) => postScanComplete(orderId),
    onSuccess: () => {
      toast({ title: "Order fulfilled", description: activeOrder ? `${activeOrder.name} — ${shippingName(activeOrder)}` : "" });
      // Move to next order. The query stays stale until the user reloads
      // or refetches — we advance the local index so they keep packing
      // without waiting for Shopify to re-mirror the new state.
      setActiveIdx(i => i + 1);
    },
    onError: (err: Error) => {
      triggerFlash("bad", err.message);
      toast({ title: "Fulfilment failed", description: err.message, variant: "destructive" });
    },
  });

  function triggerFlash(kind: "good" | "bad", message?: string) {
    setFlash({ kind, message });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), kind === "good" ? 400 : 1500);
    if (kind === "bad" && typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate([80, 60, 80]);
    } else if (kind === "good" && typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(40);
    }
  }

  function handleScan(raw: string) {
    if (!activeOrder) return;
    const code = raw.trim();
    if (!code) return;

    // Find the first sorted line item with this barcode that still has
    // unticked quantity.
    const match = sortedItems.find(li => {
      if (!li.variant_id) return false;
      const bc = barcodes[String(li.variant_id)];
      if (!bc) return false;
      if (bc !== code) return false;
      return (ticked[li.id] ?? 0) < li.quantity;
    });

    if (!match) {
      // Either the code matched a line item already fully ticked, or it's
      // foreign to this order entirely. Both are operator errors.
      const onOrderButFull = sortedItems.some(li =>
        li.variant_id && barcodes[String(li.variant_id)] === code && (ticked[li.id] ?? 0) >= li.quantity
      );
      triggerFlash(
        "bad",
        onOrderButFull ? "Already scanned the full quantity for this item" : "Item not on this order",
      );
      return;
    }

    setTickedByOrder(prev => {
      const cur = prev[activeOrder.id] ?? {};
      return {
        ...prev,
        [activeOrder.id]: { ...cur, [match.id]: (cur[match.id] ?? 0) + 1 },
      };
    });
    triggerFlash("good");
  }

  // Auto-fire fulfilment as soon as the active order is fully scanned.
  // Guarded by a ref so a re-render during the mutation doesn't fire twice.
  // We deliberately don't include the mutation in the dep array — useMutation
  // returns a new object every render, which would cause this effect to fire
  // on every render.
  const completingRef = useRef<number | null>(null);
  const fulfilMutateRef = useRef(fulfilMutation.mutate);
  fulfilMutateRef.current = fulfilMutation.mutate;
  useEffect(() => {
    if (!activeOrder || !allTicked) return;
    if (completingRef.current === activeOrder.id) return;
    completingRef.current = activeOrder.id;
    fulfilMutateRef.current(activeOrder.id);
  }, [activeOrder, allTicked]);

  function tickManually(lineItemId: number) {
    if (!activeOrder) return;
    const li = sortedItems.find(x => x.id === lineItemId);
    if (!li) return;
    setTickedByOrder(prev => {
      const cur = prev[activeOrder.id] ?? {};
      const current = cur[li.id] ?? 0;
      if (current >= li.quantity) return prev;
      return { ...prev, [activeOrder.id]: { ...cur, [li.id]: current + 1 } };
    });
  }

  function untickOne(lineItemId: number) {
    if (!activeOrder) return;
    setTickedByOrder(prev => {
      const cur = prev[activeOrder.id] ?? {};
      const current = cur[lineItemId] ?? 0;
      if (current <= 0) return prev;
      return { ...prev, [activeOrder.id]: { ...cur, [lineItemId]: current - 1 } };
    });
  }

  function skipOrder() {
    setActiveIdx(i => i + 1);
  }

  if (!tag) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="glass-panel p-6 rounded-2xl border border-destructive/30 text-destructive flex gap-3 items-start">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">No dispatch date</p>
            <p className="text-sm text-muted-foreground mt-1">Open the packing cycle from a dispatch day on the Order Packing Live page.</p>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh] text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mr-3" /> Loading packing queue…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="glass-panel p-6 rounded-2xl border border-destructive/30 text-destructive flex gap-3 items-start">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">Could not load queue</p>
            <p className="text-sm text-muted-foreground mt-1">{(error as Error).message}</p>
            <button onClick={() => refetch()} className="mt-3 text-sm underline">Retry</button>
          </div>
        </div>
      </div>
    );
  }

  // Cycle exhausted.
  if (!activeOrder) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="glass-panel p-8 rounded-2xl border border-border text-center">
          <PackageCheck className="w-12 h-12 mx-auto text-green-500" />
          <h2 className="text-2xl font-semibold mt-4">Packing cycle complete</h2>
          <p className="text-muted-foreground mt-1">{orders.length} order{orders.length === 1 ? "" : "s"} fulfilled.</p>
          <button
            onClick={() => navigate(`/fulfilment?tag=${encodeURIComponent(tag)}`)}
            className="mt-6 px-4 py-2 rounded-xl bg-primary text-primary-foreground"
          >
            Back to Order Packing Live
          </button>
        </div>
      </div>
    );
  }

  const remaining = orders.length - activeIdx;

  return (
    <div className="min-h-screen bg-background">
      <div
        className={cn(
          "fixed inset-0 pointer-events-none transition-opacity z-50",
          flash?.kind === "good" && "opacity-100 bg-green-500/20",
          flash?.kind === "bad" && "opacity-100 bg-red-500/30",
          !flash && "opacity-0",
        )}
      />

      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => navigate(`/fulfilment?tag=${encodeURIComponent(tag)}`)}
            className="p-2 -ml-2 text-muted-foreground hover:text-foreground"
            title="Exit packing cycle"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 text-center text-sm text-muted-foreground tabular-nums">
            Order {activeIdx + 1} of {orders.length} · {remaining} remaining
          </div>
          <button
            onClick={skipOrder}
            className="p-2 text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
            title="Skip this order"
          >
            <SkipForward className="w-4 h-4" /> Skip
          </button>
        </div>

        <div className="glass-panel rounded-2xl border-2 border-primary/40 bg-primary/5 p-6 text-center">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Shipping to</p>
          <h1 className="text-4xl sm:text-5xl font-bold mt-1 leading-tight break-words">
            {shippingName(activeOrder)}
          </h1>
          {activeOrder.shipping_address && (
            <p className="text-sm text-muted-foreground mt-2">
              {activeOrder.shipping_address.address1}, {activeOrder.shipping_address.city} {activeOrder.shipping_address.zip}
            </p>
          )}
          <p className="text-sm font-mono text-muted-foreground mt-1">{activeOrder.name}</p>
        </div>

        <div className="glass-panel rounded-2xl border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium">
              Items · <span className="tabular-nums">{tickedTotal}/{expectedTotal}</span>
            </p>
            {fulfilMutation.isPending && (
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" /> Fulfilling…
              </span>
            )}
          </div>
          <ul className="divide-y divide-border">
            {sortedItems.map(li => {
              const t = ticked[li.id] ?? 0;
              const itemComplete = t >= li.quantity;
              const variantBarcode = li.variant_id ? barcodes[String(li.variant_id)] : null;
              return (
                <li
                  key={li.id}
                  className={cn(
                    "flex items-center gap-3 py-3 transition-colors",
                    itemComplete && "opacity-50",
                  )}
                >
                  <button
                    onClick={() => tickManually(li.id)}
                    className={cn(
                      "w-9 h-9 rounded-lg border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                      itemComplete
                        ? "bg-green-500 border-green-500 text-white"
                        : "border-border hover:border-primary",
                    )}
                    title="Tap to tick manually"
                  >
                    {itemComplete ? <CheckCircle2 className="w-5 h-5" /> : <span className="text-sm tabular-nums">{t}</span>}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={cn("font-medium leading-tight", itemComplete && "line-through")}>
                      {li.title}
                      {li.variant_title ? <span className="text-muted-foreground"> · {li.variant_title}</span> : null}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      SKU {li.sku || "—"} · qty {li.quantity}
                      {!variantBarcode && <span className="text-amber-600 ml-2">No barcode in Shopify</span>}
                    </p>
                  </div>
                  {t > 0 && !itemComplete && (
                    <button onClick={() => untickOne(li.id)} className="text-xs text-muted-foreground underline">undo</button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="glass-panel rounded-2xl border border-border p-4">
          <div className="flex items-center gap-2 mb-2">
            <ScanLine className="w-4 h-4 text-muted-foreground" />
            <p className="text-sm font-medium">Scan items</p>
            {flash?.kind === "bad" && flash.message && (
              <span className="text-xs text-red-600 ml-2">{flash.message}</span>
            )}
          </div>
          <div className="flex justify-center">
            <QrScanner
              continuous
              wide
              dedupeMs={1200}
              onScan={handleScan}
              onError={(msg) => toast({ title: "Camera error", description: msg, variant: "destructive" })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
