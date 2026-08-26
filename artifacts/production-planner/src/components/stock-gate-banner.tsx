// Dashboard banner: products currently held back from next-day delivery by
// the stock gate (fridge-vs-despatch surplus ran low, so a Shopify tag +
// Zapiet prep-time rule pulled tomorrow from the date picker). Self-hides
// when there are no live holds. Same shape as EightPackOrdersBanner.

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ShieldAlert, Loader2, ArrowRight, CheckCircle2, AlertTriangle, FlaskConical, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

interface Hold {
  id: number;
  recipeName: string;
  productTitle: string | null;
  tag: string;
  surplusAtHold: number;
  thresholdAtHold: number;
  /** Which despatch this hold defends: "today" (delivered tomorrow) or
   *  "tomorrow" (the next despatch day, delivered the day after). */
  horizon?: string;
  dryRun: boolean;
  verifyStatus: string | null;
  verifyNote: string | null;
  heldAt: string;
}
interface StatusPayload {
  settings: {
    enabled: boolean; dryRun: boolean; thresholdPacks: number; releasePacks: number;
    autoRelease: boolean; tag: string;
    lookaheadEnabled?: boolean; lookaheadTag?: string;
    lookaheadThresholdPacks?: number; lookaheadReleasePacks?: number;
  };
  zapietKeyConfigured: boolean;
  lastRun: { at: string; ok: boolean; note: string; productsChecked: number } | null;
  activeHolds: Hold[];
}

const DEFAULT_ROLES: Record<string, boolean> = { admin: true, manager: true, employee: false, viewer: false };

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
}

/** A look-ahead hold takes two delivery days, not one. Saying which is the
 *  difference between "we lost tomorrow" and "we lost tomorrow and Friday" —
 *  the second is worth knowing at a glance. */
function HorizonBadge({ hold }: { hold: Hold }) {
  if (hold.horizon !== "tomorrow") return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-purple-700 dark:text-purple-400" title="Held on the next despatch day's shortfall, so its tag removes two delivery days">
      <CalendarDays className="w-3 h-3" /> next despatch day too
    </span>
  );
}

function VerifyBadge({ hold }: { hold: Hold }) {
  if (hold.dryRun) {
    return <span className="inline-flex items-center gap-1 text-xs text-sky-700 dark:text-sky-400"><FlaskConical className="w-3 h-3" /> dry run</span>;
  }
  if (hold.verifyStatus === "verified") {
    return <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="w-3 h-3" /> Zapiet confirmed</span>;
  }
  if (hold.verifyStatus === "failed") {
    return <span className="inline-flex items-center gap-1 text-xs text-red-700 dark:text-red-400" title={hold.verifyNote ?? undefined}><AlertTriangle className="w-3 h-3" /> NOT blocking — check Zapiet rule</span>;
  }
  if (hold.verifyStatus === "skipped") {
    return <span className="text-xs text-muted-foreground" title={hold.verifyNote ?? undefined}>check skipped</span>;
  }
  return <span className="text-xs text-muted-foreground">verifying…</span>;
}

export function StockGateBanner({ userRole }: { userRole?: string }) {
  const [roles, setRoles] = useState<Record<string, boolean>>(DEFAULT_ROLES);
  const [rolesLoaded, setRolesLoaded] = useState(false);
  const [data, setData] = useState<StatusPayload | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | "run" | null>(null);

  useEffect(() => {
    fetch(`${BASE}/api/app-settings/dashboard_stock_gate_banner_roles`, { credentials: "include" })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.value) { try { setRoles({ ...DEFAULT_ROLES, ...JSON.parse(d.value) }); } catch { /* keep defaults */ } } })
      .catch(() => {})
      .finally(() => setRolesLoaded(true));
  }, []);

  const allowed = rolesLoaded && !!userRole && roles[userRole] === true;

  async function fetchStatus() {
    try {
      const res = await fetch(`${BASE}/api/stock-gating/status`, { credentials: "include" });
      if (!res.ok) return;
      setData(await res.json());
    } catch (err) {
      console.warn("[StockGateBanner] fetch failed:", err);
    }
  }

  useEffect(() => {
    if (!allowed) return;
    fetchStatus();
    const interval = setInterval(fetchStatus, 60_000);
    return () => clearInterval(interval);
  }, [allowed]);

  if (!allowed || !data || data.activeHolds.length === 0) return null;

  const count = data.activeHolds.length;
  const allDry = data.activeHolds.every(h => h.dryRun);
  const anyFailed = data.activeHolds.some(h => !h.dryRun && h.verifyStatus === "failed");

  async function releaseHold(hold: Hold) {
    setBusy(hold.id);
    try {
      const res = await fetch(`${BASE}/api/stock-gating/release/${hold.id}`, { method: "POST", credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({ title: `Released ${hold.recipeName}`, description: hold.dryRun ? "Dry-run hold cleared." : "Tag removed — tomorrow is back in the date picker." });
        fetchStatus();
      } else {
        toast({ title: `Couldn't release ${hold.recipeName}`, description: body.error ?? "Request failed.", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Release failed", description: err instanceof Error ? err.message : "Network error", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function runNow() {
    setBusy("run");
    try {
      const res = await fetch(`${BASE}/api/stock-gating/run`, { method: "POST", credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({ title: "Stock gate checked", description: `${body.productsChecked ?? 0} products checked · ${body.activeHolds ?? 0} on hold.` });
        fetchStatus();
      } else {
        toast({ title: "Check failed", description: body.error ?? "Request failed.", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Check failed", description: err instanceof Error ? err.message : "Network error", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="-mx-6 px-6 pb-2">
      <div className={cn(
        "rounded-xl border bg-card overflow-hidden shadow-sm",
        anyFailed ? "border-red-300 dark:border-red-800" : "border-amber-300 dark:border-amber-800",
      )}>
        <button
          onClick={() => setOpen(true)}
          className={cn(
            "w-full flex items-center gap-2 px-4 py-2.5 transition-colors text-left",
            anyFailed
              ? "bg-red-50 dark:bg-red-950/30 hover:bg-red-100/70 dark:hover:bg-red-900/30"
              : "bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100/70 dark:hover:bg-amber-900/30",
          )}
        >
          <ShieldAlert className={cn("w-4 h-4 flex-shrink-0", anyFailed ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400")} />
          <span className={cn("text-sm font-semibold", anyFailed ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300")}>
            {count} product{count !== 1 ? "s" : ""} held from next-day delivery
            {allDry && <span className="font-normal opacity-70"> (dry run — nothing tagged)</span>}
            {anyFailed && <span className="font-normal"> — a hold isn't blocking, check Zapiet</span>}
          </span>
          <span className="ml-auto flex items-center gap-1 text-xs font-medium opacity-70">
            Review <ArrowRight className="w-3.5 h-3.5" />
          </span>
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-500" /> Held from next-day delivery
            </DialogTitle>
            <DialogDescription>
              These products got close to not covering a despatch, so a tag pulled delivery dates
              from the website's date picker. Within {data.settings.thresholdPacks} packs on today's
              despatch takes tomorrow off
              (<span className="font-mono text-xs px-1 py-0.5 rounded bg-secondary">{data.settings.tag}</span>);
              {data.settings.lookaheadEnabled
                ? <> within {data.settings.lookaheadThresholdPacks} packs on the NEXT despatch day takes
                    that day off as well
                    (<span className="font-mono text-xs px-1 py-0.5 rounded bg-secondary">{data.settings.lookaheadTag}</span>).</>
                : <> the look-ahead horizon is switched off.</>}
              {data.settings.autoRelease
                ? ` Each one releases automatically when its surplus recovers to ${data.settings.releasePacks}+ packs.`
                : " Auto-release is off — release manually when stock recovers."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {data.activeHolds.map(h => (
              <div key={h.id} className="rounded-xl border border-border p-3 flex items-center gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{h.recipeName}</div>
                  <div className="text-xs text-muted-foreground">
                    {h.productTitle && <span>{h.productTitle} · </span>}
                    surplus was {h.surplusAtHold} (≤ {h.thresholdAtHold}) · held {fmtTime(h.heldAt)}
                  </div>
                  <div className="mt-1 flex items-center gap-3 flex-wrap"><VerifyBadge hold={h} /><HorizonBadge hold={h} /></div>
                </div>
                <button
                  onClick={() => releaseHold(h)}
                  disabled={busy !== null}
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-border rounded-lg font-medium hover:bg-secondary disabled:opacity-50"
                >
                  {busy === h.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Release
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border text-xs text-muted-foreground">
            <span>
              {data.lastRun ? `Last check ${fmtTime(data.lastRun.at)} · ${data.lastRun.productsChecked} products` : "No check has run yet"}
              {!data.zapietKeyConfigured && " · Zapiet key not set — holds can't be verified"}
            </span>
            <button
              onClick={runNow}
              disabled={busy !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg font-medium hover:bg-secondary disabled:opacity-50 text-foreground"
            >
              {busy === "run" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Check now
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
