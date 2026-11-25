/**
 * Freezer moves → F2F stock in Shopify, on the screens (Graeme, 25 Nov 2026).
 * Wherever packs go into the freezer (wrapping's Product Freezer, the Wonky
 * Rack transfer, the closing fridge check), and once the switch is on, the
 * screen first shows "These will be added to Shopify: …" and the person
 * confirms. Recipes with no F2F product are named plainly ("No F2F product —
 * add these in Shopify by hand"). After the move, each push says what
 * happened; a failed one is kept for a manager to retry.
 *
 * Switched off (the default), useF2fConfirm().ask() answers straight away
 * with "go ahead, nothing to confirm", so every move works exactly as before.
 *
 * The server decides everything (api-server lib/f2f-freezer-push-rules.ts);
 * this only shows it. Endpoints: routes/f2f-freezer.ts.
 */
import { useCallback, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CloudOff, Loader2, RotateCcw, Snowflake, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { useModalScrollKeeper } from "@/hooks/use-modal-scroll";
import { cn } from "@/lib/utils";

export type F2fSource = "wrap_freezer" | "wonky" | "closing_check";
export interface F2fMoveItem { recipeId: number; packs: number; planItemId?: number | null }

interface PushItem { recipeId: number; recipeName: string; packs: number; line: string }
interface SkipItem { recipeId: number; recipeName: string; packs: number; reason: "no_f2f" | "own_push"; line: string }
export interface F2fPlan { enabled: boolean; push: PushItem[]; skipped: SkipItem[]; heading: string; byHandHeading: string }

export interface F2fPushView {
  id: number; recipeId: number; recipeName?: string; delta: number; status: string; canRetry: boolean;
  productTitle: string | null; userName: string | null; createdAt: string; source: F2fSource;
  tone: "ok" | "bad" | "off" | "busy"; text: string;
}
export interface F2fMoveResult { pushes: F2fPushView[]; skipped: SkipItem[]; errors: string[] }

const STATUS_KEY = ["f2f-freezer-status"];
export const F2F_PUSHES_KEY = ["f2f-freezer-pushes"];

async function json<T>(res: Response, fallback: string): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? fallback);
  return body as T;
}

const fetchStatus = async (): Promise<{ enabled: boolean }> =>
  json(await fetch("/api/f2f-freezer/status", { credentials: "include" }), "Couldn't check the Shopify switch");

/** Is the F2F → Shopify push switched on? (Cached 30 seconds.) */
export function useF2fPushEnabled() {
  return useQuery<{ enabled: boolean }>({ queryKey: STATUS_KEY, queryFn: fetchStatus, staleTime: 30_000 });
}

async function fetchPlan(source: F2fSource, items: F2fMoveItem[]): Promise<F2fPlan> {
  return json(await fetch("/api/f2f-freezer/preview", {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, items }),
  }), "Couldn't check what goes to Shopify");
}

export interface F2fAnswer {
  /** false = the person cancelled: don't move anything. */
  proceed: boolean;
  /** Send as f2fConfirmed. */
  confirmed: boolean;
}

/**
 * `ask(source, items)` before a freezer move: resolves at once when the
 * switch is off or nothing would go to Shopify; otherwise opens the confirm
 * and resolves when the person answers. Render `dialog` somewhere.
 */
export function useF2fConfirm(): { ask: (source: F2fSource, items: F2fMoveItem[]) => Promise<F2fAnswer>; dialog: ReactNode } {
  const qc = useQueryClient();
  useF2fPushEnabled(); // keep the switch warm, so asking is instant
  const [plan, setPlan] = useState<F2fPlan | null>(null);
  const resolver = useRef<((a: F2fAnswer) => void) | null>(null);

  const ask = useCallback(async (source: F2fSource, items: F2fMoveItem[]): Promise<F2fAnswer> => {
    const wanted = items.filter(i => i.packs > 0);
    if (!wanted.length) return { proceed: true, confirmed: false };
    const on = await qc.fetchQuery({ queryKey: STATUS_KEY, queryFn: fetchStatus, staleTime: 30_000 })
      .then(s => s.enabled).catch(() => false);
    // Switched off: exactly as before.
    if (!on) return { proceed: true, confirmed: false };
    let p: F2fPlan;
    try {
      p = await fetchPlan(source, wanted);
    } catch (err) {
      toast({
        title: "Couldn't check Shopify first",
        description: `${err instanceof Error ? err.message : String(err)} — the packs will still be moved; a manager can retry the Shopify update.`,
        variant: "destructive",
      });
      return { proceed: true, confirmed: false };
    }
    if (!p.enabled || !p.push.length) {
      if (p.skipped.some(s => s.reason === "no_f2f")) showByHand(p.byHandHeading, p.skipped);
      return { proceed: true, confirmed: false };
    }
    return new Promise<F2fAnswer>(resolve => { resolver.current = resolve; setPlan(p); });
  }, [qc]);

  const answer = (a: F2fAnswer) => { resolver.current?.(a); resolver.current = null; setPlan(null); };
  const dialog = plan ? (
    <F2fConfirmDialog plan={plan} onConfirm={() => answer({ proceed: true, confirmed: true })} onCancel={() => answer({ proceed: false, confirmed: false })} />
  ) : null;
  return { ask, dialog };
}

function showByHand(heading: string, skipped: SkipItem[]) {
  const byHand = skipped.filter(s => s.reason === "no_f2f");
  if (byHand.length) toast({ title: heading, description: byHand.map(s => s.line).join(" · ") });
}

/** After the move: one toast per outcome, worst news loudest. */
export function reportF2fResult(f2f: F2fMoveResult | null | undefined, onChanged?: () => void) {
  if (!f2f) return;
  for (const e of f2f.errors) toast({ title: "Shopify not updated", description: e, variant: "destructive" });
  const bad = f2f.pushes.filter(p => p.tone === "bad");
  const ok = f2f.pushes.filter(p => p.tone === "ok");
  const off = f2f.pushes.filter(p => p.tone === "off" || p.tone === "busy");
  if (bad.length) toast({ title: "Shopify F2F update failed", description: bad.map(p => p.text).join(" · "), variant: "destructive" });
  if (off.length) toast({ title: "Not added to Shopify", description: off.map(p => p.text).join(" · ") });
  if (ok.length) toast({ title: "Added to Shopify ✓", description: ok.map(p => p.text).join(" · ") });
  showByHand("No F2F product — add these in Shopify by hand:", f2f.skipped);
  if (f2f.pushes.length) onChanged?.();
}

function F2fConfirmDialog({ plan, onConfirm, onCancel }: { plan: F2fPlan; onConfirm: () => void; onCancel: () => void }) {
  useModalScrollKeeper();
  const byHand = plan.skipped.filter(s => s.reason === "no_f2f");
  const own = plan.skipped.filter(s => s.reason === "own_push");
  // A portal, like ShopifyConfirmDialog: station panels use backdrop-blur,
  // which would otherwise trap this overlay under the panel below.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-3 sm:p-4" role="dialog" aria-modal="true" aria-label="Add to Shopify?">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[92dvh] flex flex-col">
        <div className="flex items-start gap-3 p-5 pb-3">
          <div className="w-11 h-11 rounded-full bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center flex-shrink-0">
            <Snowflake className="w-6 h-6 text-sky-600 dark:text-sky-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-display text-xl font-bold">Add to Shopify?</p>
            <p className="text-sm text-muted-foreground">These packs are going into the freezer.</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close" className="w-11 h-11 -mr-2 -mt-1 rounded-full flex items-center justify-center hover:bg-secondary">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 pb-3 space-y-4 overflow-y-auto">
          <div>
            <p className="font-semibold mb-2">{plan.heading}</p>
            <ul className="space-y-2">
              {plan.push.map(p => (
                <li key={`${p.recipeId}-${p.line}`} className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-4 py-3">
                  <p className="font-semibold">{p.recipeName}</p>
                  <p className="text-sm text-emerald-800 dark:text-emerald-300">{p.line}</p>
                </li>
              ))}
            </ul>
          </div>
          {byHand.length > 0 && (
            <div>
              <p className="font-semibold mb-2 text-amber-800 dark:text-amber-300">{plan.byHandHeading}</p>
              <ul className="space-y-2">
                {byHand.map(s => (
                  <li key={`${s.recipeId}-${s.line}`} className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-4 py-3 text-sm">{s.line}</li>
                ))}
              </ul>
            </div>
          )}
          {own.length > 0 && (
            <ul className="space-y-1 text-sm text-muted-foreground">{own.map(s => <li key={`${s.recipeId}-own`}>{s.line}</li>)}</ul>
          )}
        </div>
        <div className="p-5 pt-3 border-t border-border flex flex-col-reverse sm:flex-row gap-2">
          <button type="button" onClick={onCancel} className="h-14 flex-1 rounded-xl border-2 border-border font-semibold hover:bg-secondary">Cancel — move nothing</button>
          <button type="button" onClick={onConfirm} className="h-14 flex-1 rounded-xl bg-primary text-primary-foreground font-bold text-lg">Yes — move and add</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Failed pushes (managers) ────────────────────────────────────────────────

interface PushesResponse { open: F2fPushView[]; recent: F2fPushView[] }

export function useCanRetryF2f(): boolean {
  const { state } = useAuth();
  return state.status === "authenticated" && (state.user.role === "admin" || state.user.role === "manager");
}

export function useF2fPushes(enabled: boolean) {
  return useQuery<PushesResponse>({
    queryKey: F2F_PUSHES_KEY,
    enabled,
    queryFn: async () => json(await fetch("/api/f2f-freezer/pushes", { credentials: "include" }), "Couldn't load the Shopify updates"),
    refetchInterval: 60_000,
  });
}

/**
 * Shopify F2F updates that need someone — failed, untracked skips, stuck —
 * with Retry. Managers and admins only (renders nothing for anyone else).
 * `compact`: a banner for the stations, hidden when nothing is open.
 */
export function F2fPushFailures({ compact = false }: { compact?: boolean }) {
  const canRetry = useCanRetryF2f();
  const qc = useQueryClient();
  const q = useF2fPushes(canRetry);
  const retry = useMutation({
    mutationFn: async (id: number) => json<F2fPushView>(await fetch(`/api/f2f-freezer/pushes/${id}/retry`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
    }), "Retry failed"),
    onSuccess: (row) => toast({ title: row.tone === "ok" ? "Added to Shopify ✓" : "Shopify still not updated", description: row.text, variant: row.tone === "bad" ? "destructive" : undefined }),
    onError: (e: Error) => toast({ title: "Retry failed", description: e.message, variant: "destructive" }),
    onSettled: () => qc.invalidateQueries({ queryKey: F2F_PUSHES_KEY }),
  });
  if (!canRetry) return null;
  const open = q.data?.open ?? [];
  if (compact && !open.length) return null;
  return (
    <div className={cn("rounded-2xl border-2 p-4 space-y-3", open.length ? "border-red-300 bg-red-50/60 dark:border-red-800 dark:bg-red-950/20" : "border-border bg-card")}>
      <p className="font-semibold flex items-center gap-2">
        {open.length ? <AlertTriangle className="w-5 h-5 text-red-600" /> : <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
        {open.length ? `${open.length} F2F Shopify update${open.length === 1 ? "" : "s"} need${open.length === 1 ? "s" : ""} checking` : "Every F2F Shopify update went through"}
      </p>
      {q.isLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
      {q.error && <p className="text-sm text-red-700">{(q.error as Error).message}</p>}
      {open.length > 0 && (
        <ul className="space-y-2">
          {open.map(p => (
            <li key={p.id} className="rounded-xl bg-card border border-border px-4 py-3 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[14rem]">
                <p className="font-semibold">{p.recipeName ?? `Recipe ${p.recipeId}`}</p>
                <p className="text-sm text-muted-foreground">{p.text}</p>
                <p className="text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{p.userName ? ` · ${p.userName}` : ""}</p>
              </div>
              {p.canRetry ? (
                <button type="button" onClick={() => retry.mutate(p.id)} disabled={retry.isPending}
                  className="h-12 px-5 rounded-xl bg-red-600 text-white font-bold flex items-center gap-2 hover:bg-red-700 disabled:opacity-50">
                  {retry.isPending && retry.variables === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />} Retry
                </button>
              ) : (
                <span className="text-sm text-muted-foreground flex items-center gap-1"><CloudOff className="w-4 h-4" /> Check Shopify before doing anything</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── The switch (admins turn it on; it refuses until every core recipe is linked) ──

interface SettingResponse { enabled: boolean; canTurnOn: boolean; reasons: string[]; unlinkedCore: string[]; writesBlocked: boolean }

export function F2fPushSwitch() {
  const { state } = useAuth();
  const isAdmin = state.status === "authenticated" && state.user.role === "admin";
  const qc = useQueryClient();
  const q = useQuery<SettingResponse>({
    queryKey: ["f2f-freezer-setting"],
    queryFn: async () => json(await fetch("/api/f2f-freezer/setting", { credentials: "include" }), "Couldn't load the switch"),
  });
  const save = useMutation({
    mutationFn: async (enabled: boolean) => json<{ enabled: boolean }>(await fetch("/api/f2f-freezer/setting", {
      method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }),
    }), "Couldn't change the switch"),
    onSuccess: (r) => toast({ title: r.enabled ? "Freezer packs now go to Shopify" : "Freezer packs no longer go to Shopify" }),
    onError: (e: Error) => toast({ title: "Not switched on", description: e.message, variant: "destructive" }),
    onSettled: () => { qc.invalidateQueries({ queryKey: ["f2f-freezer-setting"] }); qc.invalidateQueries({ queryKey: STATUS_KEY }); },
  });
  const s = q.data;
  if (!s) return q.isLoading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /> : null;
  return (
    <div className={cn("rounded-2xl border-2 p-4 space-y-3", s.enabled ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/20" : "border-border bg-card")}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[14rem]">
          <p className="font-semibold">Add freezer packs to the F2F products in Shopify</p>
          <p className="text-sm text-muted-foreground">
            {s.enabled
              ? "On: packs going into the freezer (wrapping, the Wonky Rack, the closing fridge check) are added to the recipe's F2F product in Shopify, after the team confirms."
              : "Off: freezer moves only change the app's stock, as before."}
          </p>
        </div>
        {isAdmin ? (
          <button type="button" onClick={() => save.mutate(!s.enabled)} disabled={save.isPending || (!s.enabled && !s.canTurnOn)}
            className={cn("h-12 px-5 rounded-xl font-bold disabled:opacity-50", s.enabled ? "border-2 border-border hover:bg-secondary" : "bg-primary text-primary-foreground")}>
            {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : s.enabled ? "Switch off" : "Switch on"}
          </button>
        ) : (
          <span className="text-sm font-semibold">{s.enabled ? "On" : "Off"} · an admin switches it</span>
        )}
      </div>
      {!s.enabled && s.reasons.length > 0 && (
        <ul className="rounded-xl bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-200 space-y-1">
          <li className="font-semibold">It can't be switched on yet:</li>
          {s.reasons.map(r => <li key={r}>{r}</li>)}
        </ul>
      )}
      {s.enabled && s.unlinkedCore.length > 0 && (
        <p className="rounded-xl bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          No F2F product yet, so their freezer packs are not added: {s.unlinkedCore.join(", ")}.
        </p>
      )}
      {s.writesBlocked && <p className="text-sm text-muted-foreground">Shopify writes are switched off on this server, so nothing is actually sent from here.</p>}
    </div>
  );
}
