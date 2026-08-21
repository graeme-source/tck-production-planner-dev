import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { IcePackBadge, IcePackBanner } from "@/components/ice-pack-callout";
import { useIcePacks } from "@/hooks/use-ice-packs";
import { useRefreshSpin } from "@/hooks/use-refresh-spin";
import { ShopifyConfirmDialog } from "@/components/shopify-confirm-dialog";
import { ApcBatchBookingDialog } from "@/components/apc-batch-booking";
import { RescheduleOrderDialog } from "@/components/reschedule-order-dialog";
import { useAuth } from "@/contexts/auth-context";
import { format, addDays, parseISO } from "date-fns";
import { useLocation } from "wouter";
import {
  Package, Scan, CheckCircle2, AlertCircle, ChevronRight, Printer,
  RefreshCw, MapPin, SkipForward, RotateCcw, XCircle, Loader2,
  ArrowLeft, Truck, Tag, ShieldAlert, PlusCircle, Ban, X, Filter, ArrowUpDown,
  Volume2, VolumeX, AlertTriangle, PackageCheck, Snowflake, CalendarClock,
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
  variant_id: number | null;
  sku: string;
  location: SkuLocation | null;
  barcode: string | null;
  imageUrl: string | null;
  recipeColor: string | null;
}

type BoxCategory = "small box" | "large box" | "wholesale" | "local delivery" | "other";

/** Orders tagged local-delivery go on the van, not APC — no consignment to
 *  book or look up, no label to print or verify. The tag is put on the order
 *  in Shopify when the local delivery is arranged. */
const LOCAL_DELIVERY_TAG = "local-delivery";
function isLocalDelivery(order: { tags: string }): boolean {
  return order.tags.split(",").map(t => t.trim().toLowerCase()).includes(LOCAL_DELIVERY_TAG);
}

/** A row of tri-state filter chips. Green = include, red = exclude, plain =
 *  ignored. Used for both order tags and products so the two behave identically. */
function FilterChipRow({ label, items, include, exclude, onToggle, emptyText }: {
  label: string;
  items: { key: string; label: string }[];
  include: Set<string>;
  exclude: Set<string>;
  onToggle: (key: string) => void;
  emptyText: string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">{emptyText}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map(({ key, label: text }) => {
            const inc = include.has(key);
            const exc = exclude.has(key);
            return (
              <button
                key={key}
                onClick={() => onToggle(key)}
                title={inc ? "Included — tap to exclude" : exc ? "Excluded — tap to clear" : "Tap to include"}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-xs font-medium border transition-all max-w-[240px] truncate",
                  inc && "bg-emerald-100 dark:bg-emerald-900/40 border-emerald-400 text-emerald-800 dark:text-emerald-200",
                  exc && "bg-red-100 dark:bg-red-900/40 border-red-400 text-red-800 dark:text-red-200 line-through",
                  !inc && !exc && "bg-secondary/60 border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                {inc && "+ "}{exc && "− "}{text}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The box-category tags, kept out of the generic tag chips so they aren't
 *  offered twice (they already have their own multi-select row). */
const BOX_CATEGORIES: string[] = ["small box", "large box", "wholesale", LOCAL_DELIVERY_TAG];

/** Cycle a chip through untouched → include → exclude → untouched, keeping the
 *  two sets mutually exclusive so a tag can never be both. */
function cycleChip(
  key: string,
  include: Set<string>,
  exclude: Set<string>,
  setInclude: (s: Set<string>) => void,
  setExclude: (s: Set<string>) => void,
) {
  const inc = new Set(include);
  const exc = new Set(exclude);
  if (inc.has(key)) {            // included → excluded
    inc.delete(key);
    exc.add(key);
  } else if (exc.has(key)) {     // excluded → untouched
    exc.delete(key);
  } else {                       // untouched → included
    inc.add(key);
  }
  setInclude(inc);
  setExclude(exc);
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
  /** Number of parcels on the consignment, so every piece gets printed. The
   *  label bytes are NOT carried here — they are fetched live from the label
   *  route at the moment each piece prints, so an amended consignment can
   *  never print from a payload captured when the order was opened. */
  pieceCount?: number;
  trackingUrl?: string;
  serviceCode: string;
  orderId: number;
  orderName: string;
  warnings?: string[];
  /** True when the server returned a consignment that already existed for
   *  this order rather than booking a second one. */
  reused?: boolean;
}

/** Same-origin URL for one piece's label, fetched live from APC on every hit.
 *
 *  Same-origin is the whole point: the old path built a `blob:` URL, and the
 *  app's CSP (frame-src 'self' + youtube/vimeo) blocks blob: frames outright,
 *  so the label never reached the print frame. `'self'` covers this URL.
 *
 *  The cache-buster is belt-and-braces on top of the route's no-store: after a
 *  consignment is amended at the bench the reprint must show the NEW label,
 *  and a stale one would go on a real box. */
function labelUrl(waybill: string, piece: number): string {
  // print=1 tells the server this fetch feeds a PHYSICAL print, so APC gets
  // the consignment marked printed — which is what puts it on the manifest
  // and the depot's radar. A label fetched without it (opening the URL in a
  // tab to check it) marks nothing. See the label route for the full story.
  return `${BASE}/api/fulfilment/shipments/${encodeURIComponent(waybill)}/label.pdf?piece=${piece}&print=1&t=${Date.now()}`;
}

/** Result of scanning the printed APC label at the bench. The verdict is
 *  decided server-side by /verify-label-scan — the browser never gets to
 *  decide that a label belongs to an order. */
interface LabelVerifyResult {
  verified: boolean;
  consignmentNumber?: string;
  trackingUrl?: string;
  reference?: string;
  consigneeName?: string;
  consigneePostcode?: string;
  parcel?: string | null;
  problem?: "too-short" | "unrecognised-length" | "empty" | "wrong-order" | "already-used" | "no-consignment";
  message?: string;
  scannedCore?: string;
  expectedCore?: string;
}

/** The hand-raised consignment we expect for an order, fetched when the order
 *  is opened so the waybill is in hand before anyone packs. */
interface ExpectedConsignment {
  waybill: string;
  expectedCore: string | null;
  reference: string | null;
  consigneeName: string | null;
  consigneeCompany: string | null;
  consigneePostcode: string | null;
  productCode: string | null;
  trackingUrl: string;
}

type ApcMode = "off" | "reconcile" | "full";

interface ConfigStatus {
  apcEnabled: boolean;
  apcMode?: ApcMode;
  apcCredentialsConfigured: boolean;
  serviceCodesConfigured: boolean;
  /** False = batch-book only: opening an order fetches an existing label but
   *  never creates a consignment. */
  bookOnOpen?: boolean;
  testMode: boolean;
  /** True when test mode is on but the APC training credentials are not configured. */
  trainingCredentialsMissing: boolean;
  /** Prefix for Shopify admin order links — append the order id. Sent once
   *  rather than per order, because a wave is several hundred rows. */
  shopifyAdminOrderBase?: string;
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

// Bright two-note rising chime (A5 → E6) with a long tail — loud and long
// enough to register over kitchen noise, but short enough not to drag when
// scanning several items back-to-back. Was a single quiet 0.15s blip that was
// easy to miss on the packing floor.
function playScanSuccess() {
  try {
    const ctx = new AudioContext();
    playTone({ ctx, frequency: 880, duration: 0.3, type: "sine", gain: 0.45 });
    playTone({ ctx, frequency: 1318.51, duration: 0.5, type: "sine", gain: 0.45, startAt: 0.11 });
    setTimeout(() => ctx.close(), 800);
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

// Order-complete fanfare: rising arpeggio (C5 → E5 → G5 → C6) landing on a
// held C-major chord (~1.6s total). Much longer and fuller than the two-note
// scan chime, so "item picked" and "order done" are unmistakable across the
// kitchen even without looking at the screen.
function playOrderComplete() {
  try {
    const ctx = new AudioContext();
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, i) => {
      playTone({ ctx, frequency: freq, duration: 0.26, type: "triangle", gain: 0.5, startAt: i * 0.14 });
    });
    // Held closing chord (C6 + E6 + G6) — the "ta-daa" that makes completion
    // obviously different from a scan.
    [1046.50, 1318.51, 1567.98].forEach(freq => {
      playTone({ ctx, frequency: freq, duration: 1.0, type: "triangle", gain: 0.35, startAt: 0.56 });
    });
    setTimeout(() => ctx.close(), 2000);
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

/** Reconcile mode: fetch the hand-raised APC consignment for an order, keyed on
 *  the Shopify order name (which is what the manual upload puts in APC's
 *  Reference field — including the leading "#"). Returns null when APC has no
 *  consignment for it, which must block packing rather than pass silently. */
async function fetchExpectedConsignment(orderName: string): Promise<ExpectedConsignment | null> {
  const res = await fetch(
    `${BASE}/api/fulfilment/consignment-for-order?orderName=${encodeURIComponent(orderName)}`,
    { credentials: "include" },
  );
  if (res.status === 404) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to look up APC consignment");
  return data;
}

/** Reconcile mode: ask the server whether a scanned label belongs to this
 *  order. Also claims the waybill in the ledger, so the same label can't be
 *  scanned onto a second order. */
async function verifyLabelScan(orderId: number, orderName: string, barcode: string): Promise<LabelVerifyResult> {
  const res = await fetch(`${BASE}/api/fulfilment/verify-label-scan`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, orderName, barcode }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Label verification failed");
  return data;
}

/** Tags exactly the orders the operator has filtered to. We send explicit ids
 *  rather than a category, because the wave can be filtered by several box
 *  categories plus tags and products — which the server can't reconstruct. */
async function bulkTagDispatch(tag: string, orderIds: number[]): Promise<{ tagged: number; total: number }> {
  const res = await fetch(`${BASE}/api/fulfilment/tag-dispatch-bulk`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag, orderIds }),
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

/** Orders whose address the app could not reshape for APC with confidence —
 *  a conflicting postcode, a town too long for the label. Read-only check. */
interface AddressReviewRow {
  orderId: number;
  orderName: string;
  review: Array<{ kind: string; message: string }>;
  normalised: { address1: string; address2: string | null; city: string; postcode: string };
}

/** Consignments already booked for this dispatch day, so the picking screen
 *  can say whether opening an order will raise a new one or reuse what's
 *  there. Local ledger read — no APC call. */
interface BookedConsignment {
  orderId: number;
  waybill: string;
  trackingUrl: string | null;
}

async function fetchBookedConsignments(tag: string): Promise<BookedConsignment[]> {
  const res = await fetch(`${BASE}/api/fulfilment/consignments?tag=${encodeURIComponent(tag)}`, { credentials: "include" });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.consignments ?? []) as BookedConsignment[];
}

/** Current 2-pack fridge stock per recipe + the variant→recipe map, so the
 *  pick list can be gated to orders the fridge can actually satisfy. */
interface FridgeAvailability {
  stock: Array<{ recipeId: number; recipeName: string; packs: number }>;
  variants: Record<string, { recipeId: number; packsPerUnit: number }>;
  specialRecipeId: number | null;
}

async function fetchFridgeAvailability(): Promise<FridgeAvailability | null> {
  const res = await fetch(`${BASE}/api/fulfilment/fridge-availability`, { credentials: "include" });
  if (!res.ok) return null;
  return (await res.json()) as FridgeAvailability;
}

/** What the "Ship order?" dialog should actually say. An order that already
 *  has a consignment will REUSE it — telling the packer it's about to raise
 *  a new one is both wrong and alarming (2026-08-12). */
function pickDialogDescription(order: ShopifyOrder, booked: Map<number, BookedConsignment>): string {
  const who = order.shipping_address?.name
    ?? `${order.customer?.first_name ?? ""} ${order.customer?.last_name ?? ""}`.trim();
  const existing = booked.get(order.id);
  if (existing) {
    return `This order already has APC consignment ${existing.waybill}. Its existing label will be used — nothing new will be booked.`;
  }
  return `This will create a real APC consignment for ${who}. This cannot be undone.`;
}

async function fetchAddressReview(tag: string): Promise<AddressReviewRow[]> {
  const res = await fetch(`${BASE}/api/fulfilment/address-review?tag=${encodeURIComponent(tag)}`, { credentials: "include" });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.flagged ?? []) as AddressReviewRow[];
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

async function addExtraBox(waybill: string): Promise<{ labelPdfs: string[]; pieceCount: number; warnings?: string[] }> {
  const res = await fetch(`${BASE}/api/fulfilment/shipments/${encodeURIComponent(waybill)}/add-parcel`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to add extra box");
  return data;
}

async function reprintLabel(waybill: string): Promise<{ waybill: string; pieceCount: number }> {
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

/** Shown in reconcile mode, where consignments are raised by hand in Hypaship
 *  and the app's job is to verify the printed label then push its tracking
 *  number to Shopify. Deliberately states that orders ARE real — it replaces
 *  the TEST MODE banner, which would otherwise imply the opposite. */
function ReconcileModeBanner() {
  return (
    <div className="w-full rounded-xl border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-4 py-2.5 flex items-start gap-2 text-blue-900 dark:text-blue-200 text-sm">
      <Scan className="w-4 h-4 flex-shrink-0 text-blue-600 mt-0.5" />
      <span>
        <span className="font-semibold">Label-scan mode.</span>{" "}
        Consignments are booked by hand in Hypaship — the app doesn't create labels. Scan each
        printed APC label before packing and its tracking number goes onto the real Shopify order.
      </span>
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

/**
 * Print one label by pointing a hidden iframe at a SAME-ORIGIN url that streams
 * the PDF live from APC.
 *
 * This used to take base64 and build a `blob:` URL. That is what broke: the
 * app's CSP lists `frame-src 'self'` plus YouTube/Vimeo and nothing else, and
 * `'self'` does not cover blob:, so Chrome refused to navigate the frame. The
 * block is invisible to onload (which fires anyway on the blocked frame), and
 * the first real symptom was print() throwing SecurityError against an opaque
 * document — surfacing at the bench as a bare "Print failed" on a label that
 * was perfectly healthy at APC (#133003 / #133050, 2026-08-20).
 *
 * Taking a same-origin URL satisfies frame-src 'self' with no CSP change, and
 * keeps every label live: the route holds no cache, so a consignment amended
 * at the bench reprints as amended.
 */
function printLabel(
  pdfUrl: string,
  onPrinted: () => void,
  onPrintFailed: (reason: string) => void,
  frameId = "label-print-frame",
) {
  // Each failure path names its own cause and hands it back to the caller, so
  // the packing bench sees WHY the label didn't print instead of a bare "Print
  // failed" that could be anything from a dead printer to a blocked frame.
  // Nobody is opening DevTools mid-wave (2026-08-20, #133003).
  if (!pdfUrl) {
    console.warn(`[Fulfilment] print: no label URL to print (frame ${frameId})`);
    onPrintFailed("No label URL was built for this consignment.");
    return;
  }
  const iframe = document.getElementById(frameId) as HTMLIFrameElement | null;
  if (!iframe) {
    console.warn(`[Fulfilment] print: frame #${frameId} not in the DOM`);
    onPrintFailed(`The print frame (#${frameId}) is missing from the page.`);
    return;
  }

  let settled = false;

  // The same-origin label route satisfies `frame-src 'self'`, so this should
  // never fire now. It stays as a regression guard: if the CSP is ever
  // tightened again, or the print path is pointed back at a blob:/data: URL,
  // the frame is blocked SILENTLY — onload still fires, and the first real
  // symptom is print() throwing SecurityError against an opaque document,
  // which reads like a printer fault. Naming the violation is the difference
  // between a five-minute fix and another day of chasing the printer.
  //
  // Chrome reports blockedURI as the bare scheme ("blob"), not the full URL,
  // so this matches on scheme/URL AND directive — verified in Chromium
  // 2026-08-20. Requiring both keeps an unrelated frame-src block (a video
  // embed elsewhere on the page) from being misreported as a print fault.
  function handleCspViolation(e: SecurityPolicyViolationEvent) {
    const isOurFrame = e.blockedURI === "blob" || e.blockedURI === "data" || pdfUrl.startsWith(e.blockedURI);
    if (!isOurFrame || !e.violatedDirective.startsWith("frame-src")) return;
    console.warn("[Fulfilment] print: label frame blocked by CSP:", e.violatedDirective, e.blockedURI);
    settle(
      false,
      `Blocked by this site's security policy (CSP ${e.violatedDirective}). ` +
      `The label PDF can't be loaded into the print frame, so nothing reaches the printer. ` +
      `This is a server config fault, not a printer fault — the same failure hits every order.`,
    );
  }
  document.addEventListener("securitypolicyviolation", handleCspViolation);

  function settle(success: boolean, reason = "The print job did not complete.") {
    if (settled) return;
    settled = true;
    document.removeEventListener("securitypolicyviolation", handleCspViolation);
    window.removeEventListener("afterprint", handleAfterPrint);
    clearTimeout(fallbackTimer);
    // The print dialog steals focus from the scan input — and a barcode
    // scanner's keystrokes would land in the dialog, not the pick list.
    // Put focus back the moment printing ends, however it ended.
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>('input[data-scan-input="true"]');
      input?.focus();
    });
    if (success) onPrinted(); else onPrintFailed(reason);
  }

  function handleAfterPrint() { settle(true); }

  // Backstop: if the PDF never loads into the frame at all, fail loudly.
  // (Once print() has been dispatched cleanly this timer is replaced by the
  // optimistic one below, so this only covers the pre-print stages.)
  let fallbackTimer = setTimeout(
    () => settle(false, "The label PDF never finished loading into the print frame (60s). The label reached the browser, so this is the frame or the PDF viewer, not APC."),
    60_000,
  );

  iframe.onerror = () => settle(false, "The print frame could not load the label PDF.");

  iframe.onload = () => {
    // Chrome's PDF viewer swallows a print() that arrives the moment the
    // frame loads — the viewer process isn't ready yet, the call no-ops and
    // nothing ever prints. A short delay makes the print reliable
    // (kitchen Citizen printer, Chrome 151, 2026-08-14).
    setTimeout(() => {
      try {
        // afterprint is unreliable for iframe PDFs on newer Chrome: it may
        // fire on the parent window, the frame's window, or neither. Listen
        // to both, but do not DEPEND on either — in kiosk mode the job has
        // spooled the moment print() returns, so a clean return settles as
        // printed after a short grace. (Non-kiosk was already optimistic:
        // dismissing the dialog counted as done.) The cost when the printer
        // itself jams is a false "printed" — the Reprint Label button is
        // the recovery, and the waybill is correct either way.
        // The label route answers failures with a JSON body and a 5xx. The
        // frame renders that quite happily, so without this check a dead APC
        // would print its error message onto a thermal label and report
        // success. Same-origin means we can actually look — which the old
        // blob: path could not do.
        try {
          const doc = iframe.contentDocument;
          if (doc && doc.contentType && doc.contentType !== "application/pdf") {
            const body = (doc.body?.innerText ?? "").trim().slice(0, 300);
            let detail = body;
            try { detail = JSON.parse(body).error ?? body; } catch { /* not JSON — use the raw text */ }
            settle(false, `APC did not return a label: ${detail || `the server replied with ${doc.contentType}`}`);
            return;
          }
        } catch {
          // contentDocument is opaque for Chrome's PDF viewer on some
          // versions. That is the SUCCESS shape, not a failure — fall through
          // and print.
        }

        window.addEventListener("afterprint", handleAfterPrint, { once: true });
        try { iframe.contentWindow?.addEventListener("afterprint", handleAfterPrint, { once: true }); } catch { /* opaque PDF frame — parent listener still applies */ }
        if (iframe.contentWindow == null) {
          // Not a throw, so it would otherwise settle as an optimistic
          // success — a "Label printed" with an empty tray.
          settle(false, "The print frame had no document to print. Nothing was sent to the printer.");
          return;
        }
        iframe.contentWindow.print();
        clearTimeout(fallbackTimer);
        fallbackTimer = setTimeout(() => settle(true), 5_000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[Fulfilment] Print failed:", err);
        settle(
          false,
          err instanceof DOMException && err.name === "SecurityError"
            ? `The browser refused access to the print frame (${msg}). This normally means the label PDF was blocked before it loaded — check the console for a Content-Security-Policy violation.`
            : `The browser rejected the print call: ${msg}`,
        );
      }
    }, 800);
  };

  // Point the frame straight at the PDF. Do NOT wrap it in HTML with an
  // <embed src="…"> — Chrome blocks the PDF plugin for data: URLs and the
  // print preview comes out blank.
  iframe.src = pdfUrl;
}

/** Order number as a link into the Shopify admin.
 *
 *  Wanted everywhere an order number appears on this page — a packer or
 *  manager assessing anything (an untagged order, a booking failure, a
 *  fulfilment error) ends up in Shopify, and hunting for the order by hand is
 *  the slow part. Opens in a new tab so the packing list stays put.
 *
 *  The base URL arrives once from /config-status rather than per order: a
 *  wave is several hundred rows. Falls back to plain text when the base
 *  hasn't loaded, so the number is never missing. */
function OrderNumber({ orderId, name, adminBase, className }: {
  orderId: number | string;
  name: string;
  adminBase?: string;
  className?: string;
}) {
  if (!adminBase) return <span className={className}>{name}</span>;
  return (
    <a
      href={`${adminBase}${orderId}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      // Underlined ALWAYS, not just on hover: the packing screen is used on
      // an iPad, where there is no hover state, so a hover-only affordance is
      // invisible to the people actually using it.
      className={cn(className, "underline decoration-dotted underline-offset-2 decoration-current/40 hover:decoration-current")}
      title={`Open ${name} in Shopify`}
    >
      {name}
    </a>
  );
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

// Constant motivator for the packing team: live packed-count plus a
// traffic-light orders-per-hour tile. Bands agreed with Graeme 2026-08-03:
// under 50 red, 50–55 amber, 55–60 green, over 60 purple ("smashing it").
function paceBand(oph: number): { tile: string; label: string } {
  if (oph > 60) return { tile: "bg-purple-600 text-white animate-pulse", label: "SMASHING IT! 🔥" };
  if (oph >= 55) return { tile: "bg-green-600 text-white", label: "On target — keep going!" };
  if (oph >= 50) return { tile: "bg-amber-500 text-white", label: "Almost there — push on!" };
  return { tile: "bg-red-600 text-white", label: "Speed up!" };
}

function PackingPaceStrip({ packed, total, oph }: { packed: number | null; total: number | null; oph: number | null }) {
  const pct = packed != null && total ? Math.min(100, Math.round((packed / total) * 100)) : 0;
  const band = oph != null ? paceBand(oph) : null;
  return (
    <div className="flex items-stretch gap-3">
      <div className="flex-1 glass-panel rounded-2xl border border-border px-4 py-3 flex items-center gap-4">
        <Package className="w-7 h-7 text-primary flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-3xl md:text-4xl font-extrabold tabular-nums leading-none">
              {packed ?? "—"}
              <span className="text-muted-foreground font-bold text-xl md:text-2xl">/{total ?? "—"}</span>
            </span>
            <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">packed</span>
          </div>
          <div className="w-full h-2.5 bg-secondary rounded-full overflow-hidden mt-2">
            <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
      <div
        className={`rounded-2xl px-5 py-3 flex flex-col items-center justify-center flex-shrink-0 min-w-[9rem] transition-colors ${band ? band.tile : "bg-secondary text-muted-foreground"}`}
        aria-label={oph != null ? `Packing pace ${oph.toFixed(1)} orders per hour` : "Packing pace not available yet"}
      >
        <span className="text-3xl md:text-4xl font-extrabold tabular-nums leading-none">{oph != null ? oph.toFixed(1) : "—"}</span>
        <span className="text-[11px] font-bold uppercase tracking-wider mt-1 opacity-90">orders/hr</span>
        <span className="text-xs font-bold mt-0.5 text-center leading-tight">{band ? band.label : "warming up…"}</span>
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
  adminBase,
}: {
  failures: Array<{ orderId: number; orderName: string; customerName: string; error: string; kind: "fulfilment" | "decrement"; at: Date }>;
  onDismiss: (orderId: number) => void;
  onClose: () => void;
  adminBase?: string;
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
                  <p className="font-semibold">
                    <OrderNumber orderId={f.orderId} name={f.orderName} adminBase={adminBase} />
                    <span className="font-normal text-muted-foreground"> — {f.customerName}</span>
                  </p>
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
function AuditModal({ tag, onClose, adminBase }: { tag: string; onClose: () => void; adminBase?: string }) {
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
                        <p className="font-semibold">
                          <OrderNumber orderId={o.orderId} name={o.orderName} adminBase={adminBase} />
                          <span className="font-normal text-muted-foreground"> — {o.customerName ?? "(no name)"}</span>
                        </p>
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
  // Orders the packer pressed Skip on. They stay out of the auto-advance
  // rotation entirely — they only rejoin when the packer picks one by hand
  // from the list, or restores them all via the "bring back" banner.
  const [skippedIds, setSkippedIds] = useState<Set<number>>(new Set());
  const [shipment, setShipment] = useState<ShipmentResult | null>(null);
  const [printStatus, setPrintStatus] = useState<PrintStatus>("idle");
  // Why the last print failed, in words the bench can act on. Cleared whenever
  // a print starts or succeeds, so a stale reason can never sit under a
  // later, different failure.
  const [printError, setPrintError] = useState<string | null>(null);

  function startPrinting() {
    setPrintStatus("printing");
    setPrintError(null);
  }
  function printSucceeded() {
    setPrintStatus("done");
    setPrintError(null);
  }
  function printFailed(reason: string) {
    setPrintStatus("failed");
    setPrintError(reason);
  }
  function resetPrint() {
    setPrintStatus("idle");
    setPrintError(null);
  }
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
  // Per-row scanned count, keyed by the grouped item's `_groupKey` (variant
  // id when present). Lets us collapse duplicate line items into a single row
  // with an `×N` badge, then track scan progress within that row.
  const [pickedCounts, setPickedCounts] = useState<Map<string, number>>(new Map());
  const [flashItem, setFlashItem] = useState<string | null>(null);
  const [flashWrong, setFlashWrong] = useState(false);
  // ── Reconcile mode: label-scan gate ──────────────────────────────────────
  // The packer must scan the printed APC label before picking anything, so a
  // wrong label is caught before the box is packed rather than after. Until
  // labelVerified is set, scans route to the label matcher, not the item one.
  const [expectedConsignment, setExpectedConsignment] = useState<ExpectedConsignment | null>(null);
  const [expectedConsignmentError, setExpectedConsignmentError] = useState<string | null>(null);
  // Reconcile-mode per-order label print (the manual-upload control test).
  const [reconcilePrinting, setReconcilePrinting] = useState(false);
  const [loadingConsignment, setLoadingConsignment] = useState(false);
  const [labelVerified, setLabelVerified] = useState<LabelVerifyResult | null>(null);
  const [labelScanError, setLabelScanError] = useState<string | null>(null);
  const [verifyingLabel, setVerifyingLabel] = useState(false);
  // Prefetched consignment lookups, so opening an order is instant and an APC
  // outage shows up before packing starts rather than mid-order.
  const consignmentCacheRef = useRef<Map<string, Promise<ExpectedConsignment | null>>>(new Map());
  // Box categories are multi-select now: the operator can pick a wave of
  // Small + Large together. An empty set means "no category constraint".
  // Defaults to Small Box, matching the team's existing muscle memory.
  // Empty set = no category constraint = All Boxes. The day now starts by
  // tagging and booking the WHOLE wave, so the default view must be
  // everything; narrowing to a category is a deliberate choice afterwards.
  const [boxFilter, setBoxFilter] = useState<Set<BoxCategory>>(new Set<BoxCategory>());
  // Fourth filter axis, only meaningful when the app books labels itself:
  // work through the wave a slice at a time by hiding what's already booked.
  const [labelFilter, setLabelFilter] = useState<"all" | "booked" | "unbooked">("all");
  // Tri-state chips: a tag/product is either untouched, included, or excluded.
  const [includeTags, setIncludeTags] = useState<Set<string>>(new Set());
  const [excludeTags, setExcludeTags] = useState<Set<string>>(new Set());
  const [includeProducts, setIncludeProducts] = useState<Set<string>>(new Set());
  const [excludeProducts, setExcludeProducts] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
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

  // Declared up here rather than next to the render guards because the
  // label-gate derivation below reads them during render — leaving them lower
  // put them in the temporal dead zone.
  const apcEnabled = configStatus?.apcEnabled !== false;
  // Fall back to the legacy boolean when the server predates apc_mode.
  const apcMode: ApcMode = configStatus?.apcMode ?? (apcEnabled ? "full" : "off");
  const reconcileMode = apcMode === "reconcile";
  // apc_test_mode only means anything in "full" mode, where it diverts real
  // bookings to APC's training server. In reconcile mode nothing is booked and
  // the consignment lookups deliberately go to live — so showing "consignments
  // are not real, no bookings are made" would be a dangerous lie: the app is
  // writing real tracking numbers onto real customers' orders.
  const showTestModeBanner = apcMode === "full" && (configStatus?.testMode ?? false);

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
  // Per-device mute for the spoken customer name, on top of the global admin
  // switch in Settings. Lets one bench go quiet mid-dispatch without turning
  // speech off for every device. localStorage so it sticks per iPad.
  const [speakMuted, setSpeakMuted] = useState(() => localStorage.getItem("fulfilment_speak_muted") === "1");
  function toggleSpeakMuted() {
    setSpeakMuted(prev => {
      const next = !prev;
      localStorage.setItem("fulfilment_speak_muted", next ? "1" : "0");
      return next;
    });
  }

  // ── Ice packs ────────────────────────────────────────────────────────────
  // The weather-driven counts live on the banner, but a banner is scenery by
  // the tenth order. To build the habit, the FIRST few orders of the day (per
  // device) open behind a one-tap interstitial naming the count for that box
  // size — the packer confirms the packs went in before picking starts.
  const { data: icePacks } = useIcePacks();
  const [icePackGate, setIcePackGate] = useState<{ packs: number; boxLabel: string } | null>(null);

  const ICE_PACK_CONFIRMS_TARGET = 3;
  function icePackConfirmsKey() {
    return `fulfilment_icepack_confirms_${format(new Date(), "yyyy-MM-dd")}`;
  }
  function icePackConfirmsSoFar() {
    const n = Number(localStorage.getItem(icePackConfirmsKey()) ?? "0");
    return Number.isFinite(n) ? n : 0;
  }

  function maybeOpenIcePackGate(order: ShopifyOrder) {
    if (!icePacks || icePacks.enabled === false) return;
    // Only small/large boxes have an ice-pack count. Wholesale bags leave as
    // they're made and local deliveries go straight on the van.
    const category = getOrderCategory(order);
    const packs = category === "small box" ? icePacks.smallBoxPacks
      : category === "large box" ? icePacks.largeBoxPacks
        : null;
    if (packs == null || packs <= 0) return;
    if (icePackConfirmsSoFar() >= ICE_PACK_CONFIRMS_TARGET) return;
    setIcePackGate({ packs, boxLabel: category });
  }

  // Counts CONFIRMS, not showings — backing out of an order without tapping
  // doesn't use up one of the day's three.
  function confirmIcePackGate() {
    localStorage.setItem(icePackConfirmsKey(), String(icePackConfirmsSoFar() + 1));
    setIcePackGate(null);
    // Hand focus back to the scan field so the next scanner burst lands right.
    requestAnimationFrame(() => barcodeRef.current?.focus());
  }

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
    // Poll so the packed-count on the picking screen stays live even when
    // a second packer on another iPad is completing orders in the same wave.
    refetchInterval: 60_000,
  });

  // Live packing pace — the SAME orders/hr number the dashboard and the
  // packing-speed report show (Shopify fulfilment timestamps, gaps over
  // 10 min treated as idle). The wave's dispatch day is the day before
  // the delivery tag. Only polled while actually picking.
  const dispatchDayStr = (() => {
    try { return format(addDays(parseISO(queryTag), -1), "yyyy-MM-dd"); }
    catch { return null; }
  })();
  const { data: packingPace, refetch: refetchPace } = useQuery({
    queryKey: ["fulfilment-packing-pace", dispatchDayStr],
    enabled: !!dispatchDayStr && view === "picking",
    refetchInterval: 60_000,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/reports/packing-speed?from=${dispatchDayStr}&to=${dispatchDayStr}`, { credentials: "include" });
      if (!res.ok) return null;
      const data = await res.json();
      return (data.dailyRows?.[0] ?? null) as { ordersPerHour: number | null; count: number } | null;
    },
  });

  const { data: postcodeValidations, refetch: refetchPostcodes } = useQuery({
    queryKey: ["fulfilment-postcode-validations", queryTag],
    queryFn: () => fetchPostcodeValidations(queryTag),
    staleTime: 60_000,
    // Postcode results only matter in full mode (see the isBlocked note
    // below) — don't even fetch them otherwise.
    enabled: apcMode === "full",
  });

  const postcodeIssueMap = new Map<number, PostcodeValidation>();
  if (postcodeValidations) {
    for (const pv of postcodeValidations) {
      if (!pv.available) {
        postcodeIssueMap.set(Number(pv.shopify_order_id), pv);
      }
    }
  }

  // Addresses the app can't reshape for a label without a judgement call.
  // Advisory only — it never blocks picking, it just puts the handful of
  // orders worth a look in front of the packer instead of in a spreadsheet.
  const { data: addressReview } = useQuery({
    queryKey: ["fulfilment-address-review", queryTag],
    queryFn: () => fetchAddressReview(queryTag),
    staleTime: 5 * 60_000,
    enabled: !!queryTag,
  });
  const addressReviewMap = new Map<number, AddressReviewRow>();
  for (const row of addressReview ?? []) addressReviewMap.set(Number(row.orderId), row);

  // Which orders already have a consignment. Only meaningful when the app
  // books labels itself; in reconcile mode consignments come from Hypaship.
  const { data: bookedConsignments, refetch: refetchBooked } = useQuery({
    queryKey: ["fulfilment-booked-consignments", queryTag],
    queryFn: () => fetchBookedConsignments(queryTag),
    staleTime: 30_000,
    enabled: !!queryTag && apcMode === "full",
  });
  const bookedMap = new Map<number, BookedConsignment>();
  for (const row of bookedConsignments ?? []) bookedMap.set(Number(row.orderId), row);

  // Fridge gate: only offer orders the production fridge can currently
  // satisfy, and turn the remainder into a wrap-deficit signal. Refetched
  // every minute — wrapping is adding stock all morning.
  const [fridgeGate, setFridgeGate] = useState(true);
  const { data: fridgeAvailability } = useQuery({
    queryKey: ["fulfilment-fridge-availability"],
    queryFn: fetchFridgeAvailability,
    refetchInterval: 60_000,
    staleTime: 30_000,
    enabled: !!queryTag,
  });

  const [recheckingId, setRecheckingId] = useState<number | null>(null);

  const allUnfulfilledOrders = orders?.filter(o => o.fulfillment_status !== "fulfilled") ?? [];
  const fulfilledOrders = orders?.filter(o => o.fulfillment_status === "fulfilled") ?? [];

  const unfulfilledOrders = allUnfulfilledOrders.filter(o =>
    o.tags.split(",").map(t => t.trim()).includes("dispatch")
  );
  const untaggedOrders = allUnfulfilledOrders.filter(o =>
    !o.tags.split(",").map(t => t.trim()).includes("dispatch")
  );

  function getOrderCategory(order: ShopifyOrder): BoxCategory {
    const tags = order.tags.split(",").map(t => t.trim().toLowerCase());
    // Local delivery wins over everything — however big the box is, it goes
    // on the van, and the packer needs it in the no-label wave.
    if (tags.includes(LOCAL_DELIVERY_TAG)) return "local delivery";
    if (tags.includes("wholesale")) return "wholesale";
    if (tags.includes("large box")) return "large box";
    if (tags.includes("small box")) return "small box";
    return "other";
  }

  // ── Wave filters ───────────────────────────────────────────────────────
  // The operator narrows the day's orders to the wave they want to pick, then
  // cycles through ONLY that wave. Three independent axes, all ANDed:
  //   • box categories  — multi-select (pick Small AND Large together)
  //   • order tags      — include / exclude any Shopify order tag
  //   • products        — include / exclude any product present in the orders
  //
  // Include is OR within an axis ("any of these tags"), exclude always wins.
  // Excluding a product drops the WHOLE ORDER — you can't half-pick an order
  // and ship it short.
  const orderTagList = (o: ShopifyOrder) =>
    o.tags.split(",").map(t => t.trim().toLowerCase()).filter(Boolean);

  /** Stable key for a line item. Variant id is the real product identity —
   *  SKUs are shelf labels shared across products, so keying on SKU merged
   *  unrelated products into one filter chip (and excluding one silently
   *  excluded the others). Fall back to title so an item without a variant
   *  is still filterable rather than silently unfilterable. */
  const productKey = (li: { sku?: string | null; variant_id?: number | null; title: string }) =>
    (li.variant_id != null ? `variant:${li.variant_id}` : `title:${li.title}`);

  const orderProductKeys = (o: ShopifyOrder) => new Set((o.line_items ?? []).map(productKey));

  function passesFilters(o: ShopifyOrder): boolean {
    const tags = orderTagList(o);
    const products = orderProductKeys(o);

    // Box category: empty selection = no category constraint (all).
    if (boxFilter.size > 0 && !boxFilter.has(getOrderCategory(o))) return false;

    // Label state — lets a batch be worked through a slice at a time.
    if (labelFilter === "booked" && !bookedMap.has(o.id)) return false;
    if (labelFilter === "unbooked" && bookedMap.has(o.id)) return false;

    // Exclusions win over everything.
    if ([...excludeTags].some(t => tags.includes(t))) return false;
    if ([...excludeProducts].some(p => products.has(p))) return false;

    // Inclusions: must match at least one of each non-empty set.
    if (includeTags.size > 0 && ![...includeTags].some(t => tags.includes(t))) return false;
    if (includeProducts.size > 0 && ![...includeProducts].some(p => products.has(p))) return false;

    return true;
  }

  // Pick-list direction. The queue arrives oldest-first (order placed), which
  // matches label print order — but the printer sometimes stacks labels in
  // reverse, so the packer needs to flip the list to work from the other end
  // (same affordance as the old EasyScan app).
  const [pickListReversed, setPickListReversed] = useState(false);
  // A no-label order being rescheduled straight from the list — the failure
  // used to be reachable only by re-attempting the booking.
  const [rescheduleTarget, setRescheduleTarget] = useState<ShopifyOrder | null>(null);
  const filteredUnfulfilledBase = unfulfilledOrders.filter(passesFilters);
  const filteredUnfulfilledOrdered = pickListReversed
    ? [...filteredUnfulfilledBase].reverse()
    : filteredUnfulfilledBase;

  // ── Label gate ──────────────────────────────────────────────────────────
  // "Ready to pack" MEANS dispatch-tagged AND label booked (Graeme,
  // 2026-08-21): an order APC refused (apc-no-service) cannot be picked — the
  // pick would only fail at the consignment step — so offering Start Picking
  // on it is a lie. Those orders keep a visible row of their own below, with
  // Reschedule in place of Start Picking; they are NOT hidden, which is how
  // failures used to get lost. Local deliveries need no label (the van does
  // the last mile), and the gate waits for the consignment ledger to load so
  // a slow query can't briefly hold every order. Full mode only — reconcile
  // mode proves labels by scanning at the bench instead.
  const labelGateActive = apcMode === "full" && bookedConsignments != null;
  const lacksLabel = (o: ShopifyOrder) =>
    labelGateActive && !isLocalDelivery(o) && !bookedMap.has(o.id);
  const noLabelOrders = filteredUnfulfilledOrdered.filter(lacksLabel);
  const labelledOrdered = filteredUnfulfilledOrdered.filter(o => !lacksLabel(o));

  // ── Fridge gate ─────────────────────────────────────────────────────────
  // Walk the pick list in DISPLAY order, allocating wrapped 2-pack fridge
  // stock to each order. An order stays pickable only when every mapped line
  // fits in what's left; a held order consumes nothing (a smaller later
  // order can still fit). Lines we can't map to a recipe never gate their
  // order — better to over-offer than wrongly hide. The unmet demand of the
  // held orders becomes the wrap-deficit readout for the wrapping station.
  const fridgeAllocation = (() => {
    const empty = {
      held: [] as ShopifyOrder[],
      deficits: [] as Array<{ recipeName: string; packs: number }>,
      active: false,
      shortFor: new Map<number, string[]>(),
    };
    if (!fridgeGate || !fridgeAvailability) return { ...empty, pickable: labelledOrdered };
    const remaining = new Map<number, number>();
    const names = new Map<number, string>();
    for (const s of fridgeAvailability.stock) {
      remaining.set(s.recipeId, s.packs);
      names.set(s.recipeId, s.recipeName);
    }
    const needsFor = (o: ShopifyOrder) => {
      const needs = new Map<number, number>();
      for (const li of o.line_items ?? []) {
        const mapped = li.variant_id != null ? fridgeAvailability.variants[String(li.variant_id)] : undefined;
        let recipeId = mapped?.recipeId;
        let packsPer = mapped?.packsPerUnit ?? 1;
        if (recipeId == null && fridgeAvailability.specialRecipeId != null
            && li.title.toLowerCase().includes("calzone club special")) {
          recipeId = fridgeAvailability.specialRecipeId;
          packsPer = 1;
        }
        if (recipeId == null) continue; // unmappable line — never gates
        needs.set(recipeId, (needs.get(recipeId) ?? 0) + li.quantity * packsPer);
      }
      return needs;
    };
    const pickable: ShopifyOrder[] = [];
    const held: ShopifyOrder[] = [];
    const heldDemand = new Map<number, number>();
    const shortFor = new Map<number, string[]>();
    for (const o of labelledOrdered) {
      const needs = needsFor(o);
      const fits = [...needs].every(([rid, qty]) => (remaining.get(rid) ?? 0) >= qty);
      if (fits) {
        for (const [rid, qty] of needs) remaining.set(rid, (remaining.get(rid) ?? 0) - qty);
        pickable.push(o);
      } else {
        held.push(o);
        const shorts: string[] = [];
        for (const [rid, qty] of needs) {
          heldDemand.set(rid, (heldDemand.get(rid) ?? 0) + qty);
          const have = remaining.get(rid) ?? 0;
          if (have < qty) shorts.push(`${names.get(rid) ?? `Recipe ${rid}`} (need ${qty}, fridge has ${have})`);
        }
        shortFor.set(o.id, shorts);
      }
    }
    const deficits = [...heldDemand]
      .map(([rid, demand]) => ({
        recipeName: names.get(rid) ?? `Recipe ${rid}`,
        packs: Math.max(0, demand - (remaining.get(rid) ?? 0)),
      }))
      .filter(d => d.packs > 0)
      .sort((a, b) => b.packs - a.packs);
    return { pickable, held, deficits, active: true, shortFor };
  })();
  // Held orders drop out of the pickable list entirely, so the picking
  // cycle, counts, and advance-to-next all respect the gate automatically.
  const filteredUnfulfilled = fridgeAllocation.pickable;
  const filteredUntagged = untaggedOrders.filter(passesFilters);
  // Skipped orders still showing in this wave — counted against the filtered
  // list so ids left over from completed or filtered-out orders don't inflate
  // the "bring back" banner.
  const skippedInWave = filteredUnfulfilled.filter(o => skippedIds.has(o.id)).length;

  // Every tag / product actually present in today's orders — the operator only
  // ever sees things that are really there, so no typing and no stale options.
  const availableTags = [...new Set(
    allUnfulfilledOrders.flatMap(orderTagList).filter(t => t !== "dispatch" && !BOX_CATEGORIES.includes(t)),
  )].sort();

  const availableProducts = (() => {
    const seen = new Map<string, { title: string; variantTitle: string | null; sku: string }>();
    for (const o of allUnfulfilledOrders) {
      for (const li of o.line_items ?? []) {
        const key = productKey(li);
        if (!seen.has(key)) {
          seen.set(key, { title: li.title, variantTitle: li.variant_title ?? null, sku: li.sku ?? "" });
        }
      }
    }
    // Several SKUs can share a title — and sometimes the same variant name too
    // (Shopify duplicates, subscription vs one-off listings). Two identical
    // chips would be impossible to choose between, so escalate the qualifier
    // until the label is unique: title → + variant → + SKU.
    const count = (fn: (p: { title: string; variantTitle: string | null; sku: string }) => string) => {
      const m = new Map<string, number>();
      for (const p of seen.values()) m.set(fn(p), (m.get(fn(p)) ?? 0) + 1);
      return m;
    };
    const byTitle = count(p => p.title);
    const byTitleVariant = count(p => `${p.title}|${p.variantTitle ?? ""}`);

    return [...seen.entries()]
      .map(([key, p]) => {
        let label = p.title;
        if ((byTitle.get(p.title) ?? 0) > 1) {
          if (p.variantTitle) label = `${p.title} · ${p.variantTitle}`;
          // Still not unique even with the variant? Fall back to the SKU, which
          // is guaranteed distinct — an unlabelled duplicate chip is worse than
          // an ugly one.
          if ((byTitleVariant.get(`${p.title}|${p.variantTitle ?? ""}`) ?? 0) > 1 && p.sku) {
            label = `${label} · ${p.sku}`;
          }
        }
        return { key, label };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  })();

  const filtersActive = includeTags.size > 0 || excludeTags.size > 0
    || includeProducts.size > 0 || excludeProducts.size > 0;

  function clearFilters() {
    setIncludeTags(new Set());
    setExcludeTags(new Set());
    setIncludeProducts(new Set());
    setExcludeProducts(new Set());
  }

  const boxCounts = {
    "small box": allUnfulfilledOrders.filter(o => getOrderCategory(o) === "small box").length,
    "large box": allUnfulfilledOrders.filter(o => getOrderCategory(o) === "large box").length,
    "wholesale": allUnfulfilledOrders.filter(o => getOrderCategory(o) === "wholesale").length,
    "local delivery": allUnfulfilledOrders.filter(o => getOrderCategory(o) === "local delivery").length,
    "other": allUnfulfilledOrders.filter(o => getOrderCategory(o) === "other").length,
  };

  const taggedCounts = {
    "small box": unfulfilledOrders.filter(o => getOrderCategory(o) === "small box").length,
    "large box": unfulfilledOrders.filter(o => getOrderCategory(o) === "large box").length,
    "wholesale": unfulfilledOrders.filter(o => getOrderCategory(o) === "wholesale").length,
    "local delivery": unfulfilledOrders.filter(o => getOrderCategory(o) === "local delivery").length,
    "other": unfulfilledOrders.filter(o => getOrderCategory(o) === "other").length,
  };

  const [showBatchBooking, setShowBatchBooking] = useState(false);
  // Packing is open to viewers; booking real consignments and rescheduling
  // customer orders is not. The API enforces this — hiding the button just
  // saves a packer finding a 403 mid-shift.
  const { state: authState } = useAuth();
  const canBookCourier = authState.status === "authenticated"
    && (authState.user.role === "admin" || authState.user.role === "manager");
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

  /** Reconcile mode: warm the consignment lookup for the next order so opening
   *  it is instant, and so an APC problem surfaces a step early. */
  function preQueueConsignment(nextOrderName: string) {
    if (!reconcileMode) return;
    if (consignmentCacheRef.current.has(nextOrderName)) return;
    consignmentCacheRef.current.set(
      nextOrderName,
      fetchExpectedConsignment(nextOrderName).catch(() => null),
    );
  }

  function preQueueNextOrder(nextOrderId: number) {
    // APC off → no shipment to pre-create, no label to pre-print. Reconcile
    // mode books nothing either — it warms the lookup via
    // preQueueConsignment instead.
    if (!apcEnabled || reconcileMode) return;
    if (preQueueRef.current.has(nextOrderId)) return;
    const promise = createShipment(nextOrderId, queryTag, queryTag)
      .then((result) => {
        // Background print the next order's label so it's done before the operator advances
        prePrintRef.current.set(nextOrderId, "printing");
        printLabel(
          labelUrl(result.consignmentNumber, 1),
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
    consignmentCacheRef.current.clear();
  }

  function handleOrderSelect(order: ShopifyOrder) {
    // Picking an order by hand (or cycling back round to it) un-skips it.
    if (skippedIds.has(order.id)) {
      setSkippedIds(prev => {
        const next = new Set(prev);
        next.delete(order.id);
        return next;
      });
    }
    clearPreQueue();
    // Live-mode confirmation only matters when a real APC consignment
    // is about to be created. With APC off, or in reconcile mode where the
    // consignment already exists, there's nothing to confirm — go straight in.
    // Same when book-on-open is off: the server refuses to book from this
    // path (409), so opening can only ever look up an existing consignment
    // (batch-booked or hand-uploaded) and print its label.
    if (configStatus?.testMode || !apcEnabled || reconcileMode || configStatus?.bookOnOpen === false) {
      startPicking(order);
    } else {
      setPendingPickOrder(order);
    }
  }

  async function startPicking(order: ShopifyOrder) {
    setActiveOrder(order);
    setPickedCounts(new Map());
    if (barcodeRef.current) barcodeRef.current.value = ""; // clear the scan field for the new order
    setShipment(null);
    setShipmentError(null);
    resetPrint();
    setCompletionError(null);
    setConsignmentAction("idle");
    setConsignmentActionError(null);
    setShowAddBoxConfirm(false);
    setShowCancelConfirm(false);
    setLabelVerified(null);
    setLabelScanError(null);
    setExpectedConsignment(null);
    setExpectedConsignmentError(null);
    setView("picking");
    // First orders of the day: make the packer confirm the ice packs went in.
    maybeOpenIcePackGate(order);

    // Local delivery: the van does the last mile, APC is never involved.
    // No consignment to look up (reconcile) or book (full) — straight to
    // item scanning, and completion runs without a tracking number.
    if (isLocalDelivery(order)) {
      setCreatingShipment(false);
      return;
    }

    // Reconcile mode: the consignment already exists in Hypaship, so nothing
    // is booked here. Fetch it (usually already prefetched) so the label-scan
    // gate knows which waybill to expect, then wait for the packer to scan the
    // printed label before any item picking is allowed.
    if (reconcileMode) {
      setCreatingShipment(false);
      setLoadingConsignment(true);
      try {
        const cached = consignmentCacheRef.current.get(order.name);
        const expected = await (cached ?? fetchExpectedConsignment(order.name));
        if (!expected) {
          setExpectedConsignmentError(
            `APC has no consignment with reference ${order.name}. Check the reference in Hypaship — this order can't be shipped until it's fixed.`,
          );
        } else {
          setExpectedConsignment(expected);
        }
      } catch (err) {
        setExpectedConsignmentError(err instanceof Error ? err.message : "Could not reach APC to look up this consignment.");
      } finally {
        setLoadingConsignment(false);
      }

      // Warm the next order in the wave. Safe to do unconditionally here —
      // unlike "full" mode this books nothing, it's just a read.
      const pos = filteredUnfulfilled.findIndex(o => o.id === order.id);
      const next = filteredUnfulfilled.slice(pos + 1).find(o => !skippedIds.has(o.id));
      if (next && !isLocalDelivery(next)) preQueueConsignment(next.name);
      return;
    }

    // APC off → no shipment to create, no label to print. The picker
    // just scans items and presses Complete; the backend fulfils
    // Shopify without tracking and the existing fridge-decrement
    // logic runs as normal. printStatus stays "idle" so the header
    // doesn't claim a label was printed when nothing was.
    if (!apcEnabled) {
      setCreatingShipment(false);
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
      // A new booking changes what the queue should show next time.
      if (!result.reused) void refetchBooked();

      // Check whether the label was already background-printed (pre-print)
      const prePrinted = prePrintRef.current.get(order.id);
      prePrintRef.current.delete(order.id);

      if (prePrinted === "done") {
        // Label already printed in background — no need to print again
        printSucceeded();
      } else {
        // Print now (either first time or pre-print failed). Every piece, each
        // fetched live at the moment it prints.
        printAllLabels(result.consignmentNumber, result.pieceCount ?? 1);
      }

      // Pre-queue AND background-print the next unfulfilled order's label.
      // Only in test mode — in live mode we must not create a real APC consignment
      // without the operator explicitly confirming the next order first.
      // Look ahead within the filtered wave — otherwise we'd pre-print a label
      // for an order the operator isn't going to pick next.
      if (configStatus?.testMode) {
        const currentPos = filteredUnfulfilled.findIndex(o => o.id === order.id);
        const nextOrder = filteredUnfulfilled.slice(currentPos + 1).find(o => !skippedIds.has(o.id));
        if (nextOrder && !isLocalDelivery(nextOrder)) preQueueNextOrder(nextOrder.id);
      }
    } catch (err: any) {
      setShipmentError(err.message ?? "Failed to create APC shipment");
      // No label ever reached the browser — the APC error above is the cause,
      // so don't let the print strip invent a second, vaguer one.
      printFailed(err.message ?? "No label was produced, because the consignment step failed.");
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

  // Collapse multiple line items of the same VARIANT into one row so a packer
  // sees "Chicken & Chorizo ×2" instead of two identical rows. Quantity adds
  // up across the merged lines, and scans increment a per-row picked count
  // until the row is full. Grouping must key on variant id, not SKU — SKUs
  // are shelf labels shared across products, and grouping by SKU merged
  // different products into one row (wrong title/image/barcode for all but
  // the first).
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
      const key = li.variant_id != null ? `v${li.variant_id}` : (li.sku || `__nosku_${li.id}`);
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

  // Local orders bypass every courier gate — computed once here so the label
  // gate, completion and auto-complete all agree.
  const activeIsLocal = !!activeOrder && isLocalDelivery(activeOrder);

  // True while the packer still owes us a verified APC label for this order.
  // Only meaningful in reconcile mode, and only once we know which consignment
  // to expect — a lookup failure shows its own blocking message instead.
  const labelGateOpen = reconcileMode && !activeIsLocal && !!expectedConsignment && !labelVerified?.verified;

  async function handleLabelScan(scanned: string) {
    if (!activeOrder || verifyingLabel) return;
    setVerifyingLabel(true);
    setLabelScanError(null);
    try {
      const result = await verifyLabelScan(activeOrder.id, activeOrder.name, scanned);
      if (result.verified) {
        setLabelVerified(result);
        playScanSuccess();
      } else {
        // Distinct sound + message per failure: aiming at the wrong barcode is
        // a different problem from the wrong label being on the box.
        playScanWrong();
        setFlashWrong(true);
        setTimeout(() => setFlashWrong(false), 600);
        setLabelScanError(result.message ?? "Label did not verify.");
      }
    } catch (err) {
      playScanWrong();
      setLabelScanError(err instanceof Error ? err.message : "Label verification failed.");
    } finally {
      setVerifyingLabel(false);
    }
  }

  function handleBarcodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    // The scan field is UNCONTROLLED — read straight from the DOM. A hardware
    // scanner types a full 13/15-digit barcode in a few milliseconds then sends
    // Enter. A controlled React input can't keep up with that burst: rapid
    // setState calls are batched and React clobbers the DOM value back to a
    // stale state, so the field ends up holding only the first few digits — the
    // "submits a 5-digit fragment" bug. Leaving the input uncontrolled lets the
    // scanner fill it untouched; we read and clear it via the ref.
    const raw = barcodeRef.current?.value ?? "";
    const input = raw.trim().toLowerCase();
    if (!input) return;

    // Reconcile mode: until the printed APC label has been verified, every
    // scan is treated as a label scan. Doing this first means a wrong label is
    // caught before a single item goes in the box.
    if (labelGateOpen) {
      handleLabelScan(raw.trim());
      if (barcodeRef.current) barcodeRef.current.value = "";
      return;
    }

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
    } else {
      playScanWrong();
      setFlashWrong(true);
      setTimeout(() => setFlashWrong(false), 600);
    }
    // Clear via the DOM — the field is uncontrolled — ready for the next scan.
    if (barcodeRef.current) barcodeRef.current.value = "";
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
    // Reconcile mode gates on the verified label instead of a booked shipment —
    // shipping without a verified consignment is the exact failure this flow
    // exists to prevent.
    if (!activeIsLocal) {
      if (reconcileMode) {
        if (!labelVerified?.verified) return;
      } else if (apcEnabled && !shipment) {
        return;
      }
    }

    // Snapshot what we need for the background call before we move on.
    const snapshot = {
      orderId: activeOrder.id,
      orderName: activeOrder.name,
      customerName: activeOrder.shipping_address?.name
        ?? (`${activeOrder.customer?.first_name ?? ""} ${activeOrder.customer?.last_name ?? ""}`.trim() || "(no name)"),
      consignmentNumber: reconcileMode
        ? labelVerified?.consignmentNumber ?? null
        : shipment?.consignmentNumber ?? null,
      trackingUrl: reconcileMode
        ? labelVerified?.trackingUrl
        : shipment?.trackingUrl,
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
        refetchPace();
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
    // Cycle within the FILTERED wave, not the whole day. Previously this read
    // `unfulfilledOrders`, so after the first order the cycle silently escaped
    // whatever filter the operator had set (the screen even defaults to Small
    // Box) and dropped them into an unrelated order.
    // After refetch, the completed order is removed from the list, so we
    // pick the first remaining order. Skipped orders never come back on
    // their own: once everything else in the wave is done we return to the
    // list, where the packer restores them deliberately (per order via
    // Start Picking, or all at once via the "bring back" banner). The old
    // behaviour — silently starting a fresh pass over the skipped ones —
    // dropped the packer into an order they'd just skipped with no warning.
    const remaining = filteredUnfulfilled.filter(o => o.id !== activeOrder?.id);
    const nextOrder = remaining.find(o => !skippedIds.has(o.id));
    if (nextOrder) {
      // Route through handleOrderSelect so that live-mode confirmation dialog
      // is shown before any real APC consignment is created.
      handleOrderSelect(nextOrder);
    } else {
      setView("list");
      setActiveOrder(null);
    }
  }

  function skipCurrent() {
    // Remember the skip BEFORE advancing, so advanceToNext (and the next
    // completion's auto-advance) won't hand this order straight back.
    if (activeOrder) {
      setSkippedIds(prev => new Set(prev).add(activeOrder.id));
    }
    advanceToNext();
  }

  function goBack() {
    clearPreQueue(); // discard any stale pre-queued shipments
    setView("list");
    setActiveOrder(null);
    setShipment(null);
    resetPrint();
    setShipmentError(null);
    setCompletionError(null);
  }

  const isConsignmentBusy = consignmentAction !== "idle";
  const [cancelSuccess, setCancelSuccess] = useState(false);

  /** Reconcile mode: fetch the hand-raised consignment's label from APC by
   *  the order reference and print it — proves the print pipeline against
   *  Graeme's trusted Excel-upload consignments without booking anything. */
  async function printReconcileLabel() {
    if (!activeOrder) return;
    setReconcilePrinting(true);
    try {
      const res = await fetch(`${BASE}/api/fulfilment/reconcile-label?orderName=${encodeURIComponent(activeOrder.name)}`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Label fetch failed");
      printAllLabels(data.waybill as string, (data.labelPdfs as string[]).length);
      toast({
        title: `Printing label for ${activeOrder.name}`,
        description: data.duplicateCount > 1
          ? `⚠ ${data.duplicateCount} consignments share this reference — spare labels must be binned.`
          : `Waybill ${data.waybill}`,
      });
    } catch (err) {
      toast({ title: "Label print failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setReconcilePrinting(false);
    }
  }

  /** Print every piece of a consignment, each fetched live from APC at the
   *  moment it prints — so a consignment amended mid-wave prints as amended. */
  function printAllLabels(waybill: string, pieces: number) {
    const count = Math.max(1, pieces);
    startPrinting();

    function printNext(index: number) {
      if (index > count) {
        printSucceeded();
        return;
      }
      printLabel(
        labelUrl(waybill, index),
        () => printNext(index + 1),
        // Say which parcel of a multi-box consignment stalled — "label 2 of 3"
        // is the difference between rebinning one label and redoing the box.
        reason => printFailed(count > 1 ? `Label ${index} of ${count}: ${reason}` : reason),
      );
    }

    printNext(1);
  }

  async function handleAddExtraBox() {
    if (!shipment) return;
    setShowAddBoxConfirm(false);
    setConsignmentAction("adding-box");
    setConsignmentActionError(null);
    try {
      const result = await addExtraBox(shipment.consignmentNumber);
      // The consignment now has more pieces than when it was opened — carry
      // that forward so a later Reprint doesn't fall back to the old count.
      setShipment(prev => prev ? { ...prev, pieceCount: result.pieceCount } : prev);
      printAllLabels(shipment.consignmentNumber, result.pieceCount);
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
      // Re-reads the consignment from APC first, so a reprint after an
      // amendment prints the CURRENT number of labels, not the count from
      // when the order was opened.
      const result = await reprintLabel(shipment.consignmentNumber);
      setShipment(prev => prev ? { ...prev, pieceCount: result.pieceCount } : prev);
      printAllLabels(shipment.consignmentNumber, result.pieceCount);
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
        resetPrint();
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
    const courierReady = activeIsLocal
      ? true
      : reconcileMode
        ? !!labelVerified?.verified
        : (!apcEnabled || !!shipment);
    if (
      view === "picking" &&
      allChecked &&
      totalUnits > 0 &&
      !completing &&
      courierReady
    ) {
      handleComplete();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allChecked, shipment, view, labelVerified?.verified]);

  // Auto-advance after the confirm celebration — kept short so the picker
  // flows straight into the next order without losing scanning rhythm.
  useEffect(() => {
    if (view !== "confirm") return;
    const timer = setTimeout(() => advanceToNext(), 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Keep the scan field focused whenever the picking view is showing it.
  // Keyed on the order id — not just the view — because Skip and auto-advance
  // move to the next order WITHOUT leaving the picking view, which left focus
  // stranded on the Skip button: the next scan went nowhere and the scanner's
  // trailing Enter could even press Skip again. Also re-fires when the form
  // un-hides (shipment created / error cleared), since a hidden input
  // silently refuses focus.
  useEffect(() => {
    if (view !== "picking") return;
    if (creatingShipment || shipmentError || expectedConsignmentError) return;
    barcodeRef.current?.focus();
  }, [view, activeOrder?.id, creatingShipment, shipmentError, expectedConsignmentError]);

  // Speak the customer's shipping name when an order opens. Gated by
  // spokenOrderIdsRef so we say each order's name exactly once per page
  // load — no repeats if the picking view re-mounts for the same order.
  // Skipped entirely if the admin has muted speech in Settings.
  useEffect(() => {
    if (!speakNameEnabled || speakMuted) return;
    if (view !== "picking" || !activeOrder) return;
    if (spokenOrderIdsRef.current.has(activeOrder.id)) return;
    const name = activeOrder.shipping_address?.name
      ?? `${activeOrder.customer?.first_name ?? ""} ${activeOrder.customer?.last_name ?? ""}`.trim();
    if (!name) return;
    spokenOrderIdsRef.current.add(activeOrder.id);
    speakName(name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrder?.id, view, speakNameEnabled, speakMuted]);

  // Reconcile mode needs APC credentials (to look consignments up) but NOT the
  // four service codes — nothing is booked, so there's no service to pick.
  const configIncomplete = reconcileMode
    ? !configStatus?.apcCredentialsConfigured
    : (!configStatus?.apcCredentialsConfigured || !configStatus?.serviceCodesConfigured);

  if (apcEnabled && !configStatusLoading && configIncomplete) {
    return (
      <div className="space-y-6">
        {showTestModeBanner && <TestModeBanner trainingCredentialsMissing={configStatus?.trainingCredentialsMissing} />}
        {reconcileMode && <ReconcileModeBanner />}
        <PageHeader title="Order Packing Live" description={apcEnabled ? "APC order scanning and label printing." : "Scan orders into the box — couriers booked manually."} />
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
        {showTestModeBanner && <TestModeBanner trainingCredentialsMissing={configStatus?.trainingCredentialsMissing} />}
        {reconcileMode && <ReconcileModeBanner />}

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
            {shipment.reused && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground pt-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-600 flex-shrink-0 mt-0.5" />
                <span>This order already had a consignment — reusing it. Nothing new was booked with APC.</span>
              </p>
            )}
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

  // With APC off there is no shipment object — the completion screen still
  // shows (minus the consignment number) so the packer gets the same
  // celebration + auto-advance rhythm either way.
  if (view === "confirm" && activeOrder && (shipment || !apcEnabled || reconcileMode)) {
    const hasNext = filteredUnfulfilled.filter(o => o.id !== activeOrder.id).length > 0;
    const isTestMode = configStatus?.testMode ?? false;
    return (
      <div className="space-y-6">
        {pendingPickOrder && (
          <ShopifyConfirmDialog
            title={`Ship order ${pendingPickOrder.name}?`}
            description={pickDialogDescription(pendingPickOrder, bookedMap)}
            products={pendingPickOrder.line_items.map(li => ({ name: li.title, quantity: li.quantity, quantityLabel: "ordered", noPlus: true }))}
            confirmLabel="Start packing"
            onConfirm={() => { const o = pendingPickOrder; setPendingPickOrder(null); startPicking(o); }}
            onCancel={() => setPendingPickOrder(null)}
          />
        )}
        {showTestModeBanner && <TestModeBanner trainingCredentialsMissing={configStatus?.trainingCredentialsMissing} />}
        {reconcileMode && <ReconcileModeBanner />}
        <PageHeader title="Order Packing Live" description={apcEnabled ? "APC order scanning and label printing." : "Scan orders into the box — couriers booked manually."} />
        <div className="glass-panel p-8 rounded-2xl border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20 text-center">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-green-800 dark:text-green-200 mb-1">Order Complete!</h2>
          <p className="text-green-700 dark:text-green-300 mb-4">
            {activeOrder.name} — {activeOrder.shipping_address?.name ?? activeOrder.customer?.first_name}
          </p>
          {shipment && (
            <div className="inline-flex items-center gap-2 bg-green-100 dark:bg-green-900/50 px-5 py-3 rounded-xl mb-6">
              <Truck className="w-5 h-5 text-green-600" />
              <span className="font-mono font-bold text-green-800 dark:text-green-200 text-lg">{shipment.consignmentNumber}</span>
            </div>
          )}
          <p className="text-sm text-green-600 dark:text-green-400 mb-6">
            {activeOrder.shipping_address?.address1}, {activeOrder.shipping_address?.city}, {activeOrder.shipping_address?.zip}
          </p>
          {hasNext && (
            <p className="text-xs text-green-600/70 dark:text-green-400/70 mb-3 animate-pulse">
              Auto-advancing to next order…
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
        <PackingPaceStrip
          packed={progress?.totalFulfilled ?? null}
          total={progress?.totalOrders ?? null}
          oph={packingPace?.ordersPerHour ?? null}
        />
        {pendingPickOrder && (
          <ShopifyConfirmDialog
            title={`Ship order ${pendingPickOrder.name}?`}
            description={pickDialogDescription(pendingPickOrder, bookedMap)}
            products={pendingPickOrder.line_items.map(li => ({ name: li.title, quantity: li.quantity, quantityLabel: "×" }))}
            confirmLabel="Start packing"
            onConfirm={() => { const o = pendingPickOrder; setPendingPickOrder(null); startPicking(o); }}
            onCancel={() => setPendingPickOrder(null)}
          />
        )}
        {showTestModeBanner && <TestModeBanner trainingCredentialsMissing={configStatus?.trainingCredentialsMissing} />}
        {reconcileMode && <ReconcileModeBanner />}
        {/* Today's counts stay in sight for every order, not just the gated
            first few. */}
        <IcePackBanner />
        {/* One-tap ice-pack confirm on the first orders of the day. Rendered
            over everything, and the confirm button takes focus so a stray
            scanner burst can't land in the pick list underneath. */}
        {icePackGate && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6">
            <div className="bg-card rounded-2xl border border-border shadow-2xl max-w-md w-full p-6 space-y-4 text-center">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-cyan-100 dark:bg-cyan-900/40 flex items-center justify-center">
                <Snowflake className="w-9 h-9 text-cyan-600 dark:text-cyan-400" />
              </div>
              <h2 className="text-3xl font-display font-bold leading-tight">
                {icePackGate.packs} ice pack{icePackGate.packs === 1 ? "" : "s"} in this {icePackGate.boxLabel}
              </h2>
              <p className="text-sm text-muted-foreground">
                Today's rule for {activeOrder.name}. Put {icePackGate.packs === 1 ? "it" : "them"} in
                now, then confirm to start picking.
              </p>
              <button
                autoFocus
                onClick={confirmIcePackGate}
                className="w-full py-4 rounded-xl bg-primary text-primary-foreground text-lg font-semibold hover:opacity-90 transition-opacity"
              >
                Ice packs are in — start picking
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-3">
          <button onClick={goBack} className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1" />
          {speakNameEnabled && (
            <button
              onClick={toggleSpeakMuted}
              title={speakMuted ? "Name announcements are muted on this device — tap to unmute" : "Tap to mute name announcements on this device"}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors",
                speakMuted
                  ? "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300"
                  : "border-border text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
              )}
            >
              {speakMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              {speakMuted ? "Muted" : "Name on"}
            </button>
          )}
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
                    onClick={() => printAllLabels(shipment.consignmentNumber, shipment.pieceCount ?? 1)}
                    className="text-xs px-2 py-1 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-lg flex items-center gap-1 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" /> Retry print
                  </button>
                  <button
                    onClick={printSucceeded}
                    className="text-xs px-2 py-1 bg-secondary hover:bg-secondary/80 rounded-lg flex items-center gap-1 transition-colors"
                    title="Manually mark as printed if the label came out correctly"
                  >
                    Mark printed
                  </button>
                </div>
                {/* The reason, verbatim. A packer who can read "blocked by the
                    site's security policy" stops re-pressing Retry and calls
                    it in; "Print failed" alone taught them to keep trying. */}
                {printError && (
                  <p className="text-xs text-destructive/90 max-w-md text-right leading-snug">{printError}</p>
                )}
                <a href="/settings" className="text-xs text-muted-foreground underline hover:text-foreground transition-colors">Check printer setup</a>
              </div>
            )}
            {printStatus === "failed" && !shipment && (
              <div className="flex flex-col items-end gap-1">
                <span className="flex items-center gap-1.5 text-xs text-destructive">
                  <XCircle className="w-4 h-4" /> Print failed
                </span>
                {printError && (
                  <p className="text-xs text-destructive/90 max-w-md text-right leading-snug">{printError}</p>
                )}
              </div>
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
                onClick={skipCurrent}
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

        {/* Local delivery: no courier, no label — make that loudly obvious so
            nobody stands at the printer waiting for a label that won't come. */}
        {activeIsLocal && (
          <div className="flex items-start gap-2 text-sm rounded-xl border border-teal-300 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/30 px-4 py-3">
            <Truck className="w-4 h-4 text-teal-600 dark:text-teal-400 flex-shrink-0 mt-0.5" />
            <span className="text-teal-800 dark:text-teal-200">
              <strong>Local delivery</strong> — no APC label needed. Pick and complete as
              normal, then set the box aside for the van run.
            </span>
          </div>
        )}

        {/* ── Reconcile mode: APC label gate ──────────────────────────────
            Blocks picking until the printed label on the box is proven to
            belong to this order. */}
        {reconcileMode && loadingConsignment && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-secondary/30 rounded-xl px-4 py-3">
            <Loader2 className="w-4 h-4 animate-spin" /> Looking up the APC consignment for {activeOrder.name}…
          </div>
        )}

        {reconcileMode && expectedConsignmentError && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 space-y-2">
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{expectedConsignmentError}</span>
            </div>
            <button
              onClick={goBack}
              className="text-xs px-3 py-2 border border-border rounded-lg hover:bg-secondary/50 transition-colors font-medium"
            >
              Back to the queue
            </button>
          </div>
        )}

        {reconcileMode && labelGateOpen && (
          <div className="rounded-2xl border-2 border-primary/40 bg-primary/5 p-5 space-y-3">
            <div className="flex items-start gap-3">
              <Scan className="w-6 h-6 text-primary flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-display font-bold text-lg leading-tight">Scan the APC label first</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Scan the <strong>long barcode</strong> on the label for {activeOrder.name}. Item picking unlocks once it matches.
                </p>
              </div>
              {verifyingLabel && <Loader2 className="w-5 h-5 animate-spin text-primary flex-shrink-0" />}
              <button
                type="button"
                onClick={printReconcileLabel}
                disabled={reconcilePrinting}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg border border-primary/40 bg-background text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
                title="Fetch this order's label from APC and print it (lost/unprinted label)"
              >
                {reconcilePrinting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                Print label
              </button>
            </div>
            {/* Shown so the packer's eyes are a second layer of checking — the
                match itself is decided server-side on the reference. */}
            <div className="text-xs text-muted-foreground grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 pl-9">
              <span>APC reference: <strong className="font-mono text-foreground">{expectedConsignment?.reference ?? "—"}</strong></span>
              <span>Consignee: <strong className="text-foreground">{expectedConsignment?.consigneeName ?? "—"}</strong></span>
              <span>Postcode: <strong className="font-mono text-foreground">{expectedConsignment?.consigneePostcode ?? "—"}</strong></span>
              <span>Service: <strong className="font-mono text-foreground">{expectedConsignment?.productCode ?? "—"}</strong></span>
            </div>
            {labelScanError && (
              <div className="flex items-start gap-2 text-sm font-medium text-destructive bg-destructive/10 rounded-xl px-3 py-2.5">
                <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{labelScanError}</span>
              </div>
            )}
          </div>
        )}

        {reconcileMode && labelVerified?.verified && (
          <div className="flex items-center gap-2 text-sm rounded-xl border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-4 py-3">
            <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
            <span className="text-green-800 dark:text-green-200">
              Label verified —{" "}
              <span className="font-mono font-semibold">{labelVerified.consignmentNumber}</span>
              {labelVerified.parcel ? <span className="text-green-700/80 dark:text-green-300/80"> · parcel {labelVerified.parcel}</span> : null}
            </span>
            {/* Same fetch-by-reference as the gate's button. After a scan
                this reprints the SAME label, so a fresh print can be held
                against the one on the box — the bench check that the
                reference→consignment mapping is right. */}
            <button
              type="button"
              onClick={printReconcileLabel}
              disabled={reconcilePrinting}
              className="ml-auto flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-green-400 dark:border-green-700 bg-background text-xs font-medium text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/40 disabled:opacity-50"
              title="Fetch this order's label from APC again and print it — should come out identical to the label on the box"
            >
              {reconcilePrinting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
              Print label
            </button>
          </div>
        )}

        <form onSubmit={handleBarcodeSubmit} hidden={creatingShipment || !!shipmentError || !!expectedConsignmentError}>
          <div className={`relative transition-all ${flashWrong ? "ring-2 ring-destructive rounded-xl" : ""}`}>
            <Scan className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none" />
            {/* Uncontrolled on purpose — see handleBarcodeSubmit. A controlled
                value can't keep up with a scanner's burst and truncates. */}
            <input
              ref={barcodeRef}
              data-scan-input="true"
              defaultValue=""
              placeholder={labelGateOpen ? "Scan the APC label…" : "Scan barcode or type SKU…"}
              className={`w-full pl-12 pr-4 py-4 text-lg bg-background border rounded-xl focus:outline-none focus:ring-2 font-mono ${
                labelGateOpen ? "border-primary/50 focus:ring-primary/40" : "border-border focus:ring-primary/30"
              }`}
              autoComplete="off"
              autoFocus
            />
          </div>
        </form>

        {/* Item list stays hidden until the label is verified, so there's no
            way to start picking into a box with the wrong label on it. */}
        <div className="space-y-2" hidden={creatingShipment || !!shipmentError || !!expectedConsignmentError || labelGateOpen}>
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
                {/* Multiplier sits BEFORE the name so the row reads "2 × Chicken
                    Chorizo" — the packer sees how many to grab first. The pack
                    size stays greyed on the right so "2" can't be misread as
                    two packs when it's one 2-pack. */}
                {item.totalQty > 1 && (
                  <div
                    className="px-3 py-1 rounded-lg text-2xl md:text-3xl font-extrabold flex-shrink-0 bg-orange-500 text-white"
                    aria-label={`Quantity ${item.totalQty}, ${picked} picked`}
                  >
                    {isPartial ? `${picked}/${item.totalQty}` : `${item.totalQty} ×`}
                  </div>
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
            onClick={skipCurrent}
            className="px-4 py-2.5 border border-border rounded-xl text-sm font-medium hover:bg-secondary/50 transition-colors flex items-center gap-1.5 text-muted-foreground"
          >
            <SkipForward className="w-4 h-4" /> Skip
          </button>
          <button
            onClick={() => handleComplete()}
            disabled={!allChecked || (apcEnabled && !activeIsLocal && !shipment && !labelVerified?.verified) || completing}
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
          aria-hidden="true"
          // NOT className="hidden": display:none stops Chrome instantiating
          // its PDF viewer inside the frame, so print() had nothing to print
          // and failed instantly (packing PC, 2026-08-14). Off-screen fixed
          // positioning keeps it invisible while letting the PDF render.
          style={{ position: "fixed", top: "-9999px", left: "-9999px", width: "100mm", height: "150mm", border: 0 }}
        />
        <iframe
          id="label-preprint-frame"
          title="Label Pre-Print"
          aria-hidden="true"
          style={{ position: "fixed", top: "-9999px", left: "-9998px", width: "100mm", height: "150mm", border: 0 }}
        />
      </div>
    );
  }

  // DATES VIEW: landing page showing all dispatch dates with unfulfilled order groups
  if (view === "dates") {
    const isTestMode = configStatus?.testMode ?? false;
    return (
      <div className="space-y-6">
        {showTestModeBanner && <TestModeBanner trainingCredentialsMissing={configStatus?.trainingCredentialsMissing} />}
        {reconcileMode && <ReconcileModeBanner />}
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

        <IcePackBadge />

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
                      {apcMode === "full" && group.postcodeIssues > 0 && (
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
            code for the delivery date, using the codes configured in Settings.
            Only relevant in full mode, where the app books the consignments;
            in reconcile mode APC itself rejects bad postcodes at upload. */}
        {apcMode === "full" && (
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

  const isTestMode = configStatus?.testMode ?? false;

  return (
    <div className="space-y-6">
      {showTestModeBanner && <TestModeBanner trainingCredentialsMissing={configStatus?.trainingCredentialsMissing} />}
        {reconcileMode && <ReconcileModeBanner />}

      {/* Live-mode confirmation dialog — appears when operator selects an order */}
      {pendingPickOrder && (
        <ShopifyConfirmDialog
          title={`Ship order ${pendingPickOrder.name}?`}
          description={pickDialogDescription(pendingPickOrder, bookedMap)}
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

      {/* Today's ice-pack rule, in sight before the first box is opened. */}
      <IcePackBanner />

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
          adminBase={configStatus?.shopifyAdminOrderBase}
          failures={completionFailures}
          onDismiss={(orderId) => setCompletionFailures(prev => prev.filter(f => f.orderId !== orderId))}
          onClose={() => setShowFailuresModal(false)}
        />
      )}
      {showAuditModal && (
        <AuditModal tag={queryTag} onClose={() => setShowAuditModal(false)} adminBase={configStatus?.shopifyAdminOrderBase} />
      )}

      {progress && (
        <DispatchProgressHeader progress={progress} />
      )}

      {orders && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {unfulfilledOrders.filter(o => !lacksLabel(o)).length} ready to pack &middot;{" "}
            {unfulfilledOrders.filter(lacksLabel).length > 0 && (
              <span className="text-amber-700 dark:text-amber-400 font-medium">{unfulfilledOrders.filter(lacksLabel).length} no label &middot;{" "}</span>
            )}
            {untaggedOrders.length} awaiting approval &middot; {progress ? progress.totalFulfilled : fulfilledOrders.length} fulfilled
          </p>

          {/* ONE filter bar, two labelled segments that combine (AND):
              Box × Label. "Small + Booked" = small boxes with labels booked.
              Actions (Book APC labels, Tags & Products) live at the right so
              they can't be mistaken for a third filter group. */}
          <div className="flex gap-2 flex-wrap items-center">
            <div className="flex items-center gap-1 rounded-xl bg-secondary/60 p-0.5 pl-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mr-1">Box</span>
              <button
                onClick={() => setBoxFilter(new Set())}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                  boxFilter.size === 0
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                All
              </button>
              {([
                { key: "small box" as const, label: "Small" },
                { key: "large box" as const, label: "Large" },
                { key: "wholesale" as const, label: "Wholesale" },
                { key: "local delivery" as const, label: "Local" },
                { key: "other" as const, label: "Other" },
              ] as const).map(tab => {
                const count = boxCounts[tab.key];
                if (count === 0) return null;
                const active = boxFilter.has(tab.key);
                const tagged = taggedCounts[tab.key];
                return (
                  <button
                    key={tab.key}
                    onClick={() => {
                      const next = new Set(boxFilter);
                      if (next.has(tab.key)) next.delete(tab.key); else next.add(tab.key);
                      setBoxFilter(next);
                    }}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5",
                      active
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {tab.label}
                    <span className={cn(
                      "text-[10px] px-1 py-0.5 rounded-full tabular-nums",
                      active ? "bg-primary-foreground/20" : "bg-secondary"
                    )}>{tagged}/{count}</span>
                  </button>
                );
              })}
            </div>

            {apcMode === "full" && (
              <div className="flex items-center gap-1 rounded-xl bg-secondary/60 p-0.5 pl-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mr-1">Label</span>
                {([
                  { key: "all" as const, label: "All" },
                  { key: "unbooked" as const, label: `No label (${allUnfulfilledOrders.filter(o => !bookedMap.has(o.id)).length})` },
                  { key: "booked" as const, label: `Booked (${bookedMap.size})` },
                ]).map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => setLabelFilter(opt.key)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                      labelFilter === opt.key
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {fridgeAvailability && (
              <button
                onClick={() => setFridgeGate(v => !v)}
                className={cn(
                  "px-3 py-1.5 rounded-xl text-xs font-medium transition-colors border",
                  fridgeGate
                    ? "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200"
                    : "border-border bg-secondary/60 text-muted-foreground hover:text-foreground",
                )}
                title="When on, only orders the production fridge can currently satisfy are offered for picking; the rest wait under 'Awaiting Wrapping' with a wrap-deficit readout"
              >
                Fridge gate: {fridgeGate ? "On" : "Off"}
                {fridgeGate && fridgeAllocation.held.length > 0 && (
                  <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 tabular-nums">
                    {fridgeAllocation.held.length} held
                  </span>
                )}
              </button>
            )}

            {rescheduleTarget && (
              <RescheduleOrderDialog
                orderId={rescheduleTarget.id}
                orderName={rescheduleTarget.name}
                fromDate={queryTag}
                adminUrl={configStatus?.shopifyAdminOrderBase ? `${configStatus.shopifyAdminOrderBase}${rescheduleTarget.id}` : undefined}
                onClose={() => setRescheduleTarget(null)}
                onDone={() => { refetch(); refetchBooked(); refetchProgress(); }}
              />
            )}
            {showBatchBooking && (
              <ApcBatchBookingDialog
                tag={queryTag}
                onClose={() => setShowBatchBooking(false)}
                onBooked={() => { void refetchBooked(); void refetch(); }}
              />
            )}

            <div className="ml-auto flex items-center gap-2">
              {/* canBookCourier: booking is manager-only (other session,
                  2026-08-21) — merged with the unified-bar layout. */}
              {apcMode === "full" && canBookCourier && (
                <button
                  onClick={() => setShowBatchBooking(true)}
                  className="px-4 py-2 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors flex items-center gap-2"
                  title="Raise APC consignments — pick first 5, all, small boxes, or large boxes"
                >
                  <PackageCheck className="w-4 h-4" /> Book APC labels
                </button>
              )}
              <button
                onClick={() => setFiltersOpen(v => !v)}
                className={cn(
                  "px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2",
                  filtersActive
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <Filter className="w-4 h-4" />
                Tags & Products
                {filtersActive && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-white/20 tabular-nums">
                    {includeTags.size + excludeTags.size + includeProducts.size + excludeProducts.size}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* How many orders this wave will actually cycle through. */}
          <p className="text-sm text-muted-foreground">
            Picking <span className="font-semibold text-foreground tabular-nums">{filteredUnfulfilled.length}</span>
            {" "}of {unfulfilledOrders.length} dispatch-tagged orders
            {filtersActive && <span className="text-indigo-600 dark:text-indigo-400"> · filters active</span>}
          </p>

          {filtersOpen && (
            <div className="glass-panel p-4 rounded-2xl border border-border space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Tap once to <span className="text-emerald-600 dark:text-emerald-400 font-medium">include</span>,
                  again to <span className="text-red-600 dark:text-red-400 font-medium">exclude</span>, again to clear.
                  Excluding a product removes the whole order from the wave.
                </p>
                {filtersActive && (
                  <button onClick={clearFilters} className="text-xs text-primary hover:underline flex-shrink-0 ml-3">
                    Clear all
                  </button>
                )}
              </div>

              <FilterChipRow
                label="Order tags"
                items={availableTags.map(t => ({ key: t, label: t }))}
                include={includeTags}
                exclude={excludeTags}
                onToggle={k => cycleChip(k, includeTags, excludeTags, setIncludeTags, setExcludeTags)}
                emptyText="No other tags on today's orders."
              />

              <FilterChipRow
                label="Products"
                items={availableProducts}
                include={includeProducts}
                exclude={excludeProducts}
                onToggle={k => cycleChip(k, includeProducts, excludeProducts, setIncludeProducts, setExcludeProducts)}
                emptyText="No products found on today's orders."
              />
            </div>
          )}

          {filteredUntagged.length > 0 && (
            <div className="glass-panel p-4 rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-amber-600" />
                  <span className="font-semibold text-sm text-amber-900 dark:text-amber-200">
                    {filteredUntagged.length} {filteredUntagged.length === 1 ? "order" : "orders"} awaiting approval
                    {(boxFilter.size > 0 || filtersActive) && <span className="font-normal"> (matching your filters)</span>}
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
                    <><Tag className="w-4 h-4" /> Tag {filteredUntagged.length} Order{filteredUntagged.length === 1 ? "" : "s"} for Dispatch</>
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
                        await bulkTagDispatch(queryTag, filteredUntagged.map(o => o.id));
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
                    <OrderNumber
                      orderId={order.id}
                      name={order.name}
                      adminBase={configStatus?.shopifyAdminOrderBase}
                      className="font-mono font-bold text-amber-900 dark:text-amber-200"
                    />
                    <span className="text-amber-700 dark:text-amber-400 truncate flex-1">
                      {order.shipping_address?.name ?? `${order.customer?.first_name} ${order.customer?.last_name}`}
                    </span>
                    <span className="text-xs text-amber-600 dark:text-amber-500">{order.line_items.reduce((s, i) => s + i.quantity, 0)} items</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {filteredUnfulfilled.length === 0 && fridgeAllocation.held.length === 0 && filteredUntagged.length === 0 && allUnfulfilledOrders.length === 0 && (
            <div className="glass-panel p-10 rounded-2xl border border-border text-center text-muted-foreground">
              <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-500 opacity-60" />
              <p className="font-medium">All orders fulfilled!</p>
              <p className="text-sm mt-1">Nothing left to dispatch for this date.</p>
            </div>
          )}

          {filteredUnfulfilled.length === 0 && fridgeAllocation.held.length === 0 && filteredUntagged.length === 0 && allUnfulfilledOrders.length > 0 && (
            <div className="glass-panel p-8 rounded-2xl border border-border text-center text-muted-foreground">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-green-500 opacity-60" />
              <p className="font-medium">All {boxFilter} orders done!</p>
              <p className="text-sm mt-1">Switch to another category to continue packing.</p>
            </div>
          )}

          {skippedInWave > 0 && (
            <div className="glass-panel px-4 py-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 flex items-center gap-3">
              <SkipForward className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <span className="flex-1 text-sm text-amber-900 dark:text-amber-200">
                {skippedInWave} skipped {skippedInWave === 1 ? "order is" : "orders are"} held out of the wave.
                They won't come round again until you bring them back.
              </span>
              <button
                onClick={() => setSkippedIds(new Set())}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 rounded-lg text-xs font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors flex-shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Bring back
              </button>
            </div>
          )}

          {/* Orders with no label are NOT ready to pack — picking one would
              only fail at the consignment step. They stay visible here with
              the actions that can actually resolve them: Reschedule, or a
              retry through Book APC labels. */}
          {noLabelOrders.length > 0 && (
            <div className="rounded-xl border-2 border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 p-3 space-y-2">
              <div className="flex items-center justify-between px-1">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-300 uppercase tracking-wide flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" /> No label — not ready to pack ({noLabelOrders.length})
                </p>
                <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80">Retry via Book APC labels, or reschedule</p>
              </div>
              {noLabelOrders.map(order => (
                <div key={order.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-card border border-amber-200 dark:border-amber-900 text-sm">
                  <OrderNumber
                    orderId={order.id}
                    name={order.name}
                    adminBase={configStatus?.shopifyAdminOrderBase}
                    className="font-bold"
                  />
                  <span className="text-muted-foreground truncate flex-1">
                    {order.shipping_address?.name ?? `${order.customer?.first_name} ${order.customer?.last_name}`}
                    {order.shipping_address && ` — ${order.shipping_address.city}, ${order.shipping_address.zip}`}
                  </span>
                  {order.tags.toLowerCase().includes("apc-no-service") && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 font-medium flex-shrink-0"
                          title="APC refused this postcode for this delivery day">
                      APC: no service
                    </span>
                  )}
                  {canBookCourier && (
                    <button
                      onClick={() => setRescheduleTarget(order)}
                      className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors"
                    >
                      <CalendarClock className="w-3.5 h-3.5" /> Reschedule
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {filteredUnfulfilled.length > 0 && (
            <div className="flex items-center justify-between mb-2 px-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ready to Pack</p>
              <button
                onClick={() => setPickListReversed(v => !v)}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 border border-border rounded-lg hover:bg-secondary/50 transition-colors"
                title="Flip the list to match the label stack when the printer prints in reverse"
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
                {pickListReversed ? "Newest first" : "Oldest first"}
              </button>
            </div>
          )}

          {filteredUnfulfilled.map((order, idx) => {
            const hasUnassigned = order.line_items.some(i => !i.location && i.sku);
            const weightKg = ((order.total_weight ?? 0) / 1000).toFixed(2);
            const tags = order.tags.split(",").map(t => t.trim()).filter(Boolean);
            // Postcode coverage only gates picking in FULL mode, where the app
            // itself books the consignment and a bad postcode would fail at
            // label time. In reconcile mode consignments are uploaded to APC
            // by hand and APC flags service problems there — so a stored
            // failure here must never block the scanner (2026-07-29: stale
            // LW16 rejections froze the entire pick list).
            // Local deliveries never touch APC, so APC postcode coverage can't
            // block them — the van doesn't care what APC thinks of the postcode.
            const localOrder = isLocalDelivery(order);
            const postcodeIssue = apcMode === "full" && !localOrder ? postcodeIssueMap.get(order.id) : undefined;
            // "Check failed:" = the VALIDATOR broke (e.g. APC auth outage,
            // 2026-08-20 — every order went red at once), not the postcode.
            // Render that amber-advisory instead of red-blocked.
            const checkUnavailable = !!postcodeIssue && (postcodeIssue.reason ?? "").startsWith("Check failed:");
            const isBlocked = !!postcodeIssue && !checkUnavailable;
            // Advisory: the address needs a human decision before a label is
            // printed. Never blocks — local deliveries don't get a label at all.
            const addressFlags = localOrder ? undefined : addressReviewMap.get(order.id);

            return (
              // Compact on purpose: a dispatch day is 60+ orders and the packer
              // works down the list top to bottom — density beats whitespace
              // here, so the full screen height shows as many orders as
              // possible.
              <div
                key={order.id}
                className={cn(
                  "glass-panel px-3.5 py-2.5 rounded-xl border flex items-center gap-3 transition-colors group",
                  isBlocked
                    ? "border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-950/10"
                    : "border-border hover:border-primary/30"
                )}
              >
                <div className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0",
                  isBlocked ? "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400" : "bg-secondary text-muted-foreground"
                )}>
                  {isBlocked ? <ShieldAlert className="w-4 h-4" /> : idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <OrderNumber
                      orderId={order.id}
                      name={order.name}
                      adminBase={configStatus?.shopifyAdminOrderBase}
                      className="font-bold text-base leading-tight"
                    />
                    <span className="text-sm text-muted-foreground truncate">
                      {order.shipping_address?.name ?? `${order.customer?.first_name} ${order.customer?.last_name}`}
                      {order.shipping_address && ` — ${order.shipping_address.city}, ${order.shipping_address.zip}`}
                    </span>
                    {hasUnassigned && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300 font-medium">
                        Unassigned SKUs
                      </span>
                    )}
                    {localOrder && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300 font-medium flex items-center gap-1">
                        <Truck className="w-2.5 h-2.5" /> Local Delivery
                      </span>
                    )}
                    {bookedMap.has(order.id) && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 font-medium flex items-center gap-1"
                        title={`Consignment ${bookedMap.get(order.id)!.waybill} already booked — opening this order reuses it`}
                      >
                        <CheckCircle2 className="w-2.5 h-2.5" /> Label booked
                      </span>
                    )}
                    {/* Booking failures used to be visible only inside the
                        batch-booking dialog's report — once closed, an order
                        with no (or a failed/cleared) label looked identical
                        to the rest of the list. Surface the gap on the card. */}
                    {apcMode === "full" && bookedConsignments && !localOrder && !bookedMap.has(order.id) && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 font-medium flex items-center gap-1"
                        title="No live APC consignment for this order — book it via Book APC labels (or it will be raised when picking starts)"
                      >
                        <AlertTriangle className="w-2.5 h-2.5" /> No label
                      </span>
                    )}
                    {skippedIds.has(order.id) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground font-medium flex items-center gap-1">
                        <SkipForward className="w-2.5 h-2.5" /> Skipped
                      </span>
                    )}
                    {isBlocked && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 font-medium">
                        Postcode Issue
                      </span>
                    )}
                    {checkUnavailable && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 font-medium"
                        title={postcodeIssue?.reason ?? undefined}
                      >
                        APC check unavailable
                      </span>
                    )}
                    {addressFlags && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 font-medium flex items-center gap-1"
                        title={addressFlags.review.map(r => r.message).join("\n")}
                      >
                        <AlertTriangle className="w-2.5 h-2.5" /> Check Address
                      </span>
                    )}
                  </div>
                  {addressFlags && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5 flex items-start gap-1">
                      <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                      <span>{addressFlags.review.map(r => r.message).join(" · ")}</span>
                    </p>
                  )}
                  {isBlocked && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-0.5 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {postcodeIssue.reason ?? "Service not available for this postcode"} (Service: {postcodeIssue.service_code})
                    </p>
                  )}
                  <div className="flex items-center gap-2.5 mt-0.5 text-xs text-muted-foreground">
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
                    className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors flex-shrink-0"
                  >
                    <Scan className="w-4 h-4" /> Start Picking
                    <ChevronRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}

          {/* ── Awaiting wrapping: orders the fridge can't satisfy yet ────
              The deficit readout is the wrapping station's live to-do: wrap
              this many packs and these orders release themselves. */}
          {fridgeAllocation.active && fridgeAllocation.held.length > 0 && (
            <div className="space-y-2 mt-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">
                Awaiting Wrapping ({fridgeAllocation.held.length})
              </p>
              {fridgeAllocation.deficits.length > 0 && (
                <div className="glass-panel px-4 py-3 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
                  <p className="text-sm font-semibold text-blue-900 dark:text-blue-200 mb-1">
                    To release these orders, wrap:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {fridgeAllocation.deficits.map(d => (
                      <span key={d.recipeName} className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 font-medium tabular-nums">
                        {d.recipeName} × {d.packs}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {fridgeAllocation.held.map(order => (
                <div key={order.id} className="glass-panel px-4 py-3 rounded-xl border border-border opacity-60 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {order.name} {order.shipping_address?.name ?? order.customer?.first_name ?? ""}
                    </p>
                    <p className="text-xs text-muted-foreground truncate" title={(fridgeAllocation.shortFor.get(order.id) ?? []).join("\n")}>
                      Short: {(fridgeAllocation.shortFor.get(order.id) ?? []).join(" · ") || "fridge stock"}
                    </p>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground font-medium flex-shrink-0">
                    Awaiting wrapping
                  </span>
                </div>
              ))}
            </div>
          )}

          {fulfilledOrders.length > 0 && includeAll && (
            <div className="space-y-2 opacity-50">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">Fulfilled</p>
              {fulfilledOrders.map(order => (
                <div key={order.id} className="glass-panel p-4 rounded-xl border border-border flex items-center gap-4">
                  <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <OrderNumber
                      orderId={order.id}
                      name={order.name}
                      adminBase={configStatus?.shopifyAdminOrderBase}
                      className="font-semibold"
                    />
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
        aria-hidden="true"
        style={{ position: "fixed", top: "-9999px", left: "-9999px", width: "100mm", height: "150mm", border: 0 }}
      />
    </div>
  );
}
