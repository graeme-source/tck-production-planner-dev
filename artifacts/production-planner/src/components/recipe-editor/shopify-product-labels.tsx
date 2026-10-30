/**
 * "Also set up in the app" in the Create Shopify product window (Graeme,
 * 30 Oct 2026: "automatically generate a back label print for it at the same
 * time" … "include front label generation as well"). Objectives A and D.
 *
 * Shows the SAME label images the recipe's label page shows (its own
 * endpoints: /api/product-labels/recipes/:id for the back label — template
 * picked the label page's way — and /api/product-front-label/:id/preview for
 * the front name label), each with a tick. What starts ticked, and why one
 * can't be set up, is @workspace/product-labels backLabelPlan / frontLabelPlan.
 * On Create, the server publishes / switches on through the label page's own
 * paths. Labels are never sent to Shopify.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, Tag } from "lucide-react";
import { backLabelPlan, frontLabelPlan, type LabelSetupPlan } from "@workspace/product-labels";
import { cn } from "@/lib/utils";
import { useRecipeLabel } from "@/components/product-labels/api";
import { ProofImage } from "@/components/product-labels/proof-image";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface FrontPreview { name: string; isDefault: boolean; canPrint: boolean; png: string | null }

export interface LabelSetup {
  loading: boolean;
  back: { plan: LabelSetupPlan | null; ticked: boolean; set: (v: boolean) => void; hash: string | null; title: string };
  front: { plan: LabelSetupPlan | null; ticked: boolean; set: (v: boolean) => void };
  /** What the create sends. */
  payload: { backLabelHash: string | null; frontLabel: boolean };
}

/** The two labels' state and ticks. A tick the person hasn't touched
 *  follows the plan (so it updates when e.g. a barcode is typed). */
export function useLabelSetup(recipeId: number): LabelSetup & { backQuery: ReturnType<typeof useRecipeLabel>; frontQuery: ReturnType<typeof useFrontPreview> } {
  const backQuery = useRecipeLabel(recipeId);
  const frontQuery = useFrontPreview(recipeId);
  const [backChoice, setBackChoice] = useState<boolean | null>(null);
  const [frontChoice, setFrontChoice] = useState<boolean | null>(null);

  const b = backQuery.data;
  const backPlan = b ? backLabelPlan({
    hasLive: !!b.live, liveVersionNo: b.live?.versionNo ?? null, matchesLive: b.matchesLive, fits: b.current.proof.fits, blockers: b.blockers,
  }) : null;
  const f = frontQuery.data;
  const frontPlan = f ? frontLabelPlan({ isDefault: f.isDefault, canPrint: f.canPrint }) : null;

  const backTicked = !!backPlan?.canSetUp && (backChoice ?? backPlan.ticked);
  const frontTicked = !!frontPlan?.canSetUp && (frontChoice ?? frontPlan.ticked);
  return {
    loading: backQuery.isLoading || frontQuery.isLoading,
    back: { plan: backPlan, ticked: backTicked, set: setBackChoice, hash: b?.current.hash ?? null, title: b?.roleTitle ?? "Back label" },
    front: { plan: frontPlan, ticked: frontTicked, set: setFrontChoice },
    payload: { backLabelHash: backTicked ? b?.current.hash ?? null : null, frontLabel: frontTicked },
    backQuery,
    frontQuery,
  };
}

function useFrontPreview(recipeId: number) {
  // Same key as the label page's front label, so a change there shows here.
  return useQuery({
    queryKey: ["front-label-preview", recipeId, ""],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/product-front-label/${recipeId}/preview`, { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Couldn't load (${res.status})`);
      return body as FrontPreview;
    },
  });
}

function TickCard({ title, plan, ticked, onChange, tickLabel, recipeId, children }: {
  title: string; plan: LabelSetupPlan | null; ticked: boolean; onChange: (v: boolean) => void; tickLabel: string; recipeId: number; children: React.ReactNode;
}) {
  const refused = !!plan?.refused;
  return (
    <div className={cn("rounded-2xl border-2 p-3.5 space-y-2", ticked ? "border-emerald-500/50 bg-emerald-500/5" : "border-border")}>
      <p className="text-base font-bold flex items-center gap-2"><Tag className="w-5 h-5 text-emerald-600" /> {title}</p>
      {children}
      {plan && (
        <>
          {plan.canSetUp ? (
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={ticked} onChange={e => onChange(e.target.checked)} className="w-6 h-6 mt-0.5 accent-emerald-600 shrink-0" />
              <span className="text-base font-semibold">{tickLabel}</span>
            </label>
          ) : null}
          <p className={cn("text-sm flex items-start gap-1.5", refused ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground")}>
            {refused ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> : !plan.canSetUp ? <Check className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" /> : null}
            <span>{plan.reason}</span>
          </p>
          {refused && <Link href={`/labels/${recipeId}`} className="text-sm font-semibold text-primary underline underline-offset-2">Open the recipe's label page</Link>}
        </>
      )}
    </div>
  );
}

export function LabelSetupSection({ recipeId, setup }: { recipeId: number; setup: ReturnType<typeof useLabelSetup> }) {
  const b = setup.backQuery.data;
  const f = setup.frontQuery.data;
  return (
    <section className="space-y-3">
      <h3 className="text-lg font-bold">Also set up in the app <span className="text-sm font-normal text-muted-foreground">— labels aren't sent to Shopify</span></h3>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <TickCard
          title={setup.back.title}
          plan={setup.back.plan}
          ticked={setup.back.ticked}
          onChange={setup.back.set}
          tickLabel={b?.live ? `Publish the ${setup.back.title.toLowerCase()} too — updates the live version` : `Publish the ${setup.back.title.toLowerCase()} too`}
          recipeId={recipeId}
        >
          {setup.backQuery.isLoading && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Drawing the label…</p>}
          {setup.backQuery.error && <p className="text-sm text-destructive">Couldn't draw the label — {(setup.backQuery.error as Error).message}</p>}
          {b && (
            <>
              <ProofImage proof={b.current.proof} className="w-full" />
              <p className="text-xs text-muted-foreground">Template: {b.template.name} · {b.template.sizeText}{b.live ? ` · live version ${b.live.versionNo}` : " · never published"}</p>
            </>
          )}
        </TickCard>
        <TickCard
          title="Front label — 102 × 25 mm"
          plan={setup.front.plan}
          ticked={setup.front.ticked}
          onChange={setup.front.set}
          tickLabel="Set up the front label too"
          recipeId={recipeId}
        >
          {setup.frontQuery.isLoading && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Drawing the front label…</p>}
          {setup.frontQuery.error && <p className="text-sm text-destructive">Couldn't draw the front label — {(setup.frontQuery.error as Error).message}</p>}
          {f?.png && <img src={f.png} alt={`Front label: ${f.name}`} className="w-full rounded-lg ring-1 ring-border bg-white" />}
        </TickCard>
      </div>
    </section>
  );
}
