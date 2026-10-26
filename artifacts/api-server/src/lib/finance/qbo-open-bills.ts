import { qboConfigured, qboQuery, qboStatus } from "./qbo";
import { openBillsFromQbo, type OpenBill } from "./qbo-open-bills-map";

// Open supplier bills from QuickBooks for the cash-flow page. Read-only
// (the shared qboQuery client), cached in memory for 15 minutes so page
// loads don't each spend a QBO call, and never throws: on failure the last
// good list comes back with `error` so the page can show stale-but-useful.

const CACHE_MS = 15 * 60_000;
const PAGE_SIZE = 1000; // QBO's maximum MAXRESULTS
const MAX_PAGES = 20; // runaway guard — 20,000 open bills would be a bug

let lastGood: { bills: OpenBill[]; fetchedAt: Date } | null = null;
let inFlight: Promise<Awaited<ReturnType<typeof loadOpenBills>>> | null = null;

async function fetchAllOpenBills(): Promise<OpenBill[]> {
  const raw: unknown[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const startPos = page * PAGE_SIZE + 1;
    // ORDERBY Id keeps paging stable between pages; Balance is compared as
    // a quoted string because that's what QBO's query language accepts.
    const batch = await qboQuery<unknown>(
      `select * from Bill where Balance > '0' ORDERBY Id STARTPOSITION ${startPos} MAXRESULTS ${PAGE_SIZE}`
    );
    raw.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return openBillsFromQbo(raw);
}

export async function loadOpenBills(): Promise<{ connected: boolean; bills: OpenBill[]; fetchedAt: string | null; error?: string }> {
  if (lastGood && Date.now() - lastGood.fetchedAt.getTime() < CACHE_MS) {
    return { connected: true, bills: lastGood.bills, fetchedAt: lastGood.fetchedAt.toISOString() };
  }
  // Concurrent callers share one fetch — and so at most one token refresh.
  if (!inFlight) inFlight = doLoad().finally(() => { inFlight = null; });
  return inFlight;
}

async function doLoad(): Promise<{ connected: boolean; bills: OpenBill[]; fetchedAt: string | null; error?: string }> {
  try {
    if (!qboConfigured()) return { connected: false, bills: [], fetchedAt: null };
    const status = await qboStatus();
    if (!status.connected) return { connected: false, bills: [], fetchedAt: null };
    const bills = await fetchAllOpenBills();
    lastGood = { bills, fetchedAt: new Date() };
    return { connected: true, bills, fetchedAt: lastGood.fetchedAt.toISOString() };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[qbo-open-bills] load failed:", error);
    return {
      connected: true,
      bills: lastGood?.bills ?? [],
      fetchedAt: lastGood ? lastGood.fetchedAt.toISOString() : null,
      error,
    };
  }
}
