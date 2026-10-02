/**
 * The buttons on a test box's launch checklist (Graeme, 2026-10-02). The
 * server says which step has which button (task.action, from
 * api-server/src/lib/test-box-launch-checklist.ts) — this file never decides
 * which steps exist. Objectives A and I.
 *
 *   shopify-products   → the per-recipe create / link flow (shopify-products-card.tsx)
 *   shopify-collection → preview + confirm, waits for decided recipes with products
 *   discount-code      → preview + confirm, waits for the collection; shows the code big
 *
 * Every create is previewed first (reads only) and confirmed in plain
 * English; nothing is ever published. API: routes/test-box-shopify.ts.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Copy, Loader2, ShieldAlert } from "lucide-react";
import { format, parseISO } from "date-fns";
import { AdminLink, Banner, ShopifyProductsModal, Shell, call, type Ticks } from "./shopify-products-card";

export type LaunchAction = "shopify-products" | "shopify-collection" | "discount-code";
export interface LaunchBox { id: number; discountCode: string | null; discountEndsOn: string | null; shopifyCollectionId: string | null }

const btn = "px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-base font-semibold hover:bg-emerald-700 disabled:opacity-50";
const longDay = (iso: string) => format(parseISO(iso), "EEE d MMM");

/** `version` changes whenever a tick changes, so the collection's "waiting
 *  for…" re-checks straight after "Decide on recipes" is ticked. */
export function LaunchStepAction({ action, box, version }: { action: LaunchAction; box: LaunchBox; version: string }) {
  if (action === "shopify-products") return <ProductsStep boxId={box.id} />;
  if (action === "shopify-collection") return <CollectionStep boxId={box.id} version={version} />;
  return <DiscountStep box={box} />;
}

function useAfterWrite(boxId: number) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["test-boxes", boxId] });
    void qc.invalidateQueries({ queryKey: ["todos"] });
  };
}

// ── Create Shopify products ────────────────────────────────────────────────
function ProductsStep({ boxId }: { boxId: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className={btn}>Create Shopify products</button>
      {open && <ShopifyProductsModal boxId={boxId} onClose={() => setOpen(false)} />}
    </>
  );
}

// ── Create the Shopify collection ──────────────────────────────────────────
interface CollectionStatus {
  boxName: string;
  existing: { title: string; adminUrl: string } | null;
  plan: { title: string; rule: string; sortOrder: string; copiedFrom: string | null };
  gate: string | null;
  missingScopes: string[];
  writesBlocked: boolean;
  blockedMessage: string | null;
  canCreate: boolean;
}

function CollectionStep({ boxId, version }: { boxId: number; version: string }) {
  const [open, setOpen] = useState(false);
  const status = useQuery({
    queryKey: ["test-boxes", boxId, "shopify-collection", version],
    queryFn: () => call<CollectionStatus>(boxId, "/collection"),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const s = status.data;
  if (status.isLoading) return <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Checking Shopify…</p>;
  if (status.error) return <p className="text-sm text-destructive">{(status.error as Error).message}</p>;
  if (!s) return null;
  if (s.existing) return <p className="text-sm flex items-center gap-2 flex-wrap"><Check className="w-4 h-4 text-emerald-600" /> '{s.existing.title}' is in Shopify <AdminLink href={s.existing.adminUrl}>Open</AdminLink></p>;
  return (
    <div className="space-y-1">
      <button onClick={() => setOpen(true)} disabled={!!s.gate} className={btn}>Create the Shopify collection</button>
      {s.gate && <p className="text-sm text-amber-800 dark:text-amber-300">Waiting: {s.gate}</p>}
      {open && <CollectionModal boxId={boxId} s={s} onClose={() => setOpen(false)} />}
    </div>
  );
}

function CollectionModal({ boxId, s, onClose }: { boxId: number; s: CollectionStatus; onClose: () => void }) {
  const qc = useQueryClient();
  const after = useAfterWrite(boxId);
  const create = useMutation({
    mutationFn: () => call<{ outcome: "created" | "exists"; title: string; adminUrl: string; ticked: Ticks }>(boxId, "/collection", { method: "POST", body: JSON.stringify({ confirm: true }) }),
    onSuccess: () => { after(); void qc.invalidateQueries({ queryKey: ["test-boxes", boxId, "shopify-collection"] }); },
  });
  const blocked = !s.canCreate ? "Only a manager or admin can create it." : s.missingScopes.length && !s.writesBlocked ? "Shopify hasn't given the app permission yet." : null;
  return (
    <Shell title="Create the Shopify collection?" onClose={onClose} narrow
      footer={create.data ? (
        <button onClick={onClose} className="flex-1 px-4 py-3 rounded-xl border-2 border-border text-base font-semibold hover:bg-secondary">Done</button>
      ) : (
        <>
          <button onClick={onClose} className="flex-1 px-4 py-3 rounded-xl border-2 border-border text-base font-semibold hover:bg-secondary">Cancel</button>
          <button onClick={() => create.mutate()} disabled={create.isPending || !!blocked} title={blocked ?? undefined} className={`flex-1 ${btn} py-3 inline-flex items-center justify-center gap-2`}>
            {create.isPending && <Loader2 className="w-5 h-5 animate-spin" />} {create.isPending ? "Working…" : "Create collection"}
          </button>
        </>
      )}
    >
      {create.data ? (
        <p className="text-base flex items-center gap-2 flex-wrap"><Check className="w-5 h-5 text-emerald-600" />
          {create.data.outcome === "created" ? "Made" : "Already there"}: <b>{create.data.title}</b> <AdminLink href={create.data.adminUrl}>Open in Shopify</AdminLink>
        </p>
      ) : (
        <>
          <ScopeBanners writesBlocked={s.writesBlocked} blockedMessage={s.blockedMessage} missingScopes={s.missingScopes} what="collections" />
          <p className="text-base">This makes <b>1 collection</b> in your Shopify store. <b>Nothing is published.</b></p>
          <ul className="text-sm list-disc pl-5 space-y-0.5">
            <li>Name: <b>{s.plan.title}</b></li>
            <li>Smart collection — {s.plan.rule}, so every product in this box joins it</li>
            <li>Sorted {s.plan.sortOrder.toLowerCase().replace(/_/g, " ")}{s.plan.copiedFrom ? `, like '${s.plan.copiedFrom}'` : ""}</li>
            <li>Not on the Online Store until launch day (on the checklist)</li>
          </ul>
          {create.error && <p className="text-sm text-destructive flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {(create.error as Error).message}</p>}
        </>
      )}
    </Shell>
  );
}

// ── Create the 20% discount code ───────────────────────────────────────────
interface DiscountStatus {
  boxName: string;
  existing: { code: string; endsOn: string | null; adminUrl: string | null } | null;
  proposedCode: string | null;
  settingsLines: string[];
  copiedFrom: string | null;
  suggestedEndOn: string | null;
  collectionTitle: string;
  gate: string | null;
  missingScopes: string[];
  writesBlocked: boolean;
  blockedMessage: string | null;
  canCreate: boolean;
}

function DiscountStep({ box }: { box: LaunchBox }) {
  const [open, setOpen] = useState(false);
  if (box.discountCode) return <CodeDisplay code={box.discountCode} endsOn={box.discountEndsOn} />;
  const gate = box.shopifyCollectionId ? null : "Create the Shopify collection first — the code applies to it.";
  return (
    <div className="space-y-1">
      <button onClick={() => setOpen(true)} disabled={!!gate} className={btn}>Create the 20% discount code</button>
      {gate && <p className="text-sm text-amber-800 dark:text-amber-300">Waiting: {gate}</p>}
      {open && <DiscountModal boxId={box.id} onClose={() => setOpen(false)} />}
    </div>
  );
}

function DiscountModal({ boxId, onClose }: { boxId: number; onClose: () => void }) {
  const after = useAfterWrite(boxId);
  const [useEnd, setUseEnd] = useState(false);
  const preview = useQuery({
    // One read per opening — the proposed code stays the same while the end
    // date is switched on and off (that only changes the last line).
    queryKey: ["test-boxes", boxId, "shopify-discount"],
    queryFn: () => call<DiscountStatus>(boxId, "/discount/preview", { method: "POST", body: JSON.stringify({ endOn: null }) }),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const p = preview.data;
  const endOn = useEnd ? p?.suggestedEndOn ?? null : null;
  const create = useMutation({
    mutationFn: () => call<{ code: string; endsOn: string | null; adminUrl: string; regenerated: boolean; ticked: Ticks }>(boxId, "/discount", {
      method: "POST", body: JSON.stringify({ code: p!.proposedCode, endOn }),
    }),
    onSuccess: after,
  });
  const blocked = !p ? null : !p.canCreate ? "Only a manager or admin can create it." : p.missingScopes.length && !p.writesBlocked ? "Shopify hasn't given the app permission yet." : p.gate;

  return (
    <Shell title="Create the 20% discount code?" onClose={onClose} narrow
      footer={create.data ? (
        <button onClick={onClose} className="flex-1 px-4 py-3 rounded-xl border-2 border-border text-base font-semibold hover:bg-secondary">Done</button>
      ) : (
        <>
          <button onClick={onClose} className="flex-1 px-4 py-3 rounded-xl border-2 border-border text-base font-semibold hover:bg-secondary">Cancel</button>
          <button onClick={() => create.mutate()} disabled={!p?.proposedCode || create.isPending || !!blocked} title={blocked ?? undefined} className={`flex-1 ${btn} py-3 inline-flex items-center justify-center gap-2`}>
            {create.isPending && <Loader2 className="w-5 h-5 animate-spin" />} {create.isPending ? "Working…" : "Create code"}
          </button>
        </>
      )}
    >
      {preview.isLoading && <p className="flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Reading the last test-box code — nothing is changed…</p>}
      {preview.error && <p className="text-destructive">{(preview.error as Error).message}</p>}
      {create.data && (
        <div className="space-y-2">
          <p className="text-base flex items-center gap-2"><Check className="w-5 h-5 text-emerald-600" /> Made in Shopify <AdminLink href={create.data.adminUrl}>Open</AdminLink></p>
          {create.data.regenerated && <p className="text-sm text-muted-foreground">Shopify already had the first code, so a new one was made.</p>}
          <CodeDisplay code={create.data.code} endsOn={create.data.endsOn} />
        </div>
      )}
      {p && !create.data && (
        p.existing ? <CodeDisplay code={p.existing.code} endsOn={p.existing.endsOn} /> : (
          <>
            <ScopeBanners writesBlocked={p.writesBlocked} blockedMessage={p.blockedMessage} missingScopes={p.missingScopes} what="discount codes" />
            {p.gate && <Banner tone="amber" icon={<AlertTriangle className="w-5 h-5" />}>{p.gate}</Banner>}
            <p className="text-base">This makes <b>1 discount code</b> in your Shopify store — one code shared by everyone.</p>
            {p.proposedCode && <p className="text-3xl font-black tracking-widest text-center py-3 rounded-2xl bg-secondary/60 tabular-nums">{p.proposedCode}</p>}
            <ul className="text-sm list-disc pl-5 space-y-0.5">
              {p.settingsLines.filter(l => l !== "No end date").map(l => <li key={l}>{l}</li>)}
              <li>{endOn ? `Ends at the end of ${longDay(endOn)}` : "No end date"}</li>
            </ul>
            {p.copiedFrom && <p className="text-sm text-muted-foreground">Settings copied from the code for '{p.copiedFrom}'.</p>}
            {p.suggestedEndOn ? (
              <label className="flex items-center gap-3 rounded-2xl border-2 border-border p-3 cursor-pointer">
                <input type="checkbox" checked={useEnd} onChange={e => setUseEnd(e.target.checked)} className="w-6 h-6 accent-emerald-600" />
                <span className="text-base">End it when orders for the last delivery close — <b>{longDay(p.suggestedEndOn)}</b></span>
              </label>
            ) : <p className="text-sm text-muted-foreground">No open delivery date, so no end date is offered.</p>}
            {create.error && <p className="text-sm text-destructive flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {(create.error as Error).message}</p>}
          </>
        )
      )}
    </Shell>
  );
}

function CodeDisplay({ code, endsOn }: { code: string; endsOn: string | null }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
  };
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-2xl font-black tracking-widest px-4 py-2 rounded-xl bg-emerald-500/15 text-emerald-900 dark:text-emerald-200">{code}</span>
      <button onClick={() => void copy()} className="px-3 py-2.5 rounded-xl border-2 border-border text-base font-semibold hover:bg-secondary inline-flex items-center gap-2">
        {copied ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy</>}
      </button>
      <span className="text-sm text-muted-foreground">{endsOn ? `Ends ${longDay(endsOn)}` : "No end date"}</span>
    </div>
  );
}

function ScopeBanners({ writesBlocked, blockedMessage, missingScopes, what }: { writesBlocked: boolean; blockedMessage: string | null; missingScopes: string[]; what: string }) {
  return (
    <>
      {writesBlocked && <Banner tone="amber" icon={<ShieldAlert className="w-5 h-5" />}><b>Shopify writes are switched off on this server.</b> Pressing Create will stop before anything is made{blockedMessage ? " (BLOCK_SHOPIFY_WRITES)" : ""}.</Banner>}
      {missingScopes.length > 0 && (
        <Banner tone="red" icon={<ShieldAlert className="w-5 h-5" />}>
          <b>Shopify hasn't given the app permission to create {what} yet.</b> Add <code>{missingScopes.join(", ")}</code> to the planner app's access scopes in Shopify and approve it in the store.
        </Banner>
      )}
    </>
  );
}
