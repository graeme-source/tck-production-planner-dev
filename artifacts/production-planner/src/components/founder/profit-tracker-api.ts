// Types + fetchers for the profit tracker (GET/PUT /api/pnl-tracker/*).
// Objective I. Shapes mirror api-server lib/finance/profit-tracker.ts.

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type Bucket =
  | "income" | "food" | "packaging" | "courier" | "payment_fees" | "production_labour"
  | "other_cost_of_sales" | "advertising" | "overhead" | "below_line" | "ignore";

export interface PnlLineOut { key: string; label: string; amount: number; how: string }

export interface OrderRow {
  id: number;
  name: string;
  createdAt: string;
  day: string;
  tags: string | null;
  box: "small" | "large" | "none";
  usesCourier: boolean;
  packs: number;
  items: number;
  products: Array<{ name: string; quantity: number }>;
  revenue: number;
  shippingCharged: number;
  discounts: number;
  refunded: number;
  food: number;
  packaging: number;
  courier: number;
  paymentFees: number;
  orderProfit: number;
  uncostedItems: number;
  labour: number;
  grossProfit: number;
  advertising: number;
  overhead: number;
  netProfit: number;
  margin: number | null;
  grossMargin: number | null;
}

export interface GroupSummary {
  label: string; orders: number; revenue: number; grossProfit: number; netProfit: number;
  margin: number | null; shareOfProfit: number | null;
}

export interface ProductSummary {
  name: string; quantity: number; ordersWithIt: number; avgOrderNetProfit: number;
  orderMargin: number | null; unitContribution: number | null;
}

export interface Calibration {
  months: string[]; overheadMonthly: number; belowLineMonthly: number; otherCostOfSalesMonthly: number;
  paymentFeeRate: number; labourRate: number;
}

export interface Prediction {
  from: string;
  to: string;
  days: number;
  pnl: {
    orders: number; packs: number; lines: PnlLineOut[]; income: number; grossProfit: number; netProfit: number;
    labourPerPack: number; adsPerOrder: number; overheadPerOrder: number; labourSource: "planday" | "estimate";
    uncostedItems: number;
  };
  orders: OrderRow[];
  bySize: GroupSummary[];
  byProduct: ProductSummary[];
  calibration: Calibration;
}

export interface Comparison {
  months: Array<{ month: string; rows: Array<{ key: string; label: string; predicted: number; actual: number; gap: number }> }>;
  calibration: Calibration;
}

export interface AccountBucket {
  key: string; name: string; accountKey: string; depth: number; group: string | null; bucket: Bucket;
  source: "set" | "inherited" | "default"; amounts: number[]; total: number; isLeaf: boolean;
}

export interface Groups {
  months: string[];
  buckets: Array<{ key: Bucket; label: string }>;
  accounts: AccountBucket[];
}

export interface TrackerSettings {
  small_box_cost: number; large_box_cost: number; small_box_courier: number; large_box_courier: number;
  overhead_average_months: number; weightThresholdGrams: number;
  employer_ni_rate: number; employer_ni_weekly_threshold: number; employment_allowance_annual: number; employer_pension_rate: number;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/api/pnl-tracker${path}`, { credentials: "include" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? "Couldn't load the profit tracker");
  return body as T;
}

async function putJson<T>(path: string, data: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api/pnl-tracker${path}`, {
    method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? "Couldn't save");
  return body as T;
}

export const fetchPrediction = (from: string, to: string) => getJson<Prediction>(`/predict?from=${from}&to=${to}`);
export const fetchComparison = () => getJson<Comparison>("/compare");
export const fetchGroups = () => getJson<Groups>("/groups");
export const fetchTrackerSettings = () => getJson<TrackerSettings>("/settings");
export const saveGroup = (name: string, bucket: Bucket | null) => putJson<{ ok: true }>("/groups", { name, bucket });
export const saveTrackerSetting = (key: keyof Omit<TrackerSettings, "weightThresholdGrams">, value: number) =>
  putJson<TrackerSettings>("/settings", { key, value });

export const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const gbp0 = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
export const pct = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(1)}%`);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m! - 1]} ${y}`;
}
export function dayLabel(d: string): string {
  const [, m, day] = d.split("-").map(Number);
  return `${day} ${MONTHS[m! - 1]}`;
}
