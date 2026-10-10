/**
 * "Request a test" (Graeme, 2026-10-10; Objectives E and F) — managers and
 * admins ask one or more people to try a change for real. If it came from an
 * issue report, the person who reported it is always asked.
 *
 * A create form, not an edit form: nothing exists until "Ask them", which
 * shows its own saving / error state (charter rule 5). Closable at every
 * point (X, Cancel), capped at 92dvh with the fields scrolling inside.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardCheck, Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DictateButton } from "@/components/dictate-button";
import { useCreateTestRequest, useIssueReporter, useTeamMembers } from "@/hooks/use-test-requests";
import { testerPreview } from "@/lib/test-requests";

type WhenKind = "any" | "page" | "date" | "times";

const WHEN_CHOICES: Array<{ kind: WhenKind; label: string; hint: string }> = [
  { kind: "any", label: "Any time", hint: "Next time they're signed in" },
  { kind: "page", label: "On a page", hint: "e.g. next time they build" },
  { kind: "date", label: "From a date", hint: "Not before a day and time" },
  { kind: "times", label: "Time of day", hint: "e.g. after 2pm" },
];

export type NewTestPrefill = { issueId?: number | null; title?: string; linkPath?: string };

export function NewTestRequestModal({ open, onClose, prefill }: { open: boolean; onClose: () => void; prefill?: NewTestPrefill }) {
  const create = useCreateTestRequest();
  const team = useTeamMembers();

  const [title, setTitle] = useState("");
  const [steps, setSteps] = useState("");
  const [linkPath, setLinkPath] = useState("");
  const [when, setWhen] = useState<Set<WhenKind>>(new Set(["any"]));
  const [onlyOnPath, setOnlyOnPath] = useState("");
  const [notBefore, setNotBefore] = useState("");
  const [dailyFrom, setDailyFrom] = useState("");
  const [dailyUntil, setDailyUntil] = useState("");
  const [whenText, setWhenText] = useState("");
  const [issueText, setIssueText] = useState("");
  const [chosen, setChosen] = useState<number[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(prefill?.title ?? ""); setSteps(""); setLinkPath(prefill?.linkPath ?? "");
    setWhen(new Set(["any"])); setOnlyOnPath(""); setNotBefore(""); setDailyFrom(""); setDailyUntil(""); setWhenText("");
    setIssueText(prefill?.issueId ? String(prefill.issueId) : ""); setChosen([]); setSearch("");
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const issueId = /^\d+$/.test(issueText.trim()) ? Number(issueText.trim()) : null;
  const issueQ = useIssueReporter(issueId);
  const reporter = issueQ.data?.reportedBy ? { id: issueQ.data.reportedBy, name: issueQ.data.reportedByName ?? "The reporter" } : null;
  const members = team.data ?? [];
  const chosenPeople = chosen.map(id => members.find(m => m.id === id)).filter((m): m is NonNullable<typeof m> => !!m);
  const testers = testerPreview(reporter, chosenPeople);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter(m => !chosen.includes(m.id) && m.id !== reporter?.id && (!q || m.name.toLowerCase().includes(q))).slice(0, q ? 30 : 12);
  }, [members, chosen, search, reporter?.id]);

  if (!open) return null;

  const toggleWhen = (k: WhenKind) => setWhen(prev => {
    if (k === "any") return new Set(["any"]);
    const next = new Set(prev);
    next.delete("any");
    if (next.has(k)) next.delete(k); else next.add(k);
    return next.size ? next : new Set(["any"]);
  });

  const issueProblem = issueText.trim() && (issueId == null ? "Type the issue number, e.g. 412" : issueQ.isError ? (issueQ.error as Error).message : null);
  const ready = title.trim().length >= 3 && steps.trim().length >= 5 && testers.length > 0 && !issueProblem && !issueQ.isFetching;

  const submit = () => {
    if (!ready) return;
    create.mutate({
      title: title.trim(),
      steps: steps.trim(),
      linkPath: linkPath.trim() || null,
      onlyOnPath: when.has("page") ? onlyOnPath.trim() || null : null,
      notBefore: when.has("date") && notBefore ? new Date(notBefore).toISOString() : null,
      dailyFrom: when.has("times") ? dailyFrom || null : null,
      dailyUntil: when.has("times") ? dailyUntil || null : null,
      whenText: whenText.trim() || null,
      andonIssueId: issueId,
      testerIds: chosen,
    }, { onSuccess: onClose });
  };

  const input = "w-full h-12 px-4 rounded-2xl border-2 border-border bg-card text-base focus:outline-none focus:ring-2 focus:ring-primary/40";

  return createPortal(
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-3 md:p-8">
      <div role="dialog" aria-modal="true" aria-labelledby="new-test-title" className="bg-background rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 md:px-7 py-4 border-b border-border">
          <ClipboardCheck className="w-8 h-8 text-sky-600 shrink-0" />
          <h2 id="new-test-title" className="flex-1 text-2xl font-display font-bold">Request a test</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="w-11 h-11 rounded-xl border border-border flex items-center justify-center text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 md:p-7 space-y-6">
          <Field label="1 · What should they test?" dictate={<DictateButton value={title} onChange={setTitle} context="title" />}>
            <input value={title} onChange={e => setTitle(e.target.value)} maxLength={160} placeholder="e.g. The new Edit numbers button on building" className={input} />
          </Field>

          <Field label="2 · What changed, and what should they try?" dictate={<DictateButton value={steps} onChange={setSteps} context="note" />}>
            <textarea value={steps} onChange={e => setSteps(e.target.value)} rows={4} maxLength={4000}
              placeholder={"e.g. When you've finished a batch, tap Edit numbers and change the count.\nDoes the total update? Is it clear what to do?"}
              className="w-full px-4 py-3 rounded-2xl border-2 border-border bg-card text-base focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y" />
          </Field>

          <Field label="3 · Which page? (optional)" hint={'"Take me there" opens this page. Copy it from the address bar after the website name, e.g. /plans/412/station/building'}>
            <input value={linkPath} onChange={e => setLinkPath(e.target.value)} placeholder="/plans/412/station/building" className={input} />
          </Field>

          <Field label="4 · When should they be asked?" hint="Pick any that apply — they're only asked when all of them are true.">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {WHEN_CHOICES.map(c => (
                <button key={c.kind} type="button" onClick={() => toggleWhen(c.kind)} aria-pressed={when.has(c.kind)}
                  className={cn("min-h-[72px] rounded-2xl px-3 py-2 text-left border-2", when.has(c.kind) ? "border-sky-500 bg-sky-50 dark:bg-sky-900/30" : "border-border hover:bg-secondary/50")}>
                  <span className="block text-base font-bold">{c.label}</span>
                  <span className="block text-xs text-muted-foreground">{c.hint}</span>
                </button>
              ))}
            </div>
            {when.has("page") && (
              <div className="mt-3">
                <input value={onlyOnPath} onChange={e => setOnlyOnPath(e.target.value)} placeholder="/plans/*/station/building" className={input} />
                <p className="text-sm text-muted-foreground mt-1">Use * for any one part — /plans/*/station/building means the building station on any day's plan.</p>
              </div>
            )}
            {when.has("date") && (
              <input type="datetime-local" value={notBefore} onChange={e => setNotBefore(e.target.value)} className={cn(input, "mt-3")} aria-label="Not before" />
            )}
            {when.has("times") && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="text-sm text-muted-foreground">After<input type="time" value={dailyFrom} onChange={e => setDailyFrom(e.target.value)} className={input} /></label>
                <label className="text-sm text-muted-foreground">Before<input type="time" value={dailyUntil} onChange={e => setDailyUntil(e.target.value)} className={input} /></label>
              </div>
            )}
            <input value={whenText} onChange={e => setWhenText(e.target.value)} maxLength={200} placeholder="In your words (shown on the card), e.g. Next time you build" className={cn(input, "mt-3")} />
          </Field>

          <Field label="5 · Did it come from an issue report? (optional)" hint="Type the issue number. The person who reported it is always asked to test it.">
            <input value={issueText} onChange={e => setIssueText(e.target.value)} inputMode="numeric" placeholder="Issue number" className={cn(input, "max-w-[12rem]")} />
            {issueProblem && <p className="text-base font-semibold text-destructive mt-1">{issueProblem}</p>}
            {issueQ.data && (
              <div className="mt-2 rounded-2xl bg-secondary/60 p-3">
                <p className="text-sm text-muted-foreground">Issue #{issueQ.data.id} · {issueQ.data.station}{issueQ.data.reportedByName ? ` · reported by ${issueQ.data.reportedByName}` : ""}</p>
                {issueQ.data.description && <p className="text-base line-clamp-3">“{issueQ.data.description}”</p>}
                {!issueQ.data.reportedBy && <p className="text-base font-semibold text-amber-700 mt-1">Whoever reported it no longer has an account — choose who should test it.</p>}
              </div>
            )}
          </Field>

          <Field label="6 · Who should test it?">
            {testers.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {testers.map(t => (
                  <span key={t.id} className="h-11 pl-4 pr-1 rounded-full bg-sky-600 text-white text-base font-semibold flex items-center gap-1">
                    {t.name}{t.isReporter && <span className="text-xs font-normal opacity-90 pr-3"> · reported it — always asked</span>}
                    {!t.isReporter && (
                      <button type="button" onClick={() => setChosen(c => c.filter(id => id !== t.id))} aria-label={`Remove ${t.name}`} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/20"><X className="w-4 h-4" /></button>
                    )}
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find someone" className={cn(input, "pl-10")} />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {team.isLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
              {filtered.map(m => (
                <button key={m.id} type="button" onClick={() => setChosen(c => [...c, m.id])} className="h-11 px-4 rounded-full border-2 border-border text-base font-semibold hover:bg-secondary/50">
                  + {m.name}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <div className="p-5 md:p-7 pt-3 border-t border-border space-y-2">
          {create.isError && <p className="text-base font-semibold text-destructive">Couldn't save — {(create.error as Error).message}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="h-14 px-6 rounded-2xl border-2 border-border text-base font-bold hover:bg-secondary/50">Cancel</button>
            <button type="button" onClick={submit} disabled={!ready || create.isPending}
              className="flex-1 h-14 rounded-2xl bg-sky-600 text-white text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
              {create.isPending && <Loader2 className="w-5 h-5 animate-spin" />}
              {testers.length === 0 ? "Choose a tester" : `Ask ${testers.length === 1 ? testers[0]!.name : `${testers.length} people`}`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Field({ label, hint, dictate, children }: { label: string; hint?: string; dictate?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <p className="text-lg font-bold">{label}</p>
        {dictate}
      </div>
      {children}
      {hint && <p className="text-sm text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}
