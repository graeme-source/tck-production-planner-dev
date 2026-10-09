/**
 * One planned email, opened from the calendar or the List view (Graeme,
 * 2026-09-30). The spreadsheet row, as a card: send day and time, subject
 * line, offer, core message, SMS, cadence, audience, website and Meta
 * changes, notes and status — every field autosaves with a visible save
 * state. A new email is created as soon as it has a subject line.
 *
 * The campaign it belongs to is worked out from the send day (never picked):
 * change the date and the campaign changes with it. A new email starts with
 * its campaign's offer and summary filled in, ready to edit.
 *
 * Plan meets reality: link the Klaviyo send it became (picked from Klaviyo's
 * emails a week either side), and the calendar shows them as one item.
 * Most link themselves (2026-10-09, server lib/klaviyo-auto-link.ts): this
 * says "Linked automatically" and what matched, with Unlink beside it; a
 * likely-but-unsure match is offered as "Looks like Klaviyo's … — link?".
 *
 * Planning together: re-read every 15 s and on focus; someone else's changes
 * flow into every field you are not in the middle of editing, with a banner.
 * Modal rule: explicit X, card capped at 92dvh with internal scrolling.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { format, parseISO, formatDistanceToNowStrict } from "date-fns";
import {
  X, Trash2, History, Users, Loader2, AlertTriangle, Mail, Link2, Unlink, CheckCircle2, Megaphone, ExternalLink, Wand2,
} from "lucide-react";
import { EMAIL_AUDIENCES, addDays, campaignForDate, effectiveStage, emailFilingEvents, formatRange, stageLabel } from "@workspace/marketing-calendar";
import { useAuth } from "@/contexts/auth-context";
import { useAutosave, type AutosaveState } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { cn } from "@/lib/utils";
import {
  CAL_KEY, createEmail, invalidateEmails, patchCachedEmail, patchEmail, setEmailDate, useCalendarEvents, useDeleteEmail,
  useKlaviyoEmails, useLinkKlaviyo, usePlannedEmail, type KlaviyoEmail, type PlannedEmail,
} from "./api";
import { EMAIL_STAGE_OPTIONS, firstName } from "./constants";
import { ApprovalPanel, useApprovalIndex } from "./approvals";

interface Draft {
  sendDate: string;
  sendTime: string;
  subject: string;
  offer: string;
  coreMessage: string;
  smsSuggestion: string;
  cadence: string;
  audiences: string[];
  audienceOther: string;
  websiteChange: string;
  metaChange: string;
  notes: string;
  status: string;
}

type FieldKey = Exclude<keyof Draft, "sendDate">;
const FIELD_KEYS: FieldKey[] = [
  "sendTime", "subject", "offer", "coreMessage", "smsSuggestion", "cadence", "audiences", "audienceOther",
  "websiteChange", "metaChange", "notes", "status",
];

function draftFrom(e: PlannedEmail): Draft {
  return {
    sendDate: e.sendDate, sendTime: e.sendTime ?? "", subject: e.subject, offer: e.offer ?? "",
    coreMessage: e.coreMessage ?? "", smsSuggestion: e.smsSuggestion ?? "", cadence: e.cadence ?? "",
    audiences: e.audiences, audienceOther: e.audienceOther ?? "", websiteChange: e.websiteChange ?? "",
    metaChange: e.metaChange ?? "", notes: e.notes ?? "", status: e.status,
  };
}

function worst(a: AutosaveState, b: AutosaveState): AutosaveState {
  const rank: AutosaveState[] = ["idle", "saved", "dirty", "saving", "error"];
  return rank.indexOf(a) >= rank.indexOf(b) ? a : b;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function PlannedEmailModal({ emailId, newOn, onClose, onOpenCampaign }: {
  /** Existing email to open, or null for a new one on `newOn`. */
  emailId: number | null;
  newOn?: string;
  onClose: () => void;
  onOpenCampaign?: (id: number) => void;
}) {
  const { state } = useAuth();
  const me = state.status === "authenticated" ? state.user : null;
  const qc = useQueryClient();

  const [id, setId] = useState<number | null>(emailId);
  const idRef = useRef<number | null>(emailId);
  const { data, isLoading, error: loadError } = usePlannedEmail(id);
  const email = data?.email;

  const [draft, setDraft] = useState<Draft>(() => ({
    sendDate: newOn ?? "", sendTime: "", subject: "", offer: "", coreMessage: "", smsSuggestion: "", cadence: "",
    audiences: [], audienceOther: "", websiteChange: "", metaChange: "", notes: "", status: "planned",
  }));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const initialised = useRef(emailId == null);
  const lastSeen = useRef<string | null>(null);
  const [notice, setNotice] = useState<{ name: string; at: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const del = useDeleteEmail();
  const link = useLinkKlaviyo();

  const queued = useRef<Partial<Record<FieldKey, unknown>>>({});
  const creating = useRef<Promise<number> | null>(null);
  const dateQueued = useRef(false);

  // The campaign is whichever one's dates contain the send day.
  const validDate = DATE_RE.test(draft.sendDate) ? draft.sendDate : null;
  const campaignsQ = useCalendarEvents(validDate ?? "", validDate ?? "", validDate != null);
  const campaign = useMemo(
    () => (validDate ? campaignForDate(validDate, emailFilingEvents(campaignsQ.data?.events ?? [])) : null),
    [validDate, campaignsQ.data],
  );

  // A brand-new email starts with its campaign's offer and summary. Until it
  // is saved, changing the day swaps them for the new campaign's — but only
  // while they are still exactly what was filled in (never over typing).
  const prefill = useRef<{ offer: string; coreMessage: string }>({ offer: "", coreMessage: "" });
  useEffect(() => {
    if (emailId != null || idRef.current != null || !campaignsQ.data || campaignsQ.isPlaceholderData) return;
    const next = { offer: campaign?.offer ?? "", coreMessage: campaign?.summary ?? "" };
    const prev = prefill.current;
    prefill.current = next;
    setDraft(d => ({
      ...d,
      offer: d.offer === prev.offer ? next.offer : d.offer,
      coreMessage: d.coreMessage === prev.coreMessage ? next.coreMessage : d.coreMessage,
    }));
  }, [emailId, campaign, campaignsQ.data, campaignsQ.isPlaceholderData]);

  const accept = (e: PlannedEmail) => {
    lastSeen.current = e.updatedAt;
    patchCachedEmail(qc, e);
    // Re-read so the history below shows the change straight away.
    void qc.invalidateQueries({ queryKey: [...CAL_KEY, "emails", "one", e.id] });
  };

  async function ensureCreated(): Promise<{ id: number; created: boolean } | null> {
    if (idRef.current != null) return { id: idRef.current, created: false };
    if (creating.current) return { id: await creating.current, created: false };
    const d = draftRef.current;
    if (!d.subject.trim() || !DATE_RE.test(d.sendDate)) return null;
    const sent: Partial<Record<FieldKey, unknown>> = Object.fromEntries(FIELD_KEYS.map(k => [k, d[k]]));
    creating.current = createEmail({
      sendDate: d.sendDate, sendTime: d.sendTime || null, subject: d.subject.trim(),
      offer: d.offer || null, coreMessage: d.coreMessage || null, smsSuggestion: d.smsSuggestion || null,
      cadence: d.cadence || null, audiences: d.audiences, audienceOther: d.audienceOther || null,
      websiteChange: d.websiteChange || null, metaChange: d.metaChange || null, notes: d.notes || null, status: d.status,
    }).then(r => {
      idRef.current = r.email.id;
      lastSeen.current = r.email.updatedAt;
      initialised.current = true;
      dateQueued.current = false;
      setId(r.email.id);
      void invalidateEmails(qc);
      return r.email.id;
    }).finally(() => { creating.current = null; });
    const newId = await creating.current;
    for (const k of Object.keys(sent) as FieldKey[]) if (queued.current[k] === sent[k]) delete queued.current[k];
    return { id: newId, created: true };
  }

  const fields = useAutosave<Partial<Record<FieldKey, unknown>>>(async snapshot => {
    const target = await ensureCreated();
    if (target == null || target.created) return;
    const pending = Object.fromEntries(Object.keys(snapshot).filter(k => k in queued.current).map(k => [k, snapshot[k as FieldKey]]));
    if (Object.keys(pending).length === 0) return;
    const r = await patchEmail(target.id, pending);
    for (const k of Object.keys(pending) as FieldKey[]) if (queued.current[k] === pending[k]) delete queued.current[k];
    accept(r.email);
  });

  const dateSave = useAutosave<string>(async d => {
    const targetId = idRef.current;
    if (targetId == null) { dateQueued.current = false; return; } // goes with the create
    const r = await setEmailDate(targetId, d);
    dateQueued.current = false;
    accept(r.email);
    void invalidateEmails(qc);
  }, 300);

  // First load, then someone else's changes.
  useEffect(() => {
    if (!email) return;
    if (!initialised.current) {
      initialised.current = true;
      lastSeen.current = email.updatedAt;
      setDraft(draftFrom(email));
      return;
    }
    if (email.updatedAt === lastSeen.current) return;
    lastSeen.current = email.updatedAt;
    const byMe = email.updatedBy != null && me != null && email.updatedBy.id === me.id;
    const server = draftFrom(email);
    setDraft(d => {
      const next = { ...d };
      for (const k of FIELD_KEYS) if (!(k in queued.current)) (next as Record<string, unknown>)[k] = server[k];
      if (!dateQueued.current) next.sendDate = server.sendDate;
      return next;
    });
    if (!byMe) setNotice({ name: firstName(email.updatedBy?.name), at: Date.now() });
  }, [email, me]);

  const setField = <K extends FieldKey>(k: K, v: Draft[K]) => {
    setDraft(d => ({ ...d, [k]: v }));
    queued.current = { ...queued.current, [k]: v };
    fields.schedule({ ...queued.current });
  };

  const setDate = (d: string) => {
    setDraft(x => ({ ...x, sendDate: d }));
    if (!DATE_RE.test(d)) return;
    if (idRef.current == null) {
      // Not created yet: the date travels with the create. Nudge a pending
      // create along if the subject is already typed.
      if (draftRef.current.subject.trim()) fields.schedule({ ...queued.current });
      return;
    }
    dateQueued.current = true;
    dateSave.schedule(d);
  };

  const close = async () => {
    await Promise.all([fields.flush(), dateSave.flush()]);
    onClose();
  };

  // Klaviyo sends a week either side of the send day, to link the plan to.
  const kFrom = validDate ? addDays(validDate, -7) : "";
  const kTo = validDate ? addDays(validDate, 7) : "";
  // Drafts too (a week either side, plus drafts edited recently whatever
  // their placeholder day) — link the plan as soon as it's built in Klaviyo.
  const klaviyo = useKlaviyoEmails(kFrom, kTo, validDate != null && id != null, { recentDrafts: true });
  const pickable = useMemo(() => {
    const seen = new Set<string>();
    const out: KlaviyoEmail[] = [];
    for (const k of [...(klaviyo.data?.emails ?? []), ...(klaviyo.data?.recentDrafts ?? [])]) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      out.push(k);
    }
    return out;
  }, [klaviyo.data]);
  const linkedId = email?.klaviyoCampaignId ?? null;
  const linkedSend = linkedId ? pickable.find(k => k.id === linkedId) ?? null : null;
  // Auto-link (2026-10-09): how the current link was made, and — while
  // unlinked — the server's "looks like this one" suggestions.
  const autoLink = linkedId ? data?.autoLink ?? null : null;
  const suggestions = useMemo(
    () => (id != null && !linkedId ? (klaviyo.data?.suggestions ?? []).filter(s => s.emailId === id) : []),
    [klaviyo.data, id, linkedId],
  );

  // STAGE: from Klaviyo once linked, otherwise set by hand.
  const stage = effectiveStage({ status: draft.status, klaviyoCampaignId: linkedId }, linkedSend);
  // APPROVAL: shared with the linked Klaviyo campaign (one approval).
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  const approvalPlans = useMemo(() => (email ? [email] : []), [email]);
  const approvalKlaviyo = useMemo(() => (linkedSend ? [linkedSend] : []), [linkedSend]);
  const approvals = useApprovalIndex(approvalPlans, approvalKlaviyo, today);
  const approvalItem = email ? approvals.forPlan(email.id) : null;

  const deleted = data?.deleted === true;
  const saveState = worst(fields.state, dateSave.state);
  const saveError = fields.error ?? dateSave.error;

  const body = (
    <div className="fixed inset-0 z-[130] bg-black/60 flex items-center justify-center p-2 sm:p-6" onClick={() => void close()}>
      <div
        className="bg-card border-2 border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={draft.subject || "New email"}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-border">
          <span className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center flex-shrink-0">
            <Mail className="w-5 h-5" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Planned email</p>
            <h2 className="font-display font-bold text-lg leading-tight truncate">{draft.subject || (id == null ? "New email" : "Email")}</h2>
          </div>
          {id == null && !draft.subject.trim()
            ? <span className="text-sm text-muted-foreground hidden sm:inline">Type a subject line to add it</span>
            : <SaveChip state={saveState} error={saveError} onRetry={() => { void fields.flush(); void dateSave.flush(); }} />}
          <button onClick={() => void close()} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          {isLoading && id != null && !email && (
            <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>
          )}
          {loadError && (
            <p className="text-sm text-destructive flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {(loadError as Error).message}</p>
          )}
          {deleted && (
            <div className="rounded-xl border-2 border-red-500/40 bg-red-500/10 px-4 py-3 text-base font-semibold text-red-700 dark:text-red-300">
              {firstName(data?.deletedBy)} deleted this email. It's kept in the history below.
            </div>
          )}
          {notice && !deleted && (
            <div className="rounded-xl border-2 border-sky-500/40 bg-sky-500/10 px-4 py-3 text-base flex items-center gap-3">
              <Users className="w-5 h-5 text-sky-600 flex-shrink-0" />
              <span className="flex-1"><b>Updated by {notice.name}</b> just now — the fields below show their changes.</span>
              <button onClick={() => setNotice(null)} className="p-1.5 rounded-lg hover:bg-sky-500/10" aria-label="Dismiss"><X className="w-4 h-4" /></button>
            </div>
          )}

          <fieldset disabled={deleted} className="space-y-5 min-w-0 disabled:opacity-60">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Send day">
                <input type="date" value={draft.sendDate} onChange={e => setDate(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border-2 border-border bg-background text-base" />
              </Field>
              <Field label="Time" hint="optional">
                <input type="time" value={draft.sendTime} onChange={e => setField("sendTime", e.target.value)} onBlur={() => void fields.flush()}
                  className="w-full px-3 py-2.5 rounded-xl border-2 border-border bg-background text-base" />
              </Field>
            </div>

            {/* The campaign — derived from the send day, never picked. */}
            <div className={cn("rounded-xl border-2 px-4 py-3 flex items-center gap-3", campaign ? "border-violet-500/40 bg-violet-500/5" : "border-dashed border-border")}>
              <Megaphone className={cn("w-5 h-5 flex-shrink-0", campaign ? "text-violet-600" : "text-muted-foreground")} />
              <div className="flex-1 min-w-0">
                {campaign ? (
                  <>
                    <p className="text-base font-semibold truncate">In “{campaign.title}”</p>
                    <p className="text-sm text-muted-foreground">{formatRange(campaign.startDate, campaign.endDate)} · change the send day to move it to another phase</p>
                  </>
                ) : (
                  <p className="text-base text-muted-foreground">Not in a phase — no phase runs on this day.</p>
                )}
              </div>
              {campaign && onOpenCampaign && (
                <button type="button" onClick={() => onOpenCampaign(campaign.id)} className="px-3 py-2 rounded-xl border-2 border-violet-500/40 text-sm font-semibold flex-shrink-0 hover:bg-violet-500/10">
                  Open
                </button>
              )}
            </div>

            <Field label="Subject line">
              <input
                value={draft.subject}
                onChange={e => setField("subject", e.target.value)}
                onBlur={() => void fields.flush()}
                placeholder="e.g. Your early access starts now"
                autoFocus={id == null}
                maxLength={300}
                className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-lg font-semibold focus:outline-none focus:border-primary"
              />
            </Field>

            <Field label="Stage" hint={stage.fromKlaviyo ? "set by Klaviyo" : undefined}>
              <div className="flex flex-wrap gap-2">
                {EMAIL_STAGE_OPTIONS.map(s => (
                  <Chip key={s.key} active={stage.stage === s.key} disabled={stage.fromKlaviyo}
                    onClick={() => setField("status", s.key)} title={s.hint}>{s.label}</Chip>
                ))}
              </div>
              {stage.fromKlaviyo && (
                <p className="text-sm text-muted-foreground">
                  Linked to Klaviyo, so the stage follows it: {linkedSend?.status === "Draft" ? "a draft there" : linkedSend?.status === "Sent" ? "sent" : "scheduled there"} → <b>{stageLabel(stage.stage)}</b>. Unlink to set it by hand.
                </p>
              )}
            </Field>

            <TextArea label="Offer" value={draft.offer} rows={2} max={2000} placeholder="e.g. 20% off everything, VIPs first"
              onChange={v => setField("offer", v)} onBlur={() => void fields.flush()} />
            <TextArea label="Core message" value={draft.coreMessage} rows={3} max={4000} placeholder="The one thing this email says"
              onChange={v => setField("coreMessage", v)} onBlur={() => void fields.flush()} />

            <Field label="Audience" hint="who gets it">
              <div className="flex flex-wrap gap-2">
                {EMAIL_AUDIENCES.map(a => {
                  const on = draft.audiences.includes(a.key);
                  return (
                    <Chip key={a.key} active={on} onClick={() => setField("audiences", on ? draft.audiences.filter(x => x !== a.key) : [...draft.audiences, a.key])}>
                      {a.label}
                    </Chip>
                  );
                })}
              </div>
              <input value={draft.audienceOther} onChange={e => setField("audienceOther", e.target.value)} onBlur={() => void fields.flush()}
                maxLength={200} placeholder="A specific list or segment (optional)"
                className="mt-2 w-full px-4 py-2.5 rounded-xl border-2 border-border bg-background text-base focus:outline-none focus:border-primary" />
            </Field>

            <Field label="Email cadence" hint="free text">
              <input value={draft.cadence} onChange={e => setField("cadence", e.target.value)} onBlur={() => void fields.flush()}
                maxLength={200} placeholder="e.g. 1 email · Fri + weekend sends · Sun AM + PM"
                className="w-full px-4 py-2.5 rounded-xl border-2 border-border bg-background text-base focus:outline-none focus:border-primary" />
            </Field>

            <TextArea label="SMS suggestion" hint="optional" value={draft.smsSuggestion} rows={2} max={1000}
              onChange={v => setField("smsSuggestion", v)} onBlur={() => void fields.flush()} />
            <div className="grid sm:grid-cols-2 gap-3">
              <TextArea label="Website change needed" value={draft.websiteChange} rows={2} max={2000} placeholder="e.g. Homepage banner"
                onChange={v => setField("websiteChange", v)} onBlur={() => void fields.flush()} />
              <TextArea label="Meta / ads change needed" value={draft.metaChange} rows={2} max={2000} placeholder="e.g. Swap to BF creative"
                onChange={v => setField("metaChange", v)} onBlur={() => void fields.flush()} />
            </div>
            <TextArea label="Notes" value={draft.notes} rows={4} max={10000}
              onChange={v => setField("notes", v)} onBlur={() => void fields.flush()} />
          </fieldset>

          {/* Link to the real Klaviyo send */}
          <section className="rounded-2xl border-2 border-teal-500/30 p-4 space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <Link2 className="w-4 h-4" /> Klaviyo email
            </h3>
            {id == null ? (
              <p className="text-sm text-muted-foreground">Add a subject line first, then link the Klaviyo email this becomes.</p>
            ) : linkedId ? (
              <div className="flex items-center gap-3 flex-wrap">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{linkedSend?.name ?? email?.klaviyoCampaignName ?? linkedId}</p>
                  <p className="text-sm text-muted-foreground">
                    {linkedSend
                      ? linkedSend.status === "Draft"
                        ? `Draft in Klaviyo ✓ (not scheduled yet)${linkedSend.subject ? ` · “${linkedSend.subject}”` : " · no subject line yet"}`
                        : `${linkedSend.status === "Sent" ? "Sent" : "Scheduled"} in Klaviyo ✓ · ${format(parseISO(linkedSend.sendAt), "EEE d MMM, HH:mm")}${linkedSend.subject ? ` · “${linkedSend.subject}”` : ""}`
                      : "Linked — not found a week either side of this day in Klaviyo"}
                  </p>
                </div>
                {linkedSend && (
                  <a href={linkedSend.klaviyoUrl} target="_blank" rel="noopener noreferrer" className="p-2 rounded-lg border-2 border-border hover:bg-secondary/50" aria-label="Open in Klaviyo">
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
                <button type="button" disabled={deleted || link.isPending} onClick={() => link.mutate({ id, klaviyo: null })}
                  className="px-3 py-2 rounded-xl border-2 border-border text-sm font-semibold flex items-center gap-1.5 hover:bg-secondary/50 disabled:opacity-50">
                  <Unlink className="w-4 h-4" /> Unlink
                </button>
                {autoLink && (
                  <div className="basis-full rounded-xl border-2 border-violet-500/40 bg-violet-500/5 px-3 py-2.5 flex items-start gap-2.5">
                    <Wand2 className="w-5 h-5 text-violet-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm">
                      <b>Linked automatically</b> {formatDistanceToNowStrict(parseISO(autoLink.at))} ago — this subject line matched Klaviyo's {autoLink.matched}.
                      {" "}Not the right one? <b>Unlink</b> and it won't be linked to that one again.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {suggestions.map(s => (
                  <div key={s.campaignId} className="rounded-xl border-2 border-violet-500/50 bg-violet-500/5 p-3 flex items-center gap-3 flex-wrap">
                    <Wand2 className="w-5 h-5 text-violet-600 flex-shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block font-semibold">Looks like Klaviyo's “{s.campaignName}” — link?</span>
                      <span className="block text-sm text-muted-foreground">
                        {s.campaignStatus === "Draft" ? "Draft" : s.campaignStatus} · matched its {s.matched}
                      </span>
                    </span>
                    <button type="button" disabled={deleted || link.isPending}
                      onClick={() => link.mutate({ id, klaviyo: { id: s.campaignId, name: s.campaignName } })}
                      className="px-4 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50">
                      <Link2 className="w-4 h-4" /> Link
                    </button>
                  </div>
                ))}
                <p className="text-sm text-muted-foreground">Klaviyo emails a week either side of this day, and recent drafts — tap the one this plan became.</p>
                {klaviyo.isLoading && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Checking Klaviyo…</p>}
                {klaviyo.data && !klaviyo.data.connected && <p className="text-sm text-muted-foreground">Klaviyo isn't connected.</p>}
                {klaviyo.data?.error && <p className="text-sm text-amber-700 dark:text-amber-400">{klaviyo.data.error}</p>}
                {klaviyo.data?.connected && pickable.length === 0 && (
                  <p className="text-sm text-muted-foreground">None yet. Once it's a draft in Klaviyo it shows up here.</p>
                )}
                {pickable.map(k => (
                  <button key={k.id} type="button" disabled={deleted || link.isPending}
                    onClick={() => link.mutate({ id, klaviyo: { id: k.id, name: k.name } })}
                    className="w-full text-left rounded-xl border-2 border-teal-500/30 p-3 flex items-center gap-3 hover:bg-teal-500/10 disabled:opacity-50">
                    <Mail className="w-5 h-5 text-teal-600 flex-shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {k.status === "Draft" ? `Draft · set for ${format(parseISO(k.sendAt), "EEE d MMM")}` : `${format(parseISO(k.sendAt), "EEE d MMM, HH:mm")} · ${k.status}`}
                      </span>
                      <span className="block font-semibold truncate">{k.name}</span>
                      <span className="block text-sm text-muted-foreground truncate">{k.subject ?? "No subject line"}</span>
                    </span>
                    <span className="text-sm font-semibold text-primary flex-shrink-0">Link</span>
                  </button>
                ))}
              </div>
            )}
            {link.isError && <p className="text-sm text-destructive">{(link.error as Error).message}</p>}
          </section>

          {/* Approval — one per email, shared with the linked Klaviyo campaign. */}
          {id != null && (
            <ApprovalPanel
              item={approvalItem}
              row={approvalItem ? approvals.row(approvalItem.key) : null}
              canApprove={approvals.canApprove}
              target={{ emailId: id }}
              disabled={deleted}
            />
          )}

          {email && (
            <p className="text-sm text-muted-foreground">
              Added by <b>{firstName(email.createdBy?.name)}</b> · {format(parseISO(email.createdAt), "d MMM HH:mm")}
              {email.updatedBy && <> · last edited by <b>{firstName(email.updatedBy.name)}</b> {formatDistanceToNowStrict(parseISO(email.updatedAt))} ago</>}
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
                  <Trash2 className="w-4 h-4" /> Delete email
                </button>
              ) : (
                <div className="rounded-xl border-2 border-red-500/50 bg-red-500/10 p-4 space-y-3">
                  <p className="font-semibold text-base">Are you sure? “{draft.subject}” comes off the plan for everyone.</p>
                  <p className="text-sm text-muted-foreground">Its history is kept. Nothing changes in Klaviyo.</p>
                  {del.isError && <p className="text-sm text-destructive">{(del.error as Error).message}</p>}
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={() => del.mutate(id, { onSuccess: onClose })} disabled={del.isPending}
                      className="px-4 py-2.5 rounded-xl bg-red-600 text-white font-semibold flex items-center gap-2 disabled:opacity-60">
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="block text-sm font-semibold">{label}{hint && <span className="font-normal text-muted-foreground"> — {hint}</span>}</span>
      {children}
    </div>
  );
}

function TextArea({ label, hint, value, rows, max, placeholder, onChange, onBlur }: {
  label: string; hint?: string; value: string; rows: number; max: number; placeholder?: string;
  onChange: (v: string) => void; onBlur: () => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <textarea value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur} rows={rows} maxLength={max} placeholder={placeholder}
        className="w-full px-4 py-2.5 rounded-xl border-2 border-border bg-background text-base focus:outline-none focus:border-primary resize-y" />
    </Field>
  );
}

function Chip({ active, onClick, title, disabled, children }: { active: boolean; onClick: () => void; title?: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "px-3.5 py-2 rounded-full border-2 text-sm font-semibold inline-flex items-center gap-1.5 transition-colors disabled:cursor-not-allowed",
        active ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:bg-secondary/50",
        disabled && !active && "opacity-50",
      )}
    >
      {children}
    </button>
  );
}
