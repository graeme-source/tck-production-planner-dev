/**
 * APC consignment check (Graeme, 19 Oct 2026) — incident #136845.
 *
 * Orders that went out (pushed to Shopify, or label printed) on a waybill
 * whose collection date wasn't the day it went out, or that APC shows as
 * CANCELLED / DISPOSED OF; and old bookings the app retired that may still be
 * live at APC, with the cancel decision. The same check runs every day at
 * 17:30 and rings Graeme's bell when it finds something new.
 *
 * Opening the page reads our own records only. "Check APC now" re-reads
 * APC's tracking (read-only). Only "Yes, cancel it in APC" writes to APC.
 */
import { useState } from "react";
import { ExternalLink, Loader2, PackageX, RefreshCw, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useConsignmentCheck, useRunConsignmentCheck, friendlyDay, type CheckRow } from "@/components/apc-consignment-check/api";
import { OldBookingPrompt } from "@/components/apc-consignment-check/old-booking-prompt";

const WINDOWS = [7, 45, 90] as const;

function Fact({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "bad" }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("text-base font-medium break-words", tone === "bad" && "text-red-700 dark:text-red-300 font-bold")}>{value}</p>
    </div>
  );
}

function MismatchCard({ row, adminOrderBase }: { row: CheckRow; adminOrderBase: string }) {
  const otherDay = row.problems.some(p => p.kind === "collected-other-day");
  return (
    <div className="rounded-2xl border-2 border-red-300 dark:border-red-800 bg-card p-5 space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <PackageX className="w-7 h-7 text-red-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xl font-bold leading-tight">
            {row.orderId ? (
              <a href={`${adminOrderBase}${row.orderId}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                {row.orderName ?? `Order ${row.orderId}`} <ExternalLink className="w-4 h-4" />
              </a>
            ) : (row.orderName ?? "Unknown order")}
            {row.customerName ? <span className="text-muted-foreground font-semibold"> — {row.customerName}</span> : null}
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {row.problems.map(p => (
              <span key={p.kind} className="px-3 py-1 rounded-full text-sm font-semibold bg-red-100 dark:bg-red-950/50 text-red-800 dark:text-red-200">{p.label}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <Fact label="Waybill" value={<span className="font-mono text-sm">{row.waybill}</span>} />
        <Fact label="Booked" value={friendlyDay(row.bookedAt)} />
        <Fact label="Collection date" value={friendlyDay(row.collectionDate)} tone={otherDay ? "bad" : undefined} />
        <Fact label="Went out (dispatch day)" value={friendlyDay(row.dispatchDate)} tone={otherDay ? "bad" : undefined} />
        <Fact label="Delivery date" value={
          row.currentDeliveryDate && row.bookedForDeliveryDate && row.currentDeliveryDate !== row.bookedForDeliveryDate
            ? `${friendlyDay(row.currentDeliveryDate)} (booked for ${friendlyDay(row.bookedForDeliveryDate)})`
            : friendlyDay(row.currentDeliveryDate ?? row.bookedForDeliveryDate)
        } />
        <Fact
          label="APC status"
          value={row.apcDeadStatus ?? row.apcStatus ?? (row.apcStatusCheckedAt ? "—" : "Not checked yet")}
          tone={row.apcDeadStatus ? "bad" : undefined}
        />
      </div>
      {(row.cancelledReason || row.supersededReason) && (
        <p className="text-sm text-muted-foreground">Our record: {row.cancelledReason ?? row.supersededReason}</p>
      )}
    </div>
  );
}

export default function ApcConsignmentCheckPage() {
  const [days, setDays] = useState<number>(45);
  const { data, isLoading, error } = useConsignmentCheck(days);
  const run = useRunConsignmentCheck(days);

  const action = (
    <button
      onClick={() => run.mutate(undefined, {
        onSuccess: r => toast({
          title: r.mismatches.length ? `${r.mismatches.length} problem${r.mismatches.length === 1 ? "" : "s"} found` : "Nothing wrong found",
          description: `${r.apcReads} APC tracking reads${r.apcUnreachable ? `, ${r.apcUnreachable} couldn't reach APC` : ""}.`,
        }),
        onError: (e: Error) => toast({ title: "Check failed", description: e.message, variant: "destructive" }),
      })}
      disabled={run.isPending}
      className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-5 h-12 text-base font-bold hover:opacity-90 disabled:opacity-50"
    >
      {run.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
      {run.isPending ? "Asking APC…" : "Check APC now"}
    </button>
  );

  return (
    <div className="p-4 md:p-6 space-y-6 w-full">
      <PageHeader
        title="APC consignment check"
        description="Orders that went out on an APC booking for a different day, or one APC shows as cancelled or disposed of — and old bookings that may still be live at APC. Runs by itself every day at 17:30."
        action={action}
      />

      <div className="flex flex-wrap items-center gap-2">
        {WINDOWS.map(w => (
          <button
            key={w}
            onClick={() => setDays(w)}
            className={cn("h-11 rounded-full px-4 text-sm border", days === w ? "bg-muted font-semibold border-foreground/30" : "border-border hover:bg-muted")}
          >
            Last {w} days
          </button>
        ))}
        {data?.lastRun && (
          <span className="text-sm text-muted-foreground ml-2">
            Last APC check {new Date(data.lastRun.ranAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}
            {" "}· {data.lastRun.apcReads} tracking reads{data.lastRun.apcUnreachable ? ` (${data.lastRun.apcUnreachable} unreachable)` : ""}
          </span>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground py-10 justify-center"><Loader2 className="w-5 h-5 animate-spin" /> Reading consignments…</div>
      )}
      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-destructive">{(error as Error).message}</div>
      )}

      {data && (
        <>
          <section className="space-y-3">
            <h2 className="text-xl font-bold">Went out on an old or cancelled booking ({data.mismatches.length})</h2>
            {data.mismatches.length === 0 ? (
              <div className="rounded-2xl border-2 border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/30 p-5 flex items-center gap-3">
                <ShieldCheck className="w-7 h-7 text-green-700 dark:text-green-300" />
                <p className="text-base text-green-900 dark:text-green-200">
                  Nothing found — all {data.checkedRows} consignments that went out in the last {data.days} days were for their own collection day
                  {data.apcReads || data.lastRun ? ", and none is cancelled in APC as far as we've checked" : ""}.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
                {data.mismatches.map(r => <MismatchCard key={r.waybill} row={r} adminOrderBase={data.adminOrderBase} />)}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold">Old bookings to decide ({data.oldBookings.length})</h2>
            <p className="text-sm text-muted-foreground max-w-prose">
              Bookings the app stopped using — the order was rescheduled, or the booking was for another day — that APC may still collect against.
              Nothing is cancelled at APC unless you press "Yes, cancel it in APC".
            </p>
            {data.oldBookings.length === 0 ? (
              <p className="text-base text-muted-foreground">None waiting.</p>
            ) : (
              <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3">
                {data.oldBookings.map(r => (
                  <OldBookingPrompt
                    key={r.waybill}
                    waybill={r.waybill}
                    orderName={r.orderName}
                    collectionDate={r.collectionDate}
                    reason={r.supersededReason}
                    apcStatus={r.apcStatus}
                    liveInApc={r.apcStatusCheckedAt ? true : null}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
