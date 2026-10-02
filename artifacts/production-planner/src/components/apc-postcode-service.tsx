/**
 * What APC's postcode table says an address can take, at a glance (Graeme,
 * 2026-10-02): next-day weekday and Saturday on two separate lines in big
 * text with a tick or a cross, then the depot. Blue, as before, so it still
 * reads as "the postcode check".
 *
 * On top of the table: what APC customer service have since told us
 * (apc_postcode_overrides). A permanent answer turns that line into a cross
 * ("No Saturday delivery — confirmed by APC on 2 Oct, permanent"); a
 * temporary one adds an amber "Temporary Saturday restriction reported
 * 2 Oct by Grant" line.
 *
 * Underneath, in amber, the advice. When APC refused something the table
 * says the depot normally does and nobody has asked APC yet, the advice is
 * a call prompt — a big tap-to-call button (number from Contacts) and the
 * two answers to record: "Temporary restriction" / "Permanent — no
 * Saturday service", each confirmed before it's saved.
 */
import { useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, XCircle, Phone, Loader2, Clock, Ban, Undo2, BookUser } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { telHref } from "@/components/contacts/contacts-api";
import { useApcPostcodeOverrides, useClearApcOverride, useRecordApcOverride, type OverrideKind, type OverrideService } from "@/components/apc-postcode-overrides";

export interface PostcodeRestriction {
  id: number;
  kind: OverrideKind;
  recordedOn: string;
  recordedByName: string | null;
  note: string | null;
  expiresOn: string | null;
  label: string;
}

export interface PostcodeServiceFacts {
  matchedOn: string;
  depot: string;
  nextDay: boolean;
  weekdayCutoff: string | null;
  transitDays: number | null;
  saturdayDelivery: boolean;
  saturdayCutoff: string | null;
  restrictions?: { saturday: PostcodeRestriction | null; weekday: PostcodeRestriction | null };
}

/** Who to call and what about — set by the server when APC refused a
 *  service the table says the depot normally offers. */
export interface PostcodeCall {
  outward: string;
  depot: string;
  contactName: string | null;
  phone: string | null;
}

function Line({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-base font-semibold">
      {ok
        ? <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        : <XCircle className="w-5 h-5 shrink-0 text-red-600 dark:text-red-400" />}
      <span>{children}</span>
    </p>
  );
}

function TemporaryLine({ r }: { r: PostcodeRestriction }) {
  return (
    <p className="flex items-start gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300 pl-7">
      <Clock className="w-4 h-4 shrink-0 mt-0.5" />
      <span>{r.label}{r.expiresOn ? <span className="font-normal"> · lapses {r.expiresOn}</span> : null}</span>
    </p>
  );
}

export function PostcodeServiceCard({ service, advice, call, callService, className }: {
  service: PostcodeServiceFacts;
  advice?: string | null;
  /** When present, the advice is a call prompt with record buttons. */
  call?: PostcodeCall | null;
  /** Which service APC refused (for the record buttons' wording). */
  callService?: OverrideService | null;
  className?: string;
}) {
  const sat = service.restrictions?.saturday ?? null;
  const wk = service.restrictions?.weekday ?? null;
  return (
    <div className={cn("space-y-2", className)}>
      <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-blue-950 dark:text-blue-100 space-y-1">
        <Line ok={service.nextDay}>
          {wk?.kind === "permanent"
            ? <>{wk.label}</>
            : service.nextDay
              ? <>Next-day weekdays{service.weekdayCutoff ? <> — by {service.weekdayCutoff}</> : null}</>
              : service.transitDays
                ? <>No next-day service — {service.transitDays} days in transit</>
                : <>No next-day weekday service</>}
        </Line>
        {wk?.kind === "temporary" && <TemporaryLine r={wk} />}
        <Line ok={service.saturdayDelivery}>
          {sat?.kind === "permanent"
            ? <>{sat.label}</>
            : service.saturdayDelivery
              ? <>Saturday{service.saturdayCutoff ? <> — by {service.saturdayCutoff}</> : null}</>
              : <>No Saturday delivery</>}
        </Line>
        {sat?.kind === "temporary" && <TemporaryLine r={sat} />}
        <p className="text-xs text-blue-800/80 dark:text-blue-300/80">
          {service.matchedOn} · Depot {service.depot} · from APC's postcode table
        </p>
      </div>
      {advice && call && callService ? (
        <CallApcPrompt advice={advice} call={call} service={callService} />
      ) : advice && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-950 dark:text-amber-100 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
          <span className="font-semibold">{advice}</span>
        </div>
      )}
    </div>
  );
}

/** The call-the-depot flow: dial, ask, record the answer (confirmed). */
export function CallApcPrompt({ advice, call, service }: { advice: string; call: PostcodeCall; service: OverrideService }) {
  const [pending, setPending] = useState<OverrideKind | null>(null);
  const [note, setNote] = useState("");
  const [recorded, setRecorded] = useState<{ id: number; label: string } | null>(null);
  const record = useRecordApcOverride();
  const clear = useClearApcOverride();
  const permanentLabel = service === "saturday" ? "Permanent — no Saturday service" : "Permanent — no next-day weekday service";
  const serviceWord = service === "saturday" ? "Saturday" : "next-day weekday";
  // The lapse window is the server's (TEMPORARY_RESTRICTION_DAYS), not restated here.
  const temporaryDays = useApcPostcodeOverrides().data?.temporaryDays;

  function save(kind: OverrideKind) {
    record.mutate(
      { outward: call.outward, service, kind, depot: call.depot, note: note.trim() || null },
      {
        onSuccess: (r) => { setRecorded({ id: r.id, label: r.label }); setPending(null); },
        onError: (err) => toast({ title: "Not recorded", description: (err as Error).message, variant: "destructive" }),
      },
    );
  }

  function undo() {
    if (!recorded) return;
    clear.mutate(recorded.id, {
      onSuccess: () => { setRecorded(null); toast({ title: "Undone — nothing recorded for " + call.outward }); },
      onError: (err) => toast({ title: "Couldn't undo", description: (err as Error).message, variant: "destructive" }),
    });
  }

  return (
    <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-3 text-amber-950 dark:text-amber-100 space-y-3">
      <p className="text-sm flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
        <span className="font-semibold">{advice}</span>
      </p>

      {call.phone ? (
        <a
          href={telHref(call.phone)}
          className="flex items-center justify-center gap-3 min-h-12 px-4 py-2 rounded-xl bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:scale-[0.99] transition-all"
        >
          <Phone className="w-5 h-5 shrink-0" />
          <span className="text-left leading-tight">
            <span className="block font-semibold">Call {call.contactName ?? "APC"}</span>
            <span className="block font-mono text-sm tabular-nums">{call.phone}</span>
          </span>
        </a>
      ) : (
        <Link href="/contacts" className="flex items-center justify-center gap-2 h-12 px-4 rounded-xl border-2 border-amber-400 bg-background font-semibold">
          <BookUser className="w-5 h-5" /> Find APC in Contacts
        </Link>
      )}

      {recorded ? (
        <div className="rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-sm text-emerald-950 dark:text-emerald-100 flex flex-wrap items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="flex-1 min-w-[12rem]">Recorded for {call.outward}: {recorded.label}. Reschedule this order.</span>
          <button onClick={undo} disabled={clear.isPending} className="h-10 px-3 rounded-lg border border-border bg-background text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-50">
            {clear.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />} Undo
          </button>
        </div>
      ) : pending ? (
        <div className="rounded-lg border-2 border-amber-400 bg-background p-3 space-y-2 text-foreground">
          <p className="text-sm font-semibold">
            {pending === "permanent"
              ? `Record that APC said there is NO ${serviceWord} service to ${call.outward} (depot ${call.depot}), permanently? ${call.outward} will show no ${serviceWord} delivery from now on, until a manager clears it.`
              : `Record that APC said the ${serviceWord} restriction to ${call.outward} (depot ${call.depot}) is temporary? It shows on ${call.outward} for ${temporaryDays ? `${temporaryDays} days` : "a while"}, then lapses by itself.`}
          </p>
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Anything they said (optional) — e.g. who you spoke to"
            className="w-full h-11 rounded-lg border-2 border-border bg-background px-3 text-sm"
            maxLength={500}
          />
          <div className="flex flex-wrap gap-2">
            <button onClick={() => save(pending)} disabled={record.isPending} className="h-11 px-4 rounded-lg bg-foreground text-background text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
              {record.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Yes, record it
            </button>
            <button onClick={() => setPending(null)} className="h-11 px-4 rounded-lg border-2 border-border text-sm font-semibold">Back</button>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <p className="text-sm font-semibold">What did APC say?</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button onClick={() => setPending("temporary")} className="min-h-12 px-3 py-2 rounded-xl border-2 border-amber-400 bg-background text-foreground font-semibold text-sm inline-flex items-center justify-center gap-2 hover:bg-amber-100/60 dark:hover:bg-amber-900/30">
              <Clock className="w-5 h-5 shrink-0 text-amber-600" /> Temporary restriction
            </button>
            <button onClick={() => setPending("permanent")} className="min-h-12 px-3 py-2 rounded-xl border-2 border-red-300 dark:border-red-800 bg-background text-foreground font-semibold text-sm inline-flex items-center justify-center gap-2 hover:bg-red-50 dark:hover:bg-red-950/30">
              <Ban className="w-5 h-5 shrink-0 text-red-600" /> {permanentLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
