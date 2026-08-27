// Dashboard banner: products currently held back from next-day delivery by
// the stock gate (fridge-vs-despatch surplus ran low, so a Shopify tag +
// Zapiet prep-time rule pulled tomorrow from the date picker). Self-hides
// when there are no live holds. Same shape as EightPackOrdersBanner.

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ShieldAlert, Loader2, ArrowRight, CheckCircle2, AlertTriangle, FlaskConical } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

interface Hold {
  id: number;
  recipeName: string;
  productTitle: string | null;
  tag: string;
  surplusAtHold: number;
  thresholdAtHold: number;
  dryRun: boolean;
  verifyStatus: string | null;
  verifyNote: string | null;
  heldAt: string;
}
interface StatusPayload {
  settings: { enabled: boolean; dryRun: boolean; thresholdPacks: number; releasePacks: number; autoRelease: boolean; tag: string };
  zapietKeyConfigured: boolean;
  lastRun: { at: string; ok: boolean; note: string; productsChecked: number } | null;
  activeHolds: Hold[];
}

const DEFAULT_ROLES: Record<string, boolean> = { admin: true, manager: true, employee: false, viewer: false };

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
}

// The Zapiet check tells us what Zapiet's calendar API says, which is NOT the
// same as what the website does — so nothing here claims a hold "isn't
// blocking". A hold that was genuinely blocking got reported that way, and a
// safety banner that cries wolf is worse than no banner (Graeme, 2026-08-27).
function VerifyBadge({ hold }: { hold: Hold }) {
  if (hold.dryRun) {
    return <span className="inline-flex items-center gap-1 text-xs text-sky-700 dark:text-sky-400"><FlaskConical className="w-3 h-3" /> dry run</span>;
  }
  if (hold.verifyStatus === "verified") {
    return <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="w-3 h-3" /> Zapiet confirmed</span>;
  }
  if (hold.verifyStatus === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400" title={hold.verifyNote ?? undefined}>
        <AlertTriangle className="w-3 h-3" /> not confirmed by Zapiet — the tag is on, check the site
      </span>
    );
  }
  if (hold.verifyStatus === "unconfirmed") {
    return <span className="text-xs text-muted-foreground" title={hold.verifyNote ?? undefined}>still checking…</span>;
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
    // One appearance, always amber: a hold is information, not an emergency.
    // The banner used to go red whenever the Zapiet check came back
    // unconfirmed, which turned an unreliable check into an alarm.
    <div className="-mx-6 px-6 pb-2">
      <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-card overflow-hidden shadow-sm">
        <button
          onClick={() => setOpen(true)}
          className="w-full flex items-center gap-2 px-4 py-2.5 text-left transition-colors bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100/70 dark:hover:bg-amber-900/30"
        >
          <ShieldAlert className="w-4 h-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">
            {count} product{count !== 1 ? "s" : ""} held from next-day delivery
            {allDry && <span className="font-normal opacity-70"> (dry run — nothing tagged)</span>}
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
              These products got within {data.settings.thresholdPacks} packs of not covering today's despatch, so the
              <span className="font-mono text-xs mx-1 px-1 py-0.5 rounded bg-secondary">{data.settings.tag}</span>
              tag pulled tomorrow from the website's date picker.
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
                  <div className="mt-1"><VerifyBadge hold={h} /></div>
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
