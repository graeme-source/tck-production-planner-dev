/**
 * The lean lesson as the morning meeting shows it (Graeme, 20 Nov 2026):
 * the title, a few bullets and the main message in big type, and the video
 * as big as a 16:9 screen allows. One component for the meeting deck and the
 * curriculum's Preview, so the preview is exactly what the room sees.
 *
 * Fills its parent's height from md up — the parent must give it one.
 */
import { useState } from "react";
import { LessonDiagram } from "@/components/lesson-diagrams";
import { LessonVideoFill, MarkdownBlock } from "@/components/lesson-media";
import { lessonSlideParts } from "@/lib/lesson-slide-parts";
import { cn } from "@/lib/utils";

export interface LeanSlideLesson {
  title: string;
  whatToShowMd: string;
  videoUrl?: string | null;
  diagram?: string | null;
  imageUrl?: string | null;
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>)}
    </>
  );
}

export function LeanLessonSlide({ lesson, kicker }: { lesson: LeanSlideLesson; kicker?: string | null }) {
  const parts = lessonSlideParts(lesson.whatToShowMd);
  const points = [...parts.other, ...parts.bullets];
  // One piece of media at a time, as big as it goes; when a lesson has more
  // than one (a video AND a diagram), buttons switch between them.
  const media = ([
    lesson.videoUrl ? { key: "video", label: "Video" } : null,
    lesson.diagram ? { key: "diagram", label: "Diagram" } : null,
    lesson.imageUrl ? { key: "image", label: "Photo" } : null,
  ].filter(Boolean) as Array<{ key: "video" | "diagram" | "image"; label: string }>);
  const hasMedia = media.length > 0;
  const [picked, setPicked] = useState<"video" | "diagram" | "image" | null>(null);
  const showing = media.find(m => m.key === picked)?.key ?? media[0]?.key ?? null;

  return (
    <div className="md:h-full flex flex-col gap-5 md:min-h-[24rem]">
      <header className="flex-shrink-0">
        {kicker && <p className="text-sm md:text-base font-semibold uppercase tracking-wide text-purple-500 mb-1">{kicker}</p>}
        <h2 className="font-display font-bold leading-[1.05] text-4xl md:text-[clamp(2.25rem,4vw,4.5rem)]">{lesson.title}</h2>
      </header>

      <div className={cn("flex-1 md:min-h-0 grid gap-6 md:gap-10",
        hasMedia ? "md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]" : "grid-cols-1")}>
        <div className={cn("md:min-h-0 md:overflow-y-auto flex flex-col justify-center gap-6",
          !hasMedia && "max-w-6xl")}>
          {points.length > 0 && (
            <ul className={cn("space-y-3 font-semibold leading-snug",
              hasMedia ? "text-2xl md:text-[clamp(1.25rem,1.8vw,2.4rem)]" : "text-2xl md:text-[clamp(1.6rem,2.8vw,3.4rem)]")}>
              {points.map((p, i) => (
                <li key={i} className="flex gap-3">
                  <span className="text-purple-500 flex-shrink-0" aria-hidden>•</span>
                  <span><Inline text={p} /></span>
                </li>
              ))}
            </ul>
          )}
          {parts.tableMd && <div className="text-xl md:text-2xl [&_table]:text-xl md:[&_table]:text-2xl"><MarkdownBlock content={parts.tableMd} /></div>}
          {parts.message && (
            <div className="rounded-2xl bg-purple-500/10 border-2 border-purple-500/30 px-5 py-4">
              {parts.messageLabel && <p className="text-sm md:text-base font-bold uppercase tracking-wide text-purple-600 dark:text-purple-300">{parts.messageLabel}</p>}
              <p className={cn("font-display font-bold leading-tight",
                hasMedia ? "text-2xl md:text-[clamp(1.4rem,2vw,2.6rem)]" : "text-3xl md:text-[clamp(1.8rem,3.2vw,3.8rem)]")}>
                <Inline text={parts.message} />
              </p>
            </div>
          )}
        </div>

        {hasMedia && (
          <div className="md:min-h-0 flex flex-col gap-3">
            {media.length > 1 && (
              <div className="flex gap-2 flex-shrink-0">
                {media.map(m => (
                  <button key={m.key} onClick={() => setPicked(m.key)}
                    className={cn("h-10 px-4 rounded-full text-sm font-semibold border-2",
                      showing === m.key ? "bg-purple-600 border-purple-600 text-white" : "border-purple-500/40 text-purple-700 dark:text-purple-300 bg-card")}>
                    {m.label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex-1 md:min-h-0 flex items-center justify-center">
              {showing === "video" && lesson.videoUrl && <LessonVideoFill url={lesson.videoUrl} />}
              {showing === "diagram" && lesson.diagram && <div className="w-full max-h-full overflow-auto"><LessonDiagram id={lesson.diagram} /></div>}
              {showing === "image" && lesson.imageUrl && <img src={lesson.imageUrl} alt="" className="max-w-full max-h-full object-contain rounded-2xl" />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
