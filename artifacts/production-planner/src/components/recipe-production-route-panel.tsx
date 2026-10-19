/**
 * "Production route" on the recipe editor (migration 0202). Objective A: a
 * product that takes a different path through the kitchen is set up here —
 * the code reads these flags, never product names. Each change saves at
 * once with a visible save state (charter rule 5). Admin edits; others see.
 *
 * The wrap-to-Shopify location is one setting for every recipe, shown here
 * when "Send to Shopify on every wrap" is on.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, AlertTriangle, Route } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useRecipeRoutes, RECIPE_ROUTES_QUERY_KEY } from "@/lib/recipe-routes";
import { cn } from "@/lib/utils";

type Patch = Partial<{ skipOvens: boolean; defaultStorage: "fridge" | "freezer"; shopifyPushOnWrap: boolean; excludeFromKpis: boolean; calzoneBatchEquivalent: number | null; billetWeightG: number | null }>;

interface WrapSettings {
  locationId: string | null;
  writesBlocked: boolean;
  locations: Array<{ id: string; name: string; isActive: boolean }> | null;
  locationsError: string | null;
}

export function RecipeProductionRoutePanel({ recipeId, portionsPerBatch, packSize }: { recipeId: number; portionsPerBatch?: number | null; packSize?: number | string | null }) {
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.user.role : null;
  const isAdmin = role === "admin";
  const canSeeSettings = role === "admin" || role === "manager";
  const queryClient = useQueryClient();
  const { routeOf, isLoading } = useRecipeRoutes();
  const route = routeOf(recipeId);

  const save = useMutation({
    mutationFn: async (patch: Patch) => {
      const res = await fetch(`/api/recipes/${recipeId}/production-route`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(b?.error ?? `Couldn't save (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RECIPE_ROUTES_QUERY_KEY }),
  });

  const [eqDraft, setEqDraft] = useState<string>("");
  useEffect(() => {
    setEqDraft(route.calzoneBatchEquivalent == null ? "" : String(Math.round(route.calzoneBatchEquivalent * 1000) / 1000));
  }, [route.calzoneBatchEquivalent]);
  const commitEq = () => {
    const v = eqDraft.trim();
    const next = v === "" ? null : Number(v);
    if (next !== null && (!Number.isFinite(next) || next < 0)) return;
    if (next === route.calzoneBatchEquivalent) return;
    save.mutate({ calzoneBatchEquivalent: next });
  };

  // Billet portion weight (migration 0203): grams each billet of dough is
  // portioned to at the dough station. Blank = the dough per batch.
  const [billetDraft, setBilletDraft] = useState<string>("");
  useEffect(() => {
    setBilletDraft(route.billetWeightG == null ? "" : String(route.billetWeightG));
  }, [route.billetWeightG]);
  const commitBillet = () => {
    const v = billetDraft.trim();
    const next = v === "" ? null : Math.round(Number(v));
    if (next !== null && (!Number.isFinite(next) || next <= 0)) return;
    if (next === route.billetWeightG) return;
    save.mutate({ billetWeightG: next });
  };

  const settings = useQuery<WrapSettings>({
    queryKey: ["shopify-wrap-settings"],
    enabled: canSeeSettings && route.shopifyPushOnWrap,
    queryFn: async () => {
      const res = await fetch("/api/shopify-wrap-pushes/settings", { credentials: "include" });
      if (!res.ok) throw new Error("Couldn't load the Shopify setting");
      return res.json();
    },
  });
  const saveLocation = useMutation({
    mutationFn: async (locationId: string | null) => {
      const res = await fetch("/api/shopify-wrap-pushes/settings", {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locationId }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(b?.error ?? `Couldn't save (${res.status})`);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shopify-wrap-settings"] }),
  });

  const ppb = Math.max(1, Math.floor((Number(portionsPerBatch) || 10) / (Number(packSize) || 2)));
  const busy = save.isPending || isLoading;

  const Toggle = ({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) => (
    <label className={cn("flex items-start gap-3 rounded-lg border border-border px-3 py-2.5", isAdmin ? "cursor-pointer hover:bg-secondary/30" : "opacity-80")}>
      <input type="checkbox" className="mt-0.5 w-5 h-5" checked={value} disabled={!isAdmin || busy} onChange={e => onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );

  return (
    <div className="mt-4 border-t border-border pt-4 space-y-2">
      <div className="flex items-center gap-2">
        <Route className="w-4 h-4 text-muted-foreground" />
        <h4 className="text-sm font-semibold">Production route</h4>
        <span className="ml-auto text-xs flex items-center gap-1">
          {save.isPending && <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>}
          {save.isSuccess && !save.isPending && <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Saved</span>}
          {save.isError && <span className="text-red-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {(save.error as Error).message}</span>}
        </span>
      </div>
      {!isAdmin && <p className="text-xs text-muted-foreground">Only an admin can change the route.</p>}
      <div className="grid gap-2 md:grid-cols-2">
        <Toggle label="No ovens step — wrap straight after building" hint="Leaves the ovens station; wrapping works to the builders' confirmed batches." value={route.skipOvens} onChange={v => save.mutate({ skipOvens: v })} />
        <Toggle label="Wrap into the freezer" hint="The wrapping station sends packs to the Product Freezer unless the wrapper flips it." value={route.defaultStorage === "freezer"} onChange={v => save.mutate({ defaultStorage: v ? "freezer" : "fridge" })} />
        <Toggle label="Send to Shopify on every wrap" hint="Each freezer add adds the packs to the linked Shopify variant; taking packs back out takes them off." value={route.shopifyPushOnWrap} onChange={v => save.mutate({ shopifyPushOnWrap: v })} />
        <Toggle label="Leave out of the calzone KPIs" hint="Not in batches per hour, team efficiency, defects or calzone batch counts. Still on every station." value={route.excludeFromKpis} onChange={v => save.mutate({ excludeFromKpis: v })} />
      </div>
      <div className="rounded-lg border border-border px-3 py-2.5 flex flex-wrap items-center gap-2 text-sm">
        <span>One batch uses</span>
        <input
          type="number" min={0} step={0.01} inputMode="decimal"
          value={eqDraft} placeholder="1"
          disabled={!isAdmin || busy}
          onChange={e => setEqDraft(e.target.value)}
          onBlur={commitEq}
          onKeyDown={e => { if (e.key === "Enter") commitEq(); }}
          className="w-20 h-10 px-2 rounded-lg border border-border bg-background text-center tabular-nums"
        />
        <span>calzone batches of the day's capacity</span>
        <span className="text-xs text-muted-foreground w-full">
          Blank = 1 (the normal rule). {route.calzoneBatchEquivalent != null
            ? `So ${ppb * 6} packs (6 batches) use ${Math.round(route.calzoneBatchEquivalent * 6 * 10) / 10} batches of capacity.`
            : `Example: 48 packs ≈ 20 calzone batches at ${ppb} packs a batch is ${Math.round((20 / Math.max(1, 48 / ppb)) * 1000) / 1000}.`}
        </span>
      </div>
      <div className="rounded-lg border border-border px-3 py-2.5 flex flex-wrap items-center gap-2 text-sm">
        <span>Portion each billet at</span>
        <input
          type="number" min={1} step={1} inputMode="numeric"
          value={billetDraft} placeholder="—"
          disabled={!isAdmin || busy}
          onChange={e => setBilletDraft(e.target.value)}
          onBlur={commitBillet}
          onKeyDown={e => { if (e.key === "Enter") commitBillet(); }}
          className="w-24 h-10 px-2 rounded-lg border border-border bg-background text-center tabular-nums"
        />
        <span>g</span>
        <span className="text-xs text-muted-foreground w-full">
          For dough sheeted whole (one billet a batch), not balled. The dough is still made at the recipe's dough per batch — the difference is the spare for wastage. Blank = portion the full dough per batch.
        </span>
      </div>
      {route.shopifyPushOnWrap && canSeeSettings && (
        <div className="rounded-lg border border-border px-3 py-2.5 space-y-1.5 text-sm">
          <p className="font-medium">Shopify location the wraps go to (every recipe)</p>
          {settings.isLoading && <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</p>}
          {settings.data && (
            <>
              <select
                value={settings.data.locationId ?? ""}
                disabled={!isAdmin || saveLocation.isPending}
                onChange={e => saveLocation.mutate(e.target.value || null)}
                className="h-10 px-2 rounded-lg border border-border bg-background w-full max-w-md"
              >
                <option value="">— Not chosen: wraps will fail until one is —</option>
                {(settings.data.locations ?? []).map(l => (
                  <option key={l.id} value={l.id}>{l.name}{l.isActive ? "" : " (inactive)"}</option>
                ))}
                {settings.data.locationId && !(settings.data.locations ?? []).some(l => l.id === settings.data!.locationId) && (
                  <option value={settings.data.locationId}>{settings.data.locationId}</option>
                )}
              </select>
              {saveLocation.isPending && <p className="text-xs text-muted-foreground">Saving…</p>}
              {saveLocation.isError && <p className="text-xs text-red-600">{(saveLocation.error as Error).message}</p>}
              {settings.data.locationsError && <p className="text-xs text-red-600">Couldn't read Shopify's locations: {settings.data.locationsError}</p>}
              {settings.data.writesBlocked && <p className="text-xs text-amber-700 dark:text-amber-400">Shopify writes are switched off on this server — wraps here are recorded as "not sent".</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
