/**
 * Preview a week's lessons full screen, exactly as the morning meeting shows
 * them (Graeme, 20 Nov 2026) — the same LeanLessonSlide the deck renders.
 * Arrow keys or the buttons move between days; Esc or X closes. Its own
 * Radix dialog so it stacks cleanly on top of the week editor.
 */
import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { LeanLessonSlide, type LeanSlideLesson } from "@/components/lean-lesson-slide";

export function LessonPreview({ lessons, dayNames, startIndex, kicker, onClose }: {
  lessons: LeanSlideLesson[];
  dayNames: string[];
  startIndex: number;
  kicker: string | null;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const lesson = lessons[index];
  const last = lessons.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setIndex(i => Math.min(last, i + 1));
      if (e.key === "ArrowLeft") setIndex(i => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last]);

  return (
    <DialogPrimitive.Root open onOpenChange={o => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-[60] bg-background flex flex-col h-[100dvh] w-screen focus:outline-none">
          <div className="flex items-center gap-3 px-4 py-2 border-b border-border flex-shrink-0">
            <DialogPrimitive.Title className="flex-1 min-w-0 text-sm font-semibold truncate">
              Preview · {dayNames[index] ?? `Day ${index + 1}`}
              <span className="font-normal text-muted-foreground"> — as the morning meeting shows it</span>
            </DialogPrimitive.Title>
            <button onClick={() => setIndex(i => Math.max(0, i - 1))} disabled={index === 0}
              className="h-11 px-3 rounded-xl border-2 border-border bg-card font-semibold flex items-center gap-1 disabled:opacity-40">
              <ChevronLeft className="w-5 h-5" /> <span className="hidden sm:inline">{index > 0 ? dayNames[index - 1] : "Back"}</span>
            </button>
            <button onClick={() => setIndex(i => Math.min(last, i + 1))} disabled={index === last}
              className="h-11 px-3 rounded-xl border-2 border-border bg-card font-semibold flex items-center gap-1 disabled:opacity-40">
              <span className="hidden sm:inline">{index < last ? dayNames[index + 1] : "Next"}</span> <ChevronRight className="w-5 h-5" />
            </button>
            <DialogPrimitive.Close aria-label="Close preview"
              className="h-11 w-11 rounded-full border-2 border-border flex items-center justify-center hover:bg-secondary">
              <X className="w-5 h-5" />
            </DialogPrimitive.Close>
          </div>
          {/* Same padding as the meeting's slide area. */}
          <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6">
            {lesson && <LeanLessonSlide key={index} lesson={lesson} kicker={kicker} />}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
