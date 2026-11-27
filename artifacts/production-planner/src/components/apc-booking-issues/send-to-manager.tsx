/**
 * "A manager will deal with these" — the ONLY thing a team member is asked
 * to do about booking issues (Graeme, 27 Nov 2026: a packer came to him not
 * knowing whether they could carry on). No list of errors, no choices: send
 * them to the managers in one message and carry on packing. Managers work
 * them in the full "Booking issues today" report.
 *
 * Used at the end of a booking run and in place of the report for anyone
 * who isn't a manager. POST /booking-issues/today/escalate-all. Objective C.
 */
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useBookingIssuesToday, useEscalateAll } from "./api";

export function SendIssuesToManager({ onDone }: { onDone: () => void }) {
  const { data, isLoading } = useBookingIssuesToday();
  const send = useEscalateAll();
  if (isLoading || !data) {
    return <p className="flex items-center gap-2 text-muted-foreground py-6 justify-center"><Loader2 className="w-5 h-5 animate-spin" /> One moment…</p>;
  }
  const open = data.issues.filter(i => !i.done);
  const unsent = open.filter(i => i.actions.escalate.enabled);

  if (open.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 p-5 space-y-3">
        <p className="text-lg font-bold flex items-center gap-2"><CheckCircle2 className="w-6 h-6 text-emerald-600" /> All sorted — nothing for you to do.</p>
        <button onClick={onDone} className="h-12 px-6 rounded-xl bg-primary text-primary-foreground text-base font-bold">Carry on packing</button>
      </div>
    );
  }

  if (unsent.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 p-5 space-y-3">
        <p className="text-lg font-bold flex items-center gap-2"><CheckCircle2 className="w-6 h-6 text-emerald-600" /> Sent to a manager — they're dealing with it.</p>
        <p className="text-base">You don't need to do anything else. Carry on packing.</p>
        <button onClick={onDone} className="h-12 px-6 rounded-xl bg-primary text-primary-foreground text-base font-bold">Carry on packing</button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/30 p-5 space-y-3">
      <p className="text-lg font-bold">{unsent.length === 1 ? "One order" : `${unsent.length} orders`} couldn't be booked.</p>
      <p className="text-base">A manager will deal with {unsent.length === 1 ? "it" : "them"}. You don't need to do anything else — send it to them and carry on packing.</p>
      <button
        onClick={() => send.mutate(undefined, {
          onSuccess: r => {
            toast({ title: r.to.length ? `Sent to ${r.to.join(", ")}` : "Sent to the managers", description: "Carry on packing." });
            onDone();
          },
          onError: e => toast({ title: "Couldn't send it", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
        })}
        disabled={send.isPending}
        className="w-full min-h-16 rounded-2xl bg-primary text-primary-foreground px-5 py-3 text-lg font-bold flex items-center justify-center gap-3 disabled:opacity-60"
      >
        {send.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : <Send className="w-6 h-6" />}
        Send to a manager and carry on packing
      </button>
    </div>
  );
}
