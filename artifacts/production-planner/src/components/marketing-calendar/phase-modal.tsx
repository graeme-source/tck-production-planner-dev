/**
 * One phase, opened from the calendar (2026-10-20). Everything is edited
 * here and autosaves with a visible save state: name, dates (any length),
 * colour (a pastel quick pick or any colour from the picker, 2026-10-21),
 * offers (from the offer library or typed new), customer group and notes. A
 * new phase is created as soon as it has a name.
 *
 * Planning together: the phase is re-read every 15 s and on focus. When
 * someone else changed it, their changes flow into every field you are not
 * in the middle of editing, and a banner says who.
 *
 * Delete is soft and undoable (toast). Modal rule: explicit X, card capped
 * at 92dvh with internal scrolling, full-width on a phone.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { format, parseISO, formatDistanceToNowStrict } from "date-fns";
import { AlertTriangle, Check, ExternalLink, History, Loader2, Package, Sparkles, Trash2, Users, X } from "lucide-react";
import {
  CUSTOMER_GROUPS, CUSTOMER_GROUP_LABELS, formatRange,
} from "@workspace/marketing-calendar";
import { ColourPicker } from "./colour-picker";
import { useAuth } from "@/contexts/auth-context";
import { useAutosave, type AutosaveState } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useEscapeToClose } from "./use-escape";
import {
  CAL_KEY, createPhase, deletePhase, invalidateCalendar, invalidateOffers, patchCachedPhase, patchPhase, putPhaseDates, restorePhase, usePhase,
  type Phase,
} from "./api";
import { OfferPicker } from "./offer-picker";
import { PHASE_CLS, firstName, phaseVars, useDefaultPhaseColour } from "./constants";

interface Draft {
  title: string;
  startDate: string;
  endDate: string;
  offers: string[];
  customerGroup: string;
  /** Palette key or "#rrggbb"; null = the calendar's default colour. */
  color: string | null;
  notes: string;
}

type FieldKey = "title" | "offers" | "customerGroup" | "color" | "notes";
const FIELD_KEYS: FieldKey[] = ["title", "offers", "customerGroup", "color", "notes"];

function draftFrom(p: Phase): Draft {
  return { title: p.title, startDate: p.startDate, endDate: p.endDate, offers: p.offers, customerGroup: p.customerGroup, color: p.color ?? null, notes: p.notes ?? "" };
}

function worst(a: AutosaveState, b: AutosaveState): AutosaveState {
  const rank: AutosaveState[] = ["idle", "saved", "dirty", "saving", "error"];
  return rank.indexOf(a) >= rank.indexOf(b) ? a : b;
}

export function PhaseModal({ phaseId, newOn, onClose }: {
  /** Existing phase to open, or null for a new one starting on `newOn`. */
  phaseId: number | null;
  newOn?: string;
  onClose: () => void;
}) {
  const { state } = useAuth();
  const me = state.status === "authenticated" ? state.user : null;
  const qc = useQueryClient();
  const calendarDefault = useDefaultPhaseColour();

  const [id, setId] = useState<number | null>(phaseId);
  const idRef = useRef<number | null>(phaseId);
  const { data, isLoading, error: loadError } = usePhase(id);
  const phase = data?.event;

  const [draft, setDraft] = useState<Draft>(() => ({
    title: "", startDate: newOn ?? "", endDate: newOn ?? "", offers: [], customerGroup: "all", color: null, notes: "",
  }));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const initialised = useRef(phaseId == null);
  const lastSeen = useRef<string | null>(null);
  const [notice, setNotice] = useState<{ name: string; at: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Fields changed but not yet saved — never overwritten by a refresh.
  const queued = useRef<Partial<Record<FieldKey, unknown>>>({});
  const creating = useRef<Promise<number> | null>(null);
  const datesQueued = useRef(false);

  const accept = (p: Phase) => {
    lastSeen.current = p.updatedAt;
    qc.setQueryData([...CAL_KEY, "event", p.id], (old: unknown) =>
      old && typeof old === "object" ? { ...(old as object), event: p } : old);
    patchCachedPhase(qc, p);
  };

  /** Create the phase the first time it has a name. Only the caller that
   *  started the create gets `created: true`. */
  async function ensureCreated(): Promise<{ id: number; created: boolean } | null> {
    if (idRef.current != null) return { id: idRef.current, created: false };
    if (creating.current) return { id: await creating.current, created: false };
    const d = draftRef.current;
    if (!d.title.trim()) return null;
    const sent: Partial<Record<FieldKey, unknown>> = { title: d.title, offers: d.offers, customerGroup: d.customerGroup, color: d.color, notes: d.notes };
    creating.current = createPhase({
      title: d.title.trim(), startDate: d.startDate, endDate: d.endDate,
      offers: d.offers, customerGroup: d.customerGroup, color: d.color, notes: d.notes || null,
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
    if (target == null) return; // nothing to save until it has a name
    if (target.created) return; // the create carried every field
    const pending = Object.fromEntries(Object.keys(snapshot).filter(k => k in queued.current).map(k => [k, snapshot[k as FieldKey]]));
    if (Object.keys(pending).length === 0) return;
    const r = await patchPhase(target.id, pending);
    for (const k of Object.keys(pending) as FieldKey[]) {
      if (queued.current[k] === pending[k]) delete queued.current[k];
    }
    accept(r.event);
    if ("offers" in pending) void invalidateOffers(qc); // a new offer joined the library
  });

  const dates = useAutosave<{ startDate: string; endDate: string }>(async d => {
    const targetId = idRef.current;
    if (targetId == null) { datesQueued.current = false; return; } // saved with the create
    const r = await putPhaseDates(targetId, d);
    datesQueued.current = false;
    accept(r.event);
    void invalidateCalendar(qc);
  }, 300);

  // First load, then someone else's changes.
  useEffect(() => {
    if (!phase) return;
    if (!initialised.current) {
      initialised.current = true;
      lastSeen.current = phase.updatedAt;
      setDraft(draftFrom(phase));
      return;
    }
    if (phase.updatedAt === lastSeen.current) return;
    lastSeen.current = phase.updatedAt;
    const byMe = phase.updatedBy != null && me != null && phase.updatedBy.id === me.id;
    const server = draftFrom(phase);
    setDraft(d => {
      const next = { ...d };
      for (const k of FIELD_KEYS) if (!(k in queued.current)) (next as Record<string, unknown>)[k] = server[k];
      if (!datesQueued.current) { next.startDate = server.startDate; next.endDate = server.endDate; }
      return next;
    });
    if (!byMe) setNotice({ name: firstName(phase.updatedBy?.name), at: Date.now() });
  }, [phase, me]);

  const setField = <K extends FieldKey>(k: K, v: Draft[K]) => {
    setDraft(d => ({ ...d, [k]: v }));
    queued.current = { ...queued.current, [k]: v };
    fields.schedule({ ...queued.current });
  };
  // Picking an offer or a group is a deliberate tap — save straight away.
  const setNow = <K extends FieldKey>(k: K, v: Draft[K]) => {
    setField(k, v);
    void fields.flush();
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
  useEscapeToClose(() => void close());

  const remove = async () => {
    if (id == null) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deletePhase(id);
      void invalidateCalendar(qc);
      const title = draft.title;
      const pid = id;
      toast({
        title: `“${title}” deleted`,
        duration: 10_000,
        description: "It's off the calendar for everyone.",
        action: (
          <ToastAction altText="Undo" onClick={() => {
            void restorePhase(pid)
              .then(() => { void invalidateCalendar(qc); toast({ title: `“${title}” is back` }); })
              .catch(err => toast({ title: "Couldn't undo", description: (err as Error).message, variant: "destructive" }));
          }}>Undo</ToastAction>
        ),
      });
      onClose();
    } catch (err) {
      setDeleteError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const isTestBox = phase?.testBoxId != null;
  const deleted = data?.deleted === true;
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
          <span style={phaseVars(draft.color, calendarDefault)} className={cn("w-4 h-4 rounded-full flex-shrink-0 border-2", PHASE_CLS.fill)} />
          <div className="flex-1 min-w-0">
            <h2 className="font-display font-bold text-lg leading-tight break-words">{draft.title || (id == null ? "New phase" : "Phase")}</h2>
            {draft.startDate && draft.endDate && !datesInvalid && (
              <p className="text-sm text-muted-foreground">{formatRange(draft.startDate, draft.endDate)}</p>
            )}
          </div>
          {id == null && !draft.title.trim()
            ? <span className="text-sm text-muted-foreground hidden sm:inline">Type a name to add it</span>
            : <SaveChip state={saveState} error={saveError} onRetry={() => { void fields.flush(); void dates.flush(); }} />}
          <button onClick={() => void close()} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          {isLoading && id != null && !phase && (
            <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>
          )}
          {loadError && (
            <p className="text-sm text-destructive flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {(loadError as Error).message}</p>
          )}
          {deleted && (
            <div className="rounded-xl border-2 border-red-500/40 bg-red-500/10 px-4 py-3 text-base font-semibold text-red-700 dark:text-red-300">
              {firstName(data?.deletedBy)} deleted this phase. It's kept in the history below.
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

          {isTestBox && phase?.testBoxId != null && (
            <div className="rounded-2xl border-2 border-border p-4 flex items-center gap-3">
              <Package className="w-6 h-6 text-muted-foreground flex-shrink-0" />
              <p className="flex-1 text-sm text-muted-foreground">This phase belongs to a test box — its name and dates follow the box (dragging it on the calendar moves the box).</p>
              <Link href={`/test-boxes/${phase.testBoxId}`} className="px-3 py-2 rounded-xl border-2 border-border text-sm font-semibold flex items-center gap-1.5 flex-shrink-0 hover:bg-secondary/50">
                Open test box <ExternalLink className="w-4 h-4" />
              </Link>
            </div>
          )}

          <fieldset disabled={deleted} className="space-y-5 disabled:opacity-60">
            <Field label="Name">
              <input
                value={draft.title}
                onChange={e => setField("title", e.target.value)}
                onBlur={() => void fields.flush()}
                placeholder="e.g. Halloween Week"
                autoFocus={id == null}
                disabled={isTestBox}
                maxLength={160}
                className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-lg font-semibold focus:outline-none focus:border-primary disabled:opacity-60"
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

            <Field label="Offers" hint="optional — pick from the list or type a new one">
              <OfferPicker value={draft.offers} onChange={v => setNow("offers", v)} disabled={deleted} />
            </Field>

            <Field label="Customers" hint="optional">
              <div className="flex flex-wrap gap-2">
                {CUSTOMER_GROUPS.map(g => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setNow("customerGroup", g)}
                    aria-pressed={draft.customerGroup === g}
                    className={cn(
                      "px-4 py-2.5 rounded-full border-2 text-base font-semibold transition-colors",
                      draft.customerGroup === g ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:bg-secondary/50",
                    )}
                  >
                    {CUSTOMER_GROUP_LABELS[g]}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Colour" hint="how it shows on the calendar">
              {/* null = follow the calendar's default colour (set under the calendar). */}
              <ColourPicker
                value={draft.color}
                calendarDefault={calendarDefault}
                allowDefault
                disabled={deleted}
                previewLabel={draft.title.trim() || "New phase"}
                onPick={(v, now) => (now ? setNow("color", v) : setField("color", v))}
              />
            </Field>

            <Field label="Notes" hint="optional">
              <textarea value={draft.notes} onChange={e => setField("notes", e.target.value)} onBlur={() => void fields.flush()}
                rows={5} maxLength={10000} placeholder="e.g. Philly Cheesesteak ending — we're removing it from the menu"
                className="w-full px-4 py-2.5 rounded-xl border-2 border-border bg-background text-base focus:outline-none focus:border-primary resize-y" />
            </Field>
          </fieldset>

          {phase && (
            <p className="text-sm text-muted-foreground flex items-center gap-1.5 flex-wrap">
              {phase.source === "ai" && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-700 dark:text-violet-300 text-xs font-semibold"><Sparkles className="w-3 h-3" /> AI suggestion</span>}
              Added by <b>{firstName(phase.createdBy?.name)}</b> · {format(parseISO(phase.createdAt), "d MMM HH:mm")}
              {phase.updatedBy && <> · last edited by <b>{firstName(phase.updatedBy.name)}</b> {formatDistanceToNowStrict(parseISO(phase.updatedAt))} ago</>}
            </p>
          )}

          {data && data.history.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 py-1">
                <History className="w-4 h-4" /> History ({data.history.length})
              </summary>
              <ol className="relative border-l-2 border-border ml-2 space-y-3 mt-2">
                {data.history.map(h => (
                  <li key={h.id} className="pl-4 relative">
                    <span className={cn("absolute -left-[7px] top-1.5 w-3 h-3 rounded-full border-2 border-card",
                      h.action === "deleted" ? "bg-red-500" : h.action === "created" ? "bg-primary" : "bg-muted-foreground")} />
                    <p className="text-base leading-snug"><b>{firstName(h.userName)}</b> {h.summary}</p>
                    <p className="text-xs text-muted-foreground">{format(parseISO(h.at), "d MMM HH:mm")}</p>
                  </li>
                ))}
              </ol>
            </details>
          )}

          {/* Delete (undo from the toast). A test box's phase goes with the box. */}
          {id != null && !deleted && !isTestBox && (
            <div className="pt-2 border-t border-border space-y-2">
              <button onClick={() => void remove()} disabled={deleting}
                className="px-4 py-2.5 rounded-xl border-2 border-red-500/40 text-red-600 font-semibold flex items-center gap-2 hover:bg-red-500/10 disabled:opacity-60">
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete phase
              </button>
              {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
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
