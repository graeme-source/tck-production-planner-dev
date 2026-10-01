/**
 * A note on a day of the marketing calendar (Graeme, 2026-10-01): "I want to
 * be able to add an idea or a note to any given day." Stored as a calendar
 * event of type "note" (one day), so it is shared with everyone who sees the
 * calendar, stamped with who added / last edited it, and keeps a history.
 *
 * Autosaves with a visible save state; created the moment it has a title.
 * Delete asks "are you sure?" first, same as phases. Re-read every 15 s so
 * two people on the same note see each other's changes (never over typing).
 *
 * Modal rule: explicit X, card capped at 92dvh with internal scrolling,
 * full-width on a phone.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { format, parseISO, formatDistanceToNowStrict } from "date-fns";
import { X, Trash2, History, Users, Loader2, AlertTriangle, StickyNote } from "lucide-react";
import { NOTE_EVENT_TYPE } from "@workspace/marketing-calendar";
import { useAuth } from "@/contexts/auth-context";
import { useAutosave, type AutosaveState } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { cn } from "@/lib/utils";
import {
  CAL_KEY, calApi, patchCachedEvent, patchEvent, invalidateCalendar, useCalendarEvent, useDeleteEvent,
  type CalEvent,
} from "./api";
import { NOTE_TONE, firstName } from "./constants";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
type FieldKey = "title" | "notes";
interface Draft { title: string; date: string; notes: string }

function worst(a: AutosaveState, b: AutosaveState): AutosaveState {
  const rank: AutosaveState[] = ["idle", "saved", "dirty", "saving", "error"];
  return rank.indexOf(a) >= rank.indexOf(b) ? a : b;
}

export function NoteModal({ noteId, newOn, onClose }: {
  /** Existing note, or null for a new one on `newOn`. */
  noteId: number | null;
  newOn?: string;
  onClose: () => void;
}) {
  const { state } = useAuth();
  const me = state.status === "authenticated" ? state.user : null;
  const qc = useQueryClient();

  const [id, setId] = useState<number | null>(noteId);
  const idRef = useRef<number | null>(noteId);
  const { data, isLoading, error: loadError } = useCalendarEvent(id);
  const note = data?.event;

  const [draft, setDraft] = useState<Draft>({ title: "", date: newOn ?? "", notes: "" });
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const initialised = useRef(noteId == null);
  const lastSeen = useRef<string | null>(null);
  const [notice, setNotice] = useState<{ name: string; at: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const del = useDeleteEvent();

  const queued = useRef<Partial<Record<FieldKey, string>>>({});
  const creating = useRef<Promise<number> | null>(null);
  const dateQueued = useRef(false);

  const accept = (ev: CalEvent) => {
    lastSeen.current = ev.updatedAt;
    qc.setQueryData([...CAL_KEY, "event", ev.id], (old: unknown) =>
      old && typeof old === "object" ? { ...(old as object), event: ev } : old);
    patchCachedEvent(qc, ev);
  };

  async function ensureCreated(): Promise<{ id: number; created: boolean } | null> {
    if (idRef.current != null) return { id: idRef.current, created: false };
    if (creating.current) return { id: await creating.current, created: false };
    const d = draftRef.current;
    if (!d.title.trim() || !DATE_RE.test(d.date)) return null;
    const sent = { title: d.title, notes: d.notes };
    creating.current = calApi<{ event: CalEvent }>("/marketing-calendar/events", {
      method: "POST",
      body: JSON.stringify({
        title: d.title.trim(), startDate: d.date, endDate: d.date,
        notes: d.notes || null, type: NOTE_EVENT_TYPE,
      }),
    }).then(r => {
      idRef.current = r.event.id;
      lastSeen.current = r.event.updatedAt;
      initialised.current = true;
      dateQueued.current = false;
      setId(r.event.id);
      void invalidateCalendar(qc);
      return r.event.id;
    }).finally(() => { creating.current = null; });
    const newId = await creating.current;
    for (const k of Object.keys(sent) as FieldKey[]) if (queued.current[k] === sent[k]) delete queued.current[k];
    return { id: newId, created: true };
  }

  const fields = useAutosave<Partial<Record<FieldKey, string>>>(async snapshot => {
    const target = await ensureCreated();
    if (target == null || target.created) return;
    const pending = Object.fromEntries(Object.keys(snapshot).filter(k => k in queued.current).map(k => [k, snapshot[k as FieldKey]]));
    if (Object.keys(pending).length === 0) return;
    const r = await patchEvent(target.id, pending);
    for (const k of Object.keys(pending) as FieldKey[]) if (queued.current[k] === pending[k]) delete queued.current[k];
    accept(r.event);
  });

  const dateSave = useAutosave<string>(async date => {
    const targetId = idRef.current;
    if (targetId == null) { dateQueued.current = false; return; } // goes with the create
    const r = await calApi<{ event: CalEvent }>(`/marketing-calendar/events/${targetId}/dates`, {
      method: "PUT", body: JSON.stringify({ startDate: date, endDate: date }),
    });
    dateQueued.current = false;
    accept(r.event);
    void invalidateCalendar(qc);
  }, 300);

  // First load, then other people's changes (never over what you're typing).
  useEffect(() => {
    if (!note) return;
    const server: Draft = { title: note.title, date: note.startDate, notes: note.notes ?? "" };
    if (!initialised.current) {
      initialised.current = true;
      lastSeen.current = note.updatedAt;
      setDraft(server);
      return;
    }
    if (note.updatedAt === lastSeen.current) return;
    lastSeen.current = note.updatedAt;
    const byMe = note.updatedBy != null && me != null && note.updatedBy.id === me.id;
    setDraft(d => ({
      title: "title" in queued.current ? d.title : server.title,
      notes: "notes" in queued.current ? d.notes : server.notes,
      date: dateQueued.current ? d.date : server.date,
    }));
    if (!byMe) setNotice({ name: firstName(note.updatedBy?.name), at: Date.now() });
  }, [note, me]);

  const setField = (k: FieldKey, v: string) => {
    setDraft(d => ({ ...d, [k]: v }));
    queued.current = { ...queued.current, [k]: v };
    fields.schedule({ ...queued.current });
  };

  const setDate = (date: string) => {
    setDraft(d => ({ ...d, date }));
    if (!DATE_RE.test(date)) return;
    dateQueued.current = true;
    dateSave.schedule(date);
  };

  const close = async () => {
    await Promise.all([fields.flush(), dateSave.flush()]);
    onClose();
  };

  const deleted = data?.deleted === true;
  const saveState = worst(fields.state, dateSave.state);
  const saveError = fields.error ?? dateSave.error;

  return createPortal(
    <div className="fixed inset-0 z-[130] bg-black/60 flex items-center justify-center p-2 sm:p-6" onClick={() => void close()}>
      <div
        className="bg-card border-2 border-border rounded-2xl shadow-2xl w-full max-w-xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={draft.title || "New note"}
      >
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-border">
          <StickyNote className={cn("w-5 h-5 flex-shrink-0", NOTE_TONE.icon)} />
          <div className="flex-1 min-w-0">
            <h2 className="font-display font-bold text-lg leading-tight truncate">{draft.title || (id == null ? "New note" : "Note")}</h2>
            {DATE_RE.test(draft.date) && <p className="text-sm text-muted-foreground">{format(parseISO(draft.date), "EEEE d MMMM yyyy")}</p>}
          </div>
          {id == null && !draft.title.trim()
            ? <span className="text-sm text-muted-foreground hidden sm:inline">Type a title to add it</span>
            : <SaveChip state={saveState} error={saveError} onRetry={() => { void fields.flush(); void dateSave.flush(); }} />}
          <button onClick={() => void close()} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          {isLoading && id != null && !note && (
            <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>
          )}
          {loadError && (
            <p className="text-sm text-destructive flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {(loadError as Error).message}</p>
          )}
          {deleted && (
            <div className="rounded-xl border-2 border-red-500/40 bg-red-500/10 px-4 py-3 text-base font-semibold text-red-700 dark:text-red-300">
              {firstName(data?.deletedBy)} deleted this note. It's kept in the history below.
            </div>
          )}
          {notice && !deleted && (
            <div className="rounded-xl border-2 border-sky-500/40 bg-sky-500/10 px-4 py-3 text-base flex items-center gap-3">
              <Users className="w-5 h-5 text-sky-600 flex-shrink-0" />
              <span className="flex-1"><b>Updated by {notice.name}</b> — the note below shows their changes.</span>
              <button onClick={() => setNotice(null)} className="p-1.5 rounded-lg hover:bg-sky-500/10" aria-label="Dismiss"><X className="w-4 h-4" /></button>
            </div>
          )}

          <fieldset disabled={deleted} className="space-y-5 disabled:opacity-60">
            <label className="block space-y-1.5">
              <span className="block text-sm font-semibold">Title</span>
              <input
                value={draft.title}
                onChange={e => setField("title", e.target.value)}
                onBlur={() => void fields.flush()}
                placeholder="e.g. Idea: Halloween pumpkin calzone teaser"
                autoFocus={id == null}
                maxLength={160}
                className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-lg font-semibold focus:outline-none focus:border-primary"
              />
            </label>
            <label className="block space-y-1.5 max-w-xs">
              <span className="block text-sm font-semibold">Day</span>
              <input type="date" value={draft.date} onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border-2 border-border bg-background text-base" />
            </label>
            <label className="block space-y-1.5">
              <span className="block text-sm font-semibold">Note <span className="font-normal text-muted-foreground">— optional</span></span>
              <textarea
                value={draft.notes}
                onChange={e => setField("notes", e.target.value)}
                onBlur={() => void fields.flush()}
                rows={7}
                maxLength={10000}
                placeholder="The idea, a reminder, who to ask…"
                className={cn("w-full px-4 py-2.5 rounded-xl border-2 text-base focus:outline-none focus:border-primary resize-y", NOTE_TONE.card)}
              />
            </label>
          </fieldset>

          {note && (
            <p className="text-sm text-muted-foreground">
              Added by <b>{firstName(note.createdBy?.name)}</b> · {format(parseISO(note.createdAt), "d MMM HH:mm")}
              {note.updatedBy && note.updatedAt !== note.createdAt && <> · last edited by <b>{firstName(note.updatedBy.name)}</b> {formatDistanceToNowStrict(parseISO(note.updatedAt))} ago</>}
            </p>
          )}

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

          {id != null && !deleted && (
            <div className="pt-2 border-t border-border">
              {!confirmDelete ? (
                <button onClick={() => setConfirmDelete(true)} className="px-4 py-2.5 rounded-xl border-2 border-red-500/40 text-red-600 font-semibold flex items-center gap-2 hover:bg-red-500/10">
                  <Trash2 className="w-4 h-4" /> Delete note
                </button>
              ) : (
                <div className="rounded-xl border-2 border-red-500/50 bg-red-500/10 p-4 space-y-3">
                  <p className="font-semibold text-base">Are you sure? “{draft.title}” comes off the calendar for everyone.</p>
                  <p className="text-sm text-muted-foreground">Its history is kept.</p>
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
    </div>,
    document.body,
  );
}
