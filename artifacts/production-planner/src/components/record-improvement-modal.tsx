// "Record Improvement" — the quick-actions dock button that replaced Quick
// Idea (Graeme, 2026-08-28).
//
// One question first, because it's the only one that changes what happens:
//
//   An idea       → snap the BEFORE photo now, while you're stood in front of
//                   the problem. It's filed as an idea with its before shot,
//                   and someone (often the same person, later) comes back,
//                   adds the after and describes what changed.
//   Already done  → snap the AFTER photo and it goes straight into the
//                   approval queue.
//
// Photos are enough. Video is better and the camera offers it, but the point
// is engagement — a picture people actually take beats a clip they don't.

import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Lightbulb, CheckCircle2, Camera, Loader2, X, ArrowRight, ListChecks, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { DictateButton } from "@/components/dictate-button";
import { toast } from "@/hooks/use-toast";
import { summariseUploadFailures, type UploadAttempt } from "@/lib/upload-failures";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Mode = "choose" | "idea" | "done";

export function RecordImprovementModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("choose");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [duplicates, setDuplicates] = useState<Array<{ id: number; title: string }>>([]);
  const [beforeTaken, setBeforeTaken] = useState(false);
  const [afterTaken, setAfterTaken] = useState(false);
  // Guided-flow state (Graeme, 2026-09-23): the form walks one step at a
  // time — title, before photo, after photo — so there's only ever one
  // obvious thing to do. Steps are "done" by doing them or by the small skip.
  const [titleConfirmed, setTitleConfirmed] = useState(false);
  const [beforeSkipped, setBeforeSkipped] = useState(false);
  const [afterSkipped, setAfterSkipped] = useState(false);
  const beforeFile = useRef<File | null>(null);
  const afterFile = useRef<File | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const beforeLibraryRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const reset = () => {
    setMode("choose"); setTitle(""); setDescription("");
    setBeforeTaken(false); setAfterTaken(false);
    setTitleConfirmed(false); setBeforeSkipped(false); setAfterSkipped(false);
    beforeFile.current = null; afterFile.current = null; setBusy(false);
    setDuplicates([]);
  };
  const close = () => { reset(); onClose(); };

  const isIdea = mode === "idea";

  // Which step is up next. "ready" = everything required is done (or
  // skipped) and the note + submit come alive.
  const stepDone = {
    title: titleConfirmed && title.trim().length > 0,
    before: beforeTaken || beforeSkipped,
    after: afterTaken || afterSkipped,
  };
  const currentStep: "title" | "before" | "after" | "ready" =
    !stepDone.title ? "title"
    : !stepDone.before ? "before"
    : !isIdea && !stepDone.after ? "after"
    : "ready";

  /** One photo step: dimmed header while locked, green header + big green
   *  button while it's the step to do, emerald "ready" once done, quiet
   *  "skipped" row that still lets you add the photo after all. */
  const photoStep = (opts: {
    n: number;
    label: string;
    readyLabel: string;
    skipLabel: string;
    helper: string;
    taken: boolean;
    skipped: boolean;
    state: "locked" | "active" | "done";
    onPick: () => void;
    onSkip: () => void;
  }) => {
    if (opts.state === "locked") {
      return (
        <div className="rounded-2xl bg-secondary/50 px-4 py-3 opacity-50">
          <p className="text-lg font-bold text-muted-foreground">{opts.n} · {opts.label}</p>
        </div>
      );
    }
    if (opts.taken) {
      return (
        <button
          onClick={opts.onPick}
          className="w-full rounded-2xl border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 p-4 text-left flex items-center gap-3 active:scale-[0.99] transition-all"
        >
          <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
          <span className="text-base font-bold">{opts.readyLabel}</span>
        </button>
      );
    }
    if (opts.skipped) {
      return (
        <button
          onClick={opts.onPick}
          className="w-full rounded-2xl border-2 border-dashed border-border p-4 text-left flex items-center gap-3 text-muted-foreground"
        >
          <Camera className="w-5 h-5 flex-shrink-0" />
          <span className="text-base font-medium">{opts.label} — skipped. Tap to add one after all.</span>
        </button>
      );
    }
    return (
      <div className="space-y-2">
        <div className="rounded-2xl bg-primary text-primary-foreground px-4 py-3">
          <p className="text-lg font-bold">{opts.n} · {opts.label}</p>
        </div>
        <button
          onClick={opts.onPick}
          className="w-full h-16 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-3 shadow-lg shadow-primary/20 active:scale-[0.99] transition-all"
        >
          <Camera className="w-6 h-6" /> {opts.label}
        </button>
        <p className="text-sm text-muted-foreground text-center">{opts.helper}</p>
        <div className="text-center">
          <button
            onClick={opts.onSkip}
            className="text-sm font-medium text-muted-foreground underline underline-offset-2 px-3 py-2"
          >
            {opts.skipLabel}
          </button>
        </div>
      </div>
    );
  };

  /**
   * Before saving an idea, check whether someone has already reported it.
   * A second copy of a known problem helps nobody; a second voice on the
   * existing one is what tells us how many people it actually affects.
   *
   * Only for ideas — something you've personally just done is never a
   * duplicate of someone else's report.
   */
  const checkThenSubmit = async () => {
    if (!title.trim()) return;
    if (!isIdea) { void submit(); return; }
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/improvements/check-duplicate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({ matches: [] }));
      if (Array.isArray(body.matches) && body.matches.length > 0) {
        setDuplicates(body.matches);
        setBusy(false);
        return;
      }
    } catch {
      // A failed check must never block someone reporting something.
    }
    await submit();
  };

  const addVote = async (id: number) => {
    setBusy(true);
    try {
      await fetch(`${BASE}/api/improvements/${id}/vote`, { method: "POST", credentials: "include" });
      queryClient.invalidateQueries({ queryKey: ["improvements"] });
      toast({ title: "Added your vote", description: "The more people it affects, the higher it climbs." });
      close();
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      // The improvement first, so the photo has something to attach to.
      const res = await fetch(`${BASE}/api/improvements`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || title.trim(),
          station: "general",
          // An idea is for whoever picks it up; something you've done is yours.
          claim: !isIdea,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't save it");
      const improvement = await res.json();

      // Every upload's answer is checked — a failed one used to vanish
      // without a word, silently losing the clip (that's how improvement 33
      // lost its "before" video, 2026-08-27).
      const attempts: UploadAttempt[] = [];
      let afterUploaded = false;
      for (const [phase, file] of [["before", beforeFile.current], ["after", afterFile.current]] as const) {
        if (!file) continue;
        const form = new FormData();
        form.append("file", file);
        form.append("phase", phase);
        const up = await fetch(`${BASE}/api/improvements/${improvement.id}/attachments`, {
          method: "POST", credentials: "include", body: form,
        }).catch(() => null);
        const ok = Boolean(up?.ok);
        if (phase === "after") afterUploaded = ok;
        attempts.push({
          label: `your ${phase.toUpperCase()} ${file.type.startsWith("video/") ? "video" : "photo"}`,
          ok,
          error: !ok && up ? ((await up.json().catch(() => ({}))) as { error?: string }).error : undefined,
        });
      }
      const uploadFailure = summariseUploadFailures(attempts, "it in the feed");

      // Something you've already done, with an after shot, is finished work —
      // send it for sign-off rather than making them find it again. Not when
      // the after failed to land: sign-off needs the evidence to exist.
      if (!isIdea && afterFile.current && afterUploaded) {
        await fetch(`${BASE}/api/improvements/${improvement.id}/done`, {
          method: "POST", credentials: "include",
        });
      }

      queryClient.invalidateQueries({ queryKey: ["improvements"] });
      queryClient.invalidateQueries({ queryKey: ["improvement-scoreboard"] });
      if (uploadFailure) {
        toast({
          title: isIdea ? "Idea logged — but a file was lost" : "Improvement logged — but a file was lost",
          description: uploadFailure,
          variant: "destructive",
        });
      } else {
        toast({
          title: isIdea ? "Idea logged" : "Improvement logged",
          description: isIdea
            ? "Come back to it when it's done and add the after photo."
            : afterFile.current ? "A manager will sign it off." : "Add a photo to it so it can be signed off.",
        });
      }
      close();
    } catch (e) {
      toast({ title: "Couldn't save it", description: (e as Error).message, variant: "destructive" });
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[150] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={close}>
      <div
        className="bg-background w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl p-5 space-y-4 max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-bold">
            {mode === "choose" ? "Record an improvement" : isIdea ? "An idea" : "Something you've done"}
          </h2>
          <button onClick={close} className="w-11 h-11 rounded-2xl bg-secondary flex items-center justify-center" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {duplicates.length > 0 ? (
          /* Someone has reported this already. Voting is offered first,
             because a second voice on the existing report is more useful
             than a second copy of it — but logging it anyway stays
             available, since the match might simply be wrong. */
          <>
            <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-4">
              <p className="text-xl font-bold">
                {duplicates.length === 1 ? "Someone's already reported this" : "This may already be reported"}
              </p>
              <p className="text-base text-muted-foreground mt-1">
                Add your vote instead — the more people it affects, the higher it climbs.
              </p>
            </div>

            <div className="space-y-3">
              {duplicates.map(d => (
                <div key={d.id} className="rounded-2xl border-2 border-border bg-card p-4">
                  <p className="text-lg font-bold">{d.title}</p>
                  <button
                    onClick={() => addVote(d.id)}
                    disabled={busy}
                    className="w-full h-14 mt-3 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.99] transition-all"
                  >
                    {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <ThumbsUp className="w-5 h-5" />}
                    This is mine too — add my vote
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={() => { setDuplicates([]); void submit(); }}
              disabled={busy}
              className="w-full h-14 rounded-2xl border-2 border-border text-lg font-bold hover:bg-secondary/50 transition-colors disabled:opacity-50"
            >
              No — mine's different, log it anyway
            </button>
          </>
        ) : mode === "choose" ? (
          <>
            <div className="space-y-3">
              <button
                onClick={() => setMode("idea")}
                className="w-full rounded-2xl border-2 border-border bg-card p-5 text-left hover:border-amber-400 active:scale-[0.99] transition-all"
              >
                <div className="flex items-center gap-3">
                  <Lightbulb className="w-8 h-8 text-amber-500 flex-shrink-0" />
                  <div>
                    <p className="text-xl font-bold">An improvement idea</p>
                    <p className="text-base text-muted-foreground mt-0.5">
                      Something that could be better. Take a <strong>before</strong> photo now.
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => setMode("done")}
                className="w-full rounded-2xl border-2 border-border bg-card p-5 text-left hover:border-emerald-500 active:scale-[0.99] transition-all"
              >
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 flex-shrink-0" />
                  <div>
                    <p className="text-xl font-bold">Something you've done</p>
                    <p className="text-base text-muted-foreground mt-0.5">
                      Already improved it. Take the <strong>after</strong> photo and send it for sign-off.
                    </p>
                  </div>
                </div>
              </button>
            </div>

            <button
              onClick={() => { close(); setLocation("/improvements"); }}
              className="w-full h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 transition-colors"
            >
              <ListChecks className="w-5 h-5" /> My improvements
            </button>
          </>
        ) : (
          <>
            {/* One thing at a time (Graeme, 2026-09-23): the form walks
                title → before photo → after photo. The step to do NOW wears
                brand green; later steps sit dimmed until it's their turn,
                and each photo step has a small skip. The optional note lives
                quietly at the bottom and only comes alive at the end. */}

            {/* Step 1 — the title. Dictate sits ON the header row: typing
                this on a shared iPad mid-shift is what stops improvements
                getting written down at all (Graeme, 2026-09-16). Tidying
                happens by itself when you stop talking. */}
            {stepDone.title ? (
              <button
                onClick={() => setTitleConfirmed(false)}
                className="w-full rounded-2xl border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 p-4 text-left flex items-center gap-3 active:scale-[0.99] transition-all"
              >
                <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                <span className="min-w-0">
                  <span className="block text-base font-bold truncate">{title}</span>
                  <span className="block text-sm text-muted-foreground">Tap to change it</span>
                </span>
              </button>
            ) : (
              <div className="space-y-3">
                <div className="rounded-2xl bg-primary text-primary-foreground px-4 py-3 flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-lg font-bold">
                    1 · {isIdea ? "What could be better?" : "What did you improve?"}
                  </span>
                  <DictateButton value={title} onChange={setTitle} context="title" />
                </div>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  autoFocus
                  placeholder={isIdea ? "e.g. The tape gun is never where you need it" : "e.g. Moved the tape gun to the wrapping bench"}
                  className="w-full h-16 px-4 rounded-2xl border-2 border-border bg-card text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <button
                  onClick={() => setTitleConfirmed(true)}
                  disabled={!title.trim()}
                  className="w-full h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-40 active:scale-[0.99] transition-all"
                >
                  Next <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            )}

            {/* The main shot — the before for an idea, the after for finished
                work. Deliberately NO capture attribute: forcing the camera
                open removes iOS's own "Photo Library" option, and the photo
                is often already on the roll (Graeme, 2026-09-09). Without it
                Safari shows its chooser — Take Photo / Photo Library — which
                is both paths from one button. */}
            <input
              ref={cameraRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                if (isIdea) { beforeFile.current = file; setBeforeTaken(true); }
                else { afterFile.current = file; setAfterTaken(true); }
              }}
            />
            {/* Done-mode before shot: the moment has passed, so no capture
                attribute — the camera roll is where that photo lives, if it
                exists at all (Graeme, 2026-08-28: ask for before FIRST when
                the work isn't completing an existing idea). */}
            <input
              ref={beforeLibraryRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) { beforeFile.current = file; setBeforeTaken(true); }
              }}
            />

            {/* Step 2 — the before photo. For an idea it's the camera, now,
                stood in front of the problem; for finished work it's the
                camera roll, if a before exists at all. */}
            {photoStep({
              n: 2,
              label: "Add the before photo",
              readyLabel: "Before photo ready — tap to change",
              skipLabel: isIdea ? "Skip for now" : "Skip — there isn't one",
              helper: isIdea
                ? "Take it now, while you're stood in front of it. A photo is fine — a short video is even better."
                : "From your camera roll if you snapped one earlier.",
              taken: beforeTaken,
              skipped: beforeSkipped,
              state: currentStep === "title" ? "locked" : currentStep === "before" ? "active" : "done",
              onPick: () => (isIdea ? cameraRef : beforeLibraryRef).current?.click(),
              onSkip: () => setBeforeSkipped(true),
            })}

            {/* Step 3 — the after photo (finished work only). */}
            {!isIdea && photoStep({
              n: 3,
              label: "Add the after photo",
              readyLabel: "After photo ready — tap to change",
              skipLabel: "Skip for now",
              helper: "Take it now or pick it from the camera roll. A photo is fine — a short video is even better.",
              taken: afterTaken,
              skipped: afterSkipped,
              state: currentStep === "title" || currentStep === "before" ? "locked" : currentStep === "after" ? "active" : "done",
              onPick: () => cameraRef.current?.click(),
              onSkip: () => setAfterSkipped(true),
            })}

            {/* The note — optional, quiet, at the bottom, and only alive once
                the steps are done so it never competes with them. */}
            <div className={cn(currentStep !== "ready" && "opacity-40 pointer-events-none")}>
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <label className="text-sm font-medium text-muted-foreground">
                  Anything to add? (optional)
                </label>
                <DictateButton value={description} onChange={setDescription} context="note" />
              </div>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={2}
                placeholder={isIdea ? "Why it's a problem" : "What was wrong before, and what's better now"}
                className="w-full px-4 py-3 rounded-2xl border-2 border-border bg-card text-base focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={() => setMode("choose")}
                className="h-14 rounded-2xl border-2 border-border text-lg font-bold hover:bg-secondary/50 transition-colors sm:order-1"
              >
                Back
              </button>
              <button
                onClick={checkThenSubmit}
                disabled={currentStep !== "ready" || busy}
                className={cn(
                  "h-16 sm:h-14 rounded-2xl bg-primary text-primary-foreground text-xl sm:text-lg font-bold flex items-center justify-center gap-3 disabled:opacity-40 active:scale-[0.99] transition-all sm:order-2",
                  currentStep === "ready" && "shadow-lg shadow-primary/20",
                )}
              >
                {busy ? <Loader2 className="w-6 h-6 animate-spin" /> : <ArrowRight className="w-6 h-6" />}
                {isIdea ? "Log the idea" : "Send for sign-off"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
