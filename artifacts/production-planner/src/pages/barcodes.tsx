/**
 * Barcodes (Graeme, 2026-10-10) — every recipe's barcodes in one place, the
 * one-time pull from Shopify (with a dry run), products that share a code,
 * old products still holding a reused code, and refused packing scans.
 *
 * Our table is the source of truth for scanning; Shopify is only READ.
 * Barcodes are set on each recipe's page (components/barcodes).
 */
import { useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Barcode, ChevronRight, CloudDownload, Eye, Info, Loader2, RefreshCw, ScanLine } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import {
  barcodesApi, useBarcodeOverview, useInvalidateBarcodes, useScanRejections, type ClashView, type PullReport,
} from "@/components/barcodes/api";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "never");
const recipeIdOf = (identityKey: string) => { const m = /^r(\d+):/.exec(identityKey); return m ? Number(m[1]) : null; };

function ProductName({ identityKey, name }: { identityKey: string; name: string }) {
  const id = recipeIdOf(identityKey);
  return id ? <Link href={`/recipes?edit=${id}`} className="font-semibold text-primary underline-offset-2 hover:underline">{name}</Link> : <b>{name}</b>;
}

function Card({ title, icon, children, tone }: { title: string; icon: React.ReactNode; children: React.ReactNode; tone?: "warn" }) {
  return (
    <section className={cn("rounded-2xl border-2 bg-card p-5 space-y-3", tone === "warn" ? "border-amber-400" : "border-border")}>
      <h2 className="text-lg font-bold flex items-center gap-2">{icon} {title}</h2>
      {children}
    </section>
  );
}

function PullCard({ isAdmin, firstPullAt }: { isAdmin: boolean; firstPullAt: string | null }) {
  const invalidate = useInvalidateBarcodes();
  const [report, setReport] = useState<PullReport | null>(null);
  const run = useMutation({
    mutationFn: (b: { dryRun: boolean; mode: "pull" | "check" }) => barcodesApi<PullReport>("/pull", { method: "POST", body: JSON.stringify(b) }),
    onSuccess: async r => { setReport(r); if (!r.dryRun) await invalidate(); },
  });
  const pull = (dryRun: boolean, mode: "pull" | "check" = "pull") => {
    if (!dryRun && mode === "pull" && !window.confirm("Pull barcodes from Shopify into the app now? Only empty barcodes are filled; nothing in Shopify changes.")) return;
    run.mutate({ dryRun, mode });
  };
  const c = report?.counts;
  return (
    <Card title="Pull barcodes from Shopify" icon={<CloudDownload className="w-5 h-5 text-primary" />}>
      <p className="text-sm text-muted-foreground">
        Reads every Shopify listing and fills the app's barcode for each listing linked to a recipe — 2-packs, 8-pack bags, wonky packs — where the app has none.
        A barcode the app already holds is never overwritten: a difference is listed. Nothing in Shopify is changed. One-time pull last run: <b>{when(firstPullAt)}</b>.
        After that, an hourly check keeps everything else in step.
      </p>
      {isAdmin ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={run.isPending} onClick={() => pull(true)} className="h-12 px-4 rounded-xl border-2 border-border font-semibold flex items-center gap-2 disabled:opacity-50"><Eye className="w-4 h-4" /> Preview (dry run)</button>
          <button type="button" disabled={run.isPending} onClick={() => pull(false)} className="h-12 px-4 rounded-xl bg-primary text-primary-foreground font-bold flex items-center gap-2 disabled:opacity-50"><CloudDownload className="w-4 h-4" /> Pull barcodes from Shopify</button>
          <button type="button" disabled={run.isPending} onClick={() => pull(false, "check")} className="h-12 px-4 rounded-xl border-2 border-border font-semibold flex items-center gap-2 disabled:opacity-50"><RefreshCw className="w-4 h-4" /> Check Shopify now</button>
        </div>
      ) : <p className="text-sm text-muted-foreground">An admin runs the pull.</p>}
      {run.isPending && <p className="text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Reading Shopify…</p>}
      {run.error && <p className="text-sm text-destructive font-semibold">Didn't run: {(run.error as Error).message}</p>}
      {report && c && (
        <div className="rounded-xl bg-muted/40 p-4 space-y-2 text-sm">
          <p className="font-bold">{report.dryRun ? "Dry run — nothing was written" : report.mode === "pull" ? "Pulled" : "Checked"} · {report.linkedVariants} linked listings</p>
          <p>Filled {c.filled} · unchanged {c.unchanged} · different (kept ours) {c.conflict} · in Shopify only {c.shopifyOnly} · missing in Shopify {c.missing} · gone from Shopify {c.notInShopify} · old products {c.retired} · check digit wrong {c.invalid}</p>
          <p className="text-muted-foreground">Other listings following Shopify: {report.followed} · old products no longer claiming a code: {report.retiredCleared}</p>
          <ul className="space-y-1">
            {report.items.filter(i => i.outcome !== "unchanged" || i.invalid).map(i => (
              <li key={i.variantId}>
                <Link href={`/recipes?edit=${i.recipeId}`} className="font-semibold text-primary">{i.recipeName}</Link> · {i.name}: <b>{i.outcome}</b> — ours {i.ours ?? "—"}, Shopify {i.shopify ?? "—"}{i.invalid ? ` · ${i.invalid}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function ClashCard({ clash, isAdmin }: { clash: ClashView; isAdmin: boolean }) {
  const invalidate = useInvalidateBarcodes();
  const [error, setError] = useState<string | null>(null);
  const keeperVariant = clash.keeper?.variants[0]?.variantId ?? null;
  const same = useMutation({
    mutationFn: (variantId: string) => barcodesApi(`/variants/${variantId}/same-product`, { method: "PUT", body: JSON.stringify({ sameAs: keeperVariant }) }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => setError(e.message),
  });
  return (
    <li className="rounded-xl border-2 border-border p-4 space-y-2">
      <p className="font-mono font-bold">{clash.barcode}</p>
      <p className="text-sm">{clash.message}</p>
      {clash.keeper && <p className="text-sm">Scans as: <ProductName identityKey={clash.keeper.identity.key} name={clash.keeper.identity.name} /></p>}
      {clash.losers.map(l => (
        <div key={l.identity.key} className="text-sm space-y-1">
          <p>Can't scan with it: <ProductName identityKey={l.identity.key} name={l.identity.name} /></p>
          {isAdmin && keeperVariant && recipeIdOf(l.identity.key) == null && l.variants.map(v => (
            <button key={v.variantId} type="button" disabled={same.isPending} onClick={() => same.mutate(v.variantId)} className="h-10 px-3 rounded-lg border-2 border-border text-xs font-bold disabled:opacity-50">
              "{v.name}" is the same product as {clash.keeper!.identity.name}
            </button>
          ))}
        </div>
      ))}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </li>
  );
}

export default function BarcodesPage() {
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.user.role : null;
  const isAdmin = role === "admin";
  const overview = useBarcodeOverview();
  const rejections = useScanRejections();
  const o = overview.data;

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader title="Barcodes" description="One barcode per product, set in the app — the packing scanner and the pack label use it. Shopify is only read." />
      {overview.isLoading && <p className="text-muted-foreground">Loading…</p>}
      {overview.error && <p className="text-destructive">Couldn't load barcodes: {(overview.error as Error).message}</p>}

      <PullCard isAdmin={isAdmin} firstPullAt={o?.firstPullAt ?? null} />

      {o && (
        <>
          <Card title={`Products sharing a barcode (${o.clashes.length})`} icon={<AlertTriangle className="w-5 h-5 text-amber-500" />} tone={o.clashes.length ? "warn" : undefined}>
            <p className="text-sm text-muted-foreground">Two products you still sell with the same code. The scanner lets only one of them use it, so the other is checked by eye until it has its own barcode. If they really are the same pack (an F2F or CFF copy), say so and both scan.</p>
            {o.clashes.length === 0 ? <p className="text-sm">None.</p> : <ul className="space-y-3">{o.clashes.map(c => <ClashCard key={c.barcode} clash={c} isAdmin={isAdmin} />)}</ul>}
          </Card>

          <Card title={`Old products still holding a reused barcode (${o.reused.length})`} icon={<Info className="w-5 h-5 text-sky-600" />}>
            <p className="text-sm text-muted-foreground">For information: these old Shopify products still carry a code now used by a current product. They never scan with it. Tidy them in Shopify if you like.</p>
            <ul className="space-y-1 text-sm">
              {o.reused.map(u => (
                <li key={u.barcode}><span className="font-mono">{u.barcode}</span> — {u.current ? <ProductName identityKey={u.current.identity.key} name={u.current.identity.name} /> : "no current product"}; also on {u.retired.map(r => r.name).join(", ")}</li>
              ))}
            </ul>
          </Card>

          <Card title="Every recipe's barcodes" icon={<Barcode className="w-5 h-5 text-[#7cb342]" />}>
            <p className="text-sm text-muted-foreground">Last checked against Shopify: {when(o.lastCheckedAt)}. Tap a recipe to set its barcodes.</p>
            <ul className="divide-y divide-border">
              {o.groups.map(g => {
                const flags = [
                  g.mixed && "listings differ",
                  !g.barcode && !g.mixed && "no barcode",
                  g.variants.some(v => v.differentInShopify) && "different in Shopify",
                  g.variants.some(v => v.invalid) && "check digit wrong",
                  g.variants.some(v => v.heldBack) && "shares a code",
                ].filter(Boolean) as string[];
                return (
                  <li key={`${g.recipeId}:${g.kind}`}>
                    <Link href={`/recipes?edit=${g.recipeId}`} className="flex items-center gap-3 py-3">
                      <span className="flex-1 min-w-0">
                        <span className="font-semibold">{g.recipeName}</span> <span className="text-muted-foreground">· {g.label}</span>
                        {flags.length > 0 && <span className="block text-xs text-amber-700 dark:text-amber-400">{flags.join(" · ")}</span>}
                      </span>
                      <span className="font-mono text-sm">{g.barcode ?? "—"}</span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        </>
      )}

      <Card title="Refused packing scans" icon={<ScanLine className="w-5 h-5 text-destructive" />}>
        <p className="text-sm text-muted-foreground">Every scan the packing screen refused or couldn't match — a wrong item caught, or a code it didn't know.</p>
        {rejections.error && <p className="text-sm text-destructive">{(rejections.error as Error).message}</p>}
        {rejections.data?.length === 0 && <p className="text-sm">None yet.</p>}
        <ul className="space-y-1 text-sm">
          {rejections.data?.map(r => (
            <li key={r.id}>{when(r.createdAt)} · {r.userName ?? "someone"} · {r.orderName ?? "—"} · <span className="font-mono">{r.code}</span> · {r.message ?? r.kind}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
