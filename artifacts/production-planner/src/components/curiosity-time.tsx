/**
 * Curiosity Time — the digital version of the "take a sheet and walk the
 * area" waste-spotting exercise (Lean Made Simple step 5, Objective E).
 * Lives on the station checklist. One walk per station per plan: eight big
 * full-screen cards, one per waste in the book's order, each asking "can
 * you see this happening here?" with a camera button when the answer is yes.
 *
 * The wastes come from the server (lean-corpus.ts) so this file never
 * carries its own copy of the terminology law. Every answer autosaves the
 * moment it's tapped, with a visible Saved tick — closing the flow
 * mid-walk loses nothing.
 *
 * Hidden entirely unless the curiosity_time_enabled switch is on (the
 * toggle card lives in the meeting page's curriculum editor).
 */
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Camera, Check, CheckCircle2, ChevronLeft, ChevronRight, Image as ImageIcon,
  Loader2, Search, Trash2, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Waste {
  name: string;
  definition: string;
  kitchenExample: string;
}

interface Observation {
  id: number;
  wasteName: string;
  spotted: boolean;
  note: string | null;
  hasPhoto: boolean;
  updatedAt: string;
}

interface Walk {
  id: number;
  startedByName: string;
  completedAt: string | null;
  observations: Observation[];
  progress: { answered: number; spotted: number; total: number; complete: boolean };
}

interface WalkResponse {
  enabled: boolean;
  wastes: Waste[];
  walk: Walk | null;
}

async function jsonOrThrow(res: globalThis.Response) {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

interface Props {
  stationType: string;
  planId: number;
}

export function CuriosityTimeCard({ stationType, planId }: Props) {
  const queryClient = useQueryClient();
  const queryKey = ["curiosity-walk", stationType, planId];
  const { data } = useQuery<WalkResponse>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(
        `${BASE}/api/curiosity/walk?planId=${planId}&station=${encodeURIComponent(stationType)}`,
        { credentials: "include" },
      );
      return jsonOrThrow(res);
    },
  });

  const [openWalk, setOpenWalk] = useState<Walk | null>(null);

  const startWalk = useMutation({
    mutationFn: async (): Promise<Walk> => {
      const res = await fetch(`${BASE}/api/curiosity/walks`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, stationType }),
      });
      return jsonOrThrow(res);
    },
    onSuccess: (walk) => setOpenWalk(walk),
    onError: (err: Error) => toast({ title: "Couldn't start the walk", description: err.message, variant: "destructive" }),
  });

  if (!data?.enabled || data.wastes.length === 0) return null;

  const walk = data.walk;
  const done = Boolean(walk?.completedAt);
  const progress = walk?.progress;

  const close = () => {
    setOpenWalk(null);
    queryClient.invalidateQueries({ queryKey });
  };

  return (
    <>
      <div className="bg-card border-2 border-primary/30 rounded-xl px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Search className="w-6 h-6 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold">Curiosity Time</h2>
              {done && progress && (
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 rounded-full px-2.5 py-0.5">
                  <CheckCircle2 className="w-4 h-4" />
                  Done — {progress.spotted} spotted
                </span>
              )}
            </div>
            <p className="text-base text-muted-foreground mt-0.5">
              {done && walk
                ? `Walked today by ${walk.startedByName}. Tap to look back at what was spotted.`
                : "Take a slow walk round your area. Can you spot any of the 8 wastes? If you can, snap a photo."}
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            if (walk) setOpenWalk(walk);
            else startWalk.mutate();
          }}
          disabled={startWalk.isPending}
          className={cn(
            "mt-3 w-full h-16 rounded-2xl text-xl font-bold flex items-center justify-center gap-3 transition-all active:scale-[0.99] disabled:opacity-50",
            done
              ? "border-2 border-border text-foreground hover:bg-secondary/50"
              : "bg-primary text-primary-foreground",
          )}
        >
          {startWalk.isPending ? (
            <Loader2 className="w-6 h-6 animate-spin" />
          ) : done ? (
            "See today's walk"
          ) : walk && progress && progress.answered > 0 ? (
            `Carry on — ${progress.answered} of ${progress.total} done`
          ) : (
            "Start the walk"
          )}
        </button>
      </div>

      {openWalk && (
        <CuriosityWalkFlow
          walk={openWalk}
          wastes={data.wastes}
          onClose={close}
        />
      )}
    </>
  );
}

// ─── The full-screen guided walk ─────────────────────────────────────

interface AnswerState {
  obsId: number | null;
  spotted: boolean | null;
  note: string;
  hasPhoto: boolean;
  photoVersion: number;
}

function seedAnswers(wastes: Waste[], walk: Walk): Record<string, AnswerState> {
  const answers: Record<string, AnswerState> = {};
  for (const w of wastes) {
    const obs = walk.observations.find(o => o.wasteName === w.name);
    answers[w.name] = obs
      ? { obsId: obs.id, spotted: obs.spotted, note: obs.note ?? "", hasPhoto: obs.hasPhoto, photoVersion: 0 }
      : { obsId: null, spotted: null, note: "", hasPhoto: false, photoVersion: 0 };
  }
  return answers;
}

function CuriosityWalkFlow({ walk, wastes, onClose }: { walk: Walk; wastes: Waste[]; onClose: () => void }) {
  const [answers, setAnswers] = useState<Record<string, AnswerState>>(() => seedAnswers(wastes, walk));
  // Mirror for the debounced note save — the timeout must read the answer
  // as it is when it fires, not as it was when the keystroke scheduled it.
  const answersRef = useRef(answers);
  answersRef.current = answers;
  // Start at the first unanswered waste; a finished walk opens on the summary.
  const [step, setStep] = useState<number>(() => {
    if (walk.completedAt) return wastes.length;
    const firstUnanswered = wastes.findIndex(w => !walk.observations.some(o => o.wasteName === w.name));
    return firstUnanswered === -1 ? wastes.length : firstUnanswered;
  });
  const [saving, setSaving] = useState(0);
  const [savedOnce, setSavedOnce] = useState(false);
  const noteTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const patch = (wasteName: string, changes: Partial<AnswerState>) =>
    setAnswers(prev => ({ ...prev, [wasteName]: { ...prev[wasteName], ...changes } }));

  const saveObservation = async (wasteName: string, spotted: boolean, note: string) => {
    setSaving(n => n + 1);
    try {
      const res = await fetch(`${BASE}/api/curiosity/walks/${walk.id}/observations`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wasteName, spotted, note: note || null }),
      });
      const row: Observation = await jsonOrThrow(res);
      patch(wasteName, { obsId: row.id });
      setSavedOnce(true);
    } catch (err) {
      toast({ title: "Couldn't save", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSaving(n => n - 1);
    }
  };

  const handleAnswer = (waste: Waste, spotted: boolean) => {
    const current = answers[waste.name];
    patch(waste.name, { spotted });
    void saveObservation(waste.name, spotted, current.note);
    // "Not here today" needs nothing else from this screen — move on so the
    // walk keeps its rhythm. A "yes" stays put for the photo.
    if (!spotted && step < wastes.length) {
      setStep(s => Math.min(s + 1, wastes.length));
    }
  };

  const handleNote = (waste: Waste, note: string) => {
    patch(waste.name, { note });
    const existing = noteTimers.current[waste.name];
    if (existing) clearTimeout(existing);
    noteTimers.current[waste.name] = setTimeout(() => {
      const a = answersRef.current[waste.name];
      if (a?.spotted === null || a?.spotted === undefined) return;
      void saveObservation(waste.name, a.spotted, a.note);
    }, 700);
  };

  const handlePhotoFile = async (waste: Waste, file: File) => {
    const obsId = answers[waste.name]?.obsId;
    if (!obsId) return;
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "Photo too big", description: "Max 10MB — try again without Live Photo.", variant: "destructive" });
      return;
    }
    setSaving(n => n + 1);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${BASE}/api/curiosity/observations/${obsId}/photo`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      await jsonOrThrow(res);
      setAnswers(prev => ({
        ...prev,
        [waste.name]: { ...prev[waste.name], hasPhoto: true, photoVersion: prev[waste.name].photoVersion + 1 },
      }));
      setSavedOnce(true);
    } catch (err) {
      toast({ title: "Couldn't save the photo", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSaving(n => n - 1);
    }
  };

  const removePhoto = async (waste: Waste) => {
    const obsId = answers[waste.name]?.obsId;
    if (!obsId) return;
    setSaving(n => n + 1);
    try {
      const res = await fetch(`${BASE}/api/curiosity/observations/${obsId}/photo`, {
        method: "DELETE",
        credentials: "include",
      });
      await jsonOrThrow(res);
      patch(waste.name, { hasPhoto: false });
    } catch (err) {
      toast({ title: "Couldn't remove the photo", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSaving(n => n - 1);
    }
  };

  const [finishing, setFinishing] = useState(false);
  const finishWalk = async () => {
    setFinishing(true);
    try {
      const res = await fetch(`${BASE}/api/curiosity/walks/${walk.id}/complete`, {
        method: "POST",
        credentials: "include",
      });
      await jsonOrThrow(res);
      const spotted = Object.values(answers).filter(a => a.spotted === true).length;
      toast({
        title: "Curiosity Time logged",
        description: spotted > 0
          ? `You spotted ${spotted} waste${spotted === 1 ? "" : "s"} — that's the skill. Nice work.`
          : "Nothing spotted today — keep looking, waste hides well.",
      });
      onClose();
    } catch (err) {
      toast({ title: "Couldn't finish the walk", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setFinishing(false);
    }
  };

  const onSummary = step >= wastes.length;
  const waste = onSummary ? null : wastes[step];
  const answer = waste ? answers[waste.name] : null;

  // Portalled to <body>: the station layout has transformed ancestors, which
  // would trap position:fixed and leave the page showing through underneath.
  return createPortal(
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header: pause (nothing is lost — every answer is already saved),
          title, and the visible save state the charter requires. */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-base font-medium text-muted-foreground hover:text-foreground px-2 py-1.5"
        >
          <X className="w-5 h-5" />
          Pause
        </button>
        <div className="flex items-center gap-2">
          <Search className="w-5 h-5 text-primary" />
          <span className="text-lg font-bold">Curiosity Time</span>
        </div>
        <div className="w-24 text-right text-sm font-medium">
          {saving > 0 ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Saving…
            </span>
          ) : savedOnce ? (
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <Check className="w-4 h-4" /> Saved
            </span>
          ) : null}
        </div>
      </div>

      {/* Progress dots — tap to jump */}
      <div className="flex items-center justify-center gap-2.5 py-3 flex-shrink-0">
        {wastes.map((w, i) => {
          const a = answers[w.name];
          return (
            <button
              key={w.name}
              onClick={() => setStep(i)}
              aria-label={w.name}
              className={cn(
                "w-4 h-4 rounded-full border-2 transition-all",
                i === step && !onSummary ? "scale-125 border-primary" : "border-transparent",
                a.spotted === true ? "bg-emerald-500" : a.spotted === false ? "bg-muted-foreground/40" : "bg-secondary border-border",
              )}
            />
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 pb-8 w-full">
          {waste && answer ? (
            <>
              <p className="text-base font-bold uppercase tracking-wider text-muted-foreground">
                Waste {step + 1} of {wastes.length}
              </p>
              <h1 className="text-4xl font-display font-bold mt-1">{waste.name}</h1>
              <p className="text-2xl text-foreground/90 mt-3 leading-snug">{waste.definition}</p>
              <div className="bg-secondary/50 rounded-xl px-4 py-3 mt-4">
                <p className="text-lg text-muted-foreground italic">For example: {waste.kitchenExample}</p>
              </div>

              <p className="text-xl font-semibold mt-6">Take a look around. Can you see this happening here?</p>

              <div className="grid grid-cols-1 gap-3 mt-4">
                <button
                  onClick={() => handleAnswer(waste, true)}
                  className={cn(
                    "h-20 rounded-2xl text-2xl font-bold flex items-center justify-center gap-3 transition-all active:scale-[0.99] border-2",
                    answer.spotted === true
                      ? "bg-emerald-600 border-emerald-600 text-white"
                      : "border-border hover:bg-secondary/50",
                  )}
                >
                  <Search className="w-7 h-7" />
                  Yes — I can see it
                </button>
                <button
                  onClick={() => handleAnswer(waste, false)}
                  className={cn(
                    "h-20 rounded-2xl text-2xl font-bold flex items-center justify-center gap-3 transition-all active:scale-[0.99] border-2",
                    answer.spotted === false
                      ? "bg-secondary border-muted-foreground/50 text-foreground"
                      : "border-border hover:bg-secondary/50",
                  )}
                >
                  Not here today
                </button>
              </div>

              {answer.spotted === true && (
                <div className="mt-5 space-y-3">
                  {answer.hasPhoto && answer.obsId ? (
                    <div className="space-y-2">
                      <img
                        src={`${BASE}/api/curiosity/observations/${answer.obsId}/photo?v=${answer.photoVersion}`}
                        alt={`What was spotted for ${waste.name}`}
                        className="w-full max-h-72 object-contain rounded-xl border border-border bg-secondary/30"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => cameraRef.current?.click()}
                          className="flex-1 h-12 rounded-xl border-2 border-border text-base font-semibold flex items-center justify-center gap-2 hover:bg-secondary/50"
                        >
                          <Camera className="w-5 h-5" /> Retake
                        </button>
                        <button
                          onClick={() => void removePhoto(waste)}
                          className="h-12 px-4 rounded-xl border-2 border-border text-base font-semibold flex items-center justify-center gap-2 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="w-5 h-5" /> Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => cameraRef.current?.click()}
                        disabled={!answer.obsId}
                        className="w-full h-16 rounded-2xl bg-primary text-primary-foreground text-xl font-bold flex items-center justify-center gap-3 transition-all active:scale-[0.99] disabled:opacity-50"
                      >
                        <Camera className="w-6 h-6" />
                        Take a photo of it
                      </button>
                      <button
                        onClick={() => libraryRef.current?.click()}
                        disabled={!answer.obsId}
                        className="w-full h-12 rounded-xl text-base font-medium text-muted-foreground hover:text-foreground flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        <ImageIcon className="w-5 h-5" />
                        Choose from photos instead
                      </button>
                    </>
                  )}
                  <textarea
                    value={answer.note}
                    onChange={e => handleNote(waste, e.target.value)}
                    placeholder="What did you see? (optional)"
                    rows={2}
                    className="w-full px-4 py-3 border border-border rounded-xl text-lg bg-background resize-none"
                  />
                </div>
              )}
            </>
          ) : (
            <WalkSummary
              wastes={wastes}
              answers={answers}
              onJump={setStep}
              onFinish={() => void finishWalk()}
              finishing={finishing}
              alreadyDone={Boolean(walk.completedAt)}
              onClose={onClose}
            />
          )}
        </div>
      </div>

      {/* Footer nav */}
      {!onSummary && (
        <div className="flex items-center gap-3 px-6 py-4 border-t border-border flex-shrink-0 max-w-2xl mx-auto w-full">
          <button
            onClick={() => setStep(s => Math.max(0, s - 1))}
            disabled={step === 0}
            className="h-14 px-5 rounded-2xl border-2 border-border text-lg font-semibold flex items-center gap-1.5 disabled:opacity-40"
          >
            <ChevronLeft className="w-6 h-6" /> Back
          </button>
          <button
            onClick={() => setStep(s => s + 1)}
            disabled={answer?.spotted === null || answer?.spotted === undefined}
            className="flex-1 h-14 rounded-2xl bg-primary text-primary-foreground text-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.99] disabled:opacity-50"
          >
            {step === wastes.length - 1 ? "See summary" : "Next waste"}
            <ChevronRight className="w-6 h-6" />
          </button>
        </div>
      )}

      {/* Hidden camera / library inputs. Cleared after read so retaking the
          same photo re-fires onChange (house pattern). */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file && waste) void handlePhotoFile(waste, file);
        }}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file && waste) void handlePhotoFile(waste, file);
        }}
      />
    </div>,
    document.body,
  );
}

function WalkSummary({
  wastes, answers, onJump, onFinish, finishing, alreadyDone, onClose,
}: {
  wastes: Waste[];
  answers: Record<string, AnswerState>;
  onJump: (step: number) => void;
  onFinish: () => void;
  finishing: boolean;
  alreadyDone: boolean;
  onClose: () => void;
}) {
  const spotted = wastes.filter(w => answers[w.name]?.spotted === true);
  const unanswered = wastes.filter(w => answers[w.name]?.spotted === null || answers[w.name]?.spotted === undefined);
  return (
    <div>
      <h1 className="text-3xl font-display font-bold mt-2">
        {spotted.length > 0
          ? `You spotted ${spotted.length} of the 8 wastes`
          : "Nothing spotted this time"}
      </h1>
      <p className="text-lg text-muted-foreground mt-1">
        {spotted.length > 0
          ? "Seeing waste is the first step to removing it — bring these to the morning meeting."
          : "That's OK — the skill is in the looking. Waste hides well."}
      </p>

      <div className="mt-5 space-y-2">
        {wastes.map((w, i) => {
          const a = answers[w.name];
          return (
            <button
              key={w.name}
              onClick={() => onJump(i)}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-border text-left hover:bg-secondary/50 transition-colors"
            >
              {a?.spotted === true ? (
                <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
              ) : a?.spotted === false ? (
                <Check className="w-6 h-6 text-muted-foreground/50 flex-shrink-0" />
              ) : (
                <span className="w-6 h-6 rounded-full border-2 border-border flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-lg font-bold">{w.name}</p>
                <p className="text-sm text-muted-foreground">
                  {a?.spotted === true ? (a.note ? a.note : "Spotted") : a?.spotted === false ? "Not seen today" : "Not answered yet"}
                </p>
              </div>
              {a?.spotted === true && a.hasPhoto && a.obsId && (
                <img
                  src={`${BASE}/api/curiosity/observations/${a.obsId}/photo?v=${a.photoVersion}`}
                  alt=""
                  className="w-14 h-14 object-cover rounded-lg border border-border flex-shrink-0"
                />
              )}
            </button>
          );
        })}
      </div>

      {unanswered.length > 0 && (
        <p className="text-base text-amber-700 dark:text-amber-300 mt-4">
          {unanswered.length} waste{unanswered.length === 1 ? "" : "s"} not answered yet — tap one above to go back to it.
        </p>
      )}

      <button
        onClick={alreadyDone ? onClose : onFinish}
        disabled={finishing || (!alreadyDone && unanswered.length > 0)}
        className="mt-6 w-full h-16 rounded-2xl bg-primary text-primary-foreground text-xl font-bold flex items-center justify-center gap-3 transition-all active:scale-[0.99] disabled:opacity-50"
      >
        {finishing ? <Loader2 className="w-6 h-6 animate-spin" /> : alreadyDone ? "Close" : "Finish Curiosity Time"}
      </button>
    </div>
  );
}
