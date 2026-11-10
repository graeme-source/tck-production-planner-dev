import { useState } from "react";
import { useFounderArea } from "@/hooks/use-founder-area";
import { Redirect } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { FounderNav } from "@/components/founder-nav";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Check, AlertTriangle } from "lucide-react";
import { MarketingCalendar } from "@/components/marketing-calendar/marketing-calendar";
import { EmailRevenuePanel } from "@/components/marketing-calendar/email-revenue-panel";
import { SalesDriversSection } from "@/components/sales-drivers/sales-drivers-section";
import { ChangeLog } from "@/components/sales-drivers/change-log";

// One page, no inner tabs (Graeme, 28 Oct 2026): Live offers and the bundle
// builder moved to their own Business tabs next to the floor map. Old
// /founder/sales#live-offers and #bundle-builder links are sent there.
const MOVED_TABS: Record<string, string> = {
  "#live-offers": "/founder/live-offers",
  "#bundle-builder": "/founder/bundle-builder",
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types (mirror the founder-sales API) ────────────────────────────────────
interface Pace {
  monthToDate: number;
  orderCount: number;
  projected: number;
  /** The minimum (target/onPace/requiredDailyRate are against it). */
  target: number;
  /** This month's stretch (carried forward), or null if none is set. */
  stretch: number | null;
  onPace: boolean;
  requiredDailyRate: number;
  averageDailyRevenue: number;
  daysLeft: number;
}

interface EmailStatus {
  configured: boolean;
  lastSentAt: string | null;
  daysSince: number | null;
  cadenceDays: number;
  recent: Array<{ name: string; sentAt: string }>;
  error?: string;
}

interface Pulse {
  today: string;
  pace: Pace | null;
  email: EmailStatus;
  gapWeeks: string[];
  attention: Array<{ kind: string; message: string }>;
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}/api/founder-sales${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}


// ── Page ───────────────────────────────────────────────────────────────────
export default function FounderSales() {
  // The founder, or someone he granted Sales & Marketing (founder.sales).
  // Connecting/disconnecting Klaviyo stays the founder's (server-enforced).
  // Emails waiting for approval show inside the marketing calendar (2026-10-20).
  const { ready, canSales, isFounder, home } = useFounderArea();
  const queryClient = useQueryClient();
  const [moved] = useState(() => MOVED_TABS[window.location.hash] ?? null);

  const { data, isLoading } = useQuery<Pulse>({
    queryKey: ["founder-sales-pulse"],
    queryFn: () => api("/pulse"),
    enabled: canSales,
    refetchInterval: 5 * 60_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["founder-sales-pulse"] });

  if (moved) return <Redirect to={moved} replace />;
  if (!ready) return null;
  if (!canSales) return <Redirect to={home ?? "/"} />;

  return (
    <div className="space-y-6">
      <FounderNav />
      <PageHeader
        title="Marketing Calendar"
        description="Email revenue, the last emails sent and the marketing calendar — there's always something on."
      />

      <div className="space-y-6">
          {/* ── Attention strip: the assistant speaks first ─────────────────── */}
          {isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (data?.attention.length ?? 0) > 0 ? (
            <div className="space-y-2">
              {data!.attention.map((a, i) => (
                <div key={i} className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <span className="text-amber-800 dark:text-amber-300">{a.message}</span>
                </div>
              ))}
            </div>
          ) : data ? (
            <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm flex items-center gap-2.5">
              <Check className="w-4 h-4 text-primary flex-shrink-0" />
              <span>On pace and emails flowing. Nothing needs you here today.</span>
            </div>
          ) : null}

          {/* Email revenue this month and the last five emails, in one
              compact panel — replaced Revenue pace and Email cadence
              (Graeme, 10 Nov 2026). Objective I. */}
          <EmailRevenuePanel
            storeSales={data?.pace?.monthToDate ?? null}
            connected={!!data?.email.configured}
            footer={isFounder ? <KlaviyoControls email={data?.email} onChanged={invalidate} /> : undefined}
          />
          <MarketingCalendar />

          {/* What's driving sales — delivery wait, conversion and the website
              changelog on one timeline (Graeme, 2026-10-16). Objective I. */}
          <SalesDriversSection canEdit={canSales} />

          {/* The change log, collapsed to one button at the very bottom — rarely
              needed (Graeme, 2026-10-21). Objective I. */}
          <ChangeLog canEdit={canSales} />
      </div>
    </div>
  );
}

// ── Klaviyo connection (the founder's) ─────────────────────────────────────
// Connect with a key while it isn't connected; a small Disconnect once it is.
function KlaviyoControls({ email, onChanged }: { email?: EmailStatus; onChanged: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [connectError, setConnectError] = useState<string | null>(null);
  const connect = useMutation({
    mutationFn: () => api("/klaviyo", { method: "POST", body: JSON.stringify({ apiKey: apiKey.trim() }) }),
    onSuccess: () => { setApiKey(""); setConnectError(null); onChanged(); },
    onError: (e: Error) => setConnectError(e.message),
  });
  const disconnect = useMutation({
    mutationFn: () => api("/klaviyo", { method: "DELETE" }),
    onSuccess: onChanged,
  });

  if (!email?.configured) {
    return (
      <div className="space-y-2 max-w-md">
        <p className="text-xs text-muted-foreground">
          Connect Klaviyo with a <b>private API key</b> (Klaviyo → Settings → API keys, read-only is enough).
        </p>
        <input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Klaviyo private API key (pk_…)"
          type="password" className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
        {connectError && <p className="text-xs text-red-500">{connectError}</p>}
        <button onClick={() => connect.mutate()} disabled={connect.isPending || apiKey.trim().length < 10}
          className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5">
          {connect.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Connect
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      {email.error && <p className="text-xs text-amber-600 dark:text-amber-400">Klaviyo error: {email.error}</p>}
      <button onClick={() => disconnect.mutate()} disabled={disconnect.isPending}
        className="text-xs text-muted-foreground underline-offset-2 hover:underline">
        {email.error ? "Disconnect & re-enter key" : "Disconnect Klaviyo"}
      </button>
    </div>
  );
}
