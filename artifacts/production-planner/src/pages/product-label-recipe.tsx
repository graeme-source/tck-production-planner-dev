/**
 * One recipe's pack label: status, the live proof next to the current one,
 * what changed, its label settings (autosaved), and "Update live version".
 * Since 12 Oct 2026 it is the one place for everything about the product:
 * big tabs for Label, Ingredient deck, Nutrition and History (?tab=deck /
 * nutrition / history — every published version, Objective D),
 * replacing the old Product Hub's pop-ups. Objectives A, D and F.
 */
import { useState } from "react";
import { Link, useRoute } from "wouter";
import { AlertTriangle, ArrowLeft, Beaker, CheckCircle2, ChefHat, ClipboardList, History, Info, Loader2, Printer, ShieldCheck, Tag, XCircle } from "lucide-react";
import { areasForChange, FIELD_LABEL, WIDTH_LABEL } from "@workspace/product-labels";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { fmtDateTime, fmtDay, STATUS_TONE, useRecipeLabel, type Proof } from "@/components/product-labels/api";
import { ProofImage, type Area } from "@/components/product-labels/proof-image";
import { PublishDialog, ChangeRow } from "@/components/product-labels/publish-dialog";
import { RecipeLabelSettings } from "@/components/product-labels/recipe-label-settings";
import { BackLabelsDialog } from "@/components/product-labels/back-labels-dialog";
import { FrontLabelPreview, FrontLabelsDialog } from "@/components/product-labels/front-labels-dialog";
import { DeclarationFixButtons } from "@/components/declaration-fix";
import { otherBlockers } from "@/lib/declaration-fix";
import { HubTabs, useCanSeeProductData, useTabParam, type HubTab } from "@/components/product-labels/hub-tabs";
import { DeckPanel } from "@/components/product-labels/deck-panel";
import { NutritionalsPanel } from "@/components/product-labels/nutritionals-panel";
import { LabelHistoryPanel } from "@/components/product-labels/history-panel";

type RecipeTab = "label" | "deck" | "nutrition" | "history";
const ALL_TABS: HubTab<RecipeTab>[] = [
  { key: "label", label: "Label", icon: Tag },
  { key: "deck", label: "Ingredient deck", icon: ClipboardList },
  { key: "nutrition", label: "Nutrition", icon: Beaker },
  // Every published version — open to everyone, like the label (Objective D).
  { key: "history", label: "History", icon: History },
];

export default function ProductLabelRecipePage() {
  const [, params] = useRoute("/labels/:id");
  const id = Number(params?.id);
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.user.role : "viewer";
  const canEdit = role === "admin" || role === "manager";
  const { data, isLoading, error, isFetching } = useRecipeLabel(Number.isFinite(id) ? id : null);
  const [publishing, setPublishing] = useState(false);
  // Test print and "Print labels — today": everyone (Graeme, 2026-10-15).
  const [testPrinting, setTestPrinting] = useState(false);
  // Real labels dated today for a product not on today's plan (2026-10-15).
  const [printingToday, setPrintingToday] = useState(false);
  // Front name labels, 102 x 25 mm (#331): anyone, like the back labels.
  const [printingFront, setPrintingFront] = useState(false);
  // Deck and nutrition keep the old Product Hub's access level.
  const canSeeData = useCanSeeProductData();
  const tabs = canSeeData ? ALL_TABS : ALL_TABS.filter(t => t.key === "label" || t.key === "history");
  const [tab, setTab] = useTabParam(tabs.map(t => t.key));

  if (isLoading) return <div className="flex items-center gap-2 text-muted-foreground py-10"><Loader2 className="w-5 h-5 animate-spin" /> Building the label…</div>;
  if (error || !data) return <p className="text-destructive">Couldn't load this label — {(error as Error | null)?.message ?? "not found"}</p>;

  const highlight: Area[] = [...new Set(data.changes.flatMap(c => areasForChange(c.key)))];
  const cur = data.current.proof;

  return (
    <div className="space-y-5">
      <PageHeader title={`${data.recipe.name} — label`} description="The live label is what prints. Changes to the recipe show here and wait for someone to check them." />

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/labels" className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border-2 border-border bg-card font-semibold hover:bg-secondary"><ArrowLeft className="w-5 h-5" /> All labels</Link>
        <Link href={`/recipes?edit=${data.recipe.id}`} className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border-2 border-border bg-card font-semibold hover:bg-secondary"><ChefHat className="w-5 h-5" /> {data.recipe.name} recipe</Link>
        {isFetching && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPrintingToday(true)}
            className="inline-flex items-center gap-2 h-11 px-4 rounded-xl bg-primary text-primary-foreground font-bold hover:bg-primary/90"
          >
            <Printer className="w-5 h-5" /> Print labels — today
          </button>
          {data.template.backLabel && (
            <button
              type="button"
              onClick={() => setPrintingFront(true)}
              className="inline-flex items-center gap-2 h-11 px-4 rounded-xl bg-primary text-primary-foreground font-bold hover:bg-primary/90"
            >
              <Printer className="w-5 h-5" /> Print front labels
            </button>
          )}
          <button
            type="button"
            onClick={() => setTestPrinting(true)}
            className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border-2 border-border bg-card font-semibold hover:bg-secondary"
          >
            <Printer className="w-5 h-5" /> Test print
          </button>
        </div>
      </div>

      {tabs.length > 1 && <HubTabs tabs={tabs} value={tab} onChange={setTab} />}

      {tab === "deck" ? (
        <section className="rounded-2xl border-2 border-border bg-card p-5">
          <DeckPanel recipe={data.recipe} />
        </section>
      ) : tab === "history" ? (
        <LabelHistoryPanel recipeId={data.recipe.id} />
      ) : tab === "nutrition" ? (
        <section className="rounded-2xl border-2 border-border bg-card p-5">
          <NutritionalsPanel recipe={data.recipe} />
        </section>
      ) : (<>
      {/* Status */}
      <section className={cn("rounded-2xl border-2 p-5 space-y-3", STATUS_TONE[data.status])}>
        <div className="flex flex-wrap items-center gap-3">
          {data.status === "live" ? <CheckCircle2 className="w-8 h-8" /> : data.status === "doesnt-fit" ? <XCircle className="w-8 h-8" /> : <AlertTriangle className="w-8 h-8" />}
          <div className="flex-1 min-w-0">
            <p className="text-2xl font-bold">{data.status === "update-needed" ? "Label update needed" : data.status === "doesnt-fit" ? "DOESN'T FIT" : data.statusLabel}</p>
            <p className="text-base">
              {data.live
                ? <>Live: version {data.live.versionNo}, published {fmtDateTime(data.live.publishedAt)}{data.live.publishedByName ? ` by ${data.live.publishedByName}` : ""}.</>
                : "No live version yet — nothing will print until one is published."}
            </p>
          </div>
          {canEdit && !data.matchesLive && !data.recipe.archived && (
            <button onClick={() => setPublishing(true)} className="h-12 px-5 rounded-xl bg-primary text-primary-foreground font-bold inline-flex items-center gap-2 shadow">
              <ShieldCheck className="w-5 h-5" /> Update live version
            </button>
          )}
        </div>
        {data.changes.length > 0 && (
          <div className="space-y-2 text-foreground">
            <p className="font-semibold">What changed since the live version:</p>
            {data.changes.map(c => <ChangeRow key={c.key} change={c} />)}
          </div>
        )}
        {data.blockers.length > 0 && !data.matchesLive && (
          <div className="rounded-xl bg-card/80 text-foreground p-3">
            <p className="font-semibold">To fix before it can go live:</p>
            {otherBlockers(data.blockers, data.deckBlockers, data.deckIssues).length > 0 && (
              <ul className="list-disc pl-6 space-y-1">{otherBlockers(data.blockers, data.deckBlockers, data.deckIssues).map(b => <li key={b}>{b}</li>)}</ul>
            )}
            <DeclarationFixButtons issues={data.deckIssues ?? []} className="mt-2" />
          </div>
        )}
        {data.warnings.length > 0 && (
          <ul className="list-disc pl-6 space-y-1 text-foreground">{data.warnings.map(w => <li key={w}>{w}</li>)}</ul>
        )}
      </section>

      <p className="flex items-start gap-2 text-sm text-muted-foreground max-w-prose">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        Proof dates are a sample: printed and made today ({fmtDay(data.sample.printDate)}). Real labels use the day they're printed; the batch number comes from the {data.current.snapshot.template.batchBasis === "print-day" ? "print day" : "production day"}. These pictures are the exact {cur.dpi} dpi image the printer will get.
      </p>

      {/* Proofs */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Work on the left, send it to the right (Graeme, 12 Oct 2026). */}
        <div className="space-y-2">
          <h2 className="text-lg font-bold">{data.matchesLive ? "Current — same as live" : "Current — from the recipe as it is now"}</h2>
          <ProofImage proof={cur} highlight={data.matchesLive ? [] : highlight} />
          {/* The small label has no text fields to size — its fixed size instead. */}
          {cur.backLabel ? <FitTable proof={cur} /> : <p className="text-sm text-muted-foreground">Small label, {cur.sizeText} — name, use-by, batch number and barcode.</p>}
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-bold">Live — what prints now</h2>
          {data.live?.proof
            ? <ProofImage proof={data.live.proof} highlight={data.matchesLive ? [] : highlight} showOverflow={false} />
            : <div className="rounded-lg border-2 border-dashed border-border p-10 text-center text-muted-foreground">Never published</div>}
        </div>
      </div>

      {/* Front name labels go with the back label; a small pot label is the only label. */}
      {data.template.backLabel && <FrontLabelPreview recipeId={data.recipe.id} onPrint={() => setPrintingFront(true)} />}

      <RecipeLabelSettings key={data.recipe.id} data={data} canEdit={canEdit} />
      </>)}

      {publishing && <PublishDialog data={data} onClose={() => setPublishing(false)} />}
      {printingToday && (
        <BackLabelsDialog mode="today" recipeId={data.recipe.id} recipeName={data.recipe.name} onClose={() => setPrintingToday(false)} />
      )}
      {printingFront && (
        <FrontLabelsDialog recipeId={data.recipe.id} recipeName={data.recipe.name} onClose={() => setPrintingFront(false)} />
      )}
      {testPrinting && (
        <BackLabelsDialog mode="test" recipeId={data.recipe.id} recipeName={data.recipe.name} onClose={() => setTestPrinting(false)} />
      )}
    </div>
  );
}

function FitTable({ proof }: { proof: Proof }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr><th className="px-3 py-2">Text</th><th className="px-3 py-2">Size</th><th className="px-3 py-2">Font</th><th className="px-3 py-2">x-height</th><th className="px-3 py-2">Fits</th></tr>
        </thead>
        <tbody>
          {proof.fields.map(f => (
            <tr key={f.key} className="border-t border-border">
              <td className="px-3 py-1.5 font-semibold">{FIELD_LABEL[f.key]}</td>
              <td className="px-3 py-1.5 tabular-nums">{f.sizePt} pt <span className="text-muted-foreground">(min {f.minPt})</span></td>
              <td className="px-3 py-1.5">{WIDTH_LABEL[f.width]}</td>
              <td className="px-3 py-1.5 tabular-nums">{f.xHeightMm} mm</td>
              <td className="px-3 py-1.5">{f.fits ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-rose-600" />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {proof.barcode.module.ok && (
        <p className="px-3 py-2 text-xs text-muted-foreground border-t border-border">
          Barcode: {proof.barcode.module.magnificationPct}% of standard size — bars {proof.barcode.module.moduleDots} printer dots wide,
          {" "}{proof.barcode.module.widthDots ? `${((proof.barcode.module.widthDots / proof.dpi) * 25.4).toFixed(1)} mm across with its clear space` : ""}.
        </p>
      )}
    </div>
  );
}
