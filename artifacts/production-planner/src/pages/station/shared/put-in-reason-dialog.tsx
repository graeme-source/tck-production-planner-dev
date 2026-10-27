/**
 * "Why did it go in at a different time?" (Graeme, 2026-10-27). Shown when a
 * meat's first tray goes in more than the threshold away from the suggested
 * time, and again next time the station opens if it wasn't answered. One tap
 * on a big reason; "Other" asks for a few words. Closable — "Not now" leaves
 * it for later. The answer tells the learning whether this was the model's
 * fault or not (lib/production-schedule meat-daily-review.ts).
 */
import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { formatClock } from "@workspace/production-schedule";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useSavePutInReason, type PendingPutIn, type PutInReason } from "@/hooks/use-live-schedule";

const FALLBACK_REASONS: PutInReason[] = [
  { code: "oven_busy", label: "Oven busy", category: "capacity" },
  { code: "not_defrosted", label: "Meat not defrosted / not ready", category: "capacity" },
  { code: "short_staffed", label: "Short-staffed", category: "capacity" },
  { code: "builders_ahead", label: "Builders running ahead", category: "pace" },
  { code: "builders_behind", label: "Builders running behind", category: "pace" },
  { code: "other", label: "Other", category: "other" },
];

export function PutInReasonDialog({ planId, putIn, reasons, onClose }: {
  planId: number;
  putIn: PendingPutIn;
  reasons?: PutInReason[];
  onClose: () => void;
}) {
  const save = useSavePutInReason(planId);
  const [other, setOther] = useState(false);
  const [note, setNote] = useState("");
  const list = reasons?.length ? reasons : FALLBACK_REASONS;
  const dev = putIn.deviationMinutes ?? 0;

  const submit = (code: string, n?: string) => {
    save.mutate({ recordId: putIn.recordId, code, note: n }, {
      onSuccess: () => { toast({ title: "Thanks — noted" }); onClose(); },
      onError: (err) => toast({ title: "Couldn't save", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="bg-card rounded-2xl shadow-xl w-full max-w-xl max-h-[92dvh] flex flex-col">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-border">
          <div>
            <h2 className="text-xl font-bold">
              {putIn.ingredientName} went in {Math.abs(dev)} min {dev < 0 ? "early" : "late"}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {putIn.recipeName}: suggested {putIn.suggestedAtMinutes != null ? formatClock(putIn.suggestedAtMinutes) : "—"}, went in {formatClock(putIn.putInMinutes)}.
              What happened? It helps the times get right.
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-secondary" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto space-y-3">
          {!other ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {list.map(r => (
                <button
                  key={r.code}
                  disabled={save.isPending}
                  onClick={() => (r.code === "other" ? setOther(true) : submit(r.code))}
                  className={cn(
                    "min-h-[64px] rounded-xl border-2 border-border bg-background px-4 py-3 text-left text-base font-semibold",
                    "hover:border-primary active:scale-[0.98] transition disabled:opacity-50",
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <textarea
                autoFocus
                value={note}
                onChange={e => setNote(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="What happened?"
                className="w-full rounded-xl border border-border bg-background p-3 text-base"
              />
              <div className="flex gap-3">
                <button onClick={() => setOther(false)} className="flex-1 py-3 rounded-xl border border-border font-medium">Back</button>
                <button
                  onClick={() => submit("other", note.trim())}
                  disabled={!note.trim() || save.isPending}
                  className="flex-1 py-3 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
                >
                  {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="p-4 border-t border-border">
          <button onClick={onClose} className="w-full py-2.5 rounded-xl text-sm text-muted-foreground hover:bg-secondary">Not now — ask me later</button>
        </div>
      </div>
    </div>
  );
}
