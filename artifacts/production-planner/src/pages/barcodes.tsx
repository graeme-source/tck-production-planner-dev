/**
 * Barcodes (Graeme, 2026-10-10; two-way with Shopify 2026-10-12) — every
 * recipe's barcodes in one place, disagreements with Shopify to clear, the
 * one-time preview + bulk sync to Shopify, the one-time pull (with a dry
 * run), products that share a code, old products still holding a reused
 * code, and refused packing scans.
 *
 * Our table is the single source of truth. Barcodes are set on each
 * product's label page or recipe page (components/barcodes) and sent to
 * Shopify from there; the hourly check adopts Shopify's where we have none.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Barcode, ChevronRight, CloudDownload, CloudUpload, Copy, Eye, Info, Loader2, RefreshCw, ScanLine, Star, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import {
  barcodesApi, useBarcodeOverview, useInvalidateBarcodes, useScanRejections, type ClashView, type ClubSpecialView, type GroupView, type PullReport,
  type SyncAction, type SyncItem, type SyncPreview, type SyncResult,
} from "@/components/barcodes/api";
import { BarcodeGroupCard } from "@/components/barcodes/recipe-barcodes";
import type { CopyLink } from "@workspace/barcodes";

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
        A barcode the app already holds is never overwritten: a difference is listed. This pull changes nothing in Shopify. One-time pull last run: <b>{when(firstPullAt)}</b>.
        After that, an hourly check adopts Shopify's barcode wherever the app has none and keeps everything else in step.
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

const ACTION_LABEL: Record<SyncAction, string> = {
  overwrite: "Shopify's number replaced by ours",
  fill: "Ours filled in (Shopify has none)",
  adopt: "Shopify's adopted (the app has none)",
  same: "Same both sides",
  skip: "Left alone",
};

function SyncRow({ i }: { i: SyncItem }) {
  return (
    <li className="py-2 text-sm">
      {i.recipeId ? <Link href={`/labels/${i.recipeId}`} className="font-semibold text-primary">{i.recipeName}</Link> : <b>{i.name}</b>}
      {i.recipeId && <span className="text-muted-foreground"> · {i.name}</span>}
      <span className="block font-mono text-xs">
        app {i.ours ?? "—"} · Shopify {i.shopify ?? "—"}{i.action === "skip" ? ` · ${i.reason}` : ""}
      </span>
    </li>
  );
}

/**
 * The one-time "Preview what would change in Shopify" (sends nothing), then a
 * separate, deliberate "Send to Shopify" for exactly what was previewed.
 * After that every save in the app is sent automatically.
 */
function ShopifySyncCard({ isAdmin, writesBlocked }: { isAdmin: boolean; writesBlocked: string | null }) {
  const invalidate = useInvalidateBarcodes();
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const look = useMutation({
    mutationFn: () => barcodesApi<SyncPreview>("/shopify-sync/preview", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: p => { setPreview(p); setResult(null); },
  });
  const apply = useMutation({
    mutationFn: (items: Array<{ variantId: string; action: SyncAction }>) => barcodesApi<SyncResult>("/shopify-sync/apply", { method: "POST", body: JSON.stringify({ items }) }),
    onSuccess: async r => { setResult(r); setPreview(null); setConfirming(false); await invalidate(); },
  });
  const by = (a: SyncAction) => preview?.changes.filter(c => c.action === a) ?? [];
  const sections: Array<[SyncAction, SyncItem[]]> = [["overwrite", by("overwrite")], ["fill", by("fill")], ["adopt", by("adopt")]];
  const total = preview?.changes.length ?? 0;
  return (
    <Card title="Sync with Shopify" icon={<CloudUpload className="w-5 h-5 text-primary" />}>
      <p className="text-sm text-muted-foreground">
        Every barcode saved in the app is sent to Shopify straight away. Barcodes that already differ are left alone until you choose — one at a time below,
        or all at once here: preview first (nothing is sent), then send exactly what you saw. The Calzone Club Special and archived products are never changed.
      </p>
      {writesBlocked && <p className="text-sm font-semibold text-amber-700 dark:text-amber-400 flex items-start gap-1"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {writesBlocked}. Saves still work; sends wait until this is fixed.</p>}
      {isAdmin ? (
        <button type="button" disabled={look.isPending} onClick={() => look.mutate()} className="h-12 px-4 rounded-xl border-2 border-border font-semibold flex items-center gap-2 disabled:opacity-50">
          {look.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />} Preview what would change in Shopify
        </button>
      ) : <p className="text-sm text-muted-foreground">An admin runs the bulk sync.</p>}
      {look.error && <p className="text-sm text-destructive font-semibold">Couldn't preview: {(look.error as Error).message}</p>}
      {preview && (
        <div className="rounded-xl bg-muted/40 p-4 space-y-3">
          <p className="font-bold">Preview — nothing has been sent or saved</p>
          <p className="text-sm">
            Overwrite in Shopify <b>{preview.counts.overwrite}</b> · fill in Shopify <b>{preview.counts.fill}</b> · adopt from Shopify <b>{preview.counts.adopt}</b> ·
            already the same {preview.counts.same} · left alone {preview.counts.skip}
          </p>
          {preview.writesBlocked && <p className="text-sm text-amber-700 dark:text-amber-400">{preview.writesBlocked} — sending now would leave them waiting.</p>}
          {sections.map(([a, items]) => items.length > 0 && (
            <div key={a}>
              <p className="font-semibold">{ACTION_LABEL[a]} ({items.length})</p>
              <ul className="divide-y divide-border">{items.map(i => <SyncRow key={i.variantId} i={i} />)}</ul>
            </div>
          ))}
          {preview.skipped.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm font-semibold">Left alone on purpose ({preview.skipped.length})</summary>
              <ul className="divide-y divide-border">{preview.skipped.map(i => <SyncRow key={i.variantId} i={i} />)}</ul>
            </details>
          )}
          {isAdmin && total > 0 && !confirming && (
            <button type="button" onClick={() => setConfirming(true)} className="h-12 px-4 rounded-xl bg-primary text-primary-foreground font-bold flex items-center gap-2">
              <CloudUpload className="w-4 h-4" /> Send these {total} to Shopify…
            </button>
          )}
          {confirming && (
            <div className="rounded-xl border-2 border-destructive/60 bg-card p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold">
                  This changes {preview.counts.overwrite + preview.counts.fill} barcode{preview.counts.overwrite + preview.counts.fill === 1 ? "" : "s"} in Shopify
                  {preview.counts.overwrite ? ` (${preview.counts.overwrite} replacing a number Shopify has now)` : ""} and adopts {preview.counts.adopt} into the app. Anything that changed since the preview is left alone.
                </p>
                <button type="button" aria-label="Cancel" onClick={() => setConfirming(false)} className="h-9 w-9 shrink-0 rounded-lg border-2 border-border flex items-center justify-center"><X className="w-4 h-4" /></button>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setConfirming(false)} className="h-12 px-4 rounded-xl border-2 border-border font-semibold">Cancel</button>
                <button
                  type="button"
                  disabled={apply.isPending}
                  onClick={() => apply.mutate(preview.changes.map(c => ({ variantId: c.variantId, action: c.action })))}
                  className="h-12 px-4 rounded-xl bg-destructive text-white font-bold flex items-center gap-2 disabled:opacity-50"
                >
                  {apply.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudUpload className="w-4 h-4" />} Yes — send to Shopify
                </button>
              </div>
            </div>
          )}
          {apply.error && <p className="text-sm text-destructive font-semibold">Didn't run: {(apply.error as Error).message}</p>}
        </div>
      )}
      {result && (
        <p className="text-sm rounded-xl bg-muted/40 p-3">
          Sent {result.sent} · waiting to send {result.waiting} · failed {result.failed} · adopted {result.adopted}
          {result.changedSincePreview ? ` · ${result.changedSincePreview} changed since the preview, left alone` : ""}. Each product's card shows how its send went.
        </p>
      )}
    </Card>
  );
}

/** Every product where Shopify and the app hold different numbers — the
 *  same cards as the label page, so each can be cleared here. */
function DisagreementsCard({ groups, canEdit }: { groups: GroupView[]; canEdit: boolean }) {
  const differing = groups.filter(g => g.variants.some(v => v.differentInShopify));
  return (
    <Card title={`Shopify and the app disagree (${differing.length})`} icon={<AlertTriangle className="w-5 h-5 text-amber-500" />} tone={differing.length ? "warn" : undefined}>
      <p className="text-sm text-muted-foreground">Neither side is changed automatically. For each, pick "Use Shopify's" or "Send ours to Shopify".</p>
      {differing.length === 0 ? <p className="text-sm">None.</p> : (
        <div className="space-y-3">
          {differing.map(g => (
            <div key={`${g.recipeId}:${g.kind}`} className="space-y-1">
              <Link href={`/labels/${g.recipeId}`} className="text-sm font-semibold text-primary">{g.recipeName}</Link>
              <BarcodeGroupCard group={g} canEdit={canEdit} />
            </div>
          ))}
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

/** F2F copies are the same pack with the same printed barcode (Graeme,
 *  2026-10-10). One reviewed step marks each "same product as" its
 *  recipe's pack — barcodes only; stock and sales counts are untouched. */
function F2fCard({ links, isAdmin }: { links: CopyLink[]; isAdmin: boolean }) {
  const invalidate = useInvalidateBarcodes();
  const [done, setDone] = useState<CopyLink[] | null>(null);
  const apply = useMutation({
    mutationFn: () => barcodesApi<{ applied: CopyLink[] }>("/f2f-links", { method: "POST", body: JSON.stringify({ variantIds: links.map(l => l.variantId) }) }),
    onSuccess: async r => { setDone(r.applied); await invalidate(); },
  });
  if (!links.length && !done) return null;
  return (
    <Card title={`F2F copies to link (${links.length})`} icon={<Copy className="w-5 h-5 text-primary" />}>
      <p className="text-sm text-muted-foreground">
        Each F2F listing below carries its recipe's printed barcode. Linking marks it the same product, so both scan and neither shows as a clash.
        This only affects barcodes — stock, sales counts and the stock gate don't change. Check the list, then link.
      </p>
      <ul className="space-y-1 text-sm">
        {links.map(l => (
          <li key={l.variantId}><b>{l.name}</b> → <Link href={`/recipes?edit=${l.recipeId}`} className="font-semibold text-primary">{l.sameAsName}</Link> <span className="font-mono text-muted-foreground">{l.barcode}</span></li>
        ))}
      </ul>
      {isAdmin && links.length > 0 && (
        <button
          type="button"
          disabled={apply.isPending}
          onClick={() => { if (window.confirm(`Link these ${links.length} F2F listing${links.length !== 1 ? "s" : ""} to their recipe's pack?`)) apply.mutate(); }}
          className="h-12 px-4 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-50"
        >
          {apply.isPending ? "Linking…" : `Link all ${links.length}`}
        </button>
      )}
      {apply.error && <p className="text-sm text-destructive font-semibold">Not linked: {(apply.error as Error).message}</p>}
      {done && <p className="text-sm text-emerald-700 dark:text-emerald-400 font-semibold">Linked {done.length}.</p>}
    </Card>
  );
}

function ClubSpecialCard({ rows }: { rows: ClubSpecialView[] }) {
  if (!rows.length) return null;
  return (
    <Card title="Calzone Club Special" icon={<Star className="w-5 h-5 text-amber-500" />}>
      <p className="text-sm text-muted-foreground">
        It always scans as the recipe ticked "Calzone Club Special" on its recipe page, with that recipe's barcode — never its own, so it never clashes. <b>Managed by hand in Shopify</b>: the app never sends it a barcode and never adopts its one.
        When you switch its barcode in Shopify ahead of the next special, the packing screen also accepts the incoming special until the recipe is switched here.
      </p>
      <ul className="space-y-2 text-sm">
        {rows.map(r => (
          <li key={r.variantId} className="rounded-xl bg-muted/40 px-3 py-2 space-y-1">
            <p className="font-medium">{r.name}{!r.current && <span className="ml-1 text-xs text-muted-foreground">(not active in Shopify)</span>}</p>
            <p>Scans as: <b>{r.scansAs ?? "no special set — tick one on its recipe page"}</b> <span className="font-mono">{r.barcode ?? "—"}</span></p>
            {r.changing && (
              <p className="text-sky-700 dark:text-sky-400 flex items-center gap-1"><Info className="w-4 h-4" /> Special changing — expected. Shopify already has {r.alsoAccepts.map(a => a.name).join(", ")} (<span className="font-mono">{r.shopifyBarcode}</span>); both are accepted until the special is switched here.</p>
            )}
            {r.unexpected && <p className="text-amber-700 dark:text-amber-400">Shopify has <span className="font-mono">{r.shopifyBarcode}</span>, which isn't a recipe's 2-pack barcode — not used for scanning.</p>}
          </li>
        ))}
      </ul>
    </Card>
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
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader title="Barcodes" description="One barcode per product, set in the app (on its label page or recipe page) — the packing scanner, the pack label and Shopify all get the same number." />
      {overview.isLoading && <p className="text-muted-foreground">Loading…</p>}
      {overview.error && <p className="text-destructive">Couldn't load barcodes: {(overview.error as Error).message}</p>}

      {o && <DisagreementsCard groups={o.groups} canEdit={role === "admin" || role === "manager"} />}
      <ShopifySyncCard isAdmin={isAdmin} writesBlocked={o?.shopifyWritesBlocked ?? null} />
      <PullCard isAdmin={isAdmin} firstPullAt={o?.firstPullAt ?? null} />

      {o && (
        <>
          <F2fCard links={o.f2fSuggestions} isAdmin={isAdmin} />
          <ClubSpecialCard rows={o.clubSpecial} />
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
            <p className="text-sm text-muted-foreground">Last checked against Shopify: {when(o.lastCheckedAt)}. Tap a product to set its barcode on its label page.</p>
            <ul className="divide-y divide-border">
              {o.groups.map(g => {
                const flags = [
                  g.mixed && "listings differ",
                  !g.barcode && !g.mixed && "no barcode",
                  g.variants.some(v => v.differentInShopify) && "different in Shopify",
                  g.variants.some(v => v.invalid) && "check digit wrong",
                  g.variants.some(v => v.heldBack) && "shares a code",
                  g.pending && "no Shopify listing yet",
                  g.variants.some(v => v.push?.state === "waiting" || v.push?.state === "failed") && "not sent to Shopify",
                ].filter(Boolean) as string[];
                return (
                  <li key={`${g.recipeId}:${g.kind}`}>
                    <Link href={`/labels/${g.recipeId}`} className="flex items-center gap-3 py-3">
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
