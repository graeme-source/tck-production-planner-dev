/**
 * Letters on a record entry (Graeme, 2026-10-12: "generate letters and send
 * them to employees to inform them of important updates such as written
 * warnings").
 *
 *   Create letter → pick a template that fits this entry (which ones fit is
 *   data on each template) → it's filled from the entry, gaps shown as
 *   [reviewDate] → edit the wording (autosaved draft) → Preview PDF (TCK
 *   letterhead, same renderer as contracts) → File on their record, or
 *   Send to <name>: a confirmation shows exactly who, where, and — if the
 *   email box is ticked — the From / Replies-to line. Never automatic.
 *
 * Once sent it's in their Employee Hub → My documents, where they open it
 * and tap "I've read and understood this letter". Opened / acknowledged
 * show here and on the timeline.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Eye, FileText, Loader2, Mail, Plus, Send, Archive } from "lucide-react";
import { templatesForEntry, letterGaps, letterStatusLabel, type LetterStatus } from "@workspace/people-reviews";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { peopleFetch, peopleRetry } from "@/hooks/use-people-gate";
import { PeopleModal } from "@/components/people-modal";
import { AutoText } from "./review-fields";
import {
  recordSend, useLetterTemplates, LETTER_PREVIEW_URL, type PersonRecordEntries, type RecordEntry, type RecordLetter,
} from "./reviews-api";

type Person = { id: number; name: string; email: string | null; isActive: boolean };

export function useLetterIdentity(enabled: boolean) {
  return useQuery<{ identity: { line: string; fromName: string; fromEmail: string; replyTo: string } }>({
    queryKey: ["people-record-entries", "hr-settings"],
    queryFn: () => peopleFetch("/people-reviews/hr-settings"),
    enabled,
    retry: peopleRetry,
    staleTime: 60_000,
  });
}

export function LettersBlock({ entry, data, person, onChanged }: {
  entry: RecordEntry; data: PersonRecordEntries; person: Person; onChanged: () => void;
}) {
  const templates = useLetterTemplates(true);
  const [picking, setPicking] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const offered = templates.data
    ? templatesForEntry(entry, data.classifications, data.stages, templates.data.templates)
    : [];
  const open = entry.letters.find(l => l.id === openId) ?? null;

  const create = async (templateId: number) => {
    try {
      const r = await recordSend<{ id: number }>("POST", `/entries/${entry.id}/letters`, { templateId });
      setPicking(false);
      onChanged();
      setOpenId(r.id);
    } catch (e) {
      toast({ title: "Couldn't start the letter", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
    }
  };

  return (
    <section className="rounded-3xl border-2 border-border bg-card p-4 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="flex-1 min-w-0 text-lg font-bold flex items-center gap-2"><FileText className="w-5 h-5 text-primary" /> Letters</h3>
        <button type="button" onClick={() => setPicking(p => !p)}
          className="h-12 px-4 rounded-xl border-2 border-border font-bold flex items-center gap-2 hover:bg-secondary/50">
          <Plus className="w-5 h-5" /> Create letter
        </button>
      </div>
      {picking && (
        <div className="space-y-2">
          <p className="text-base text-muted-foreground">Letters that fit this entry:</p>
          {templates.isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
            <div className="grid gap-2 sm:grid-cols-2">
              {offered.map(t => (
                <button key={t.id} type="button" onClick={() => void create(t.id)}
                  className="min-h-14 px-4 py-2 rounded-2xl border-2 border-border text-left text-lg font-bold hover:border-primary/50">
                  {t.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {entry.letters.length === 0 && !picking && <p className="text-base text-muted-foreground">No letters yet.</p>}
      {entry.letters.map(l => (
        <button key={l.id} type="button" onClick={() => setOpenId(l.id)}
          className="w-full text-left rounded-2xl border-2 border-border p-3 flex items-center gap-3 hover:border-primary/50">
          {l.acknowledgedAt ? <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" /> : <FileText className="w-6 h-6 text-primary shrink-0" />}
          <span className="flex-1 min-w-0">
            <span className="block text-lg font-bold truncate">{l.title}</span>
            <span className="block text-sm text-muted-foreground">{letterStatusLabel(l)}</span>
          </span>
        </button>
      ))}
      {open && (
        <PeopleModal title={`${open.title} — ${person.name}`} onClose={() => { setOpenId(null); onChanged(); }} wide>
          <LetterEditor letter={open} person={person} onChanged={onChanged} />
        </PeopleModal>
      )}
    </section>
  );
}

function LetterEditor({ letter, person, onChanged }: { letter: RecordLetter; person: Person; onChanged: () => void }) {
  const [body, setBody] = useState(letter.body);
  const [step, setStep] = useState<null | "file" | "send">(null);
  const [email, setEmail] = useState(!!person.email);
  const [busy, setBusy] = useState(false);
  const identity = useLetterIdentity(step === "send");
  const editable = letter.status === "draft";
  const gaps = letterGaps(editable ? body : letter.body);
  const first = person.name.split(" ")[0];

  const act = async (path: string, payload: unknown, done: string) => {
    setBusy(true);
    try {
      const r = await recordSend<{ emailed?: { to: string } | null; emailError?: string | null }>("POST", path, payload);
      toast({ title: done, description: r?.emailError ? `But the email didn't go: ${r.emailError}` : r?.emailed ? `Email sent to ${r.emailed.to}.` : undefined });
      setStep(null);
      onChanged();
    } catch (e) {
      toast({ title: "Couldn't do that", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <p className={cn("text-base font-bold", letter.status === "sent" ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground")}>
        {letterStatusLabel({ ...letter, status: letter.status as LetterStatus })}
        {letter.emailedTo ? ` · email sent to ${letter.emailedTo}` : ""}
      </p>
      {editable ? (
        <>
          <AutoText label="Title" initial={letter.title} maxLength={200} onSave={v => recordSend("PATCH", `/letters/${letter.id}`, { title: v })} />
          <AutoText label="The letter" initial={letter.body} rows={18}
            onSave={async v => { setBody(v); await recordSend("PATCH", `/letters/${letter.id}`, { body: v }); }} />
          <p className="text-sm text-muted-foreground">
            Words in CAPITALS on their own line print as headings. {"[[founder_signature]]"} prints Graeme's signature.
          </p>
        </>
      ) : (
        <pre className="whitespace-pre-wrap font-serif text-base rounded-2xl border-2 border-border p-4 bg-card max-h-[50dvh] overflow-y-auto">{letter.body}</pre>
      )}
      {gaps.length > 0 && editable && (
        <p className="rounded-2xl bg-amber-50 dark:bg-amber-950/30 p-3 text-base font-semibold text-amber-900 dark:text-amber-100">
          Still to fill in: {gaps.map(g => `[${g}]`).join(", ")} — fill these in the entry, or type over them here.
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        <a href={LETTER_PREVIEW_URL(letter.id)} target="_blank" rel="noreferrer"
          className="h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50">
          <Eye className="w-5 h-5" /> Preview PDF
        </a>
        {letter.status === "draft" && (
          <button type="button" disabled={gaps.length > 0} onClick={() => setStep("file")}
            className="h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
            <Archive className="w-5 h-5" /> File on their record
          </button>
        )}
        {letter.status !== "sent" && (
          <button type="button" disabled={gaps.length > 0} onClick={() => setStep("send")}
            className="h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
            <Send className="w-5 h-5" /> Send to {first}
          </button>
        )}
      </div>

      {step === "file" && (
        <div className="rounded-2xl border-2 border-primary p-4 space-y-3">
          <p className="text-lg font-bold">File this letter on {person.name}'s record?</p>
          <p className="text-base">It's saved as a PDF in their Documents (not shared with them). The wording can't be changed after this.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" disabled={busy} onClick={() => void act(`/letters/${letter.id}/file`, {}, "Filed on their record")}
              className="h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold">File it</button>
            <button type="button" onClick={() => setStep(null)} className="h-14 rounded-2xl border-2 border-border text-lg font-bold">Not yet</button>
          </div>
        </div>
      )}

      {step === "send" && (
        <div className="rounded-2xl border-2 border-primary p-4 space-y-3">
          <p className="text-lg font-bold">Send “{letter.title}” to {person.name}?</p>
          <ul className="text-base space-y-1 list-disc pl-5">
            <li>It's saved as a PDF in their Documents and <b>shared with {first}</b> — they'll see it in the app under Employee Hub → My documents, and can tick "I've read and understood this letter".</li>
            <li>The wording can't be changed after this.</li>
          </ul>
          {!person.isActive && <p className="text-base font-bold text-destructive">{first} doesn't have an active account, so can't read it in the app.</p>}
          {person.email ? (
            <label className="flex items-start gap-3 min-h-14 px-4 py-3 rounded-2xl border-2 border-border cursor-pointer">
              <input type="checkbox" checked={email} onChange={e => setEmail(e.target.checked)} className="w-6 h-6 mt-0.5 accent-primary" />
              <span className="text-base">
                <span className="font-bold flex items-center gap-2"><Mail className="w-4 h-4" /> Also email {person.email}</span>
                <span className="block text-muted-foreground">Just to say a letter is waiting in the app — the letter itself is never attached.</span>
                {email && <span className="block mt-1 font-semibold">{identity.data?.identity.line ?? "…"}</span>}
              </span>
            </label>
          ) : (
            <p className="text-base text-muted-foreground">No email address on their account — they'll see it next time they open the app.</p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" disabled={busy || !person.isActive}
              onClick={() => void act(`/letters/${letter.id}/send`, { email: email && !!person.email }, `Sent to ${first}`)}
              className="h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
              {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />} Yes, send it to {first}
            </button>
            <button type="button" onClick={() => setStep(null)} className="h-14 rounded-2xl border-2 border-border text-lg font-bold">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
