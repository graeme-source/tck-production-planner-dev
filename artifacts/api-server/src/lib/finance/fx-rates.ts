// What a foreign currency was worth in pounds on a given day (Graeme, 6 Nov
// 2026), so a $20 invoice can be held up against the £15.14 charged for it.
// European Central Bank rates through Frankfurter: free, no key, and it only
// ever sees a currency and a date. A missed lookup comes back null, and the
// invoice is then simply left for a person.

const TIMEOUT_MS = 4000;
const LATEST_KEEPS_MS = 6 * 60 * 60 * 1000;

const dated = new Map<string, number>();
let latest = new Map<string, { rate: number; at: number }>();

function isoDay(date: string | null | undefined, today: string): string | null {
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today ? date : null;
}

export async function gbpRateFor(currency: string | null | undefined, date: string | null | undefined): Promise<number | null> {
  const code = currency?.toUpperCase();
  if (!code || code === "GBP" || !/^[A-Z]{3}$/.test(code)) return null;
  const day = isoDay(date, new Date().toISOString().slice(0, 10));
  const key = `${code} ${day}`;
  if (day && dated.has(key)) return dated.get(key)!;
  const recent = day ? null : latest.get(code);
  if (recent && Date.now() - recent.at < LATEST_KEEPS_MS) return recent.rate;
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/${day ?? "latest"}?base=${code}&symbols=GBP`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const rate = ((await res.json()) as { rates?: { GBP?: number } }).rates?.GBP;
    if (typeof rate !== "number" || !(rate > 0)) return null;
    if (day) dated.set(key, rate);
    else latest = new Map(latest).set(code, { rate, at: Date.now() });
    return rate;
  } catch (err) {
    console.warn(`[finance] exchange rate lookup failed for ${code}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** The invoice with its rate, for matching. */
export async function withGbpRate<T extends { currency?: string | null; invoiceDate: string | null }>(inv: T): Promise<T & { gbpRate: number | null }> {
  return { ...inv, gbpRate: await gbpRateFor(inv.currency, inv.invoiceDate) };
}
