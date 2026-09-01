// "Record Issue" — the other half of the quick-actions dock (Graeme,
// 2026-08-28). Same shape as Record Improvement: one question that actually
// changes what happens, then the details.
//
//   Factory issue → something physical on the floor. Goes to the team.
//   System issue  → this app misbehaving on the iPad. Goes to whoever fixes
//                   the software. They're different people, which is the
//                   whole reason for asking.
//
// Safety is a separate toggle rather than a category, because a safety
// problem can be either kind, and it's the flag that decides how loudly it
// gets escalated.
//
// An issue can also be an improvement opportunity — a safety problem gets
// fixed by improving something — so the last step offers that in one tap
// rather than making anyone re-type it in the other modal.

import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Factory, Tablet, ShieldAlert, Camera, Image as ImageIcon, Loader2, X, ArrowRight, Lightbulb, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { summariseUploadFailures, type UploadAttempt } from "@/lib/upload-failures";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Area = "factory" | "system";

export function RecordIssueModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [area, setArea] = useState<Area | null>(null);
  const [description, setDescription] = useState("");
  const [isSafety, setIsSafety] = useState(false);
  const [alsoImprovement, setAlsoImprovement] = useState(false);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const cameraRef = useRef<HTMLInputElement>(null);
  const deviceRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const reset = () => {
    setArea(null); setDescription(""); setIsSafety(false); setAlsoImprovement(false);
    setFiles([]); setBusy(false);
  };
  const close = () => { reset(); onClose(); };

  const submit = async () => {
    if (!description.trim() || !area) return;
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/andon`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Safety is its own category in the existing andon model; otherwise
          // a factory problem is equipment and a system one is 'other'.
          category: isSafety ? "safety" : area === "factory" ? "equipment" : "other",
          // Safety issues shout; everything else is a normal report.
          severity: isSafety ? "red" : "yellow",
          description: description.trim(),
          station: area === "system" ? "App / iPad" : "general",
          area,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't report it");
      const issue = await res.json();

      let improvementId: number | null = null;
      if (alsoImprovement) {
        const tagged = await fetch(`${BASE}/api/andon/${issue.id}/tag-improvement`, {
          method: "POST", credentials: "include",
        });
        if (tagged.ok) improvementId = (await tagged.json()).improvementId ?? null;
      }

      // Everything attaches to the issue itself — that's the report's
      // evidence. When it's also logged as an improvement, the first shot
      // doubles as the improvement's "before" so both views are complete.
      // Every upload's answer is checked — a failed one used to vanish
      // without a word (same silent loss that cost improvement 33 its
      // "before" video, 2026-08-27).
      const attempts: UploadAttempt[] = [];
      for (const [i, file] of files.entries()) {
        const form = new FormData();
        form.append("file", file);
        const up = await fetch(`${BASE}/api/andon/${issue.id}/attachments`, {
          method: "POST", credentials: "include", body: form,
        }).catch(() => null);
        attempts.push({
          label: files.length === 1 ? "your photo" : `photo ${i + 1}`,
          ok: Boolean(up?.ok),
          error: up && !up.ok ? ((await up.json().catch(() => ({}))) as { error?: string }).error : undefined,
        });
        if (i === 0 && improvementId) {
          const impForm = new FormData();
          impForm.append("file", file);
          impForm.append("phase", "before");
          const impUp = await fetch(`${BASE}/api/improvements/${improvementId}/attachments`, {
            method: "POST", credentials: "include", body: impForm,
          }).catch(() => null);
          attempts.push({
            label: "the improvement's BEFORE shot",
            ok: Boolean(impUp?.ok),
            error: impUp && !impUp.ok ? ((await impUp.json().catch(() => ({}))) as { error?: string }).error : undefined,
          });
        }
      }
      const uploadFailure = summariseUploadFailures(attempts, "the report");

      queryClient.invalidateQueries({ queryKey: ["andon"] });
      queryClient.invalidateQueries({ queryKey: ["improvements"] });
      if (uploadFailure) {
        toast({
          title: isSafety ? "Safety issue reported — but a photo was lost" : "Reported — but a photo was lost",
          description: uploadFailure,
          variant: "destructive",
        });
      } else {
        toast({
          title: isSafety ? "Safety issue reported" : "Issue reported",
          description: improvementId
            ? "It's also logged as an improvement to work on."
            : area === "system" ? "Sent to whoever looks after the app." : "Sent to the team.",
        });
      }
      close();
    } catch (e) {
      toast({ title: "Couldn't report it", description: (e as Error).message, variant: "destructive" });
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
          <h2 className="text-2xl font-bold">{area === null ? "Report an issue" : area === "system" ? "App or iPad problem" : "Factory problem"}</h2>
          <button onClick={close} className="w-11 h-11 rounded-2xl bg-secondary flex items-center justify-center" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {area === null ? (
          <div className="space-y-3">
            <button
              onClick={() => setArea("factory")}
              className="w-full rounded-2xl border-2 border-border bg-card p-5 text-left hover:border-primary active:scale-[0.99] transition-all"
            >
              <div className="flex items-center gap-3">
                <Factory className="w-8 h-8 text-primary flex-shrink-0" />
                <div>
                  <p className="text-xl font-bold">Something in the factory</p>
                  <p className="text-base text-muted-foreground mt-0.5">Equipment, a mess, something unsafe, something broken.</p>
                </div>
              </div>
            </button>

            <button
              onClick={() => setArea("system")}
              className="w-full rounded-2xl border-2 border-border bg-card p-5 text-left hover:border-blue-500 active:scale-[0.99] transition-all"
            >
              <div className="flex items-center gap-3">
                <Tablet className="w-8 h-8 text-blue-500 flex-shrink-0" />
                <div>
                  <p className="text-xl font-bold">Something in the app</p>
                  <p className="text-base text-muted-foreground mt-0.5">The iPad, this software — wrong numbers, a button that won't work.</p>
                </div>
              </div>
            </button>
          </div>
        ) : (
          <>
            <div>
              <label className="text-lg font-bold mb-2 block">What's wrong?</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
                autoFocus
                placeholder={area === "system" ? "What were you doing, and what happened?" : "What's the problem, and where?"}
                className="w-full px-4 py-3 rounded-2xl border-2 border-border bg-card text-lg focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
              />
            </div>

            <button
              onClick={() => setIsSafety(s => !s)}
              className={cn(
                "w-full h-16 rounded-2xl border-2 text-lg font-bold flex items-center justify-center gap-3 transition-colors",
                isSafety
                  ? "border-destructive bg-destructive/10 text-destructive"
                  : "border-border hover:bg-secondary/50",
              )}
            >
              <ShieldAlert className="w-6 h-6" />
              {isSafety ? "Safety issue — flagged" : "Is this a safety issue?"}
            </button>

            <button
              onClick={() => setAlsoImprovement(v => !v)}
              className={cn(
                "w-full h-16 rounded-2xl border-2 text-lg font-bold flex items-center justify-center gap-3 transition-colors",
                alsoImprovement
                  ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300"
                  : "border-border hover:bg-secondary/50",
              )}
            >
              {alsoImprovement ? <CheckCircle2 className="w-6 h-6" /> : <Lightbulb className="w-6 h-6" />}
              {alsoImprovement ? "Also an improvement to make" : "Could this be an improvement?"}
            </button>

            {/* Evidence — always offered, not only for improvements. A photo
                of the problem, a screenshot of the app misbehaving, a short
                clip: whatever shows it (Graeme, 2026-08-28). Camera for
                what's in front of you; the device picker for screenshots
                already taken. */}
            <input
              ref={cameraRef}
              type="file"
              accept="image/*,video/*"
              capture="environment"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) setFiles(f => [...f, file]);
              }}
            />
            <input
              ref={deviceRef}
              type="file"
              accept="image/*,video/*"
              multiple
              className="hidden"
              onChange={e => {
                const picked = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (picked.length) setFiles(f => [...f, ...picked]);
              }}
            />
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => cameraRef.current?.click()}
                className="h-16 rounded-2xl border-2 border-dashed border-border text-base font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 transition-colors"
              >
                <Camera className="w-5 h-5" /> Take photo / video
              </button>
              <button
                onClick={() => deviceRef.current?.click()}
                className="h-16 rounded-2xl border-2 border-dashed border-border text-base font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 transition-colors"
              >
                <ImageIcon className="w-5 h-5" /> Add from device
              </button>
            </div>
            {area === "system" && files.length === 0 && (
              <p className="text-sm text-muted-foreground text-center -mt-1">
                A screenshot of what went wrong helps enormously.
              </p>
            )}
            {files.length > 0 && (
              <div className="space-y-2">
                {files.map((f, i) => (
                  <div key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-2xl border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                    <span className="flex-1 text-base font-bold truncate">{f.name || (f.type.startsWith("video") ? "Video" : "Photo")}</span>
                    <button
                      onClick={() => setFiles(cur => cur.filter((_, j) => j !== i))}
                      className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0"
                      aria-label="Remove"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={() => setArea(null)}
                className="h-14 rounded-2xl border-2 border-border text-lg font-bold hover:bg-secondary/50 transition-colors sm:order-1"
              >
                Back
              </button>
              <button
                onClick={submit}
                disabled={!description.trim() || busy}
                className="h-16 sm:h-14 rounded-2xl bg-primary text-primary-foreground text-xl sm:text-lg font-bold flex items-center justify-center gap-3 disabled:opacity-50 active:scale-[0.99] transition-all shadow-lg shadow-primary/20 sm:order-2"
              >
                {busy ? <Loader2 className="w-6 h-6 animate-spin" /> : <ArrowRight className="w-6 h-6" />}
                Report it
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
