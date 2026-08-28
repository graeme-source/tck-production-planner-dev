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
import { toast } from "@/hooks/use-toast";

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
  const beforeFile = useRef<File | null>(null);
  const afterFile = useRef<File | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const beforeLibraryRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const reset = () => {
    setMode("choose"); setTitle(""); setDescription("");
    setBeforeTaken(false); setAfterTaken(false);
    beforeFile.current = null; afterFile.current = null; setBusy(false);
    setDuplicates([]);
  };
  const close = () => { reset(); onClose(); };

  const isIdea = mode === "idea";

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

      for (const [phase, file] of [["before", beforeFile.current], ["after", afterFile.current]] as const) {
        if (!file) continue;
        const form = new FormData();
        form.append("file", file);
        form.append("phase", phase);
        await fetch(`${BASE}/api/improvements/${improvement.id}/attachments`, {
          method: "POST", credentials: "include", body: form,
        });
      }

      // Something you've already done, with an after shot, is finished work —
      // send it for sign-off rather than making them find it again.
      if (!isIdea && afterFile.current) {
        await fetch(`${BASE}/api/improvements/${improvement.id}/done`, {
          method: "POST", credentials: "include",
        });
      }

      queryClient.invalidateQueries({ queryKey: ["improvements"] });
      queryClient.invalidateQueries({ queryKey: ["improvement-scoreboard"] });
      toast({
        title: isIdea ? "Idea logged" : "Improvement logged",
        description: isIdea
          ? "Come back to it when it's done and add the after photo."
          : afterFile.current ? "A manager will sign it off." : "Add a photo to it so it can be signed off.",
      });
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
            <div>
              <label className="text-lg font-bold mb-2 block">
                {isIdea ? "What could be better?" : "What did you improve?"}
              </label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                autoFocus
                placeholder={isIdea ? "e.g. The tape gun is never where you need it" : "e.g. Moved the tape gun to the wrapping bench"}
                className="w-full h-16 px-4 rounded-2xl border-2 border-border bg-card text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            <div>
              <label className="text-lg font-bold mb-2 block">
                Anything to add? <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={2}
                placeholder={isIdea ? "Why it's a problem" : "What was wrong before, and what's better now"}
                className="w-full px-4 py-3 rounded-2xl border-2 border-border bg-card text-lg focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
              />
            </div>

            {/* Live camera — the before shot for an idea, the after shot for
                finished work. */}
            <input
              ref={cameraRef}
              type="file"
              accept="image/*,video/*"
              capture="environment"
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

            {!isIdea && (
              <button
                onClick={() => beforeLibraryRef.current?.click()}
                className={cn(
                  "w-full h-16 rounded-2xl border-2 text-lg font-bold flex items-center justify-center gap-3 transition-colors",
                  beforeTaken
                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400"
                    : "border-dashed border-border hover:bg-secondary/50",
                )}
              >
                {beforeTaken ? <CheckCircle2 className="w-6 h-6" /> : <Camera className="w-6 h-6" />}
                {beforeTaken ? "Before photo ready — tap to change" : "Add the before photo"}
              </button>
            )}
            {!isIdea && !beforeTaken && (
              <p className="text-sm text-muted-foreground text-center -mt-1">
                From your camera roll if you snapped one earlier — skip it if there isn't one.
              </p>
            )}

            <button
              onClick={() => cameraRef.current?.click()}
              className={cn(
                "w-full h-16 rounded-2xl border-2 text-lg font-bold flex items-center justify-center gap-3 transition-colors",
                (isIdea ? beforeTaken : afterTaken)
                  ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400"
                  : "border-dashed border-border hover:bg-secondary/50",
              )}
            >
              {(isIdea ? beforeTaken : afterTaken) ? <CheckCircle2 className="w-6 h-6" /> : <Camera className="w-6 h-6" />}
              {isIdea
                ? (beforeTaken ? "Before photo ready — tap to retake" : "Take the before photo")
                : (afterTaken ? "After photo ready — tap to retake" : "Take the after photo")}
            </button>
            <p className="text-sm text-muted-foreground text-center -mt-1">
              A photo is fine. A short video is even better.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={() => setMode("choose")}
                className="h-14 rounded-2xl border-2 border-border text-lg font-bold hover:bg-secondary/50 transition-colors sm:order-1"
              >
                Back
              </button>
              <button
                onClick={checkThenSubmit}
                disabled={!title.trim() || busy}
                className="h-16 sm:h-14 rounded-2xl bg-primary text-primary-foreground text-xl sm:text-lg font-bold flex items-center justify-center gap-3 disabled:opacity-50 active:scale-[0.99] transition-all shadow-lg shadow-primary/20 sm:order-2"
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
