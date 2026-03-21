import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { format } from "date-fns";
import {
  Package, Scan, CheckCircle2, AlertCircle, ChevronRight, Printer,
  RefreshCw, MapPin, SkipForward, RotateCcw, XCircle, Loader2,
  ArrowLeft, Truck, ChevronLeft,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SkuLocation {
  sku: string;
  zone: "fridge" | "freezer" | "ambient";
  locationLabel: string;
}

interface LineItem {
  id: number;
  title: string;
  variant_title: string | null;
  quantity: number;
  sku: string;
  location: SkuLocation | null;
}

interface ShopifyOrder {
  id: number;
  name: string;
  tags: string;
  total_weight: number;
  fulfillment_status: string | null;
  customer: {
    first_name: string;
    last_name: string;
    email: string;
  } | null;
  shipping_address: {
    name: string;
    address1: string;
    address2?: string;
    city: string;
    zip: string;
  } | null;
  line_items: LineItem[];
}

interface ShipmentResult {
  consignmentNumber: string;
  labelPdfBase64: string;
  trackingUrl?: string;
  serviceCode: string;
  orderId: number;
  orderName: string;
}

interface ConfigStatus {
  apcCredentialsConfigured: boolean;
  serviceCodesConfigured: boolean;
  serviceCodes: {
    smallWeekday: string;
    largeWeekday: string;
    smallFriday: string;
    largeFriday: string;
  };
}

interface DispatchTagGroup {
  tag: string;
  orderCount: number;
  totalItems: number;
  totalWeightG: number;
}

async function fetchDispatchTags(): Promise<DispatchTagGroup[]> {
  const res = await fetch(`${BASE}/api/fulfilment/dispatch-tags`, { credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "Failed to fetch dispatch tags");
  }
  return res.json();
}

async function fetchOrders(tag: string, includeAll = false): Promise<ShopifyOrder[]> {
  const url = `${BASE}/api/fulfilment/orders?tag=${encodeURIComponent(tag)}${includeAll ? "&includeAll=1" : ""}`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "Failed to fetch orders");
  }
  return res.json();
}

async function fetchConfigStatus(): Promise<ConfigStatus> {
  const res = await fetch(`${BASE}/api/fulfilment/config-status`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch config status");
  return res.json();
}

async function createShipment(orderId: number, tag: string, dispatchDate?: string): Promise<ShipmentResult> {
  const res = await fetch(`${BASE}/api/fulfilment/shipments`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, tag, dispatchDate }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to create shipment");
  return data;
}

async function completeOrder(orderId: number, consignmentNumber: string, trackingUrl?: string): Promise<void> {
  const res = await fetch(`${BASE}/api/fulfilment/orders/${orderId}/complete`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ consignmentNumber, trackingUrl }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to complete order");
}

const ZONE_STYLES: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  fridge: {
    bg: "bg-blue-50 dark:bg-blue-950/30",
    border: "border-blue-200 dark:border-blue-800",
    text: "text-blue-700 dark:text-blue-300",
    badge: "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200",
  },
  freezer: {
    bg: "bg-purple-50 dark:bg-purple-950/30",
    border: "border-purple-200 dark:border-purple-800",
    text: "text-purple-700 dark:text-purple-300",
    badge: "bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200",
  },
  ambient: {
    bg: "bg-amber-50 dark:bg-amber-950/30",
    border: "border-amber-200 dark:border-amber-800",
    text: "text-amber-700 dark:text-amber-300",
    badge: "bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200",
  },
};

// Wraps the PDF in an HTML page with explicit @page sizing for 100mm×150mm thermal labels.
// This ensures Chrome respects the label dimensions regardless of default printer paper settings.
function makeLabelHtml(base64Pdf: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<style>
@page { size: 100mm 150mm; margin: 0; }
html, body { margin: 0; padding: 0; width: 100mm; height: 150mm; overflow: hidden; }
embed { width: 100%; height: 100%; display: block; }
</style>
</head>
<body>
<embed src="data:application/pdf;base64,${base64Pdf}" type="application/pdf" />
</body>
</html>`;
}

function printLabel(
  base64Pdf: string,
  onPrinted: () => void,
  onPrintFailed: () => void,
  frameId = "label-print-frame",
) {
  const iframe = document.getElementById(frameId) as HTMLIFrameElement | null;
  if (!iframe) { onPrintFailed(); return; }

  let settled = false;

  function settle(success: boolean) {
    if (settled) return;
    settled = true;
    window.removeEventListener("afterprint", handleAfterPrint);
    clearTimeout(fallbackTimer);
    if (success) onPrinted(); else onPrintFailed();
  }

  function handleAfterPrint() { settle(true); }

  // Kiosk mode fires afterprint immediately after sending job to printer.
  // Non-kiosk: fires when the print dialog is dismissed (could be cancel).
  // We treat dismiss as "done" — the user is responsible for printer setup.
  // Fallback: 10 s timeout in case afterprint never fires (e.g. data-URL sandbox).
  const fallbackTimer = setTimeout(() => settle(true), 10_000);

  iframe.onerror = () => settle(false);

  iframe.onload = () => {
    try {
      window.addEventListener("afterprint", handleAfterPrint, { once: true });
      iframe.contentWindow?.print();
    } catch {
      settle(false);
    }
  };

  iframe.srcdoc = makeLabelHtml(base64Pdf);
}

type PrintStatus = "idle" | "printing" | "done" | "failed";

type View = "dates" | "list" | "picking" | "pre-confirm" | "confirm";

export default function Fulfilment() {
  const today = format(new Date(), "yyyy-MM-dd");
  const [tag, setTag] = useState(today);
  const [queryTag, setQueryTag] = useState(today);
  const [includeAll, setIncludeAll] = useState(false);
  const [view, setView] = useState<View>("dates");
  const [activeOrder, setActiveOrder] = useState<ShopifyOrder | null>(null);
  const [shipment, setShipment] = useState<ShipmentResult | null>(null);
  const [printStatus, setPrintStatus] = useState<PrintStatus>("idle");
  const [shipmentError, setShipmentError] = useState<string | null>(null);
  const [creatingShipment, setCreatingShipment] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [barcodeInput, setBarcodeInput] = useState("");
  const [flashItem, setFlashItem] = useState<string | null>(null);
  const [flashWrong, setFlashWrong] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const preQueueRef = useRef<Map<number, Promise<ShipmentResult>>>(new Map());
  const prePrintRef = useRef<Map<number, PrintStatus>>(new Map());

  const { data: configStatus } = useQuery({
    queryKey: ["fulfilment-config-status"],
    queryFn: fetchConfigStatus,
    staleTime: 60_000,
  });

  const { data: dispatchTags, isLoading: tagsLoading, error: tagsError, refetch: refetchTags } = useQuery({
    queryKey: ["fulfilment-dispatch-tags"],
    queryFn: fetchDispatchTags,
    staleTime: 2 * 60 * 1000,
    enabled: !!configStatus?.apcCredentialsConfigured && !!configStatus?.serviceCodesConfigured,
  });

  const { data: orders, isLoading, error, refetch } = useQuery({
    queryKey: ["fulfilment-orders", queryTag, includeAll],
    queryFn: () => fetchOrders(queryTag, includeAll),
    staleTime: 2 * 60 * 1000,
  });

  const unfulfilledOrders = orders?.filter(o => o.fulfillment_status !== "fulfilled") ?? [];
  const fulfilledOrders = orders?.filter(o => o.fulfillment_status === "fulfilled") ?? [];

  function preQueueNextOrder(nextOrderId: number) {
    if (preQueueRef.current.has(nextOrderId)) return;
    const promise = createShipment(nextOrderId, queryTag, queryTag)
      .then((result) => {
        // Background print the next order's label so it's done before the operator advances
        prePrintRef.current.set(nextOrderId, "printing");
        printLabel(
          result.labelPdfBase64,
          () => prePrintRef.current.set(nextOrderId, "done"),
          () => prePrintRef.current.set(nextOrderId, "failed"),
          "label-preprint-frame",
        );
        return result;
      })
      .catch((err) => {
        preQueueRef.current.delete(nextOrderId);
        throw err;
      });
    preQueueRef.current.set(nextOrderId, promise);
  }

  function clearPreQueue() {
    preQueueRef.current.clear();
    prePrintRef.current.clear();
  }

  async function startPicking(order: ShopifyOrder) {
    setActiveOrder(order);
    setCheckedItems(new Set());
    setBarcodeInput("");
    setShipment(null);
    setShipmentError(null);
    setPrintStatus("idle");
    setCompletionError(null);
    setView("picking");
    setCreatingShipment(true);

    try {
      let result: ShipmentResult;
      if (preQueueRef.current.has(order.id)) {
        result = await preQueueRef.current.get(order.id)!;
        preQueueRef.current.delete(order.id);
      } else {
        result = await createShipment(order.id, queryTag, queryTag);
      }
      setShipment(result);

      // Check whether the label was already background-printed (pre-print)
      const prePrinted = prePrintRef.current.get(order.id);
      prePrintRef.current.delete(order.id);

      if (prePrinted === "done") {
        // Label already printed in background — no need to print again
        setPrintStatus("done");
      } else {
        // Print now (either first time or pre-print failed)
        setPrintStatus("printing");
        printLabel(
          result.labelPdfBase64,
          () => setPrintStatus("done"),
          () => setPrintStatus("failed"),
        );
      }

      // Pre-queue AND background-print the next unfulfilled order's label
      const currentPos = unfulfilledOrders.findIndex(o => o.id === order.id);
      const nextOrder = unfulfilledOrders[currentPos + 1];
      if (nextOrder) preQueueNextOrder(nextOrder.id);
    } catch (err: any) {
      setShipmentError(err.message ?? "Failed to create APC shipment");
      setPrintStatus("failed");
    } finally {
      setCreatingShipment(false);
    }
  }

  function retryShipment() {
    if (!activeOrder) return;
    startPicking(activeOrder);
  }

  const sortedLineItems = activeOrder ? [...activeOrder.line_items].sort((a, b) => {
    const zA = a.location?.zone ?? "z";
    const zB = b.location?.zone ?? "z";
    const order = ["fridge", "freezer", "ambient"];
    return (order.indexOf(zA) - order.indexOf(zB)) || a.title.localeCompare(b.title);
  }) : [];

  const expandedItems = sortedLineItems.flatMap(item =>
    Array.from({ length: item.quantity }, (_, i) => ({ ...item, _key: `${item.id}-${i}` }))
  );

  const allChecked = expandedItems.length > 0 && checkedItems.size >= expandedItems.length;

  function handleBarcodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input = barcodeInput.trim().toLowerCase();
    if (!input) return;

    const unchecked = expandedItems.filter(item => !checkedItems.has(item._key));
    const match = unchecked.find(item =>
      item.sku?.toLowerCase() === input ||
      item.title?.toLowerCase().includes(input)
    );

    if (match) {
      setCheckedItems(prev => {
        const next = new Set([...prev, match._key]);
        // After state update, scroll to next unchecked item
        setTimeout(() => {
          const remaining = expandedItems.filter(item => !next.has(item._key));
          const nextItem = remaining[0];
          if (nextItem) {
            itemRefs.current.get(nextItem._key)?.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, 100);
        return next;
      });
      setFlashItem(match._key);
      setTimeout(() => setFlashItem(null), 800);
      setBarcodeInput("");
    } else {
      setFlashWrong(true);
      setTimeout(() => setFlashWrong(false), 600);
      setBarcodeInput("");
    }
  }

  function toggleItem(key: string) {
    setCheckedItems(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function handleComplete() {
    if (!activeOrder || !shipment) return;
    setCompleting(true);
    setCompletionError(null);
    try {
      await completeOrder(activeOrder.id, shipment.consignmentNumber, shipment.trackingUrl);
      setView("confirm");
      refetch();
    } catch (err: any) {
      setCompletionError(err.message ?? "Failed to complete order");
    } finally {
      setCompleting(false);
    }
  }

  function advanceToNext() {
    // Find next unfulfilled order that isn't the one just completed.
    // After refetch, the completed order is removed from the list, so we
    // pick the first remaining order. Pre-queued shipments are keyed by
    // order ID, so they still resolve correctly regardless of list position.
    const remaining = unfulfilledOrders.filter(o => o.id !== activeOrder?.id);
    const nextOrder = remaining[0];
    if (nextOrder) {
      startPicking(nextOrder);
    } else {
      setView("list");
      setActiveOrder(null);
    }
  }

  function goBack() {
    clearPreQueue(); // discard any stale pre-queued shipments
    setView("list");
    setActiveOrder(null);
    setShipment(null);
    setPrintStatus("idle");
    setShipmentError(null);
    setCompletionError(null);
  }

  // When all items are picked and shipment is ready, advance to pre-confirm step.
  // The operator then explicitly taps "Confirm & Complete" before the APC call is made.
  useEffect(() => {
    if (view === "picking" && allChecked && expandedItems.length > 0 && shipment && !completing) {
      setView("pre-confirm");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allChecked, shipment, view]);

  // Auto-advance after confirm is shown — give user 4 s to read consignment number
  useEffect(() => {
    if (view !== "confirm") return;
    const timer = setTimeout(() => advanceToNext(), 4000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    if (view === "picking" && barcodeRef.current) {
      barcodeRef.current.focus();
    }
  }, [view]);

  if (!configStatus?.apcCredentialsConfigured || !configStatus?.serviceCodesConfigured) {
    return (
      <div className="space-y-6">
        <PageHeader title="Fulfilment" description="APC order scanning and label printing." />
        <div className="glass-panel p-8 rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
          <div className="flex items-start gap-4">
            <AlertCircle className="w-8 h-8 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="space-y-3">
              <h3 className="font-semibold text-lg text-amber-900 dark:text-amber-200">Fulfilment not configured</h3>
              {!configStatus?.apcCredentialsConfigured && (
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  <span className="font-medium">APC credentials missing.</span> Set the{" "}
                  <code className="bg-amber-100 dark:bg-amber-900 px-1.5 py-0.5 rounded font-mono text-xs">APC_USERNAME</code>,{" "}
                  <code className="bg-amber-100 dark:bg-amber-900 px-1.5 py-0.5 rounded font-mono text-xs">APC_PASSWORD</code>, and{" "}
                  <code className="bg-amber-100 dark:bg-amber-900 px-1.5 py-0.5 rounded font-mono text-xs">APC_ACCOUNT_NUMBER</code>{" "}
                  environment variables on the server.
                </p>
              )}
              {configStatus?.apcCredentialsConfigured && !configStatus?.serviceCodesConfigured && (
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  <span className="font-medium">Service codes not configured.</span> Go to{" "}
                  <a href={`${BASE}/settings`} className="underline font-medium">Settings → APC Service Codes</a>{" "}
                  and enter all 4 service codes.
                </p>
              )}
              <div className="mt-2 p-4 bg-amber-100 dark:bg-amber-900/40 rounded-xl text-xs font-mono space-y-1 text-amber-900 dark:text-amber-200">
                <p className="font-semibold text-sm font-sans mb-2 text-amber-800 dark:text-amber-300">Chrome kiosk-printing setup</p>
                <p>For silent label printing, run Chrome with:</p>
                <p className="text-amber-700 dark:text-amber-400">chrome.exe --kiosk-printing</p>
                <p className="mt-2">Or update your Chrome shortcut to include this flag.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === "pre-confirm" && activeOrder && shipment) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => setView("picking")} className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="font-display font-bold text-xl">{activeOrder.name}</h1>
            <p className="text-sm text-muted-foreground">{activeOrder.shipping_address?.name ?? `${activeOrder.customer?.first_name} ${activeOrder.customer?.last_name}`}</p>
          </div>
          <button onClick={goBack} className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg border border-border hover:bg-secondary/50 transition-colors">
            Back to list
          </button>
        </div>

        <div className="glass-panel p-6 rounded-2xl border border-primary/30 bg-primary/5 space-y-4">
          <div className="flex items-center gap-3 mb-2">
            <CheckCircle2 className="w-8 h-8 text-green-500 flex-shrink-0" />
            <div>
              <h2 className="font-bold text-lg">All items picked!</h2>
              <p className="text-sm text-muted-foreground">Review the shipment details then confirm to complete.</p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Order</span>
              <span className="font-semibold">{activeOrder.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Customer</span>
              <span className="font-semibold">{activeOrder.shipping_address?.name ?? `${activeOrder.customer?.first_name} ${activeOrder.customer?.last_name}`}</span>
            </div>
            {activeOrder.shipping_address && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Address</span>
                <span className="text-right font-medium">
                  {activeOrder.shipping_address.address1}<br />
                  {activeOrder.shipping_address.city}, {activeOrder.shipping_address.zip}
                </span>
              </div>
            )}
            <div className="border-t border-border pt-2 flex justify-between">
              <span className="text-muted-foreground">Consignment</span>
              <span className="font-mono font-bold text-primary">{shipment.consignmentNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Service</span>
              <span className="font-mono text-xs">{shipment.serviceCode}</span>
            </div>
          </div>

          {completionError && (
            <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{completionError}</span>
            </div>
          )}

          <button
            onClick={handleComplete}
            disabled={completing}
            className="w-full py-4 bg-primary text-primary-foreground rounded-xl font-bold text-xl hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-3"
          >
            {completing ? (
              <><Loader2 className="w-6 h-6 animate-spin" /> Completing…</>
            ) : (
              <><Truck className="w-6 h-6" /> Confirm &amp; Complete</>
            )}
          </button>

          <button
            onClick={() => setView("picking")}
            disabled={completing}
            className="w-full py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-xl hover:bg-secondary/50 transition-colors disabled:opacity-40"
          >
            ← Back to picking
          </button>
        </div>
      </div>
    );
  }

  if (view === "confirm" && activeOrder && shipment) {
    const hasNext = unfulfilledOrders.filter(o => o.id !== activeOrder.id).length > 0;
    return (
      <div className="space-y-6">
        <PageHeader title="Fulfilment" description="APC order scanning and label printing." />
        <div className="glass-panel p-8 rounded-2xl border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20 text-center">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-green-800 dark:text-green-200 mb-1">Order Complete!</h2>
          <p className="text-green-700 dark:text-green-300 mb-4">
            {activeOrder.name} — {activeOrder.shipping_address?.name ?? activeOrder.customer?.first_name}
          </p>
          <div className="inline-flex items-center gap-2 bg-green-100 dark:bg-green-900/50 px-5 py-3 rounded-xl mb-6">
            <Truck className="w-5 h-5 text-green-600" />
            <span className="font-mono font-bold text-green-800 dark:text-green-200 text-lg">{shipment.consignmentNumber}</span>
          </div>
          <p className="text-sm text-green-600 dark:text-green-400 mb-6">
            {activeOrder.shipping_address?.address1}, {activeOrder.shipping_address?.city}, {activeOrder.shipping_address?.zip}
          </p>
          {hasNext && (
            <p className="text-xs text-green-600/70 dark:text-green-400/70 mb-3 animate-pulse">
              Auto-advancing to next order in 4 s…
            </p>
          )}
          <div className="flex gap-3 justify-center">
            {hasNext ? (
              <button
                onClick={advanceToNext}
                className="px-8 py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-lg hover:bg-primary/90 transition-colors flex items-center gap-2"
              >
                Next Order <ChevronRight className="w-5 h-5" />
              </button>
            ) : null}
            <button
              onClick={() => setView("list")}
              className="px-6 py-3 bg-secondary text-foreground rounded-xl font-medium hover:bg-secondary/80 transition-colors"
            >
              {hasNext ? "Back to List" : "All Done — Back to List"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (view === "picking" && activeOrder) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={goBack} className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="font-display font-bold text-xl">{activeOrder.name}</h1>
            <p className="text-sm text-muted-foreground">
              {activeOrder.shipping_address?.name ?? `${activeOrder.customer?.first_name} ${activeOrder.customer?.last_name}`}
              {activeOrder.shipping_address && ` — ${activeOrder.shipping_address.city}, ${activeOrder.shipping_address.zip}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {printStatus === "printing" && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Printer className="w-4 h-4 animate-pulse" /> Printing label…
              </span>
            )}
            {printStatus === "done" && (
              <span className="flex items-center gap-1.5 text-xs text-green-600">
                <CheckCircle2 className="w-4 h-4" /> Label printed
              </span>
            )}
            {printStatus === "failed" && shipment && (
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-xs text-destructive">
                  <XCircle className="w-4 h-4" /> Print failed
                </span>
                <button
                  onClick={() => {
                    setPrintStatus("printing");
                    printLabel(
                      shipment.labelPdfBase64,
                      () => setPrintStatus("done"),
                      () => setPrintStatus("failed"),
                    );
                  }}
                  className="text-xs px-2 py-1 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-lg flex items-center gap-1 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" /> Retry print
                </button>
              </div>
            )}
            {printStatus === "failed" && !shipment && (
              <span className="flex items-center gap-1.5 text-xs text-destructive">
                <XCircle className="w-4 h-4" /> Print failed
              </span>
            )}
          </div>
        </div>

        {shipmentError && (
          <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive flex items-start gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-sm">APC Shipment Error</p>
              <p className="text-sm opacity-80 mt-0.5">{shipmentError}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={retryShipment}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-destructive/10 hover:bg-destructive/20 rounded-lg transition-colors font-medium"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Retry
              </button>
              <button
                onClick={advanceToNext}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-secondary hover:bg-secondary/80 rounded-lg transition-colors font-medium"
              >
                <SkipForward className="w-3.5 h-3.5" /> Skip
              </button>
            </div>
          </div>
        )}

        {shipment && (
          <div className="flex items-center gap-3 p-3 bg-secondary/30 rounded-xl text-sm">
            <Truck className="w-4 h-4 text-muted-foreground" />
            <span className="text-muted-foreground">Consignment:</span>
            <span className="font-mono font-semibold">{shipment.consignmentNumber}</span>
            <span className="text-xs text-muted-foreground ml-auto">Service: {shipment.serviceCode}</span>
          </div>
        )}

        {creatingShipment && (
          <div className="flex items-center gap-2 p-3 bg-secondary/30 rounded-xl text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Creating APC shipment…
          </div>
        )}

        <form onSubmit={handleBarcodeSubmit}>
          <div className={`relative transition-all ${flashWrong ? "ring-2 ring-destructive rounded-xl" : ""}`}>
            <Scan className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none" />
            <input
              ref={barcodeRef}
              value={barcodeInput}
              onChange={e => setBarcodeInput(e.target.value)}
              placeholder="Scan barcode or type SKU…"
              className="w-full pl-12 pr-4 py-4 text-lg bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
              autoComplete="off"
              autoFocus
            />
          </div>
        </form>

        <div className="space-y-2">
          <div className="flex items-center gap-3 text-xs text-muted-foreground px-1 mb-1">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-400 inline-block" /> Fridge</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-purple-400 inline-block" /> Freezer</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-400 inline-block" /> Ambient</span>
            <span className="ml-auto font-medium text-foreground">
              {checkedItems.size} / {expandedItems.length} picked
            </span>
          </div>

          {expandedItems.map((item) => {
            const checked = checkedItems.has(item._key);
            const zone = item.location?.zone ?? null;
            const style = zone ? ZONE_STYLES[zone] : null;
            const isFlashing = flashItem === item._key;

            return (
              <button
                key={item._key}
                ref={el => {
                  if (el) itemRefs.current.set(item._key, el);
                  else itemRefs.current.delete(item._key);
                }}
                onClick={() => toggleItem(item._key)}
                className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all
                  ${checked
                    ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 opacity-60"
                    : style
                      ? `${style.bg} ${style.border}`
                      : "bg-card border-border"
                  }
                  ${isFlashing ? "ring-2 ring-green-500 ring-offset-1" : ""}
                `}
              >
                <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors
                  ${checked ? "border-green-500 bg-green-500" : "border-border"}`}
                >
                  {checked && <CheckCircle2 className="w-5 h-5 text-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`font-semibold text-base ${checked ? "line-through text-muted-foreground" : ""}`}>
                    {item.title}
                    {item.variant_title && (
                      <span className="text-sm font-normal text-muted-foreground ml-2">— {item.variant_title}</span>
                    )}
                  </p>
                  {item.sku && (
                    <p className="text-xs font-mono text-muted-foreground mt-0.5">{item.sku}</p>
                  )}
                </div>
                {item.location ? (
                  <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium flex-shrink-0 ${style?.badge}`}>
                    <MapPin className="w-3 h-3" />
                    {item.location.locationLabel}
                  </div>
                ) : (
                  <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300 flex-shrink-0">
                    <AlertCircle className="w-3 h-3" />
                    No location
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {completionError && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {completionError}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={advanceToNext}
            className="px-4 py-2.5 border border-border rounded-xl text-sm font-medium hover:bg-secondary/50 transition-colors flex items-center gap-1.5 text-muted-foreground"
          >
            <SkipForward className="w-4 h-4" /> Skip
          </button>
          <button
            onClick={() => setView("pre-confirm")}
            disabled={!allChecked || !shipment}
            className="flex-1 py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-lg hover:bg-primary/90 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {allChecked ? (
              <><CheckCircle2 className="w-5 h-5" /> Review &amp; Complete</>
            ) : (
              `${expandedItems.length - checkedItems.size} items remaining`
            )}
          </button>
        </div>

        <iframe
          id="label-print-frame"
          title="Label Print"
          className="hidden"
          style={{ position: "fixed", top: "-9999px", left: "-9999px", width: "100mm", height: "150mm" }}
        />
        <iframe
          id="label-preprint-frame"
          title="Label Pre-Print"
          className="hidden"
          style={{ position: "fixed", top: "-9999px", left: "-9998px", width: "100mm", height: "150mm" }}
        />
      </div>
    );
  }

  // DATES VIEW: landing page showing all dispatch dates with unfulfilled order groups
  if (view === "dates") {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <PageHeader title="Fulfilment" description="Select a dispatch date to start picking." />
          <button
            onClick={() => refetchTags()}
            disabled={tagsLoading}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${tagsLoading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {tagsError && (
          <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm">{(tagsError as Error).message}</p>
          </div>
        )}

        {tagsLoading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Loading dispatch schedule…</span>
          </div>
        )}

        {!tagsLoading && dispatchTags && dispatchTags.length === 0 && (
          <div className="glass-panel p-10 rounded-2xl border border-border text-center text-muted-foreground">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-500 opacity-60" />
            <p className="font-medium">No pending orders</p>
            <p className="text-sm mt-1">All recent orders have been fulfilled.</p>
          </div>
        )}

        {!tagsLoading && dispatchTags && dispatchTags.length > 0 && (
          <div className="space-y-3">
            {dispatchTags.map(group => {
              const isToday = group.tag === today;
              const isPast = group.tag < today;
              const weightKg = (group.totalWeightG / 1000).toFixed(1);

              return (
                <div
                  key={group.tag}
                  className={`glass-panel p-5 rounded-2xl border flex items-center gap-4 transition-colors ${
                    isPast
                      ? "border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-950/10"
                      : isToday
                      ? "border-primary/30 bg-primary/5"
                      : "border-border"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-lg font-mono">{group.tag}</span>
                      {isToday && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">Today</span>
                      )}
                      {isPast && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 font-semibold">Overdue</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1"><Package className="w-3.5 h-3.5" /> {group.orderCount} orders</span>
                      <span>{group.totalItems} items</span>
                      <span>{weightKg} kg</span>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setQueryTag(group.tag);
                      setTag(group.tag);
                      setIncludeAll(false);
                      setView("list");
                    }}
                    className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-semibold hover:bg-primary/90 transition-colors flex-shrink-0"
                  >
                    <Truck className="w-4 h-4" /> Start Picking
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Manual override for dates without a dispatch tag */}
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground transition-colors">Load a specific date manually</summary>
          <div className="flex gap-3 items-end mt-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Date tag</label>
              <input
                type="date"
                value={tag}
                onChange={e => setTag(e.target.value)}
                className="px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <button
              onClick={() => { setQueryTag(tag); setIncludeAll(false); setView("list"); }}
              className="px-4 py-2 bg-secondary text-foreground rounded-xl font-medium hover:bg-secondary/80 transition-colors"
            >
              Load Date
            </button>
          </div>
        </details>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => setView("dates")} className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <PageHeader title={`Fulfilment — ${queryTag}`} description="Orders for this dispatch date." />
        <button
          onClick={() => refetch()}
          disabled={isLoading}
          className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors ml-auto"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
        </button>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={includeAll}
            onChange={e => setIncludeAll(e.target.checked)}
            className="rounded accent-primary"
          />
          Show fulfilled
        </label>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm">{(error as Error).message}</p>
        </div>
      )}

      {orders && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display font-bold text-lg">
                Orders tagged <span className="text-primary">{queryTag}</span>
              </h3>
              <p className="text-sm text-muted-foreground">
                {unfulfilledOrders.length} unfulfilled &middot; {fulfilledOrders.length} fulfilled
              </p>
            </div>
          </div>

          {unfulfilledOrders.length === 0 && (
            <div className="glass-panel p-10 rounded-2xl border border-border text-center text-muted-foreground">
              <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-500 opacity-60" />
              <p className="font-medium">All orders fulfilled!</p>
              <p className="text-sm mt-1">Nothing left to dispatch for this date.</p>
            </div>
          )}

          {unfulfilledOrders.map((order, idx) => {
            const hasUnassigned = order.line_items.some(i => !i.location && i.sku);
            const weightKg = ((order.total_weight ?? 0) / 1000).toFixed(2);
            const tags = order.tags.split(",").map(t => t.trim()).filter(Boolean);

            return (
              <div
                key={order.id}
                className="glass-panel p-5 rounded-2xl border border-border flex items-center gap-4 hover:border-primary/30 transition-colors group"
              >
                <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-sm font-bold text-muted-foreground flex-shrink-0">
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-lg">{order.name}</span>
                    {hasUnassigned && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300 font-medium">
                        Unassigned SKUs
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">
                    {order.shipping_address?.name ?? `${order.customer?.first_name} ${order.customer?.last_name}`}
                    {order.shipping_address && ` — ${order.shipping_address.city}, ${order.shipping_address.zip}`}
                  </p>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                    <span>{order.line_items.reduce((s, i) => s + i.quantity, 0)} items</span>
                    <span>{weightKg} kg</span>
                    {tags.slice(0, 4).map(t => (
                      <span key={t} className="px-1.5 py-0.5 rounded bg-secondary/60 font-mono">{t}</span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => { clearPreQueue(); startPicking(order); }}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-semibold hover:bg-primary/90 transition-colors flex-shrink-0"
                >
                  <Scan className="w-4 h-4" /> Start Picking
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            );
          })}

          {fulfilledOrders.length > 0 && includeAll && (
            <div className="space-y-2 opacity-50">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">Fulfilled</p>
              {fulfilledOrders.map(order => (
                <div key={order.id} className="glass-panel p-4 rounded-xl border border-border flex items-center gap-4">
                  <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold">{order.name}</span>
                    <span className="text-sm text-muted-foreground ml-3">
                      {order.shipping_address?.name ?? `${order.customer?.first_name} ${order.customer?.last_name}`}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">Fulfilled</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <iframe
        id="label-print-frame"
        title="Label Print"
        className="hidden"
        style={{ position: "fixed", top: "-9999px", left: "-9999px", width: "100mm", height: "150mm" }}
      />
    </div>
  );
}
