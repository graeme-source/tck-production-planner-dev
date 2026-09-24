/**
 * SOP review player (station training, 2026-09-24) — one step at a time,
 * big type, photo or video beside it, and "I've read and understood" only
 * once they've paged through to the last step. That tap records a dated
 * review of THIS version of the SOP for the signed-in person.
 *
 * Used by the station gate and the station training matrix. Always closable
 * (X) — closing just means not reviewed yet.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { X, ChevronLeft, ChevronRight, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { detectVideoEmbed } from "@/components/standards-sops-dialog";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SopStep {
  id: number;
  position: number;
  description: string;
  hasImage: boolean;
  hasVideo: boolean;
}

interface SopDetail {
  id: number;
  title: string;
  steps: SopStep[];
}

export function SopReviewPlayer({ sopId, version, source, station, onClose, onReviewed }: {
  sopId: number;
  /** The version the person is being shown — recorded as what they read. */
  version: number;
  source: "station_gate" | "matrix";
  station?: string;
  onClose: () => void;
  onReviewed: () => void;
}) {
  const [index, setIndex] = useState(0);
  const { data: sop, isLoading, isError } = useQuery<SopDetail>({
    queryKey: ["sop-review", sopId, version],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/standards/${sopId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Couldn't load the SOP");
      return res.json();
    },
  });

  const confirm = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/station-training/reviews`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sopId, version, source, station }),
      });
      if (!res.ok) throw new Error("Couldn't save your review");
      return res.json() as Promise<{ status: string }>;
    },
    onSuccess: () => {
      toast({ title: "Trained", description: sop?.title });
      onReviewed();
    },
    onError: (e: Error) => toast({ title: e.message, description: "Check the connection and tap it again.", variant: "destructive" }),
  });

  const steps = sop?.steps ?? [];
  const step = steps[index];
  const atLast = steps.length > 0 && index === steps.length - 1;
  const embed = step && !step.hasVideo ? detectVideoEmbed(step.description) : null;
  const hasMedia = !!step && (step.hasVideo || step.hasImage || embed != null);

  return createPortal(
    <div className="fixed inset-0 z-[320] bg-background flex flex-col" role="dialog" aria-modal="true" aria-label={sop?.title ?? "SOP review"}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Review this SOP</p>
          <h2 className="text-xl font-bold truncate">{sop?.title ?? "Loading…"}</h2>
        </div>
        {steps.length > 0 && (
          <span className="text-base font-semibold text-muted-foreground tabular-nums flex-shrink-0">
            Step {index + 1} of {steps.length}
          </span>
        )}
        <button onClick={onClose} className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center flex-shrink-0" aria-label="Close">
          <X className="w-6 h-6" />
        </button>
      </div>

      {steps.length > 0 && (
        <div className="flex gap-1 px-4 pt-2">
          {steps.map((s, i) => (
            <div key={s.id} className={cn("h-1.5 flex-1 rounded-full", i <= index ? "bg-primary" : "bg-secondary")} />
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {isLoading && <div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>}
        {isError && <p className="p-8 text-lg text-destructive">Couldn't load this SOP. Close and try again.</p>}
        {step && (
          <div className={cn("min-h-full flex flex-col gap-6 p-6", hasMedia && "lg:flex-row lg:items-center")}>
            {hasMedia && (
              <div className="lg:w-3/5 flex items-center justify-center bg-secondary/30 rounded-2xl p-4">
                {step.hasVideo ? (
                  <video key={step.id} src={`${BASE}/api/standards/steps/${step.id}/video`} controls playsInline className="max-w-full max-h-[50vh] lg:max-h-[70vh] rounded-lg bg-black" />
                ) : embed?.kind === "iframe" ? (
                  <div className="w-full aspect-video">
                    <iframe src={embed.src} title={embed.title} className="w-full h-full rounded-lg border-0" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
                  </div>
                ) : embed ? (
                  <video key={step.id} src={embed.src} controls playsInline className="max-w-full max-h-[50vh] rounded-lg bg-black" />
                ) : (
                  <img src={`${BASE}/api/standards/steps/${step.id}/image`} alt={`Step ${index + 1}`} className="max-w-full max-h-[50vh] lg:max-h-[70vh] object-contain rounded-lg" />
                )}
              </div>
            )}
            <div className="flex-1 flex items-center">
              <p className="text-2xl md:text-3xl leading-relaxed font-medium whitespace-pre-wrap">
                {embed ? <span className="text-muted-foreground italic">Video step — watch the player.</span> : step.description}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border p-4 flex gap-3">
        <button
          onClick={() => setIndex(i => Math.max(0, i - 1))}
          disabled={index === 0}
          className="h-16 px-6 rounded-2xl border-2 border-border text-lg font-bold flex items-center gap-2 disabled:opacity-30"
        >
          <ChevronLeft className="w-6 h-6" /> Back
        </button>
        {atLast ? (
          <button
            onClick={() => confirm.mutate()}
            disabled={confirm.isPending}
            className="flex-1 h-16 rounded-2xl bg-primary text-primary-foreground text-xl font-bold flex items-center justify-center gap-3 shadow-lg shadow-primary/20 disabled:opacity-60"
          >
            {confirm.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : <CheckCircle2 className="w-7 h-7" />}
            I've read and understood
          </button>
        ) : (
          <button
            onClick={() => setIndex(i => Math.min(steps.length - 1, i + 1))}
            disabled={steps.length === 0}
            className="flex-1 h-16 rounded-2xl bg-primary text-primary-foreground text-xl font-bold flex items-center justify-center gap-2 disabled:opacity-40"
          >
            Next step <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
