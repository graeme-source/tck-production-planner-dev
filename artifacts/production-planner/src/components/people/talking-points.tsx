/**
 * A bullet-point note shown as talking points: headlines, a bold topic on
 * each point with its detail underneath, and a tick box to tick each one off
 * while talking it through (Graeme, 26 Nov 2026). Ticks are a meeting aid,
 * kept in this browser per note — never part of the note or the record.
 * The parsing is lib/talking-points.ts. Objective H.
 */
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { tickProgress, type TalkingBlock } from "@/lib/talking-points";

const storeKey = (noteId: number) => `note-ticks:${noteId}`;

function loadTicks(noteId: number): Set<string> {
  try {
    const raw = localStorage.getItem(storeKey(noteId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch { return new Set(); }
}

export function TalkingPoints({ noteId, blocks, tickable }: { noteId: number; blocks: TalkingBlock[]; tickable: boolean }) {
  const [ticked, setTicked] = useState<Set<string>>(() => (tickable ? loadTicks(noteId) : new Set()));
  useEffect(() => { if (tickable) setTicked(loadTicks(noteId)); }, [noteId, tickable]);
  const save = (next: Set<string>) => {
    setTicked(next);
    try {
      if (next.size) localStorage.setItem(storeKey(noteId), JSON.stringify([...next]));
      else localStorage.removeItem(storeKey(noteId));
    } catch { /* private window: keep in memory */ }
  };
  const flip = (key: string) => {
    const next = new Set(ticked);
    if (next.has(key)) next.delete(key); else next.add(key);
    save(next);
  };
  const { done, total } = tickProgress(blocks, ticked);

  // Sections: each heading starts one; points flow into columns on wide screens.
  const sections: Array<{ heading: string | null; items: TalkingBlock[] }> = [];
  for (const b of blocks) {
    if (b.kind === "heading" || sections.length === 0) sections.push({ heading: b.kind === "heading" ? b.text : null, items: [] });
    if (b.kind !== "heading") sections[sections.length - 1]!.items.push(b);
  }

  return (
    <div className="space-y-4 text-foreground">
      {tickable && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className={cn("font-semibold", done === total ? "text-emerald-700 dark:text-emerald-400" : "text-foreground")}>
            {done} of {total} talked through
          </span>
          {done > 0 && (
            <button type="button" onClick={() => save(new Set())} className="min-h-11 px-2 underline decoration-dotted underline-offset-2 text-muted-foreground hover:text-foreground">
              Clear ticks
            </button>
          )}
        </div>
      )}
      {sections.map((s, i) => (
        <section key={i} className="space-y-2">
          {s.heading && <h3 className="text-xl font-display font-bold border-b-2 border-primary/30 pb-1">{s.heading}</h3>}
          <div className="md:columns-2 2xl:columns-3 gap-6">
            {s.items.map((b, j) => {
              if (b.kind === "subheading") {
                return <h4 key={j} className="break-after-avoid text-base font-bold text-primary pt-2 first:pt-0">{b.text}</h4>;
              }
              if (b.kind === "text") return <p key={j} className="break-inside-avoid py-1 text-[15px] leading-snug">{b.text}</p>;
              if (b.kind !== "point") return null;
              const on = ticked.has(b.key);
              const label = (
                <span className={cn("min-w-0", on && "opacity-50")}>
                  {b.topic && <span className={cn("block font-bold text-[15px] leading-snug", on && "line-through")}>{b.topic}</span>}
                  <span className={cn("block leading-snug", b.topic ? "text-sm text-foreground/80" : "text-[15px] font-medium", on && "line-through")}>{b.detail}</span>
                </span>
              );
              return tickable ? (
                <button key={j} type="button" onClick={() => flip(b.key)} aria-pressed={on}
                  className="break-inside-avoid w-full flex items-start gap-3 rounded-lg px-1.5 py-2 text-left hover:bg-secondary/60">
                  <span className={cn("mt-0.5 shrink-0 w-6 h-6 rounded-md border-2 flex items-center justify-center",
                    on ? "bg-emerald-600 border-emerald-600 text-white" : "border-primary/50 bg-background")}>
                    {on && <Check className="w-4 h-4" strokeWidth={3} />}
                  </span>
                  {label}
                </button>
              ) : (
                <div key={j} className="break-inside-avoid flex items-start gap-2 py-1.5">
                  <span className="mt-2 shrink-0 w-1.5 h-1.5 rounded-full bg-primary" />
                  {label}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
