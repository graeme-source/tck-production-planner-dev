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
import { Check, ChevronDown, ChevronRight, ExternalLink, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { AUDIENCES, guideWords, sinceWords, type AudienceKey, type ReasonGuide, type ReasonSummary, type RestState } from "@workspace/marketing-calendar";
import { cn } from "@/lib/utils";
import { calApi, CAL_KEY } from "./api";

interface UseSales { perDayDuring: number; perDayBefore: number; changePct: number | null }
interface ReasonsReport {
  connected: boolean;
  reasons: Array<ReasonSummary & { lastUseSales: UseSales | null; guide: ReasonGuide; readyFrom: string | null; ready: boolean; rest: RestState | null }>;
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
          <span className="block text-sm text-muted-foreground">Ready to use first, least recently used at the top — then the ones still resting.</span>
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
              {data.error && <p className="text-sm text-destructive" title={data.error}>Reading paused — the AI couldn't be reached just now. It tries again on its own.</p>}

              {reasons.length === 0 && !adding && (
                <p className="text-muted-foreground">No reasons yet. Add the reasons you use — "You've got credit", "Free pack", "New recipe" — and every past email is read to see when each was last used.</p>
              )}

              {reasons.length > 0 && (
                <div className="rounded-2xl border border-border divide-y divide-border overflow-hidden">
                  {reasons.map(r => <ReasonRow key={r.reason.id} r={r} stillReading={data.unread > 0} />)}
                </div>
              )}

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

/** One reason per full-width row (Graeme, 18 Nov: "one underneath each
 *  other" so lots show at once); tap to open the detail and its emails. */
function ReasonRow({ r, stillReading }: { r: ReasonsReport["reasons"][number]; stillReading: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const u = r.lastUse;
  const s = r.lastUseSales;
  // Emails are read newest first, so a use found so far is right — but "not
  // used" can't be said until every email has been read.
  const pending = r.daysSince == null && stillReading;
  const never = r.daysSince == null && !stillReading;
  const guide = guideWords(r.guide);
  return (
    <div className={cn(never && "bg-primary/5")}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full min-h-[56px] px-4 py-3 text-left hover:bg-secondary/40 flex items-start gap-3">
        {open ? <ChevronDown className="w-5 h-5 mt-0.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-5 h-5 mt-0.5 text-muted-foreground shrink-0" />}
        <span className="flex-1 min-w-0 grid gap-x-6 gap-y-0.5 md:grid-cols-[minmax(10rem,1.2fr)_minmax(9rem,1fr)_minmax(0,2.4fr)] md:items-baseline">
          <span className="min-w-0">
            <span className="block font-bold text-base leading-tight break-words">{r.reason.name}</span>
            {guide && <span className="block text-xs text-muted-foreground break-words mt-0.5">{guide}</span>}
          </span>
          <span className="min-w-0">
            <span className={cn("block font-display font-extrabold", never ? "text-primary" : pending ? "text-muted-foreground font-semibold" : "text-foreground")}>
              {pending ? "Still checking emails…" : sinceWords(r.daysSince)}
            </span>
            {!pending && r.rest && <RestPill rest={r.rest} />}
          </span>
          <span className="text-sm text-muted-foreground min-w-0">
            {u ? <>
              <span className="font-semibold text-foreground">{range(u.from, u.to)}</span>
              {" · "}{u.emails.length} email{u.emails.length === 1 ? "" : "s"}
              {" · "}<span className="font-semibold text-foreground">{gbp(u.revenue)}</span> from {u.orders.toLocaleString("en-GB")} orders
            </> : pending ? "" : "No email in the last year"}
          </span>
        </span>
      </button>

      {open && (
        <div className="pl-12 pr-4 pb-4 space-y-3">
          {r.reason.description && <p className="text-base font-semibold text-foreground max-w-prose break-words">{r.reason.description}</p>}
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
          {r.uses.map(use => (
            <div key={use.from} className="space-y-1">
              <p className="text-sm font-semibold">{range(use.from, use.to)} · {gbp(use.revenue)} from {use.orders} orders</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                {use.emails.map(e => (
                  <li key={e.campaignId} className="break-words">
                    {day(e.date)} ·{" "}
                    {e.klaviyoUrl ? (
                      <a href={e.klaviyoUrl} target="_blank" rel="noopener noreferrer" title="Open in Klaviyo — Clone is at the top"
                        className="font-semibold text-foreground underline underline-offset-2 decoration-muted-foreground/50 hover:decoration-foreground inline-flex items-baseline gap-1">
                        {e.subject ?? e.name}<ExternalLink className="w-3.5 h-3.5 self-center shrink-0" />
                      </a>
                    ) : (e.subject ?? e.name)}{" "}
                    <span className="tabular-nums">· {gbp(e.revenue)}</span>
                    {e.evidence && <span className="block text-xs italic">“{e.evidence}”</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <button type="button" onClick={() => setEditing(e => !e)} className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2">
            {editing ? "Done editing" : "Edit this reason"}
          </button>
          {editing && <EditReason id={r.reason.id} name={r.reason.name} description={r.reason.description} guide={r.guide} />}
        </div>
      )}
    </div>
  );
}

/** Where a reason stands against its shortest gap — guidance, not a rule
 *  (Graeme, 18 Nov 2026): yellow resting, green due soon / today, dark green
 *  overdue. */
function RestPill({ rest }: { rest: RestState }) {
  const base = "inline-block mt-1 text-xs font-semibold rounded-full px-2.5 py-0.5 whitespace-nowrap";
  const green = "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
  switch (rest.kind) {
    case "resting":
      return <span className={cn(base, "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200")}
        title={`Used recently — by its guide, it's next due ${day(rest.date)}. It can still be used before then.`}>Resting until {day(rest.date)}</span>;
    case "due_soon":
      return <span className={cn(base, green)} title={`Due to be used again from ${day(rest.date)} — plan it in.`}>Due soon · from {day(rest.date)}</span>;
    case "due_today":
      return <span className={cn(base, green)} title="Due to be used again from today.">Due today</span>;
    case "overdue":
      return <span className={cn(base, "bg-emerald-700 text-white dark:bg-emerald-600")}
        title={`Could have been used again since ${day(rest.date)} and hasn't been.`}>Overdue · since {day(rest.date)}</span>;
  }
}

/** Name + "what counts", saved as you leave each box. */
function EditReason({ id, name, description, guide }: { id: number; name: string; description: string | null; guide: ReasonGuide }) {
  const qc = useQueryClient();
  const [n, setN] = useState(name);
  const [d, setD] = useState(description ?? "");
  useEffect(() => { setN(name); setD(description ?? ""); }, [name, description]);
  const [rereads, setRereads] = useState(false);
  const save = useMutation({
    mutationFn: (body: { name?: string; description?: string | null } & Partial<ReasonGuide>) =>
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
        <input value={n} onChange={e => setN(e.target.value)} onBlur={() => { if (n.trim() && n.trim() !== name) { setRereads(true); save.mutate({ name: n.trim() }); } }}
          className="mt-1 w-full h-11 rounded-xl border border-border bg-card px-3 font-normal" />
      </label>
      <label className="block text-sm font-semibold">What counts as this reason
        <textarea value={d} onChange={e => setD(e.target.value)} onBlur={() => { if (d.trim() !== (description ?? "")) { setRereads(true); save.mutate({ description: d.trim() || null }); } }}
          rows={2} placeholder="e.g. Customers with unused credit, told to use it before it expires"
          className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 font-normal" />
      </label>
      <GuideFields guide={guide} onSave={body => { setRereads(false); save.mutate(body); }} />
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">
          {save.isPending ? "Saving…" : save.isError ? "Not saved" : save.isSuccess ? <span className="inline-flex items-center gap-1"><Check className="w-4 h-4" /> Saved{rereads ? " — past emails are read again" : ""}</span> : "Changes save as you go."}
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

const toNum = (v: string): number | null => {
  const n = Math.round(Number(v));
  return v.trim() && Number.isFinite(n) && n > 0 ? n : null;
};

/** How it's usually run — guidance, not rules (Graeme, 18 Nov 2026). */
function GuideFields({ guide, onSave }: { guide: ReasonGuide; onSave: (body: Partial<ReasonGuide>) => void }) {
  const [emails, setEmails] = useState(guide.emailsPerUse?.toString() ?? "");
  const [days, setDays] = useState(guide.daysPerUse?.toString() ?? "");
  const startUnit = guide.minGapDays && guide.minGapDays % 30 === 0 ? 30 : guide.minGapDays && guide.minGapDays % 7 === 0 ? 7 : guide.minGapDays ? 1 : 30;
  const [unit, setUnit] = useState<number>(startUnit);
  const [gap, setGap] = useState(guide.minGapDays ? String(guide.minGapDays / startUnit) : "");
  const [who, setWho] = useState<AudienceKey[]>(guide.audiences);
  const saveGap = (g: string, u: number) => {
    const n = toNum(g);
    const next = n == null ? null : Math.min(730, n * u);
    if (next !== guide.minGapDays) onSave({ minGapDays: next });
  };
  const box = "mt-1 w-full h-11 rounded-xl border border-border bg-card px-3 font-normal";
  return (
    <div className="space-y-2 rounded-xl bg-secondary/40 p-3">
      <p className="text-sm font-semibold">How it's usually run <span className="font-normal text-muted-foreground">— a guide for planning, not a rule</span></p>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block text-sm font-semibold">About how many emails
          <input inputMode="numeric" value={emails} onChange={e => setEmails(e.target.value)} placeholder="e.g. 4"
            onBlur={() => { const v = toNum(emails); if (v !== guide.emailsPerUse) onSave({ emailsPerUse: v }); }} className={box} />
        </label>
        <label className="block text-sm font-semibold">Over how many days
          <input inputMode="numeric" value={days} onChange={e => setDays(e.target.value)} placeholder="e.g. 7"
            onBlur={() => { const v = toNum(days); if (v !== guide.daysPerUse) onSave({ daysPerUse: v }); }} className={box} />
        </label>
        <div className="block text-sm font-semibold">Use it at most every
          <div className="mt-1 flex gap-2">
            <input inputMode="numeric" aria-label="Shortest gap" value={gap} onChange={e => setGap(e.target.value)} placeholder="e.g. 2"
              onBlur={() => saveGap(gap, unit)} className="w-20 h-11 rounded-xl border border-border bg-card px-3 font-normal" />
            <select aria-label="Gap unit" value={unit} onChange={e => { const u = Number(e.target.value); setUnit(u); saveGap(gap, u); }}
              className="flex-1 h-11 rounded-xl border border-border bg-card px-2 font-normal">
              <option value={7}>weeks</option>
              <option value={30}>months</option>
              <option value={1}>days</option>
            </select>
          </div>
        </div>
      </div>
      <div className="text-sm font-semibold">Who it goes to
        <div className="mt-1 flex flex-wrap gap-2">
          {AUDIENCES.map(a => {
            const on = who.includes(a.key);
            return (
              <button key={a.key} type="button" aria-pressed={on}
                onClick={() => { const next = on ? who.filter(k => k !== a.key) : [...who, a.key]; setWho(next); onSave({ audiences: next }); }}
                className={cn("min-h-[44px] px-3 rounded-full border-2 font-semibold inline-flex items-center gap-1",
                  on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
                {on && <Check className="w-4 h-4" />} {a.label}
              </button>
            );
          })}
        </div>
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
