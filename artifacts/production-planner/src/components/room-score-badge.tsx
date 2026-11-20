/**
 * The packing & wrapping room's score, wherever boxes per hour shows (Graeme,
 * 20 Nov 2026): the score big, boxes packed per hour and packs wrapped per
 * hour under it in small writing — like the end-of-day meeting. Today's is
 * worked out up to now (each shift counted only so far); until Planday
 * approves the shifts the hours come from the punch clock or the rota and
 * it says "estimate". Server: GET /api/production-kpis/room/day.
 */
import { useQuery } from "@tanstack/react-query";
import { BAND_BG, type Band } from "@/components/room-kpi-card";
import { cn } from "@/lib/utils";
import { roomSpeedsLine } from "@/lib/room-speeds-line";

export { roomSpeedsLine };

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export interface RoomDayScore {
  date: string;
  score: number | null;
  band: Band;
  estimate: boolean;
  live: boolean;
  boxes: number;
  packs: number;
  paidHours: number;
  earnedHours: number;
  people: number;
  boxesPerHour: number | null;
  packsPerHour: number | null;
}

/** Today's room score (or `date`'s), refreshed every few minutes. */
export function useRoomDay(date?: string) {
  return useQuery<RoomDayScore | null>({
    queryKey: ["room-day", date ?? "today"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/production-kpis/room/day${date ? `?date=${date}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error("Couldn't load the room score");
      return ((await res.json()) as { room: RoomDayScore | null }).room;
    },
    refetchInterval: 3 * 60_000,
    staleTime: 60_000,
  });
}

export function RoomScoreBadge({ room, size = "sm", className, failed }: { room: RoomDayScore | null | undefined; size?: "sm" | "lg"; className?: string; failed?: boolean }) {
  const band: Band = room?.band ?? "neutral";
  return (
    <div className={cn("rounded-xl flex flex-col", size === "lg" ? "px-5 py-3" : "px-4 py-2", BAND_BG[band], className)}
      aria-label={room?.score != null ? `Packing and wrapping room ${room.score}% of standard` : "Packing and wrapping room score not available yet"}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className={cn("font-extrabold tabular-nums leading-none", size === "lg" ? "text-4xl" : "text-xl")}>
          {room?.score != null ? `${room.score}%` : "—"}
        </span>
        <span className={cn("font-semibold leading-tight", size === "lg" ? "text-base" : "text-xs uppercase tracking-wide")}>
          Packing &amp; wrapping room{room?.live ? " today" : ""}
        </span>
      </div>
      <span className={cn("opacity-90 tabular-nums leading-snug mt-0.5", size === "lg" ? "text-sm" : "text-[11px]")}>
        {room ? roomSpeedsLine(room) : failed ? "Couldn't reach Planday just now" : room === null ? "No room figure yet today" : "Working it out…"}
        {room?.estimate ? " · estimate until Planday approves the shifts" : ""}
      </span>
    </div>
  );
}

/** The badge with today's live figure. */
export function RoomScoreLive({ size, className }: { size?: "sm" | "lg"; className?: string }) {
  const { data, isError } = useRoomDay();
  return <RoomScoreBadge room={data} size={size} className={className} failed={isError && data === undefined} />;
}
