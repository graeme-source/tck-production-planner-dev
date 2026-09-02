/**
 * Inline media for an improvement, feed-post style: the stitched
 * before/after clip IS the story when it exists; otherwise a before/after
 * image pair sits side by side, videos play in place, and anything past
 * three tiles collapses to "+N".
 *
 * Shared between the improvements feed and the morning meeting's Recent
 * Improvements slide — extracted from pages/improvements.tsx so the meeting
 * shows the exact same story the feed does. `large` scales the media for a
 * screen watched from across the kitchen rather than held in a hand.
 *
 * Videos are wrapped in data-no-swipe so a drag on the scrub bar can't
 * change the meeting slide.
 */
export interface ImprovementMediaItem {
  id: number;
  kind: "image" | "video";
  phase: "before" | "after" | "stitched" | null;
}

export const improvementMediaUrl = (id: number) =>
  `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/improvements/attachments/${id}`;

export function ImprovementFeedMedia({
  media,
  onOpen,
  large = false,
}: {
  media: ImprovementMediaItem[] | undefined;
  /** Tap on a photo / the "+N" button. Omit to render photos as plain images. */
  onOpen?: () => void;
  large?: boolean;
}) {
  const items = media ?? [];
  if (items.length === 0) return null;

  const stitched = items.find(m => m.kind === "video" && m.phase === "stitched");
  const shown = stitched ? [stitched] : items.slice(0, 3);
  const hidden = stitched ? 0 : items.length - shown.length;

  const before = !stitched ? shown.find(m => m.kind === "image" && (m.phase === "before" || m.phase === null)) : undefined;
  const after = !stitched ? shown.find(m => m.kind === "image" && m.phase === "after") : undefined;
  const pair = before && after;
  const rest = pair ? shown.filter(m => m !== before && m !== after) : shown;

  const imgMax = large ? "max-h-[44vh]" : "max-h-80";
  const vidMax = large ? "max-h-[48vh]" : "max-h-96";
  const labelCls = large
    ? "absolute top-3 left-3 text-sm font-bold px-3 py-1 rounded-full bg-black/60 text-white uppercase tracking-wide"
    : "absolute top-2 left-2 text-[11px] font-bold px-2 py-0.5 rounded-full bg-black/60 text-white uppercase tracking-wide";

  const img = (m: ImprovementMediaItem, label?: string) => (
    <button key={m.id} onClick={onOpen} disabled={!onOpen} className="relative block w-full overflow-hidden rounded-xl">
      <img src={improvementMediaUrl(m.id)} alt={label ?? "Improvement photo"} loading="lazy" className={`w-full ${imgMax} object-cover`} />
      {label && <span className={labelCls}>{label}</span>}
    </button>
  );
  const vid = (m: ImprovementMediaItem, label?: string) => (
    <div key={m.id} data-no-swipe className="relative w-full overflow-hidden rounded-xl bg-black">
      <video src={improvementMediaUrl(m.id)} controls playsInline preload="metadata" className={`w-full ${vidMax}`} />
      {label && <span className={`${labelCls} pointer-events-none`}>{label}</span>}
    </div>
  );

  return (
    <div className={large ? "mt-4 space-y-3" : "mt-3 space-y-2"}>
      {stitched && vid(stitched, "Before → After")}
      {pair && (
        <div className="grid grid-cols-2 gap-2">
          {img(before!, "Before")}
          {img(after!, "After")}
        </div>
      )}
      {rest.filter(m => !stitched).map(m =>
        m.kind === "video"
          ? vid(m, m.phase === "before" ? "Before" : m.phase === "after" ? "After" : undefined)
          : img(m, m.phase === "before" ? "Before" : m.phase === "after" ? "After" : undefined)
      )}
      {hidden > 0 && onOpen && (
        <button onClick={onOpen} className="w-full py-2 rounded-xl bg-secondary text-sm font-semibold text-muted-foreground hover:bg-secondary/70">
          +{hidden} more photo{hidden === 1 ? "" : "s"} — open to see all
        </button>
      )}
    </div>
  );
}
