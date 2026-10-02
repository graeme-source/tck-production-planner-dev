/**
 * One marketing event, opened from the calendar. Every field autosaves with
 * a visible save state; the dates save the moment they change. A new event
 * is created as soon as it has a title.
 *
 * Planning together: the event is re-read every 15 s and on focus. When
 * someone else changed it, their changes flow into every field you are not
 * in the middle of editing, and a banner says who ("Updated by Tommy just
 * now") — nothing is silently overwritten either way.
 *
 * Modal rule: explicit X, card capped at 92dvh with internal scrolling,
 * full-width on a phone.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { format, parseISO, formatDistanceToNowStrict } from "date-fns";
import { X, Trash2, History, Users, Package, ExternalLink, Sparkles, Loader2, AlertTriangle } from "lucide-react";
import { formatRange } from "@workspace/marketing-calendar";
import { useAuth } from "@/contexts/auth-context";
import { useAutosave, type AutosaveState } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { cn } from "@/lib/utils";
import {
  CAL_KEY, calApi, patchCachedEvent, patchEvent, invalidateCalendar, useCalendarEvent, useDeleteEvent,
  type CalEvent,
} from "./api";
import { CHANNELS, EVENT_TYPES, PICKABLE_TYPES, STATUSES, firstName, typeStyle } from "./constants";

interface Draft {
  title: string;
  startDate: string;
  endDate: string;
  summary: string;
  notes: string;
  offer: string;
  type: string;
  channels: string[];
  audience: string;
  status: string;
}

type FieldKey = "title" | "summary" | "notes" | "offer" | "type" | "channels" | "audience" | "status";
const FIELD_KEYS: FieldKey[] = ["title", "summary", "notes", "offer", "type", "channels", "audience", "status"];

function draftFrom(e: CalEvent): Draft {
  return {
    title: e.title, startDate: e.startDate, endDate: e.endDate,
    summary: e.summary ?? "", notes: e.notes ?? "", offer: e.offer ?? "",
    type: e.type, channels: e.channels, audience: e.audience ?? "", status: e.status,
  };
}

function worst(a: AutosaveState, b: AutosaveState): AutosaveState {
  const rank: AutosaveState[] = ["idle", "saved", "dirty", "saving", "error"];
  return rank.indexOf(a) >= rank.indexOf(b) ? a : b;
}

export function EventModal({ eventId, newOn, onClose }: {
  /** Existing event to open, or null for a new one on `newOn`. */
  eventId: number | null;
  newOn?: string;
  onClose: () => void;
}) {
  const { state } = useAuth();
  const me = state.status === "authenticated" ? state.user : null;
  const qc = useQueryClient();

  const [id, setId] = useState<number | null>(eventId);
  const idRef = useRef<number | null>(eventId);
  const { data, isLoading, error: loadError } = useCalendarEvent(id);
  const event = data?.event;

  const [draft, setDraft] = useState<Draft>(() => ({
    title: "", startDate: newOn ?? "", endDate: newOn ?? "", summary: "", notes: "", offer: "",
    type: "campaign", channels: [], audience: "", status: "planned",
  }));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const initialised = useRef(eventId == null);
  const lastSeen = useRef<string | null>(null);
  const [notice, setNotice] = useState<{ name: string; at: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const del = useDeleteEvent();

  // Fields typed but not yet saved — these are never overwritten by a refresh.
  const queued = useRef<Partial<Record<FieldKey, unknown>>>({});
  const creating = useRef<Promise<number> | null>(null);
  const datesQueued = useRef(false);

  const accept = (ev: CalEvent) => {
    lastSeen.current = ev.updatedAt;
    qc.setQueryData([...CAL_KEY, "event", ev.id], (old: unknown) =>
      old && typeof old === "object" ? { ...(old as object), event: ev } : old);
    patchCachedEvent(qc, ev);
  };

  /** Create the event the first time it has a title. Only the caller that
   *  started the create gets `created: true` — later saves that queued up
   *  behind it still send their own changes. */
  async function ensureCreated(): Promise<{ id: number; created: boolean } | null> {
    if (idRef.current != null) return { id: idRef.current, created: false };
    if (creating.current) return { id: await creating.current, created: false };
    const d = draftRef.current;
    if (!d.title.trim()) return null;
    const sent: Partial<Record<FieldKey, unknown>> = {
      title: d.title, summary: d.summary, notes: d.notes, offer: d.offer,
      type: d.type, channels: d.channels, audience: d.audience, status: d.status,
    };
    creating.current = calApi<{ event: CalEvent }>("/marketing-calendar/events", {
      method: "POST",
      body: JSON.stringify({
        title: d.title.trim(), startDate: d.startDate, endDate: d.endDate,
        summary: d.summary || null, notes: d.notes || null, offer: d.offer || null,
        type: d.type, channels: d.channels, audience: d.audience || null, status: d.status,
      }),
    }).then(r => {
      idRef.current = r.event.id;
      lastSeen.current = r.event.updatedAt;
      initialised.current = true;
      datesQueued.current = false;
      setId(r.event.id);
      void invalidateCalendar(qc);
      return r.event.id;
    }).finally(() => { creating.current = null; });
    const newId = await creating.current;
    for (const k of Object.keys(sent) as FieldKey[]) if (queued.current[k] === sent[k]) delete queued.current[k];
    return { id: newId, created: true };
  }

  const fields = useAutosave<Partial<Record<FieldKey, unknown>>>(async snapshot => {
    const target = await ensureCreated();
    if (target == null) return; // nothing to save until it has a title
    if (target.created) return; // the create carried every field
    const pending = Object.fromEntries(Object.keys(snapshot).filter(k => k in queued.current).map(k => [k, snapshot[k as FieldKey]]));
    if (Object.keys(pending).length === 0) return;
    const r = await patchEvent(target.id, pending);
    for (const k of Object.keys(pending) as FieldKey[]) {
      if (queued.current[k] === pending[k]) delete queued.current[k];
    }
    accept(r.event);
  });

  const dates = useAutosave<{ startDate: string; endDate: string }>(async d => {
    const targetId = idRef.current;
    if (targetId == null) { datesQueued.current = false; return; } // saved with the create
    const r = await calApi<{ event: CalEvent }>(`/marketing-calendar/events/${targetId}/dates`, {
      method: "PUT", body: JSON.stringify(d),
    });
    datesQueued.current = false;
    accept(r.event);
    void invalidateCalendar(qc);
  }, 300);

  // First load, then someone else's changes.
  useEffect(() => {
    if (!event) return;
    if (!initialised.current) {
      initialised.current = true;
      lastSeen.current = event.updatedAt;
      setDraft(draftFrom(event));
      return;
    }
    if (event.updatedAt === lastSeen.current) return;
    lastSeen.current = event.updatedAt;
    // My own changes made elsewhere (a drag on the grid, another tab) flow in
    // too, just without the banner.
    const byMe = event.updatedBy != null && me != null && event.updatedBy.id === me.id;
    const server = draftFrom(event);
    setDraft(d => {
      const next = { ...d };
      for (const k of FIELD_KEYS) if (!(k in queued.current)) (next as Record<string, unknown>)[k] = server[k];
      if (!datesQueued.current) { next.startDate = server.startDate; next.endDate = server.endDate; }
      return next;
    });
    if (!byMe) setNotice({ name: firstName(event.updatedBy?.name), at: Date.now() });
  }, [event, me]);

  const setField = <K extends FieldKey>(k: K, v: Draft[K]) => {
    setDraft(d => ({ ...d, [k]: v }));
    queued.current = { ...queued.current, [k]: v };
    fields.schedule({ ...queued.current });
  };

  const setDates = (startDate: string, endDate: string) => {
    setDraft(d => ({ ...d, startDate, endDate }));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) return;
    datesQueued.current = true;
    dates.schedule({ startDate, endDate });
  };

  const close = async () => {
    // Anything still pending goes out before the modal disappears.
    await Promise.all([fields.flush(), dates.flush()]);
    onClose();
  };

  const isTestBox = event?.testBox != null;
  const deleted = data?.deleted === true;
  const style = typeStyle(draft.type);
  const saveState = worst(fields.state, dates.state);
  const saveError = fields.error ?? dates.error;
  const datesInvalid = draft.endDate !== "" && draft.startDate !== "" && draft.endDate < draft.startDate;

  const body = (
    <div className="fixed inset-0 z-[130] bg-black/60 flex items-center justify-center p-2 sm:p-6" onClick={() => void close()}>
      <div
        className="bg-card border-2 border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={draft.title || "New phase"}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-border">
          <span className={cn("w-3.5 h-3.5 rounded-full flex-shrink-0", style.dot)} />
          <div className="flex-1 min-w-0">
            <h2 className="font-display font-bold text-lg leading-tight truncate">{draft.title || (id == null ? "New phase" : "Phase")}</h2>
            {draft.startDate && draft.endDate && !datesInvalid && (
              <p className="text-sm text-muted-foreground">{formatRange(draft.startDate, draft.endDate)}</p>
            )}
          </div>
          {id == null && !draft.title.trim()
            ? <span className="text-sm text-muted-foreground hidden sm:inline">Type a title to add it</span>
            : <SaveChip state={saveState} error={saveError} onRetry={() => { void fields.flush(); void dates.flush(); }} />}
          <button onClick={() => void close()} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          {isLoading && id != null && !event && (
            <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>
          )}
          {loadError && (
            <p className="text-sm text-destructive flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {(loadError as Error).message}</p>
          )}
          {deleted && (
            <div className="rounded-xl border-2 border-red-500/40 bg-red-500/10 px-4 py-3 text-base font-semibold text-red-700 dark:text-red-300">
              {firstName(data?.deletedBy)} deleted this event. It's kept in the history below.
            </div>
          )}
          {notice && !deleted && (
            <div className="rounded-xl border-2 border-sky-500/40 bg-sky-500/10 px-4 py-3 text-base flex items-center gap-3">
              <Users className="w-5 h-5 text-sky-600 flex-shrink-0" />
              <span className="flex-1">
                <b>Updated by {notice.name}</b> {formatDistanceToNowStrict(notice.at) === "0 seconds" ? "just now" : `${formatDistanceToNowStrict(notice.at)} ago`} — the fields below show their changes.
              </span>
              <button onClick={() => setNotice(null)} className="p-1.5 rounded-lg hover:bg-sky-500/10" aria-label="Dismiss"><X className="w-4 h-4" /></button>
            </div>
          )}

          {isTestBox && event?.testBox && (
            <div className="rounded-2xl border-2 border-rose-500/40 bg-rose-500/5 p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Package className="w-6 h-6 text-rose-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-base">Test box: {event.testBox.name}</p>
                  <p className="text-sm text-muted-foreground">
                    VIP launch {format(parseISO(event.testBox.launchDate), "EEE d MMM")} · VIP-only until {format(parseISO(event.testBox.vipWindowEnds), "EEE d MMM")}
                    {event.testBox.lastDeliveryDate ? ` · last delivery ${format(parseISO(event.testBox.lastDeliveryDate), "EEE d MMM")}` : " · no delivery date yet"}.
                    {" "}Dates follow the test box — change them there.
                  </p>
                </div>
                <Link href={`/test-boxes/${event.testBox.id}`} className="px-3 py-2 rounded-xl bg-rose-600 text-white text-sm font-semibold flex items-center gap-1.5 flex-shrink-0">
                  Open <ExternalLink className="w-4 h-4" />
                </Link>
              </div>
              {event.testBox.milestones.length > 0 && (
                <ul className="grid sm:grid-cols-2 gap-1.5">
                  {event.testBox.milestones.map((m, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <span className="w-2.5 h-2.5 rotate-45 bg-rose-600 flex-shrink-0" />
                      <span className="font-semibold tabular-nums w-20 flex-shrink-0">{format(parseISO(m.date), "EEE d MMM")}</span>
                      <span className="truncate">{m.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <fieldset disabled={deleted} className="space-y-5 disabled:opacity-60">
            <Field label="Title">
              <input
                value={draft.title}
                onChange={e => setField("title", e.target.value)}
                onBlur={() => void fields.flush()}
                placeholder="e.g. Early Black Friday"
                autoFocus={id == null}
                disabled={isTestBox}
                title={isTestBox ? "Named after the test box — rename it there" : undefined}
                maxLength={160}
                className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-lg font-semibold focus:outline-none focus:border-primary"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Starts">
                <input type="date" value={draft.startDate} disabled={isTestBox}
                  onChange={e => setDates(e.target.value, draft.endDate < e.target.value ? e.target.value : draft.endDate)}
                  className="w-full px-3 py-2.5 rounded-xl border-2 border-border bg-background text-base disabled:opacity-60" />
              </Field>
              <Field label="Ends">
                <input type="date" value={draft.endDate} disabled={isTestBox} min={draft.startDate}
                  onChange={e => setDates(draft.startDate, e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border-2 border-border bg-background text-base disabled:opacity-60" />
              </Field>
            </div>
            {datesInvalid && <p className="text-sm text-destructive -mt-3">The end date can't be before the start.</p>}

            {!isTestBox && (
              <Field label="Type">
                <div className="flex flex-wrap gap-2">
                  {PICKABLE_TYPES.map(t => (
                    <Chip key={t} active={draft.type === t} onClick={() => setField("type", t)}>
                      <span className={cn("w-2.5 h-2.5 rounded-full", EVENT_TYPES[t].dot)} /> {EVENT_TYPES[t].label}
                    </Chip>
                  ))}
                </div>
              </Field>
            )}

            <Field label="Status">
              <div className="flex flex-wrap gap-2">
                {STATUSES.map(s => (
                  <Chip key={s.key} active={draft.status === s.key} onClick={() => setField("status", s.key)} title={s.hint}>{s.label}</Chip>
                ))}
              </div>
            </Field>

            <Field label="Summary" hint="One line — what shows at a glance">
              <input value={draft.summary} onChange={e => setField("summary", e.target.value)} onBlur={() => void fields.flush()}
                maxLength={300} placeholder="e.g. Biggest offer of the year"
                className="w-full px-4 py-2.5 rounded-xl border-2 border-border bg-background text-base focus:outline-none focus:border-primary" />
            </Field>

            <Field label="Channels">
              <div className="flex flex-wrap gap-2">
                {CHANNELS.map(c => {
                  const on = draft.channels.includes(c.key);
                  return (
                    <Chip key={c.key} active={on} onClick={() => setField("channels", on ? draft.channels.filter(x => x !== c.key) : [...draft.channels, c.key])}>
                      {c.label}
                    </Chip>
                  );
                })}
              </div>
            </Field>

            <Field label="Audience">
              <input value={draft.audience} onChange={e => setField("audience", e.target.value)} onBlur={() => void fields.flush()}
                maxLength={200} placeholder="e.g. VIPs first, then everyone"
                className="w-full px-4 py-2.5 rounded-xl border-2 border-border bg-background text-base focus:outline-none focus:border-primary" />
            </Field>

            <Field label="Offer details">
              <textarea value={draft.offer} onChange={e => setField("offer", e.target.value)} onBlur={() => void fields.flush()}
                rows={3} maxLength={2000} placeholder="The mechanic: free pack over £X, bundle price, code…"
                className="w-full px-4 py-2.5 rounded-xl border-2 border-border bg-background text-base focus:outline-none focus:border-primary resize-y" />
            </Field>

            <Field label="Notes">
              <textarea value={draft.notes} onChange={e => setField("notes", e.target.value)} onBlur={() => void fields.flush()}
                rows={6} maxLength={10000} placeholder="Plans, copy ideas, who's doing what…"
                className="w-full px-4 py-2.5 rounded-xl border-2 border-border bg-background text-base focus:outline-none focus:border-primary resize-y" />
            </Field>
          </fieldset>

          {event && (
            <p className="text-sm text-muted-foreground flex items-center gap-1.5 flex-wrap">
              {event.source === "ai" && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-700 dark:text-violet-300 text-xs font-semibold"><Sparkles className="w-3 h-3" /> AI suggestion</span>}
              Added by <b>{firstName(event.createdBy?.name)}</b> · {format(parseISO(event.createdAt), "d MMM HH:mm")}
              {event.updatedBy && <> · last edited by <b>{firstName(event.updatedBy.name)}</b> {formatDistanceToNowStrict(parseISO(event.updatedAt))} ago</>}
            </p>
          )}

          {/* History */}
          {data && data.history.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <History className="w-4 h-4" /> History
              </h3>
              <ol className="relative border-l-2 border-border ml-2 space-y-3">
                {data.history.map(h => (
                  <li key={h.id} className="pl-4 relative">
                    <span className={cn("absolute -left-[7px] top-1.5 w-3 h-3 rounded-full border-2 border-card",
                      h.action === "deleted" ? "bg-red-500" : h.action === "created" ? "bg-primary" : "bg-muted-foreground")} />
                    <p className="text-base leading-snug"><b>{firstName(h.userName)}</b> {h.summary}</p>
                    <p className="text-xs text-muted-foreground">{format(parseISO(h.at), "d MMM HH:mm")}</p>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* Delete, with an "are you sure" step. Test boxes are removed from the test box itself. */}
          {id != null && !deleted && !isTestBox && (
            <div className="pt-2 border-t border-border">
              {!confirmDelete ? (
                <button onClick={() => setConfirmDelete(true)} className="px-4 py-2.5 rounded-xl border-2 border-red-500/40 text-red-600 font-semibold flex items-center gap-2 hover:bg-red-500/10">
                  <Trash2 className="w-4 h-4" /> Delete phase
                </button>
              ) : (
                <div className="rounded-xl border-2 border-red-500/50 bg-red-500/10 p-4 space-y-3">
                  <p className="font-semibold text-base">Are you sure? “{draft.title}” comes off the calendar for everyone.</p>
                  <p className="text-sm text-muted-foreground">Its history is kept, and any emails planned in it stay on the calendar (as “Not in a phase”).</p>
                  {del.isError && <p className="text-sm text-destructive">{(del.error as Error).message}</p>}
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => del.mutate(id, { onSuccess: onClose })}
                      disabled={del.isPending}
                      className="px-4 py-2.5 rounded-xl bg-red-600 text-white font-semibold flex items-center gap-2 disabled:opacity-60"
                    >
                      {del.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Yes, delete it
                    </button>
                    <button onClick={() => setConfirmDelete(false)} className="px-4 py-2.5 rounded-xl border-2 border-border font-semibold">Keep it</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
  return createPortal(body, document.body);
}

// A div, not a <label>: a label wrapping a row of chip buttons would "click"
// the first chip whenever its text is tapped.
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="block text-sm font-semibold">{label}{hint && <span className="font-normal text-muted-foreground"> — {hint}</span>}</span>
      {children}
    </div>
  );
}

function Chip({ active, onClick, title, children }: { active: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "px-3.5 py-2 rounded-full border-2 text-sm font-semibold inline-flex items-center gap-1.5 transition-colors",
        active ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:bg-secondary/50",
      )}
    >
      {children}
    </button>
  );
}
