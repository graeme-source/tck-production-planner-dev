/**
 * Friday dispatch check (Graeme, 11 Nov 2026). Objective C.
 *
 * Run any day before a Friday: which orders due out that Friday APC won't
 * deliver on the Saturday, so the customer can be offered Thursday's
 * dispatch (Friday delivery) or moved to next Monday's (Tuesday
 * delivery). Rules: api-server lib/friday-dispatch-check.ts.
 *
 * Opening the page reads Shopify and our own records only. The email is
 * sent from a confirm step; moves go through the Reschedule pop-up, which
 * shows the exact Shopify change first.
 */
import { useState, type ReactNode } from "react";
import {
  AlertTriangle, Ban, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, HelpCircle, Loader2, RefreshCw, Truck,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { ConfirmSheet } from "@/components/apc-booking-issues/confirm-sheet";
import {
  useFridayCheck, useNoSaturdayEmailDraft, useSendNoSaturdayEmail, useSetDateChangeSafe, addDays, fridayOnOrAfter, londonToday, shortDay, when,
  type FridayCheck, type FridayCheckRow, type FridayStatus, type Alternative,
} from "@/components/friday-dispatch-check/api";

const STYLE: Record<Exclude<FridayStatus, "ok">, { title: string; ring: string; band: string; icon: ReactNode }> = {
  no_saturday: {
    title: "No Saturday delivery",
    ring: "border-red-400 dark:border-red-700",
    band: "bg-red-50 dark:bg-red-950/40 text-red-950 dark:text-red-100",
    icon: <Ban className="w-6 h-6 text-red-600 shrink-0" />,
  },
  at_risk: {
    title: "Saturday at risk",
    ring: "border-amber-400 dark:border-amber-700",
    band: "bg-amber-50 dark:bg-amber-950/40 text-amber-950 dark:text-amber-100",
    icon: <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0" />,
  },
  unknown: {
    title: "Not in APC's table",
    ring: "border-slate-300 dark:border-slate-700",
    band: "bg-slate-50 dark:bg-slate-900/50 text-slate-950 dark:text-slate-100",
    icon: <HelpCircle className="w-6 h-6 text-slate-600 shrink-0" />,
  },
};

function CountTile({ label, n, tone }: { label: string; n: number; tone: "green" | "red" | "amber" | "slate" | "violet" }) {
  const tones = {
    green: "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-100",
    red: "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-100",
    amber: "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100",
    slate: "border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 text-slate-900 dark:text-slate-100",
    violet: "border-violet-300 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 text-violet-900 dark:text-violet-100",
  }[tone];
  return (
    <div className={cn("rounded-2xl border-2 px-5 py-4", tones)}>
      <p className="text-4xl font-black tabular-nums leading-none">{n}</p>
      <p className="text-base font-semibold mt-1.5">{label}</p>
    </div>
  );
}

function AltLine({ alt, dispatchWord }: { alt: Alternative; dispatchWord: string }) {
  return (
    <p className={cn("text-base flex items-start gap-2", !alt.possible && "text-muted-foreground")}>
      {alt.possible
        ? <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
        : <Ban className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />}
      <span>
        <span className="font-semibold">{dispatchWord} dispatch</span> → delivery {shortDay(alt.deliveryDate)}
        {alt.note ? <span className="block text-sm text-muted-foreground">{alt.note}</span> : null}
      </span>
    </p>
  );
}

function BigButton({ onClick, disabled, title, icon, label, tone }: {
  onClick: () => void; disabled?: boolean; title?: string; icon: ReactNode; label: string; tone: "red" | "amber" | "blue";
}) {
  const tones = {
    red: "border-red-400 dark:border-red-700 text-red-800 dark:text-red-200 hover:bg-red-50 dark:hover:bg-red-950/30",
    amber: "border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-950/30",
    blue: "border-blue-400 dark:border-blue-700 text-blue-800 dark:text-blue-200 hover:bg-blue-50 dark:hover:bg-blue-950/30",
  }[tone];
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={cn(
        "min-h-12 px-4 py-2 rounded-xl border-2 bg-background text-base font-semibold inline-flex items-center justify-center gap-2 transition-colors",
        "disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:bg-background",
        tones,
      )}>
      {icon}{label}
    </button>
  );
}

function OrderCard({ row, check, onEmail }: {
  row: FridayCheckRow; check: FridayCheck;
  onEmail: (row: FridayCheckRow) => void;
}) {
  const style = STYLE[row.status as Exclude<FridayStatus, "ok">];
  const noPerm = check.canCourier ? undefined : "Needs the \"Fix APC booking problems\" permission";
  return (
    <article className={cn("rounded-3xl border-2 bg-card shadow-sm overflow-hidden flex flex-col", style.ring)}>
      <div className={cn("flex items-start gap-3 px-5 py-3", style.band)}>
        {style.icon}
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight">{style.title}</p>
          <p className="text-sm mt-0.5">{row.reason}</p>
        </div>
      </div>
      <div className="p-5 space-y-4 flex-1">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
          <a href={`${check.adminOrderBase}${row.orderId}`} target="_blank" rel="noopener noreferrer"
            className="text-3xl font-black tabular-nums text-primary hover:underline inline-flex items-center gap-1.5"
            title={`Open ${row.orderName} in Shopify`}>
            {row.orderName} <ExternalLink className="w-5 h-5" />
          </a>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold leading-tight break-words">{row.customerName || "—"}</p>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono font-semibold text-foreground">{row.postcode ?? "no postcode"}</span>
              {row.depot ? <> · depot {row.depot}</> : null}
            </p>
          </div>
        </div>

        {(row.done?.emailedAt || row.done?.movedAt) && (
          <div className="flex flex-wrap gap-2">
            {row.done?.emailedAt && (
              <span className="px-3 py-1 rounded-full text-sm font-semibold border bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100">
                Emailed {when(row.done.emailedAt)}{row.done.emailedBy ? ` by ${row.done.emailedBy}` : ""}
              </span>
            )}
            {row.done?.movedAt && row.done.movedTo && (
              <span className="px-3 py-1 rounded-full text-sm font-semibold border bg-violet-50 dark:bg-violet-950/40 border-violet-300 dark:border-violet-800 text-violet-900 dark:text-violet-100">
                Moved to {shortDay(row.done.movedTo)} {when(row.done.movedAt)}, but still on Saturday
              </span>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <AltLine alt={row.thursday} dispatchWord="Thursday" />
          <AltLine alt={row.nextWeek} dispatchWord="Next Monday" />
        </div>

        <div className="space-y-2 pt-1">
          {/* One action (Graeme, 11 Nov 2026): move it to the Wednesday after
              and email them a link to choose a sooner day themselves. Test
              production and 8-pack bags are changed by hand. */}
          {row.lockedReason ? (
            <>
              <p className="rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-base font-semibold text-amber-900 dark:text-amber-200">
                {row.lockedReason}
              </p>
              {/* Always in stock (Graeme, 12 Nov 2026: "the mayo is not an
                  issue"): mark it safe and it stops locking any order. */}
              {row.safeCandidates.map(p => (
                <SafeToMoveButton key={p.recipeId} product={p} disabled={!check.canCourier} title={noPerm} />
              ))}
            </>
          ) : (
            <BigButton onClick={() => onEmail(row)}
              disabled={!row.canEmail || !row.nextWeek.possible || !check.canCourier || !!row.done?.movedAt}
              title={noPerm ?? row.emailNote ?? row.nextWeek.note ?? undefined} icon={<CalendarClock className="w-5 h-5" />}
              label={`Reschedule to ${shortDay(check.dates.nextWeekDelivery)} & email`} tone="red" />
          )}
          {!row.lockedReason && (noPerm || row.emailNote || (!row.nextWeek.possible ? row.nextWeek.note : null)) && (
            <p className="text-sm text-muted-foreground">{noPerm ?? row.emailNote ?? row.nextWeek.note}</p>
          )}
        </div>
      </div>
    </article>
  );
}

function SafeToMoveButton({ product, disabled, title }: { product: { recipeId: number; name: string }; disabled?: boolean; title?: string }) {
  const setSafe = useSetDateChangeSafe();
  return (
    <button
      type="button"
      disabled={disabled || setSafe.isPending}
      title={title ?? "It stops locking delivery dates, here and in the website assistant. Undo it at the bottom of this page."}
      onClick={() => setSafe.mutate({ recipeId: product.recipeId, safe: true }, {
        onSuccess: r => toast({ title: `${r.name} is safe to move`, description: "Orders holding it can change delivery date now." }),
        onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
      })}
      className="w-full min-h-12 rounded-xl border-2 border-border bg-card px-4 py-2 text-base font-semibold hover:bg-secondary/50 disabled:opacity-50 flex items-center justify-center gap-2"
    >
      {setSafe.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
      {product.name} is always in stock — safe to move
    </button>
  );
}

function SafeProductsList({ products, canEdit }: { products: Array<{ recipeId: number; name: string }>; canEdit: boolean }) {
  const setSafe = useSetDateChangeSafe();
  if (products.length === 0) return null;
  return (
    <details className="rounded-2xl border-2 border-border bg-card">
      <summary className="cursor-pointer select-none px-5 py-4 text-lg font-bold flex items-center gap-2">
        <CheckCircle2 className="w-5 h-5 text-emerald-600" /> {products.length} product{products.length === 1 ? "" : "s"} safe to move
      </summary>
      <div className="px-5 pb-5 space-y-2">
        <p className="text-sm text-muted-foreground">Always in stock, so they never stop an order changing delivery date — here or in the website assistant.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          {products.map(p => (
            <div key={p.recipeId} className="rounded-xl border border-border px-4 py-3 flex items-center justify-between gap-3">
              <span className="font-semibold">{p.name}</span>
              <button
                type="button"
                disabled={!canEdit || setSafe.isPending}
                onClick={() => setSafe.mutate({ recipeId: p.recipeId, safe: false }, {
                  onSuccess: r => toast({ title: `${r.name} locks dates again` }),
                  onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
                })}
                className="min-h-10 px-3 rounded-lg border border-border text-sm font-medium hover:bg-secondary/50 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

function EmailSheet({ row, dispatchDate, onClose }: { row: FridayCheckRow; dispatchDate: string; onClose: () => void }) {
  const draft = useNoSaturdayEmailDraft(row.orderId, dispatchDate);
  const send = useSendNoSaturdayEmail();
  const d = draft.data;
  return (
    <ConfirmSheet
      title="Reschedule and email the customer"
      orderName={row.orderName}
      customerName={d?.customerName ?? row.customerName}
      confirmLabel={d?.to ? `Move to ${d.newDeliveryLabel} & email ${d.to}` : "Move & email"}
      confirmDisabled={!d?.to || draft.isLoading || !!draft.error}
      busy={send.isPending}
      tone="danger"
      onClose={onClose}
      onConfirm={() => send.mutate(
        { orderId: row.orderId, dispatchDate, confirmOrderName: row.orderName },
        {
          onSuccess: r => {
            if (!r.emailed) toast({ title: `${row.orderName} moved, but the email didn't send`, description: r.emailError ?? "", variant: "destructive" });
            else toast({
              title: `${row.orderName} moved and emailed`,
              description: r.linkIncluded ? `To ${r.to}, with the choose-a-day link` : `To ${r.to} — WITHOUT the link (${r.linkError ?? "the assistant didn't answer"}); it asks them to reply instead`,
              variant: r.linkIncluded ? undefined : "destructive",
            });
            onClose();
          },
          onError: (e: Error) => toast({ title: "Nothing was changed", description: e.message, variant: "destructive" }),
        },
      )}
    >
      {draft.isLoading && <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Reading the order from Shopify…</p>}
      {draft.error && <p className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-destructive">{(draft.error as Error).message}</p>}
      {d && (
        <>
          {d.alreadyEmailedAt && (
            <p className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-amber-900 dark:text-amber-200">
              Already emailed {when(d.alreadyEmailedAt)}{d.alreadyEmailedBy ? ` by ${d.alreadyEmailedBy}` : ""}. This sends it again.
            </p>
          )}
          {!d.to && <p className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-destructive">No email address on this order.</p>}
          <p className="rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm">
            This moves the order to <span className="font-semibold">{d.newDeliveryLabel}</span> in Shopify straight away (Monday's dispatch), then sends this email.
          </p>
          <p className="text-sm"><span className="font-semibold">To:</span> {d.to ?? "—"}</p>
          <p className="text-sm"><span className="font-semibold">Subject:</span> {d.subject}</p>
          <pre className="text-sm whitespace-pre-wrap font-sans bg-secondary/30 rounded-xl p-4">{d.body}</pre>
          {d.link ? (
            <p className="text-sm">
              <span className="font-semibold">Try the link:</span>{" "}
              <a href={d.link} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 break-all">open what the customer will see</a>
              <span className="block text-muted-foreground">Until you press the button below, the order is still on Saturday, so the chat will say Saturday.</span>
            </p>
          ) : (
            <p className="rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
              No link could be made ({d.linkError ?? "the assistant didn't answer"}) — the email will ask them to reply instead.
            </p>
          )}
        </>
      )}
    </ConfirmSheet>
  );
}

export default function FridayDispatchCheck() {
  const [picked, setPicked] = useState<string | null>(null);
  const { data, isLoading, isFetching, error, refetch } = useFridayCheck(picked);
  const [emailRow, setEmailRow] = useState<FridayCheckRow | null>(null);

  // The server's answer when it has one; worked out here too, so the date
  // controls still work when the Shopify read failed.
  const friday = picked ?? data?.dispatchDate ?? fridayOnOrAfter(londonToday());
  const flagged = data?.results.filter(r => r.status !== "ok") ?? [];
  const willGo = data?.results.filter(r => r.status === "ok") ?? [];

  return (
    <div className="p-4 md:p-6 space-y-6 w-full">
      <PageHeader title="Friday dispatch check" description="Friday's orders APC won't deliver on the Saturday." />

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => friday && setPicked(addDays(friday, -7))} disabled={!friday} aria-label="Previous Friday"
          className="h-12 w-12 rounded-xl border-2 border-border flex items-center justify-center hover:bg-secondary/60 disabled:opacity-40">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <label className="flex items-center gap-3">
          <span className="text-base font-semibold">Dispatch Friday</span>
          <input type="date" value={friday ?? ""} onChange={e => e.target.value && setPicked(fridayOnOrAfter(e.target.value))}
            className="h-12 px-3 rounded-xl border-2 border-border bg-background text-base" />
        </label>
        <button onClick={() => friday && setPicked(addDays(friday, 7))} disabled={!friday} aria-label="Next Friday"
          className="h-12 w-12 rounded-xl border-2 border-border flex items-center justify-center hover:bg-secondary/60 disabled:opacity-40">
          <ChevronRight className="w-6 h-6" />
        </button>
        <button onClick={() => refetch()} disabled={isFetching}
          className="h-12 px-4 rounded-xl border-2 border-border text-base font-semibold inline-flex items-center gap-2 hover:bg-secondary/60 disabled:opacity-40">
          <RefreshCw className={cn("w-5 h-5", isFetching && "animate-spin")} /> Check again
        </button>
        {data && (
          <p className="text-base text-muted-foreground">
            Delivery <span className="font-semibold text-foreground">{data.dates.deliveryLabel}</span>
            {" · "}reply for Thursday by end of <span className="font-semibold text-foreground">{data.dates.replyByLabel}</span>
          </p>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground py-10 justify-center"><Loader2 className="w-5 h-5 animate-spin" /> Reading Friday's orders from Shopify…</div>
      )}
      {error && (
        <div className="rounded-2xl border-2 border-destructive/40 bg-destructive/10 p-5 text-destructive text-base font-semibold">{(error as Error).message}</div>
      )}

      {data && !error && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3">
            <CountTile label="Will go" n={data.summary.ok} tone="green" />
            <CountTile label="No Saturday" n={data.summary.noSaturday} tone="red" />
            <CountTile label="At risk" n={data.summary.atRisk} tone="amber" />
            <CountTile label="Not in table" n={data.summary.unknown} tone="slate" />
            {data.summary.moved > 0 && <CountTile label="Moved from here" n={data.summary.moved} tone="violet" />}
          </div>

          {data.summary.total === 0 && (
            <div className="rounded-2xl border-2 border-border bg-card p-5 text-base">
              No APC orders tagged {data.dates.deliveryDate} yet.
            </div>
          )}

          {flagged.length > 0 && (
            <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-4">
              {flagged.map(r => (
                <OrderCard key={r.orderId} row={r} check={data} onEmail={setEmailRow} />
              ))}
            </div>
          )}
          {data.summary.total > 0 && flagged.length === 0 && (
            <div className="rounded-2xl border-2 border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/30 p-5 flex items-center gap-3 text-base font-semibold">
              <CheckCircle2 className="w-6 h-6 text-green-600" /> Every order should get its Saturday delivery.
            </div>
          )}

          {data.moved.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-lg font-bold">Moved from here</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-4 gap-3">
                {data.moved.map(m => (
                  <a key={m.orderId} href={`${data.adminOrderBase}${m.orderId}`} target="_blank" rel="noopener noreferrer"
                    className="rounded-2xl border-2 border-violet-300 dark:border-violet-800 bg-card p-4 hover:bg-secondary/40">
                    <p className="text-xl font-black tabular-nums text-primary inline-flex items-center gap-1.5">{m.orderName} <ExternalLink className="w-4 h-4" /></p>
                    <p className="text-base font-semibold">Delivery {m.movedTo ? shortDay(m.movedTo) : "—"}</p>
                    <p className="text-sm text-muted-foreground">
                      {m.movedAt ? `Moved ${when(m.movedAt)}` : ""}{m.movedBy ? ` by ${m.movedBy}` : ""}
                      {m.emailedAt ? ` · emailed ${when(m.emailedAt)}` : ""}
                    </p>
                  </a>
                ))}
              </div>
            </section>
          )}

          <SafeProductsList products={data.safeProducts ?? []} canEdit={data.canCourier} />

          {willGo.length > 0 && (
            <details className="rounded-2xl border-2 border-border bg-card">
              <summary className="cursor-pointer select-none px-5 py-4 text-lg font-bold flex items-center gap-2">
                <Truck className="w-5 h-5 text-emerald-600" /> {willGo.length} will go on Saturday
              </summary>
              <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2">
                {willGo.map(r => (
                  <a key={r.orderId} href={`${data.adminOrderBase}${r.orderId}`} target="_blank" rel="noopener noreferrer"
                    className="rounded-xl border border-border px-4 py-3 hover:bg-secondary/40">
                    <span className="font-bold tabular-nums text-primary">{r.orderName}</span>{" "}
                    <span className="font-semibold">{r.customerName}</span>
                    <span className="block text-sm text-muted-foreground">
                      <span className="font-mono">{r.postcode}</span>{r.depot ? ` · depot ${r.depot}` : ""}
                    </span>
                  </a>
                ))}
              </div>
            </details>
          )}

          {data.calendarChecked === false && (
            <p className="rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm font-semibold text-amber-900 dark:text-amber-200">
              Couldn't read the delivery calendar from Zapiet, so the move-to date ({shortDay(data.dates.nextWeekDelivery)}) only allows for our own closure days. Check it isn't a blacked-out day.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Checked against {data.source}, recorded APC answers, and {data.refusalsConsidered} Saturday refusal{data.refusalsConsidered === 1 ? "" : "s"} in the {data.refusalDays} days before. Only strong signs are flagged: no Saturday in APC's table, a restriction APC told us about, or the same postcode area refused on two different Fridays. A depot's one-off refusal isn't.
          </p>
        </>
      )}

      {emailRow && data && (
        <EmailSheet row={emailRow} dispatchDate={data.dispatchDate} onClose={() => setEmailRow(null)} />
      )}
    </div>
  );
}
