/**
 * Reasons to Buy (Graeme, 18 Nov 2026): the reasons we give customers to
 * order — entered here — with when each was last used in an email, how it
 * did, and the least recently used at the top, so the next emails can pick
 * one we haven't leaned on lately. Every sent Klaviyo email is read
 * automatically to see which reasons it used (server:
 * lib/reasons-to-buy-store.ts); a burst of emails about the same thing counts
 * as one use. Objective I.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Check, ChevronDown, ChevronRight, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { sinceWords, type ReasonSummary } from "@workspace/marketing-calendar";
import { cn } from "@/lib/utils";
import { calApi, CAL_KEY } from "./api";

interface UseSales { perDayDuring: number; perDayBefore: number; changePct: number | null }
interface ReasonsReport {
  connected: boolean;
  reasons: Array<ReasonSummary & { lastUseSales: UseSales | null }>;
  unread: number;
  reading: boolean;
  error: string | null;
}

const REASONS_KEY = [...CAL_KEY, "reasons"] as const;
const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
const day = (d: string) => format(parseISO(d), "d MMM");
const range = (a: string, b: string) => (a === b ? day(a) : `${day(a)} – ${day(b)}`);

export function ReasonsToBuyPanel() {
  const q = useQuery({
    queryKey: REASONS_KEY,
    queryFn: () => calApi<ReasonsReport>("/marketing-calendar/reasons"),
    // While past emails are still being read, check back often.
    refetchInterval: query => {
      const d = query.state.data as ReasonsReport | undefined;
      return d && (d.reading || d.unread > 0) ? 10_000 : 5 * 60_000;
    },
  });
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const data = q.data;
  const reasons = data?.reasons ?? [];

  return (
    <section className="rounded-3xl border border-border bg-card shadow-sm">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-5 py-4 text-left">
        <span className="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0"><Sparkles className="w-5 h-5" /></span>
        <span className="flex-1 min-w-0">
          <span className="block text-xl font-display font-extrabold">Reasons to buy</span>
          <span className="block text-sm text-muted-foreground">Least recently used first — pick one we haven't leaned on lately.</span>
        </span>
        {open ? <ChevronDown className="w-5 h-5 text-muted-foreground" /> : <ChevronRight className="w-5 h-5 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-3">
          {q.isLoading ? (
            <p className="py-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>
          ) : q.isError ? (
            <p className="py-6 text-destructive">{(q.error as Error).message}</p>
          ) : !data?.connected ? (
            <p className="py-6 text-muted-foreground">Connect Klaviyo to see when each reason was last used.</p>
          ) : (
            <>
              {(data.reading || data.unread > 0) && reasons.length > 0 && (
                <p className="text-sm flex items-center gap-2 text-sky-800 dark:text-sky-300">
                  <Loader2 className="w-4 h-4 animate-spin" /> Reading {data.unread.toLocaleString("en-GB")} past email{data.unread === 1 ? "" : "s"} to see which reasons they used — this fills in as it goes.
                </p>
              )}
              {data.error && <p className="text-sm text-destructive">Reading paused: {data.error}</p>}

              {reasons.length === 0 && !adding && (
                <p className="text-muted-foreground">No reasons yet. Add the reasons you use — "You've got credit", "Free pack", "New recipe" — and every past email is read to see when each was last used.</p>
              )}

              <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                {reasons.map(r => <ReasonCard key={r.reason.id} r={r} />)}
              </div>

              {adding ? <AddReason onDone={() => setAdding(false)} /> : (
                <button type="button" onClick={() => setAdding(true)}
                  className="min-h-[48px] px-4 rounded-xl border-2 border-dashed border-border text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/40 inline-flex items-center gap-2">
                  <Plus className="w-4 h-4" /> Add a reason to buy
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function ReasonCard({ r }: { r: ReasonsReport["reasons"][number] }) {
  const [showMore, setShowMore] = useState(false);
  const [editing, setEditing] = useState(false);
  const u = r.lastUse;
  const s = r.lastUseSales;
  const never = r.daysSince == null;
  return (
    <div className={cn("rounded-2xl border-2 p-4 space-y-2 min-w-0", never ? "border-primary/50 bg-primary/5" : "border-border bg-background")}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-lg font-bold leading-tight break-words">{r.reason.name}</p>
          {r.reason.description && <p className="text-sm text-muted-foreground break-words">{r.reason.description}</p>}
        </div>
        <button type="button" onClick={() => setEditing(e => !e)} className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2 shrink-0">
          {editing ? "Done" : "Edit"}
        </button>
      </div>

      <p className={cn("text-2xl font-display font-extrabold", never ? "text-primary" : "text-foreground")}>{sinceWords(r.daysSince)}</p>

      {u && (
        <div className="text-sm space-y-0.5">
          <p>
            <span className="font-semibold">Last used {range(u.from, u.to)}</span>
            <span className="text-muted-foreground"> · {u.emails.length} email{u.emails.length === 1 ? "" : "s"} · {u.recipients.toLocaleString("en-GB")} sends</span>
          </p>
          <p><span className="font-semibold">{gbp(u.revenue)}</span> <span className="text-muted-foreground">from {u.orders.toLocaleString("en-GB")} orders the emails brought in</span></p>
          {s && (
            <p className="text-muted-foreground">
              Shop sales {gbp(s.perDayDuring)} a day while it ran
              {s.changePct != null && <> — <span className={cn("font-semibold", s.changePct >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400")}>{s.changePct >= 0 ? "+" : ""}{s.changePct}%</span> on the 4 weeks before</>}
            </p>
          )}
        </div>
      )}

      {r.uses.length > 0 && (
        <button type="button" onClick={() => setShowMore(m => !m)} className="text-sm font-semibold text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          {showMore ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          The emails{r.uses.length > 1 ? ` and ${r.uses.length - 1} earlier use${r.uses.length === 2 ? "" : "s"}` : ""}
        </button>
      )}
      {showMore && (
        <div className="space-y-3 pt-1">
          {r.uses.map(use => (
            <div key={use.from} className="space-y-1">
              <p className="text-sm font-semibold">{range(use.from, use.to)} · {gbp(use.revenue)} from {use.orders} orders</p>
              <ul className="text-sm text-muted-foreground space-y-0.5">
                {use.emails.map(e => (
                  <li key={e.campaignId} className="break-words">{day(e.date)} · {e.subject ?? e.name} <span className="tabular-nums">· {gbp(e.revenue)}</span></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {editing && <EditReason id={r.reason.id} name={r.reason.name} description={r.reason.description} />}
    </div>
  );
}

/** Name + "what counts", saved as you leave each box. */
function EditReason({ id, name, description }: { id: number; name: string; description: string | null }) {
  const qc = useQueryClient();
  const [n, setN] = useState(name);
  const [d, setD] = useState(description ?? "");
  useEffect(() => { setN(name); setD(description ?? ""); }, [name, description]);
  const save = useMutation({
    mutationFn: (body: { name?: string; description?: string | null }) =>
      calApi(`/marketing-calendar/reasons/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: REASONS_KEY }),
  });
  const remove = useMutation({
    mutationFn: () => calApi(`/marketing-calendar/reasons/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: REASONS_KEY }),
  });
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <label className="block text-sm font-semibold">Name
        <input value={n} onChange={e => setN(e.target.value)} onBlur={() => n.trim() && n.trim() !== name && save.mutate({ name: n.trim() })}
          className="mt-1 w-full h-11 rounded-xl border border-border bg-card px-3 font-normal" />
      </label>
      <label className="block text-sm font-semibold">What counts as this reason
        <textarea value={d} onChange={e => setD(e.target.value)} onBlur={() => d.trim() !== (description ?? "") && save.mutate({ description: d.trim() || null })}
          rows={2} placeholder="e.g. Customers with unused credit, told to use it before it expires"
          className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 font-normal" />
      </label>
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">
          {save.isPending ? "Saving…" : save.isError ? "Not saved" : save.isSuccess ? <span className="inline-flex items-center gap-1"><Check className="w-4 h-4" /> Saved — past emails are read again</span> : "Changes save as you leave a box."}
        </span>
        <button type="button" disabled={remove.isPending}
          onClick={() => { if (window.confirm(`Remove "${name}" from the reasons to buy?`)) remove.mutate(); }}
          className="ml-auto inline-flex items-center gap-1 text-destructive hover:underline">
          <Trash2 className="w-4 h-4" /> Remove
        </button>
      </div>
    </div>
  );
}

function AddReason({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const add = useMutation({
    mutationFn: () => calApi("/marketing-calendar/reasons", { method: "POST", body: JSON.stringify({ name: name.trim(), description: description.trim() || null }) }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: REASONS_KEY }); setName(""); setDescription(""); onDone(); },
  });
  return (
    <div className="rounded-2xl border-2 border-primary/40 p-4 space-y-2">
      <label className="block text-sm font-semibold">Reason to buy
        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. You've got credit"
          className="mt-1 w-full h-11 rounded-xl border border-border bg-card px-3 font-normal" />
      </label>
      <label className="block text-sm font-semibold">What counts as this reason <span className="font-normal text-muted-foreground">(helps the matching)</span>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
          placeholder="e.g. Customers with unused credit, told to use it before it expires"
          className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 font-normal" />
      </label>
      {add.isError && <p className="text-sm text-destructive">{(add.error as Error).message}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onDone} className="min-h-[48px] px-4 rounded-xl border-2 border-border font-semibold">Cancel</button>
        <button type="button" disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}
          className="flex-1 min-h-[48px] rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-50 inline-flex items-center justify-center gap-2">
          {add.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add
        </button>
      </div>
    </div>
  );
}
