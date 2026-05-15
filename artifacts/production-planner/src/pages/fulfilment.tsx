import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { useRefreshSpin } from "@/hooks/use-refresh-spin";
import { ShopifyConfirmDialog } from "@/components/shopify-confirm-dialog";
import { format, addDays, parseISO } from "date-fns";
import { useLocation } from "wouter";
import {
  Package, Scan, CheckCircle2, AlertCircle, ChevronRight, Printer,
  RefreshCw, MapPin, SkipForward, RotateCcw, XCircle, Loader2,
  ArrowLeft, Truck, Tag, ShieldAlert, PlusCircle, Ban, X,
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
  barcode: string | null;
  imageUrl: string | null;
  recipeColor: string | null;
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
  warnings?: string[];
}

interface ConfigStatus {
  apcEnabled: boolean;
  apcCredentialsConfigured: boolean;
  serviceCodesConfigured: boolean;
  testMode: boolean;
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
  postcodeIssues: number;
}

interface PostcodeValidation {
  shopify_order_id: number;
  postcode: string;
  service_code: string;
  available: boolean;
  reason: string | null;
  checked_at: string;
}

// All audio cues for the picking flow. Web Audio API beeps so we don't ship
// audio assets and they always play instantly even on the first scan.
function playTone(opts: { frequency: number; duration: number; type?: OscillatorType; gain?: number; startAt?: number; ctx?: AudioContext }) {
  const ctx = opts.ctx ?? new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = opts.type ?? "sine";
  const start = ctx.currentTime + (opts.startAt ?? 0);
  osc.frequency.setValueAtTime(opts.frequency, start);
  const peak = opts.gain ?? 0.25;
  gain.gain.setValueAtTime(peak, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + opts.duration);
  osc.start(start);
  osc.stop(start + opts.duration);
  return ctx;
}

function playScanSuccess() {
  try {
    const ctx = playTone({ frequency: 880, duration: 0.15, type: "sine", gain: 0.2 });
    setTimeout(() => ctx.close(), 200);
  } catch (err) {
    console.warn("[Fulfilment] AudioContext not available:", err);
  }
}

// Loud, attention-grabbing low-frequency buzz for an unrecognised scan —
// square wave rasps so a packer immediately knows to look at the screen.
function playScanWrong() {
  try {
    const ctx = new AudioContext();
    playTone({ ctx, frequency: 180, duration: 0.18, type: "square", gain: 0.5 });
    playTone({ ctx, frequency: 130, duration: 0.25, type: "square", gain: 0.5, startAt: 0.18 });
    setTimeout(() => ctx.close(), 600);
  } catch (err) {
    console.warn("[Fulfilment] AudioContext not available:", err);
  }
}

// Reads the shipping name aloud when an order opens so the packer can
// cross-check against the printed APC label. Browsers require a prior user
// gesture before speech is allowed; the click on "Start Picking" satisfies
// that, so this fires reliably for the second order onwards too. Cancels
// any in-flight utterance first to handle rapid back-to-back orders.

// Voice picker — prefer a natural-sounding English female voice (closest
// match to the OpenAI "Nova" / ChatGPT voice on each platform). Voices load
// asynchronously in some browsers, so we cache the choice once and re-evaluate
// on the `voiceschanged` event. Picked once per page load.
let cachedSpeechVoice: SpeechSynthesisVoice | null | undefined;
function pickEnglishFemaleVoice(): SpeechSynthesisVoice | null {
  if (cachedSpeechVoice !== undefined) return cachedSpeechVoice;
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    cachedSpeechVoice = null;
    return null;
  }
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null; // wait for voiceschanged

  // Priority order — most natural-sounding en-GB female voices first.
  // Apple ships "Premium" and "Enhanced" tiers that sound noticeably better
  // than the default; Chrome on macOS exposes the Google UK voices.
  const preferredNames = [
    /Google UK English Female/i,
    /Microsoft Sonia/i,           // Edge / Windows en-GB neural
    /Microsoft Libby/i,           // Edge / Windows en-GB neural
    /Kate \(Premium\)/i, /Serena \(Premium\)/i, /Stephanie \(Premium\)/i,
    /Kate \(Enhanced\)/i, /Serena \(Enhanced\)/i, /Stephanie \(Enhanced\)/i,
    /^Kate$/i, /^Serena$/i, /^Stephanie$/i, /^Susan$/i, /^Fiona$/i,
  ];
  for (const pattern of preferredNames) {
    const v = voices.find(v => pattern.test(v.name) && /^en[-_]GB/i.test(v.lang));
    if (v) { cachedSpeechVoice = v; return v; }
  }
  // Fallback: any voice whose name contains "Female" and is en-GB
  const femaleEnGB = voices.find(v => /female/i.test(v.name) && /^en[-_]GB/i.test(v.lang));
  if (femaleEnGB) { cachedSpeechVoice = femaleEnGB; return femaleEnGB; }
  // Last resort: first en-GB voice we find
  const anyEnGB = voices.find(v => /^en[-_]GB/i.test(v.lang));
  cachedSpeechVoice = anyEnGB ?? null;
  return cachedSpeechVoice;
}

// Refresh the cached voice when the browser finishes loading them. Safari
// and some Chrome builds deliver voices asynchronously after the first call
// returns an empty list.
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    cachedSpeechVoice = undefined;
    pickEnglishFemaleVoice();
  };
}

function speakName(name: string) {
  try {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(name);
    const voice = pickEnglishFemaleVoice();
    if (voice) utter.voice = voice;
    utter.rate = 0.95;
    utter.pitch = 1;
    utter.volume = 1;
    utter.lang = "en-GB";
    window.speechSynthesis.speak(utter);
  } catch (err) {
    console.warn("[Fulfilment] speechSynthesis not available:", err);
  }
}

// Triumphant rising arpeggio (C5 → E5 → G5 → C6) — clearly distinct from
// the per-scan beep and audible across the kitchen.
function playOrderComplete() {
  try {
    const ctx = new AudioContext();
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, i) => {
      playTone({ ctx, frequency: freq, duration: 0.22, type: "triangle", gain: 0.45, startAt: i * 0.12 });
    });
    setTimeout(() => ctx.close(), 1200);
  } catch (err) {
    console.warn("[Fulfilment] AudioContext not available:", err);
  }
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

// WeekendCheckOrderResult kept as alias for backwards compat with any
// callers — the canonical type is now ServiceCheckOrderResult above.
type WeekendCheckOrderResult = ServiceCheckOrderResult;

interface ServiceCheckResult {
  tag: string;
  results: ServiceCheckOrderResult[];
  summary: { available: number; unavailable: number; total: number };
}

interface ServiceCheckOrderResult {
  orderName: string;
  customerName: string;
  postcode: string;
  available: boolean;
  reason?: string;
  serviceCode?: string;
}

interface DispatchProgress {
  tag: string;
  totalOrders: number;
  totalFulfilled: number;
  categories: {
    smallBox: { total: number; fulfilled: number };
    largeBox: { total: number; fulfilled: number };
    wholesale: { total: number; fulfilled: number };
    other: { total: number; fulfilled: number };
  };
}

async function fetchDispatchProgress(tag: string): Promise<DispatchProgress> {
  const res = await fetch(`${BASE}/api/fulfilment/dispatch-progress?tag=${encodeURIComponent(tag)}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch dispatch progress");
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

async function bulkTagDispatch(tag: string, category: string): Promise<{ tagged: number; total: number }> {
  const res = await fetch(`${BASE}/api/fulfilment/tag-dispatch-bulk`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag, category }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to tag orders");
  return data;
}

async function fetchPostcodeValidations(tag: string): Promise<PostcodeValidation[]> {
  const res = await fetch(`${BASE}/api/fulfilment/postcode-validations?tag=${encodeURIComponent(tag)}`, { credentials: "include" });
  if (!res.ok) return [];
  return res.json();
}

async function recheckPostcode(orderId: number, tag: string): Promise<{ available: boolean; reason?: string }> {
  const res = await fetch(`${BASE}/api/fulfilment/postcode-recheck`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, tag }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Re-check failed");
  return data;
}

async function addExtraBox(waybill: string): Promise<{ labelPdfs: string[]; warnings?: string[] }> {
  const res = await fetch(`${BASE}/api/fulfilment/shipments/${encodeURIComponent(waybill)}/add-parcel`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to add extra box");
  return data;
}

async function reprintLabel(waybill: string): Promise<{ labelPdfs: string[] }> {
  const res = await fetch(`${BASE}/api/fulfilment/shipments/${encodeURIComponent(waybill)}/reprint-label`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to reprint label");
  return data;
}

async function cancelConsignment(waybill: string): Promise<void> {
  const res = await fetch(`${BASE}/api/fulfilment/shipments/${encodeURIComponent(waybill)}/cancel`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to cancel consignment");
}

interface CompleteOrderResult {
  ok: true;
  orderId: number;
  consignmentNumber: string | null;
  decrementError: string | null;
}

async function completeOrder(orderId: number, consignmentNumber: string | null, trackingUrl?: string): Promise<CompleteOrderResult> {
  const res = await fetch(`${BASE}/api/fulfilment/orders/${orderId}/complete`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(consignmentNumber ? { consignmentNumber, trackingUrl } : {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to complete order");
  return data as CompleteOrderResult;
}

function TestModeBanner({ trainingCredentialsMissing }: { trainingCredentialsMissing?: boolean }) {
  return (
    <div className="space-y-2">
      <div className="w-full rounded-xl border border-amber-400 bg-amber-100 dark:bg-amber-900/40 px-4 py-2.5 flex items-center gap-2 text-amber-900 dark:text-amber-200 text-sm font-medium">
        <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-600" />
        <span>TEST MODE — APC consignments are not real. No real charges or bookings are made.</span>
      </div>
      {trainingCredentialsMissing && (
        <div className="w-full rounded-xl border border-red-400 bg-red-50 dark:bg-red-900/30 px-4 py-2.5 flex items-start gap-2 text-red-900 dark:text-red-200 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-600 mt-0.5" />
          <span>
            <span className="font-semibold">Training credentials not configured.</span>{" "}
            The APC training server requires a separate login from production. Set the{" "}
            <code className="bg-red-100 dark:bg-red-900 px-1 rounded font-mono text-xs">APC_TRAINING_USERNAME</code> and{" "}
            <code className="bg-red-100 dark:bg-red-900 px-1 rounded font-mono text-xs">APC_TRAINING_PASSWORD</code>{" "}
            environment variables (contact APC/Hypaship support to request training access).
          </span>
        </div>
      )}
    </div>
  );
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
  // Resolves as failure so the operator sees a deterministic state and can retry.
  const fallbackTimer = setTimeout(() => settle(false), 10_000);

  iframe.onerror = () => settle(false);

  iframe.onload = () => {
    try {
      window.addEventListener("afterprint", handleAfterPrint, { once: true });
      iframe.contentWindow?.print();
    } catch (err) {
      console.warn("[Fulfilment] Print failed:", err);
      settle(false);
    }
  };

  iframe.srcdoc = makeLabelHtml(base64Pdf);
}

type PrintStatus = "idle" | "printing" | "done" | "failed";

type View = "dates" | "list" | "picking" | "pre-confirm" | "confirm";

function ProgressBar({ label, fulfilled, total, color, weight }: { label: string; fulfilled: number; total: number; color: string; weight: number }) {
  if (total === 0) return null;
  const pct = Math.round((fulfilled / total) * 100);
  return (
    <div className="min-w-[80px]" style={{ flex: weight }}>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">{fulfilled}/{total}</span>
      </div>
      <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function DispatchProgressHeader({ progress }: { progress: DispatchProgress }) {
  const { categories, totalOrders, totalFulfilled } = progress;
  const remaining = totalOrders - totalFulfilled;
  const pct = totalOrders > 0 ? Math.round((totalFulfilled / totalOrders) * 100) : 0;

  return (
    <div className="glass-panel p-4 rounded-2xl border border-border">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Truck className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-sm">Dispatch Progress</h3>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="font-bold text-primary tabular-nums">{totalFulfilled}/{totalOrders}</span>
          <span className="text-muted-foreground">({pct}%)</span>
          {remaining > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 font-medium">
              {remaining} remaining
            </span>
          )}
          {remaining === 0 && totalOrders > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 font-medium">
              All done!
            </span>
          )}
        </div>
      </div>
      <div className="flex gap-4 flex-wrap">
        <ProgressBar label="Small Box" fulfilled={categories.smallBox.fulfilled} total={categories.smallBox.total} color="bg-blue-500" weight={categories.smallBox.total} />
        <ProgressBar label="Large Box" fulfilled={categories.largeBox.fulfilled} total={categories.largeBox.total} color="bg-indigo-500" weight={categories.largeBox.total} />
        <ProgressBar label="Wholesale" fulfilled={categories.wholesale.fulfilled} total={categories.wholesale.total} color="bg-amber-500" weight={categories.wholesale.total} />
        {categories.other.total > 0 && (
          <ProgressBar label="Other" fulfilled={categories.other.fulfilled} total={categories.other.total} color="bg-gray-500" weight={categories.other.total} />
        )}
      </div>
    </div>
  );
}

// Modal showing background-completion failures for the current session.
// Each failure can be dismissed individually after the operator has dealt
// with it (e.g. retried in Shopify Admin or manually decremented stock).
function FailuresModal({
  failures,
  onDismiss,
  onClose,
}: {
  failures: Array<{ orderId: number; orderName: string; customerName: string; error: string; kind: "fulfilment" | "decrement"; at: Date }>;
  onDismiss: (orderId: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Background completion failures</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {failures.length} order{failures.length === 1 ? "" : "s"} did not finish completing in this session.
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-secondary/50">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-4 space-y-3">
          {failures.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">All cleared. Nothing to review.</p>
          )}
          {failures.map(f => (
            <div key={f.orderId} className={`p-3 rounded-xl border ${f.kind === "fulfilment" ? "bg-destructive/5 border-destructive/30" : "bg-amber-50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{f.orderName} <span className="font-normal text-muted-foreground">— {f.customerName}</span></p>
                  <p className={`text-xs font-medium mt-0.5 ${f.kind === "fulfilment" ? "text-destructive" : "text-amber-700 dark:text-amber-300"}`}>
                    {f.kind === "fulfilment"
                      ? "Shopify fulfilment failed — customer was NOT emailed; stock was NOT deducted."
                      : "Shopify shipped + customer emailed, but local stock decrement failed — manually adjust the production fridge."}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 break-words">{f.error}</p>
                </div>
                <button onClick={() => onDismiss(f.orderId)} className="text-xs px-2 py-1 border border-border rounded-lg hover:bg-secondary/50 flex-shrink-0">
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface DispatchAuditRow {
  orderId: number;
  orderName: string;
  customerName: string | null;
  cancelledAt: string | null;
  shopifyFulfillmentStatus: string | null;
  fulfilledByApp: boolean;
  factoryAdjusted: boolean;
  status: "ok" | "needs_decrement" | "needs_fulfilment" | "untouched" | "shopify_only";
}

interface DispatchAuditResponse {
  tag: string;
  summary: { total: number; ok: number; needsFulfilment: number; needsDecrement: number; shopifyOnly: number; untouched: number };
  orders: DispatchAuditRow[];
}

// End-of-dispatch audit modal — calls /api/fulfilment/dispatch-audit which
// cross-checks each order in the current dispatch tag against Shopify's
// fulfillment_status and the two completion tags. Lets the operator close
// out a packing session knowing exactly what (if anything) needs follow-up.
function AuditModal({ tag, onClose }: { tag: string; onClose: () => void }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dispatch-audit", tag],
    queryFn: async (): Promise<DispatchAuditResponse> => {
      const res = await fetch(`${BASE}/api/fulfilment/dispatch-audit?tag=${encodeURIComponent(tag)}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Audit failed");
      return res.json();
    },
    staleTime: 10_000,
  });

  const STATUS_LABEL: Record<DispatchAuditRow["status"], { label: string; color: string }> = {
    ok: { label: "Fully complete", color: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" },
    needs_decrement: { label: "Stock not decremented", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
    needs_fulfilment: { label: "Not fulfilled", color: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" },
    shopify_only: { label: "Fulfilled outside app", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200" },
    untouched: { label: "Untouched", color: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200" },
  };

  const problemRows = (data?.orders ?? []).filter(o => o.status !== "ok");

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">End-of-dispatch audit</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Tag: <span className="font-mono">{tag}</span></p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => refetch()} className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-secondary/50" title="Refresh">
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            </button>
            <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-secondary/50">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto p-4 space-y-4">
          {isLoading && (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          )}
          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm">{(error as Error).message}</div>
          )}
          {data && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <SummaryTile label="Total" value={data.summary.total} color="bg-secondary" />
                <SummaryTile label="OK" value={data.summary.ok} color="bg-green-100 dark:bg-green-900/40" />
                <SummaryTile label="Not fulfilled" value={data.summary.needsFulfilment} color="bg-red-100 dark:bg-red-900/40" />
                <SummaryTile label="Stock missed" value={data.summary.needsDecrement} color="bg-amber-100 dark:bg-amber-900/40" />
                <SummaryTile label="Outside app" value={data.summary.shopifyOnly} color="bg-blue-100 dark:bg-blue-900/40" />
              </div>

              {problemRows.length === 0 ? (
                <div className="p-4 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-xl text-sm text-green-700 dark:text-green-300 text-center">
                  Everything on this dispatch tag is fully complete — Shopify shipped + stock decremented.
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Needs attention ({problemRows.length})</p>
                  {problemRows.map(o => (
                    <div key={o.orderId} className="p-3 bg-secondary/20 border border-border rounded-xl flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{o.orderName} <span className="font-normal text-muted-foreground">— {o.customerName ?? "(no name)"}</span></p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap text-xs">
                          <span className={`px-2 py-0.5 rounded ${STATUS_LABEL[o.status].color} font-medium`}>{STATUS_LABEL[o.status].label}</span>
                          <span className="text-muted-foreground">Shopify: {o.shopifyFulfillmentStatus ?? "unfulfilled"}</span>
                          <span className="text-muted-foreground">App-fulfilled: {o.fulfilledByApp ? "✓" : "✗"}</span>
                          <span className="text-muted-foreground">Stock-decremented: {o.factoryAdjusted ? "✓" : "✗"}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`p-3 rounded-xl ${color}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold leading-tight">{value}</p>
    </div>
  );
}

export default function Fulfilment() {
  const tagsRefresh = useRefreshSpin();
  const ordersRefresh = useRefreshSpin();
  const today = format(new Date(), "yyyy-MM-dd");
  const urlParams = new URLSearchParams(window.location.search);
  const urlTag = urlParams.get("tag");
  const [tag, setTag] = useState(urlTag || today);
  const [queryTag, setQueryTag] = useState(urlTag || today);
  const [includeAll, setIncludeAll] = useState(false);
  const [view, setView] = useState<View>(urlTag ? "list" : "dates");
  const [, navigate] = useLocation();
  const [activeOrder, setActiveOrder] = useState<ShopifyOrder | null>(null);
  const [shipment, setShipment] = useState<ShipmentResult | null>(null);
  const [printStatus, setPrintStatus] = useState<PrintStatus>("idle");
  const [shipmentError, setShipmentError] = useState<string | null>(null);
  const [creatingShipment, setCreatingShipment] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  // Fire-and-forget completions that resolved with an error. Stored so the
  // packer can audit them at the end of a dispatch session without having
  // to scroll back through every order.
  interface CompletionFailure {
    orderId: number;
    orderName: string;
    customerName: string;
    error: string;
    kind: "fulfilment" | "decrement";
    at: Date;
  }
  const [completionFailures, setCompletionFailures] = useState<CompletionFailure[]>([]);
  const [pendingCompletions, setPendingCompletions] = useState(0);
  const [showFailuresModal, setShowFailuresModal] = useState(false);
  const [showAuditModal, setShowAuditModal] = useState(false);
  // Per-row scanned count, keyed by the grouped item's `_groupKey` (SKU when
  // present). Lets us collapse duplicate line items into a single row with
  // an `×N` badge, then track scan progress within that row.
  const [pickedCounts, setPickedCounts] = useState<Map<string, number>>(new Map());
  const [barcodeInput, setBarcodeInput] = useState("");
  const [flashItem, setFlashItem] = useState<string | null>(null);
  const [flashWrong, setFlashWrong] = useState(false);
  const [boxFilter, setBoxFilter] = useState<"small box" | "large box" | "wholesale" | "all">("small box");
  const [pendingPickOrder, setPendingPickOrder] = useState<ShopifyOrder | null>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const preQueueRef = useRef<Map<number, Promise<ShipmentResult>>>(new Map());
  const prePrintRef = useRef<Map<number, PrintStatus>>(new Map());
  // Tracks which order ids have been spoken aloud — prevents the picker
  // from hearing the same name twice if the picking view re-mounts (e.g.
  // after dismissing an error or scrolling back from pre-confirm).
  const spokenOrderIdsRef = useRef<Set<number>>(new Set());

  const { data: configStatus, isLoading: configStatusLoading } = useQuery({
    queryKey: ["fulfilment-config-status"],
    queryFn: fetchConfigStatus,
    staleTime: 60_000,
  });

  // Manual-tap kill switch — read from app_settings via /manual-tick-config.
  // Defaults to enabled until the fetch resolves so we don't briefly look
  // locked-down on a slow connection.
  const { data: manualTickConfig } = useQuery({
    queryKey: ["fulfilment-manual-tick-config"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/fulfilment/manual-tick-config`, { credentials: "include" });
      if (!res.ok) return { enabled: true };
      return (await res.json()) as { enabled: boolean };
    },
    staleTime: 60_000,
  });
  const manualTickEnabled = manualTickConfig?.enabled !== false;

  // Speak-customer-name kill switch — same pattern as manual-tick. Default
  // enabled so the spoken cross-check is on out of the box.
  const { data: speakNameConfig } = useQuery({
    queryKey: ["fulfilment-speak-name-config"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/fulfilment/speak-name-config`, { credentials: "include" });
      if (!res.ok) return { enabled: true };
      return (await res.json()) as { enabled: boolean };
    },
    staleTime: 60_000,
  });
  const speakNameEnabled = speakNameConfig?.enabled !== false;

  const { data: dispatchTags, isLoading: tagsLoading, error: tagsError, refetch: refetchTags } = useQuery({
    queryKey: ["fulfilment-dispatch-tags"],
    queryFn: fetchDispatchTags,
    staleTime: 2 * 60 * 1000,
    enabled: configStatus?.apcEnabled === false
      ? true
      : !!configStatus?.apcCredentialsConfigured && !!configStatus?.serviceCodesConfigured,
  });

  const { data: orders, isLoading, error, refetch } = useQuery({
    queryKey: ["fulfilment-orders", queryTag, includeAll],
    queryFn: () => fetchOrders(queryTag, includeAll),
    staleTime: 2 * 60 * 1000,
  });

  const { data: progress, refetch: refetchProgress } = useQuery({
    queryKey: ["fulfilment-dispatch-progress", queryTag],
    queryFn: () => fetchDispatchProgress(queryTag),
    staleTime: 30_000,
  });

  const { data: postcodeValidations, refetch: refetchPostcodes } = useQuery({
    queryKey: ["fulfilment-postcode-validations", queryTag],
    queryFn: () => fetchPostcodeValidations(queryTag),
    staleTime: 60_000,
  });

  const postcodeIssueMap = new Map<number, PostcodeValidation>();
  if (postcodeValidations) {
    for (const pv of postcodeValidations) {
      if (!pv.available) {
        postcodeIssueMap.set(Number(pv.shopify_order_id), pv);
      }
    }
  }

  const [recheckingId, setRecheckingId] = useState<number | null>(null);

  const allUnfulfilledOrders = orders?.filter(o => o.fulfillment_status !== "fulfilled") ?? [];
  const fulfilledOrders = orders?.filter(o => o.fulfillment_status === "fulfilled") ?? [];

  const unfulfilledOrders = allUnfulfilledOrders.filter(o =>
    o.tags.split(",").map(t => t.trim()).includes("dispatch")
  );
  const untaggedOrders = allUnfulfilledOrders.filter(o =>
    !o.tags.split(",").map(t => t.trim()).includes("dispatch")
  );

  function getOrderCategory(order: ShopifyOrder): "small box" | "large box" | "wholesale" | "other" {
    const tags = order.tags.split(",").map(t => t.trim().toLowerCase());
    if (tags.includes("wholesale")) return "wholesale";
    if (tags.includes("large box")) return "large box";
    if (tags.includes("small box")) return "small box";
    return "other";
  }

  const filteredUnfulfilled = boxFilter === "all"
    ? unfulfilledOrders
    : unfulfilledOrders.filter(o => getOrderCategory(o) === boxFilter);

  const filteredUntagged = boxFilter === "all"
    ? untaggedOrders
    : untaggedOrders.filter(o => getOrderCategory(o) === boxFilter);

  const boxCounts = {
    "small box": allUnfulfilledOrders.filter(o => getOrderCategory(o) === "small box").length,
    "large box": allUnfulfilledOrders.filter(o => getOrderCategory(o) === "large box").length,
    "wholesale": allUnfulfilledOrders.filter(o => getOrderCategory(o) === "wholesale").length,
    "other": allUnfulfilledOrders.filter(o => getOrderCategory(o) === "other").length,
  };

  const taggedCounts = {
    "small box": unfulfilledOrders.filter(o => getOrderCategory(o) === "small box").length,
    "large box": unfulfilledOrders.filter(o => getOrderCategory(o) === "large box").length,
    "wholesale": unfulfilledOrders.filter(o => getOrderCategory(o) === "wholesale").length,
    "other": unfulfilledOrders.filter(o => getOrderCategory(o) === "other").length,
  };

  const [bulkTagging, setBulkTagging] = useState(false);
  const [showBulkTagConfirm, setShowBulkTagConfirm] = useState(false);
  const [consignmentAction, setConsignmentAction] = useState<"idle" | "adding-box" | "reprinting" | "cancelling">("idle");
  const [consignmentActionError, setConsignmentActionError] = useState<string | null>(null);
  const [showAddBoxConfirm, setShowAddBoxConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const [weekendCheckTag, setWeekendCheckTag] = useState(today);
  const [weekendCheckLoading, setWeekendCheckLoading] = useState(false);
  const [weekendCheckError, setWeekendCheckError] = useState<string | null>(null);
  const [weekendCheckResults, setWeekendCheckResults] = useState<ServiceCheckResult | null>(null);

  async function runWeekendCheck() {
    setWeekendCheckLoading(true);
    setWeekendCheckError(null);
    setWeekendCheckResults(null);
    try {
      const params = new URLSearchParams({ tag: weekendCheckTag });
      const res = await fetch(`${BASE}/api/fulfilment/service-check?${params}`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Check failed");
      setWeekendCheckResults(data as ServiceCheckResult);
    } catch (err: any) {
      setWeekendCheckError(err.message ?? "Unknown error");
    } finally {
      setWeekendCheckLoading(false);
    }
  }

  function preQueueNextOrder(nextOrderId: number) {
    // APC off → no shipment to pre-create, no label to pre-print.
    if (!apcEnabled) return;
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

  function handleOrderSelect(order: ShopifyOrder) {
    clearPreQueue();
    // Live-mode confirmation only matters when a real APC consignment
    // is about to be created. With APC off there's no shipment, so we
    // can go straight into picking.
    if (configStatus?.testMode || !apcEnabled) {
      startPicking(order);
    } else {
      setPendingPickOrder(order);
    }
  }

  async function startPicking(order: ShopifyOrder) {
    setActiveOrder(order);
    setPickedCounts(new Map());
    setBarcodeInput("");
    setShipment(null);
    setShipmentError(null);
    setPrintStatus("idle");
    setCompletionError(null);
    setConsignmentAction("idle");
    setConsignmentActionError(null);
    setShowAddBoxConfirm(false);
    setShowCancelConfirm(false);
    setView("picking");

    // APC off → no shipment to create, no label to print. The picker
    // just scans items and presses Complete; the backend fulfils
    // Shopify without tracking and the existing fridge-decrement
    // logic runs as normal.
    if (!apcEnabled) {
      setCreatingShipment(false);
      setPrintStatus("done");
      return;
    }

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

      // Pre-queue AND background-print the next unfulfilled order's label.
      // Only in test mode — in live mode we must not create a real APC consignment
      // without the operator explicitly confirming the next order first.
      if (configStatus?.testMode) {
        const currentPos = unfulfilledOrders.findIndex(o => o.id === order.id);
        const nextOrder = unfulfilledOrders[currentPos + 1];
        if (nextOrder) preQueueNextOrder(nextOrder.id);
      }
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

  const ZONE_PICK_ORDER = ["fridge", "freezer", "ambient"];
  const sortedLineItems = activeOrder ? [...activeOrder.line_items].sort((a, b) => {
    const idxA = a.location ? ZONE_PICK_ORDER.indexOf(a.location.zone) : ZONE_PICK_ORDER.length;
    const idxB = b.location ? ZONE_PICK_ORDER.indexOf(b.location.zone) : ZONE_PICK_ORDER.length;
    // Within a zone, sort by SKU (natural/numeric) so the pick list matches
    // the kitchen's label numbering (1, 3c, 5b, 5c) instead of product-title
    // alphabetical order. Items with no SKU sort last.
    if (idxA !== idxB) return idxA - idxB;
    if (a.sku && !b.sku) return -1;
    if (!a.sku && b.sku) return 1;
    if (a.sku && b.sku) return a.sku.localeCompare(b.sku, undefined, { numeric: true });
    return a.title.localeCompare(b.title);
  }) : [];

  // Collapse multiple line items with the same SKU into one row so a packer
  // sees "Chicken & Chorizo ×2" instead of two identical rows. Quantity adds
  // up across the merged lines, and scans increment a per-row picked count
  // until the row is full.
  interface GroupedItem {
    _groupKey: string;
    title: string;
    variant_title: string | null;
    sku: string;
    totalQty: number;
    location: LineItem["location"];
    barcode: string | null;
    imageUrl: string | null;
    recipeColor: string | null;
  }
  const groupedItems: GroupedItem[] = [];
  {
    const map = new Map<string, GroupedItem>();
    for (const li of sortedLineItems) {
      const key = li.sku || `__nosku_${li.id}`;
      const existing = map.get(key);
      if (existing) {
        existing.totalQty += li.quantity;
      } else {
        const group: GroupedItem = {
          _groupKey: key,
          title: li.title,
          variant_title: li.variant_title,
          sku: li.sku,
          totalQty: li.quantity,
          location: li.location,
          barcode: li.barcode,
          imageUrl: li.imageUrl,
          recipeColor: li.recipeColor,
        };
        map.set(key, group);
        groupedItems.push(group);
      }
    }
  }

  const totalUnits = groupedItems.reduce((sum, g) => sum + g.totalQty, 0);
  const pickedUnits = groupedItems.reduce((sum, g) => sum + Math.min(pickedCounts.get(g._groupKey) ?? 0, g.totalQty), 0);
  const allChecked = totalUnits > 0 && pickedUnits >= totalUnits;

  function handleBarcodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input = barcodeInput.trim().toLowerCase();
    if (!input) return;

    // Only rows that still need picks — once a row is fully picked, scanning
    // its barcode again should be a no-match (flash red), not a silent ignore.
    const remaining = groupedItems.filter(g => (pickedCounts.get(g._groupKey) ?? 0) < g.totalQty);
    // Barcode is the primary match — scanners send a numeric GTIN/EAN that
    // never appears in SKU or title. Fall back to SKU and title so picking
    // still works when barcodes aren't synced or a packer types manually.
    const match =
      remaining.find(g => g.barcode && g.barcode.toLowerCase() === input) ??
      remaining.find(g =>
        g.sku?.toLowerCase() === input ||
        g.title?.toLowerCase().includes(input)
      );

    if (match) {
      playScanSuccess();

      setPickedCounts(prev => {
        const next = new Map(prev);
        const newCount = Math.min((prev.get(match._groupKey) ?? 0) + 1, match.totalQty);
        next.set(match._groupKey, newCount);
        // After update, scroll to the next row that still needs picks.
        setTimeout(() => {
          const nextRow = groupedItems.find(g => (next.get(g._groupKey) ?? 0) < g.totalQty);
          if (nextRow) {
            itemRefs.current.get(nextRow._groupKey)?.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, 100);
        return next;
      });
      setFlashItem(match._groupKey);
      setTimeout(() => setFlashItem(null), 800);
      setBarcodeInput("");
    } else {
      playScanWrong();
      setFlashWrong(true);
      setTimeout(() => setFlashWrong(false), 600);
      setBarcodeInput("");
    }
  }

  // Each tap adds one to that row, then wraps back to zero — same logic
  // as scanning so the colour stages (white → yellow → green) are identical
  // either way. Forces one explicit action per item the packer puts in
  // the bag, even on a 4-pack.
  function toggleItem(key: string, totalQty: number) {
    setPickedCounts(prev => {
      const next = new Map(prev);
      const current = prev.get(key) ?? 0;
      if (current >= totalQty) next.delete(key);
      else next.set(key, current + 1);
      return next;
    });
  }

  // Fires the actual Shopify fulfilment in the background and advances the
  // UI to the next order immediately — the packer never waits on Shopify
  // (which can take a couple of seconds per order). Failures are stashed
  // in completionFailures so the operator can review them at end-of-dispatch
  // via the alert badge near the top of the page. Two failure modes are
  // tracked separately:
  //   "fulfilment" → Shopify call rejected; nothing was deducted
  //   "decrement" → Shopify shipped + customer was emailed, but the local
  //                 stock decrement failed (rare; needs manual fix)
  function handleComplete() {
    if (!activeOrder) return;
    // With APC disabled there's no shipment object — fulfilment runs
    // without a tracking number. The barcode-driven decrement still
    // fires inside the backend complete handler.
    if (apcEnabled && !shipment) return;

    // Snapshot what we need for the background call before we move on.
    const snapshot = {
      orderId: activeOrder.id,
      orderName: activeOrder.name,
      customerName: activeOrder.shipping_address?.name
        ?? (`${activeOrder.customer?.first_name ?? ""} ${activeOrder.customer?.last_name ?? ""}`.trim() || "(no name)"),
      consignmentNumber: shipment?.consignmentNumber ?? null,
      trackingUrl: shipment?.trackingUrl,
    };

    // Optimistic UI: play sound, advance immediately. The actual Shopify
    // call happens in the background.
    setCompletionError(null);
    playOrderComplete();
    setView("confirm");
    setPendingCompletions(c => c + 1);

    completeOrder(snapshot.orderId, snapshot.consignmentNumber, snapshot.trackingUrl)
      .then((result) => {
        // Shopify shipped — refresh the orders list to drop this one.
        refetch();
        refetchProgress();
        // Decrement may still have failed silently — surface it.
        if (result.decrementError) {
          setCompletionFailures(prev => [...prev, {
            orderId: snapshot.orderId,
            orderName: snapshot.orderName,
            customerName: snapshot.customerName,
            error: result.decrementError ?? "decrement failed",
            kind: "decrement",
            at: new Date(),
          }]);
        }
      })
      .catch((err) => {
        // Shopify rejected the fulfilment. Stock was NOT decremented.
        setCompletionFailures(prev => [...prev, {
          orderId: snapshot.orderId,
          orderName: snapshot.orderName,
          customerName: snapshot.customerName,
          error: err?.message ?? String(err),
          kind: "fulfilment",
          at: new Date(),
        }]);
        // Make sure we still refetch so the failed order shows up unfulfilled
        // in the list — the packer can retry by selecting it again.
        refetch();
        refetchProgress();
      })
      .finally(() => {
        setPendingCompletions(c => Math.max(0, c - 1));
      });
  }

  function advanceToNext() {
    // Find next unfulfilled order that isn't the one just completed.
    // After refetch, the completed order is removed from the list, so we
    // pick the first remaining order.
    const remaining = unfulfilledOrders.filter(o => o.id !== activeOrder?.id);
    const nextOrder = remaining[0];
    if (nextOrder) {
      // Route through handleOrderSelect so that live-mode confirmation dialog
      // is shown before any real APC consignment is created.
      handleOrderSelect(nextOrder);
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

  const isConsignmentBusy = consignmentAction !== "idle";
  const [cancelSuccess, setCancelSuccess] = useState(false);

  function printAllLabels(pdfs: string[]) {
    if (pdfs.length === 0) return;
    setPrintStatus("printing");

    function printNext(index: number) {
      if (index >= pdfs.length) {
        setPrintStatus("done");
        return;
      }
      printLabel(
        pdfs[index],
        () => printNext(index + 1),
        () => setPrintStatus("failed"),
      );
    }

    printNext(0);
  }

  async function handleAddExtraBox() {
    if (!shipment) return;
    setShowAddBoxConfirm(false);
    setConsignmentAction("adding-box");
    setConsignmentActionError(null);
    try {
      const result = await addExtraBox(shipment.consignmentNumber);
      printAllLabels(result.labelPdfs);
      if (result.warnings && result.warnings.length > 0) {
        setShipment(prev => prev ? { ...prev, warnings: [...(prev.warnings ?? []), ...result.warnings!] } : prev);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setConsignmentActionError(`Add box failed: ${msg}`);
    } finally {
      setConsignmentAction("idle");
    }
  }

  async function handleReprintLabel() {
    if (!shipment) return;
    setConsignmentAction("reprinting");
    setConsignmentActionError(null);
    try {
      const result = await reprintLabel(shipment.consignmentNumber);
      printAllLabels(result.labelPdfs);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setConsignmentActionError(`Reprint failed: ${msg}`);
    } finally {
      setConsignmentAction("idle");
    }
  }

  async function handleCancelConsignment() {
    if (!shipment) return;
    setShowCancelConfirm(false);
    setConsignmentAction("cancelling");
    setConsignmentActionError(null);
    try {
      await cancelConsignment(shipment.consignmentNumber);
      setCancelSuccess(true);
      setTimeout(() => {
        setCancelSuccess(false);
        setShipment(null);
        setPrintStatus("idle");
        setActiveOrder(null);
        setView("list");
        refetch();
        refetchProgress();
      }, 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setConsignmentActionError(`Cancel failed: ${msg}`);
    } finally {
      setConsignmentAction("idle");
    }
  }

  // Once every line is scanned, finalise the order automatically so the
  // picker can keep scanning straight onto the next one. We wait for the
  // pre-queued APC shipment to be ready (or skip that check when APC is
  // disabled); `completing` prevents a re-entrant call while the request
  // is in flight.
  useEffect(() => {
    if (
      view === "picking" &&
      allChecked &&
      totalUnits > 0 &&
      !completing &&
      (!apcEnabled || shipment)
    ) {
      handleComplete();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allChecked, shipment, view]);

  // Auto-advance after the confirm celebration — kept short so the picker
  // flows straight into the next order without losing scanning rhythm.
  useEffect(() => {
    if (view !== "confirm") return;
    const timer = setTimeout(() => advanceToNext(), 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    if (view === "picking" && barcodeRef.current) {
      barcodeRef.current.focus();
    }
  }, [view]);

  // Speak the customer's shipping name when an order opens. Gated by
  // spokenOrderIdsRef so we say each order's name exactly once per page
  // load — no repeats if the picking view re-mounts for the same order.
  // Skipped entirely if the admin has muted speech in Settings.
  useEffect(() => {
    if (!speakNameEnabled) return;
    if (view !== "picking" || !activeOrder) return;
    if (spokenOrderIdsRef.current.has(activeOrder.id)) return;
    const name = activeOrder.shipping_address?.name
      ?? `${activeOrder.customer?.first_name ?? ""} ${activeOrder.customer?.last_name ?? ""}`.trim();
    if (!name) return;
    spokenOrderIdsRef.current.add(activeOrder.id);
    speakName(name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrder?.id, view, speakNameEnabled]);

  const apcEnabled = configStatus?.apcEnabled !== false;

  if (apcEnabled && !configStatusLoading && (!configStatus?.apcCredentialsConfigured || !configStatus?.serviceCodesConfigured)) {
    return (
      <div className="space-y-6">
        {configStatus?.testMode && <TestModeBanner trainingCredentialsMissing={configStatus?.trainingCredentialsMissing} />}
        <PageHeader title="Order Packing Live" description="APC order scanning and label printing." />
        <div className="glass-panel p-8 rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
          <div className="flex items-start gap-4">
            <AlertCircle className="w-8 h-8 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="space-y-3">
              <h3 className="font-semibold text-lg text-amber-900 dark:text-amber-200">Order Packing not configured</h3>
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

  if (cancelSuccess) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-card border border-green-200 dark:border-green-800 rounded-2xl shadow-2xl w-full max-w-sm p-8 text-center space-y-3">
          <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
          <h3 className="font-bold text-lg">Consignment Cancelled</h3>
          <p className="text-sm text-muted-foreground">The order has been returned to the unpacked queue.</p>
        </div>
      </div>
    );
  }

  if (view === "pre-confirm" && activeOrder && shipment) {
    const isTestMode = configStatus?.testMode ?? false;
    const customerEmail = activeOrder.customer?.email;
    const customerName = activeOrder.shipping_address?.name ?? `${activeOrder.customer?.first_name} ${activeOrder.customer?.last_name}`;
    return (
      <div className="space-y-4">
        <PageHeader title={activeOrder.name} description={customerName} />
        {isTestMode && <TestModeBanner trainingCredentialsMissing={configStatus?.trainingCredentialsMissing} />}

        <div className="flex items-center gap-3">
          <button onClick={() => setView("picking")} className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <p className="text-sm text-muted-foreground">{customerName}</p>
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
              <p className="text-sm text-muted-foreground">Review the details below, then confirm to complete the order.</p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Order</span>
              <span className="font-semibold">{activeOrder.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Customer</span>
              <span className="font-semibold">{customerName}</span>
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

          {/* Consequence warning — always shown, because Shopify fulfillment and email are always real */}
          <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm space-y-1.5">
            <p className="font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
              Confirming will:
            </p>
            <ul className="text-amber-800 dark:text-amber-300 space-y-1 pl-6 list-disc">
              <li>Mark order <strong>{activeOrder.name}</strong> as fulfilled on Shopify</li>
              <li>
                Send a dispatch notification email to{" "}
                {customerEmail
                  ? <strong className="font-mono">{customerEmail}</strong>
                  : <span className="italic text-amber-600">no email on file</span>
                }
              </li>
              {isTestMode && (
                <li className="text-amber-600 dark:text-amber-400 italic">APC consignment is test-only — not real</li>
              )}
            </ul>
          </div>

          <div className="flex items-center gap-2 flex-wrap border-t border-border pt-3">
            <button
              onClick={() => setShowAddBoxConfirm(true)}
              disabled={isConsignmentBusy || completing}
              className="flex items-center gap-1.5 text-xs px-3 py-2 border border-border rounded-lg hover:bg-secondary/50 transition-colors font-medium disabled:opacity-40"
            >
              {consignmentAction === "adding-box" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlusCircle className="w-3.5 h-3.5" />}
              Add Extra Box
            </button>
            <button
              onClick={handleReprintLabel}
              disabled={isConsignmentBusy || completing}
              className="flex items-center gap-1.5 text-xs px-3 py-2 border border-border rounded-lg hover:bg-secondary/50 transition-colors font-medium disabled:opacity-40"
            >
              {consignmentAction === "reprinting" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
              Reprint Label
            </button>
            <button
              onClick={() => setShowCancelConfirm(true)}
              disabled={isConsignmentBusy || completing}
              className="flex items-center gap-1.5 text-xs px-3 py-2 border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors font-medium disabled:opacity-40"
            >
              {consignmentAction === "cancelling" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
              Cancel Consignment
            </button>
          </div>

          {consignmentActionError && (
            <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{consignmentActionError}</span>
            </div>
          )}

          {completionError && (
            <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{completionError}</span>
            </div>
          )}

          <button
            onClick={handleComplete}
            disabled={completing || isConsignmentBusy}
            className="w-full py-4 bg-red-600 text-white rounded-xl font-bold text-xl hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-3"
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

        {showAddBoxConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
              <div className="flex items-start gap-3">
                <PlusCircle className="w-6 h-6 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-lg">Add an extra box?</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    This will add a second parcel to consignment <strong className="font-mono">{shipment.consignmentNumber}</strong> and reprint updated labels showing "1 of 2" and "2 of 2".
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowAddBoxConfirm(false)}
                  className="flex-1 py-2.5 border border-border rounded-xl text-sm font-medium hover:bg-secondary/50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddExtraBox}
                  className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}

        {showCancelConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
              <div className="flex items-start gap-3">
                <Ban className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-lg text-red-600 dark:text-red-400">Cancel this consignment?</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    This will cancel APC consignment <strong className="font-mono">{shipment.consignmentNumber}</strong>. The order will return to the unpacked queue.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowCancelConfirm(false)}
                  className="flex-1 py-2.5 border border-border rounded-xl text-sm font-medium hover:bg-secondary/50 transition-colors"
                >
                  Keep it
                </button>
                <button
                  onClick={handleCancelConsignment}
                  className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700 transition-colors"
                >
                  Cancel Consignment
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (view === "confirm" && activeOrder && shipment) {
    const hasNext = unfulfilledOrders.filter(o => o.id !== activeOrder.id).length > 0;
    const isTestMode = configStatus?.testMode ?? false;
    return (
      <div className="space-y-6">
        {pendingPickOrder && (
          <ShopifyConfirmDialog
            title={`Ship order ${pendingPickOrder.name}?`}
            description={`This will create a real APC consignment for ${pendingPickOrder.shipping_address?.name ?? `${pendingPickOrder.customer?.first_name ?? ""} ${pendingPickOrder.customer?.last_name ?? ""}`.trim()}. This cannot be undone.`}
            products={pendingPickOrder.line_items.map(li => ({ name: li.title, quantity: li.quantity, quantityLabel: "ordered", noPlus: true }))}
            confirmLabel="Start packing"
            onConfirm={() => { const o = pendingPickOrder; setPendingPickOrder(null); startPicking(o); }}
            onCancel={() => setPendingPickOrder(null)}
          />
        )}
        {isTestMode && <TestModeBanner trainingCredentialsMissing={configStatus?.trainingCredentialsMissing} />}
        <PageHeader title="Order Packing Live" description="APC order scanning and label printing." />
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
    const isTestMode = configStatus?.testMode ?? false;
    return (
      <div className="space-y-4">
        <PageHeader
          title={activeOrder.name}
          description={activeOrder.shipping_address?.name ?? `${activeOrder.customer?.first_name} ${activeOrder.customer?.last_name}`}
        />
        {pendingPickOrder && (
          <ShopifyConfirmDialog
            title={`Ship order ${pendingPickOrder.name}?`}
            description={`This will create a real APC consignment for ${pendingPickOrder.shipping_address?.name ?? `${pendingPickOrder.customer?.first_name ?? ""} ${pendingPickOrder.customer?.last_name ?? ""}`.trim()}. This cannot be undone.`}
            products={pendingPickOrder.line_items.map(li => ({ name: li.title, quantity: li.quantity, quantityLabel: "×" }))}
            confirmLabel="Start packing"
            onConfirm={() => { const o = pendingPickOrder; setPendingPickOrder(null); startPicking(o); }}
            onCancel={() => setPendingPickOrder(null)}
          />
        )}
        {isTestMode && <TestModeBanner trainingCredentialsMissing={configStatus?.trainingCredentialsMissing} />}
        <div className="flex items-center gap-3">
          <button onClick={goBack} className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1" />
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
              <div className="flex flex-col items-end gap-1">
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
                  <button
                    onClick={() => setPrintStatus("done")}
                    className="text-xs px-2 py-1 bg-secondary hover:bg-secondary/80 rounded-lg flex items-center gap-1 transition-colors"
                    title="Manually mark as printed if the label came out correctly"
                  >
                    Mark printed
                  </button>
                </div>
                <a href="/settings" className="text-xs text-muted-foreground underline hover:text-foreground transition-colors">Check printer setup</a>
              </div>
            )}
            {printStatus === "failed" && !shipment && (
              <span className="flex items-center gap-1.5 text-xs text-destructive">
                <XCircle className="w-4 h-4" /> Print failed
              </span>
            )}
          </div>
        </div>

        {/* Customer name banner — sized so a packer can read it from 8 yards across the kitchen. */}
        <div className="px-1">
          <p className="text-5xl md:text-7xl lg:text-8xl font-extrabold leading-none tracking-tight break-words">
            {activeOrder.shipping_address?.name ?? `${activeOrder.customer?.first_name} ${activeOrder.customer?.last_name}`}
          </p>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mt-2">
            {activeOrder.shipping_address && (
              <p className="text-lg md:text-2xl text-muted-foreground">
                {activeOrder.shipping_address.city}, {activeOrder.shipping_address.zip}
              </p>
            )}
            <p className="text-xl md:text-3xl font-bold">
              <span className="text-primary">{totalUnits}</span>
              <span className="text-muted-foreground ml-2 font-semibold">item{totalUnits === 1 ? "" : "s"} to pack</span>
            </p>
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

        {shipment?.warnings && shipment.warnings.length > 0 && (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-amber-800 dark:text-amber-300 text-xs mb-1">APC Warnings</p>
              {shipment.warnings.map((w, i) => (
                <p key={i} className="text-amber-700 dark:text-amber-400 text-xs">{w}</p>
              ))}
            </div>
          </div>
        )}

        {shipment && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowAddBoxConfirm(true)}
              disabled={isConsignmentBusy}
              className="flex items-center gap-1.5 text-xs px-3 py-2 border border-border rounded-lg hover:bg-secondary/50 transition-colors font-medium disabled:opacity-40"
            >
              {consignmentAction === "adding-box" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlusCircle className="w-3.5 h-3.5" />}
              Add Extra Box
            </button>
            <button
              onClick={handleReprintLabel}
              disabled={isConsignmentBusy}
              className="flex items-center gap-1.5 text-xs px-3 py-2 border border-border rounded-lg hover:bg-secondary/50 transition-colors font-medium disabled:opacity-40"
            >
              {consignmentAction === "reprinting" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
              Reprint Label
            </button>
            <button
              onClick={() => setShowCancelConfirm(true)}
              disabled={isConsignmentBusy}
              className="flex items-center gap-1.5 text-xs px-3 py-2 border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors font-medium disabled:opacity-40"
            >
              {consignmentAction === "cancelling" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
              Cancel Consignment
            </button>
          </div>
        )}

        {consignmentActionError && (
          <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-xl px-4 py-3">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{consignmentActionError}</span>
          </div>
        )}

        {showAddBoxConfirm && shipment && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
              <div className="flex items-start gap-3">
                <PlusCircle className="w-6 h-6 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-lg">Add an extra box?</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    This will add a second parcel to consignment <strong className="font-mono">{shipment.consignmentNumber}</strong> and reprint updated labels showing "1 of 2" and "2 of 2".
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowAddBoxConfirm(false)}
                  className="flex-1 py-2.5 border border-border rounded-xl text-sm font-medium hover:bg-secondary/50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddExtraBox}
                  className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}

        {showCancelConfirm && shipment && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
              <div className="flex items-start gap-3">
                <Ban className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-lg text-red-600 dark:text-red-400">Cancel this consignment?</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    This will cancel APC consignment <strong className="font-mono">{shipment.consignmentNumber}</strong>. The order will return to the unpacked queue.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowCancelConfirm(false)}
                  className="flex-1 py-2.5 border border-border rounded-xl text-sm font-medium hover:bg-secondary/50 transition-colors"
                >
                  Keep it
                </button>
                <button
                  onClick={handleCancelConsignment}
                  className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700 transition-colors"
                >
                  Cancel Consignment
                </button>
              </div>
            </div>
          </div>
        )}

        {creatingShipment && !shipmentError && (
          <div className="flex items-center justify-center py-8 gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Creating APC shipment — please wait before scanning…</span>
          </div>
        )}

        <form onSubmit={handleBarcodeSubmit} hidden={creatingShipment || !!shipmentError}>
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

        <div className="space-y-2" hidden={creatingShipment || !!shipmentError}>
          <div className="flex items-center gap-3 text-xs text-muted-foreground px-1 mb-1">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-400 inline-block" /> Fridge</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-purple-400 inline-block" /> Freezer</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-400 inline-block" /> Ambient</span>
            <span className="ml-auto font-medium text-foreground">
              {pickedUnits} / {totalUnits} picked
            </span>
          </div>

          {groupedItems.map((item) => {
            const picked = Math.min(pickedCounts.get(item._groupKey) ?? 0, item.totalQty);
            const isComplete = picked >= item.totalQty;
            const isPartial = picked > 0 && !isComplete;
            const zone = item.location?.zone ?? null;
            const style = zone ? ZONE_STYLES[zone] : null;
            const isFlashing = flashItem === item._groupKey;

            const rowClasses = isComplete
              ? "bg-green-100 dark:bg-green-950/40 border-green-400 dark:border-green-700"
              : isPartial
                ? "bg-yellow-100 dark:bg-yellow-950/40 border-yellow-400 dark:border-yellow-600"
                : style
                  ? `${style.bg} ${style.border}`
                  : "bg-card border-border";

            return (
              <button
                key={item._groupKey}
                ref={el => {
                  if (el) itemRefs.current.set(item._groupKey, el);
                  else itemRefs.current.delete(item._groupKey);
                }}
                onClick={manualTickEnabled ? () => toggleItem(item._groupKey, item.totalQty) : undefined}
                disabled={!manualTickEnabled}
                title={manualTickEnabled ? undefined : "Manual tap-to-pick is disabled — scan the barcode to mark this item picked."}
                className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all ${rowClasses}
                  ${isFlashing ? "ring-4 ring-green-500 ring-offset-1" : ""}
                  ${manualTickEnabled ? "cursor-pointer" : "cursor-default"}
                `}
              >
                <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors
                  ${isComplete ? "border-green-500 bg-green-500" : isPartial ? "border-yellow-500 bg-yellow-500" : "border-border"}`}
                >
                  {isComplete
                    ? <CheckCircle2 className="w-7 h-7 text-white" />
                    : isPartial
                      ? <span className="text-white font-bold text-base">{picked}</span>
                      : null}
                </div>
                {item.imageUrl && (
                  <img
                    src={item.imageUrl}
                    alt=""
                    className={`w-16 h-16 md:w-20 md:h-20 rounded-lg object-cover flex-shrink-0 bg-secondary ${isComplete ? "opacity-50" : ""}`}
                    loading="lazy"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p
                    className={`font-bold text-2xl md:text-3xl leading-tight ${isComplete ? "line-through text-muted-foreground" : ""}`}
                    style={!isComplete && item.recipeColor ? { color: item.recipeColor } : undefined}
                  >
                    {item.title}
                    {item.variant_title && (
                      <span className="font-semibold text-xl md:text-2xl text-muted-foreground ml-2">— {item.variant_title}</span>
                    )}
                  </p>
                  {item.sku && (
                    <p className="text-sm font-mono text-muted-foreground mt-1">{item.sku}</p>
                  )}
                </div>
                {item.totalQty > 1 && (
                  <div
                    className="px-3 py-1 rounded-lg text-2xl md:text-3xl font-extrabold flex-shrink-0 bg-orange-500 text-white"
                    aria-label={`Quantity ${item.totalQty}, ${picked} picked`}
                  >
                    {isPartial ? `${picked}/${item.totalQty}` : `×${item.totalQty}`}
                  </div>
                )}
                {item.location ? (
                  <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium flex-shrink-0 ${style?.badge}`}>
                    <MapPin className="w-3 h-3" />
                    {item.location.locationLabel}
                  </div>
                ) : !item.sku ? (
                  <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300 flex-shrink-0" title="This line item has no SKU — cannot look up bin location">
                    <AlertCircle className="w-3 h-3" />
                    No SKU
                  </div>
                ) : (
                  <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300 flex-shrink-0" title="SKU exists but no bin location has been assigned">
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
            onClick={() => handleComplete()}
            disabled={!allChecked || (apcEnabled && !shipment) || completing}
            className="flex-1 py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-lg hover:bg-primary/90 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {allChecked ? (
              <><CheckCircle2 className="w-5 h-5" /> {completing ? "Completing…" : "Complete"}</>
            ) : (
              `${totalUnits - pickedUnits} items remaining`
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
    const isTestMode = configStatus?.testMode ?? false;
    return (
      <div className="space-y-6">
        {isTestMode && <TestModeBanner trainingCredentialsMissing={configStatus?.trainingCredentialsMissing} />}
        <PageHeader
          title="Order Packing Live"
          description="Select a dispatch date to start picking."
          action={
            <button
              onClick={() => { tagsRefresh.triggerSpin(); refetchTags(); }}
              disabled={tagsLoading}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${tagsLoading || tagsRefresh.spinning ? "animate-spin" : ""}`} />
            </button>
          }
        />

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
                      <span className="flex items-center gap-1"><Package className="w-3.5 h-3.5" /> {group.orderCount} unfulfilled</span>
                      <span>{group.totalItems} items</span>
                      <span>{weightKg} kg</span>
                      {group.postcodeIssues > 0 && (
                        <span className="flex items-center gap-1 text-red-600 dark:text-red-400 font-medium">
                          <ShieldAlert className="w-3.5 h-3.5" />
                          {group.postcodeIssues} postcode {group.postcodeIssues === 1 ? "issue" : "issues"}
                        </span>
                      )}
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

        {/* APC Service Check — validates postcodes against the correct service
            code for the delivery date, using the codes configured in Settings. */}
        <details className="text-sm">
          <summary className="cursor-pointer font-medium text-foreground hover:text-primary transition-colors select-none">
            APC Service Check
          </summary>
          <div className="mt-4 space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Checks every order for this delivery date against APC&rsquo;s production postcode database.
              The correct service code is selected automatically per order from your Settings
              (based on box size and delivery day).
            </p>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-xs font-medium mb-1 block text-muted-foreground">Delivery date tag</label>
                <input
                  type="date"
                  value={weekendCheckTag}
                  onChange={e => { setWeekendCheckTag(e.target.value); setWeekendCheckResults(null); }}
                  className="px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <button
                onClick={runWeekendCheck}
                disabled={weekendCheckLoading || !weekendCheckTag}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {weekendCheckLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldAlert className="w-4 h-4" />}
                Run Check
              </button>
            </div>

            {weekendCheckError && (
              <div className="flex items-center gap-3 p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {weekendCheckError}
              </div>
            )}

            {weekendCheckResults && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-3 text-sm">
                  <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 font-medium">
                    {weekendCheckResults.summary.available} available
                  </span>
                  <span className="px-3 py-1 rounded-full bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 font-medium">
                    {weekendCheckResults.summary.unavailable} unavailable
                  </span>
                  <span className="px-3 py-1 rounded-full bg-secondary text-muted-foreground font-medium">
                    {weekendCheckResults.summary.total} total
                  </span>
                </div>

                {weekendCheckResults.results.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No unfulfilled orders found for this tag.</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-secondary/50 text-left">
                          <th className="px-4 py-2.5 font-semibold text-muted-foreground">Order</th>
                          <th className="px-4 py-2.5 font-semibold text-muted-foreground">Customer</th>
                          <th className="px-4 py-2.5 font-semibold text-muted-foreground">Postcode</th>
                          <th className="px-4 py-2.5 font-semibold text-muted-foreground">Service</th>
                          <th className="px-4 py-2.5 font-semibold text-muted-foreground">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {weekendCheckResults.results.map((row, i) => (
                          <tr key={i} className={row.available ? "" : "bg-red-50/40 dark:bg-red-950/10"}>
                            <td className="px-4 py-2.5 font-mono font-medium">{row.orderName}</td>
                            <td className="px-4 py-2.5 text-muted-foreground">{row.customerName}</td>
                            <td className="px-4 py-2.5 font-mono">{row.postcode || <span className="text-muted-foreground italic">none</span>}</td>
                            <td className="px-4 py-2.5 font-mono text-muted-foreground">{row.serviceCode ?? "—"}</td>
                            <td className="px-4 py-2.5">
                              {row.available ? (
                                <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium">
                                  <CheckCircle2 className="w-4 h-4" /> Available
                                </span>
                              ) : (
                                <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400 font-medium">
                                  <XCircle className="w-4 h-4" />
                                  <span>Unavailable{row.reason ? ` — ${row.reason}` : ""}</span>
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </details>

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

  const isTestMode = configStatus?.testMode ?? false;

  return (
    <div className="space-y-6">
      {isTestMode && <TestModeBanner trainingCredentialsMissing={configStatus?.trainingCredentialsMissing} />}

      {/* Live-mode confirmation dialog — appears when operator selects an order */}
      {pendingPickOrder && (
        <ShopifyConfirmDialog
          title={`Ship order ${pendingPickOrder.name}?`}
          description={`This will create a real APC consignment for ${pendingPickOrder.shipping_address?.name ?? `${pendingPickOrder.customer?.first_name ?? ""} ${pendingPickOrder.customer?.last_name ?? ""}`.trim()}. This cannot be undone.`}
          products={pendingPickOrder.line_items.map(li => ({ name: li.title, quantity: li.quantity, quantityLabel: "ordered", noPlus: true }))}
          confirmLabel="Start packing"
          onConfirm={() => { const o = pendingPickOrder; setPendingPickOrder(null); startPicking(o); }}
          onCancel={() => setPendingPickOrder(null)}
        />
      )}

      <PageHeader
        title="Order Packing Live"
        description={(() => {
          try {
            const packingDay = format(addDays(parseISO(queryTag), -1), "EEEE d MMM");
            const deliveryDay = format(parseISO(queryTag), "EEEE d MMM");
            return `Packing ${packingDay} · Delivery ${deliveryDay}`;
          } catch (err) {
            console.warn("[Fulfilment] Date parse failed:", err);
            return `Orders tagged ${queryTag}`;
          }
        })()}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => { ordersRefresh.triggerSpin(); refetch(); }}
              disabled={isLoading}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading || ordersRefresh.spinning ? "animate-spin" : ""}`} />
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
        }
      />

      <div className="flex items-center gap-3">
        <button onClick={() => {
          if (urlTag) {
            navigate("/dispatches");
          } else {
            setView("dates");
          }
        }} className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5" />
          <span className="sr-only">Back</span>
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm">{(error as Error).message}</p>
        </div>
      )}

      {/* Background completion status — packer can keep scanning while
          previous orders finish fulfilling. Failures persist here until
          the packer reviews them. */}
      {(pendingCompletions > 0 || completionFailures.length > 0) && (
        <div className="flex items-center gap-3 flex-wrap">
          {pendingCompletions > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-secondary/40 border border-border rounded-lg text-sm">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">Fulfilling {pendingCompletions} order{pendingCompletions === 1 ? "" : "s"} in background…</span>
            </div>
          )}
          {completionFailures.length > 0 && (
            <button
              onClick={() => setShowFailuresModal(true)}
              className="flex items-center gap-2 px-3 py-2 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive hover:bg-destructive/20 font-medium"
            >
              <AlertCircle className="w-4 h-4" />
              {completionFailures.length} order{completionFailures.length === 1 ? "" : "s"} failed — review
            </button>
          )}
          <button
            onClick={() => setShowAuditModal(true)}
            className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm text-muted-foreground hover:bg-secondary/50 ml-auto"
          >
            Run end-of-dispatch audit
          </button>
        </div>
      )}
      {pendingCompletions === 0 && completionFailures.length === 0 && (
        <div className="flex justify-end">
          <button
            onClick={() => setShowAuditModal(true)}
            className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm text-muted-foreground hover:bg-secondary/50"
          >
            Run end-of-dispatch audit
          </button>
        </div>
      )}

      {showFailuresModal && (
        <FailuresModal
          failures={completionFailures}
          onDismiss={(orderId) => setCompletionFailures(prev => prev.filter(f => f.orderId !== orderId))}
          onClose={() => setShowFailuresModal(false)}
        />
      )}
      {showAuditModal && (
        <AuditModal tag={queryTag} onClose={() => setShowAuditModal(false)} />
      )}

      {progress && (
        <DispatchProgressHeader progress={progress} />
      )}

      {orders && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {unfulfilledOrders.length} ready to pack &middot; {untaggedOrders.length} awaiting approval &middot; {progress ? progress.totalFulfilled : fulfilledOrders.length} fulfilled
          </p>

          <div className="flex gap-2 flex-wrap">
            {([
              { key: "small box" as const, label: "Small Box", color: "bg-blue-500" },
              { key: "large box" as const, label: "Large Box", color: "bg-indigo-500" },
              { key: "wholesale" as const, label: "Wholesale", color: "bg-amber-500" },
              { key: "all" as const, label: "All Orders", color: "bg-gray-500" },
            ] as const).map(tab => {
              const count = tab.key === "all" ? allUnfulfilledOrders.length : boxCounts[tab.key];
              if (tab.key !== "all" && count === 0) return null;
              const active = boxFilter === tab.key;
              const tagged = tab.key === "all" ? unfulfilledOrders.length : taggedCounts[tab.key];
              return (
                <button
                  key={tab.key}
                  onClick={() => setBoxFilter(tab.key)}
                  className={cn(
                    "px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  {tab.label}
                  <span className={cn(
                    "text-xs px-1.5 py-0.5 rounded-full tabular-nums",
                    active ? "bg-primary-foreground/20" : "bg-secondary"
                  )}>{tagged}/{count}</span>
                </button>
              );
            })}
          </div>

          {filteredUntagged.length > 0 && (
            <div className="glass-panel p-4 rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-amber-600" />
                  <span className="font-semibold text-sm text-amber-900 dark:text-amber-200">
                    {filteredUntagged.length} {boxFilter === "all" ? "" : boxFilter + " "}{filteredUntagged.length === 1 ? "order" : "orders"} awaiting approval
                  </span>
                </div>
                <button
                  onClick={() => setShowBulkTagConfirm(true)}
                  disabled={bulkTagging}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-xl text-sm font-semibold hover:bg-amber-700 transition-colors disabled:opacity-50"
                >
                  {bulkTagging ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Tagging…</>
                  ) : (
                    <><Tag className="w-4 h-4" /> Tag {boxFilter === "all" ? "All" : boxFilter === "small box" ? "Small Box" : boxFilter === "large box" ? "Large Box" : boxFilter === "wholesale" ? "Wholesale" : "Other"} Orders for Dispatch</>
                  )}
                </button>
                {showBulkTagConfirm && (
                  <ShopifyConfirmDialog
                    title="Tag orders for dispatch?"
                    description={`This will tag ${filteredUntagged.length} order${filteredUntagged.length === 1 ? "" : "s"} on Shopify as ready to dispatch. This cannot be undone.`}
                    products={filteredUntagged.slice(0, 10).map(o => ({
                      name: `${o.name} — ${o.shipping_address?.name ?? `${o.customer?.first_name ?? ""} ${o.customer?.last_name ?? ""}`.trim()}`,
                    }))}
                    confirmLabel="Tag All for Dispatch"
                    onConfirm={async () => {
                      setShowBulkTagConfirm(false);
                      setBulkTagging(true);
                      try {
                        await bulkTagDispatch(queryTag, boxFilter);
                        refetch();
                        refetchProgress();
                        refetchTags();
                        refetchPostcodes();
                      } catch (err) {
                        console.warn("[Fulfilment] Bulk tag dispatch failed:", err);
                        toast({ title: "Bulk tagging failed", description: "Please try again.", variant: "destructive" });
                      } finally {
                        setBulkTagging(false);
                      }
                    }}
                    onCancel={() => setShowBulkTagConfirm(false)}
                  />
                )}
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {filteredUntagged.map(order => (
                  <div key={order.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-amber-100/50 dark:bg-amber-900/20 text-sm">
                    <span className="font-mono font-bold text-amber-900 dark:text-amber-200">{order.name}</span>
                    <span className="text-amber-700 dark:text-amber-400 truncate flex-1">
                      {order.shipping_address?.name ?? `${order.customer?.first_name} ${order.customer?.last_name}`}
                    </span>
                    <span className="text-xs text-amber-600 dark:text-amber-500">{order.line_items.reduce((s, i) => s + i.quantity, 0)} items</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {filteredUnfulfilled.length === 0 && filteredUntagged.length === 0 && allUnfulfilledOrders.length === 0 && (
            <div className="glass-panel p-10 rounded-2xl border border-border text-center text-muted-foreground">
              <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-500 opacity-60" />
              <p className="font-medium">All orders fulfilled!</p>
              <p className="text-sm mt-1">Nothing left to dispatch for this date.</p>
            </div>
          )}

          {filteredUnfulfilled.length === 0 && filteredUntagged.length === 0 && allUnfulfilledOrders.length > 0 && (
            <div className="glass-panel p-8 rounded-2xl border border-border text-center text-muted-foreground">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-green-500 opacity-60" />
              <p className="font-medium">All {boxFilter} orders done!</p>
              <p className="text-sm mt-1">Switch to another category to continue packing.</p>
            </div>
          )}

          {filteredUnfulfilled.length > 0 && (
            <div className="glass-panel p-4 rounded-2xl border border-primary/30 bg-primary/5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Scan className="w-5 h-5 text-primary" />
                <div>
                  <p className="font-semibold text-sm">Scan to pack</p>
                  <p className="text-xs text-muted-foreground">
                    Walk through {filteredUnfulfilled.length} {boxFilter === "all" ? "" : boxFilter + " "}order{filteredUnfulfilled.length === 1 ? "" : "s"} one-by-one. Scan each item; orders auto-fulfil when complete.
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  const params = new URLSearchParams({ tag: queryTag });
                  if (boxFilter !== "all") params.set("category", boxFilter);
                  navigate(`/fulfilment/pack?${params}`);
                }}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors flex items-center gap-2 flex-shrink-0"
              >
                <Scan className="w-4 h-4" /> Start Packing Cycle
              </button>
            </div>
          )}

          {filteredUnfulfilled.length > 0 && (
            <div className="space-y-1 mb-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">Ready to Pack</p>
            </div>
          )}

          {filteredUnfulfilled.map((order, idx) => {
            const hasUnassigned = order.line_items.some(i => !i.location && i.sku);
            const weightKg = ((order.total_weight ?? 0) / 1000).toFixed(2);
            const tags = order.tags.split(",").map(t => t.trim()).filter(Boolean);
            const postcodeIssue = postcodeIssueMap.get(order.id);
            const isBlocked = !!postcodeIssue;

            return (
              <div
                key={order.id}
                className={cn(
                  "glass-panel p-5 rounded-2xl border flex items-center gap-4 transition-colors group",
                  isBlocked
                    ? "border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-950/10"
                    : "border-border hover:border-primary/30"
                )}
              >
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0",
                  isBlocked ? "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400" : "bg-secondary text-muted-foreground"
                )}>
                  {isBlocked ? <ShieldAlert className="w-4 h-4" /> : idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-lg">{order.name}</span>
                    {hasUnassigned && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300 font-medium">
                        Unassigned SKUs
                      </span>
                    )}
                    {isBlocked && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 font-medium">
                        Postcode Issue
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">
                    {order.shipping_address?.name ?? `${order.customer?.first_name} ${order.customer?.last_name}`}
                    {order.shipping_address && ` — ${order.shipping_address.city}, ${order.shipping_address.zip}`}
                  </p>
                  {isBlocked && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {postcodeIssue.reason ?? "Service not available for this postcode"} (Service: {postcodeIssue.service_code})
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                    <span>{order.line_items.reduce((s, i) => s + i.quantity, 0)} items</span>
                    <span>{weightKg} kg</span>
                    {tags.slice(0, 4).map(t => (
                      <span key={t} className="px-1.5 py-0.5 rounded bg-secondary/60 font-mono">{t}</span>
                    ))}
                  </div>
                </div>
                {isBlocked ? (
                  <button
                    onClick={async () => {
                      setRecheckingId(order.id);
                      try {
                        await recheckPostcode(order.id, queryTag);
                        refetchPostcodes();
                      } catch (err) {
                        console.warn("[Fulfilment] Postcode recheck failed:", err);
                        toast({ title: "Recheck failed", description: "Could not recheck postcode. Please try again.", variant: "destructive" });
                      } finally {
                        setRecheckingId(null);
                      }
                    }}
                    disabled={recheckingId === order.id}
                    className="flex items-center gap-2 px-4 py-2.5 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 rounded-xl text-sm font-semibold hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors flex-shrink-0 disabled:opacity-50"
                  >
                    {recheckingId === order.id ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Checking…</>
                    ) : (
                      <><RefreshCw className="w-4 h-4" /> Re-check</>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={() => handleOrderSelect(order)}
                    className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-semibold hover:bg-primary/90 transition-colors flex-shrink-0"
                  >
                    <Scan className="w-4 h-4" /> Start Picking
                    <ChevronRight className="w-4 h-4" />
                  </button>
                )}
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
