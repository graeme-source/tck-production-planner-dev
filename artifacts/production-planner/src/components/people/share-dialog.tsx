/**
 * "Share…" — who can see a note, and the double confirmation before it
 * reaches the colleague (Graeme, 2026-10-14: "It might be a draft version
 * that we're not willing to share yet, or we might not choose to share it
 * at all… I want a double confirmation. I also want to make it a less
 * obvious button. I also want the ability for me to share with Lorna, but
 * not with anyone else"). Objective H.
 *
 *   • Three levels (lib/people-reviews share-levels.ts): Private to you;
 *     Shared with HR — people picked from those with People access to this
 *     record; Shared with <colleague>.
 *   • Sharing with the colleague is two steps: (1) read exactly what will be
 *     shared and who will see it; (2) tick "I've checked this is ready to
 *     share", then "Share with <name>". HR and back-to-private: one step.
 *   • A closable People modal (X, Escape, tap outside), capped at 92dvh with
 *     the buttons pinned in view. Drawn on document.body so it sits above
 *     the pop-up it was opened from.
 *
 * The server decides who reads what; this only asks before changing it.
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Check, Eye, Loader2, Lock, Users } from "lucide-react";
import {
  canConfirmShare, confirmLabel, levelLabel, needsDoubleConfirm, whoWillSee, agreementBullets, NOTE_KIND_LABEL,
  type ShareLevel,
} from "@workspace/people-reviews";
import { cn } from "@/lib/utils";
import { PeopleModal } from "@/components/people-modal";
import { PinnedFooter, pinnedPrimaryClass } from "@/components/ui/pinned-save-bar";

export interface RecordReader { id: number; name: string }

const Readers = createContext<readonly RecordReader[]>([]);

/** Who else can open this record (founder + People access, never on their
 *  own) — from GET /people-reviews/person/:userId. */
export function RecordReadersProvider({ readers, children }: { readers: readonly RecordReader[] | undefined; children: ReactNode }) {
  return <Readers.Provider value={readers ?? []}>{children}</Readers.Provider>;
}
export const useRecordReaders = () => useContext(Readers);

export const LEVEL_ICON = { private: Lock, hr: Users, colleague: Eye } as const;

/** The quiet entry point on a card: small, outlined, never the green one. */
export function ShareButton({ onClick, label = "Share…", disabled }: { onClick: () => void; label?: string; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="min-h-11 px-4 rounded-xl border-2 border-border text-base font-bold text-muted-foreground hover:text-foreground hover:bg-secondary/50 inline-flex items-center gap-2 disabled:opacity-50">
      <Users className="w-4 h-4" /> {label}
    </button>
  );
}

/** One piece of what would be shared, shown in full in step 1. */
export interface SharePart { kind?: string; title?: string | null; body: string }

export function ShareDialog({ heading, parts, colleagueName, current, currentHrIds = [], allow, onConfirm, onClose }: {
  heading: string;
  parts: readonly SharePart[];
  colleagueName: string;
  current: ShareLevel;
  currentHrIds?: readonly number[];
  /** The levels on offer here (a write-up part goes to the colleague only as
   *  part of the whole write-up, so its own dialog leaves that out). */
  allow: readonly ShareLevel[];
  onConfirm: (level: ShareLevel, hrUserIds: number[]) => Promise<void>;
  onClose: () => void;
}) {
  const readers = useRecordReaders();
  const first = colleagueName.trim().split(/\s+/)[0] || colleagueName;
  const [target, setTarget] = useState<ShareLevel | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [checked, setChecked] = useState(false);
  const [hrIds, setHrIds] = useState<number[]>([...currentHrIds]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hrNames = readers.filter(r => hrIds.includes(r.id)).map(r => r.name.split(" ")[0]);
  const words = { colleagueFirst: first, hrNames, othersWithAccess: readers.map(r => r.name.split(" ")[0]) };
  const ready = target != null && canConfirmShare({ target, step, checked, hrUserIds: hrIds }, current);
  const twoStep = target != null && needsDoubleConfirm(target, current);

  const pick = (l: ShareLevel) => { setTarget(l); setStep(1); setChecked(false); setError(null); };
  const confirm = async () => {
    if (!target || !ready) return;
    setBusy(true); setError(null);
    try { await onConfirm(target, target === "hr" ? hrIds : []); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't save — try again"); }
    finally { setBusy(false); }
  };

  const option = (l: ShareLevel) => {
    const Icon = LEVEL_ICON[l];
    const title = l === "private" ? "Private to you" : l === "hr" ? "Shared with HR" : `Shared with ${first}`;
    const sub = l === "private" ? "Nobody else — not other managers, not " + first + "."
      : l === "hr" ? `People you pick who look after ${first}'s record. Never ${first}.`
      : `${first} sees it in their Employee Hub and gets a notification.`;
    return (
      <button key={l} type="button" onClick={() => pick(l)} aria-pressed={target === l}
        className={cn("w-full text-left rounded-2xl border-2 p-4 flex items-start gap-3",
          target === l ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/40")}>
        <Icon className="w-6 h-6 shrink-0 mt-0.5 text-muted-foreground" />
        <span className="flex-1 min-w-0">
          <span className="block text-lg font-bold">{title}{l === current ? " · now" : ""}</span>
          <span className="block text-base text-muted-foreground">{sub}</span>
        </span>
      </button>
    );
  };

  const preview = (
    <div className="rounded-2xl border-2 border-border bg-background p-4 space-y-4 max-h-[40dvh] overflow-y-auto">
      {parts.map((p, i) => (
        <div key={i} className="space-y-1">
          {p.kind && <p className="text-sm font-bold uppercase tracking-wide text-muted-foreground">{NOTE_KIND_LABEL[p.kind as keyof typeof NOTE_KIND_LABEL] ?? "Note"}</p>}
          {p.title && <p className="text-lg font-bold break-words">{p.title}</p>}
          {p.kind === "agreement"
            ? <ul className="list-disc pl-6 space-y-1 text-base">{agreementBullets(p.body).map((b, j) => <li key={j} className="break-words">{b}</li>)}</ul>
            : <p className="text-base leading-relaxed whitespace-pre-wrap break-words">{p.body}</p>}
        </div>
      ))}
    </div>
  );

  return createPortal(
    <PeopleModal title={heading} onClose={() => { if (!busy) onClose(); }}>
      <div className="space-y-4">
        {target === "colleague" && twoStep ? (
          step === 1 ? (
            <>
              <p className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Step 1 of 2 — check exactly what {first} will see</p>
              {preview}
              <p className="text-base font-semibold">{whoWillSee("colleague", words)}</p>
            </>
          ) : (
            <>
              <p className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Step 2 of 2 — confirm</p>
              <p className="text-lg">Once shared, {first} can read it straight away. You can make it private again later, but they may already have seen it.</p>
              <label className="flex items-start gap-3 cursor-pointer rounded-2xl border-2 border-border px-4 py-3">
                <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} className="w-6 h-6 mt-0.5 accent-emerald-600" />
                <span className="text-lg font-semibold">I've checked this is ready to share</span>
              </label>
            </>
          )
        ) : (
          <>
            <p className="text-base text-muted-foreground">Now: <span className="font-bold text-foreground">{levelLabel(current, { colleagueFirst: first, hrNames: readers.filter(r => currentHrIds.includes(r.id)).map(r => r.name.split(" ")[0]) })}</span>. Who should be able to read it?</p>
            <div className="space-y-2">{allow.map(option)}</div>
            {target === "hr" && (
              readers.length === 0 ? (
                <p className="text-base text-muted-foreground">Nobody else has People access to {first}'s record.</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-base font-bold">Who?</p>
                  {readers.map(r => (
                    <label key={r.id} className="flex items-center gap-3 cursor-pointer rounded-2xl border-2 border-border px-4 min-h-14">
                      <input type="checkbox" checked={hrIds.includes(r.id)} className="w-6 h-6 accent-emerald-600"
                        onChange={e => setHrIds(prev => e.target.checked ? [...prev, r.id] : prev.filter(x => x !== r.id))} />
                      <span className="text-lg font-semibold">{r.name}</span>
                    </label>
                  ))}
                </div>
              )
            )}
            {target != null && target !== "colleague" && <p className="text-base font-semibold">{whoWillSee(target, words)}</p>}
            {target === "colleague" && !twoStep && <p className="text-base">It's already shared with {first}.</p>}
          </>
        )}
        {error && <p className="text-base font-semibold text-destructive" role="alert">{error}</p>}
      </div>

      <PinnedFooter>
        <div className="space-y-2" data-testid="footer-share">
          {target === "colleague" && twoStep && step === 1 ? (
            <div className="grid gap-2 grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <button type="button" onClick={() => setStep(2)}
                className="min-h-14 rounded-2xl border-2 border-primary text-primary text-lg font-bold flex items-center justify-center gap-2 hover:bg-primary/5">
                <Check className="w-5 h-5" /> I've read it — next
              </button>
              <button type="button" onClick={() => { setTarget(null); setStep(1); }}
                className="min-h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2">
                <ArrowLeft className="w-5 h-5" /> Back
              </button>
            </div>
          ) : (
            <div className="grid gap-2 grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <button type="button" disabled={!ready || busy} onClick={() => void confirm()} className={pinnedPrimaryClass}>
                {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : target ? (() => { const I = LEVEL_ICON[target]; return <I className="w-5 h-5" />; })() : null}
                {target ? confirmLabel(target, { colleagueFirst: first, hrNames }) : "Choose who can read it"}
              </button>
              <button type="button" disabled={busy}
                onClick={() => (target === "colleague" && step === 2 ? setStep(1) : onClose())}
                className="min-h-14 rounded-2xl border-2 border-border text-lg font-bold disabled:opacity-50">
                {target === "colleague" && step === 2 ? "Back" : "Cancel"}
              </button>
            </div>
          )}
        </div>
      </PinnedFooter>
    </PeopleModal>,
    document.body,
  );
}
