/**
 * The morning meeting's System Updates slide, station work only (Graeme,
 * 27 Oct 2026: "filter that improvement slide for station work only, and
 * group them in stations: building station, prep station, production
 * planning... separate headlines, what's changed under those areas in the
 * last 7 days, rather than one long list. Filter out sales and marketing,
 * backend stuff, cash flow"). Objectives E and H.
 *
 * Source: the tagged System Updates entries from the last 7 days. If none
 * are tagged to a station or planning, the automatic weekly commit summary
 * (each item tagged by area) is used instead. Office work never shows. One
 * headline per step of the deck; the slide is left out of the deck when
 * there's nothing to show (useStationUpdatesSlideEmpty).
 */
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, PlayCircle } from "lucide-react";
import { groupForMeeting, withinDays, type MeetingGroup, type StationChange } from "@workspace/station-changes";
import { cn } from "@/lib/utils";
import { useStationChanges } from "./api";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface AutoItem { title: string; detail: string; teamFacing: boolean; areas?: string[] }

/** A card on the slide: a tagged entry, or an automatic-summary item. */
interface SlideItem {
  key: string;
  title: string;
  bullets: string[];
  areas: string[];
  createdAt: string | null;
  imageId: number | null;
  hasTutorial: boolean;
}

function fromEntry(e: StationChange): SlideItem {
  return { key: `e${e.id}`, title: e.title, bullets: e.bullets, areas: e.areas, createdAt: e.createdAt, imageId: e.hasImage ? e.id : null, hasTutorial: !!e.tutorial };
}

function fromAuto(a: AutoItem, i: number): SlideItem {
  return { key: `a${i}`, title: a.title, bullets: [a.detail], areas: a.areas ?? [], createdAt: null, imageId: null, hasTutorial: false };
}

export function useMeetingStationGroups(): { groups: MeetingGroup<SlideItem>[]; source: "tagged" | "auto"; isLoading: boolean } {
  const changes = useStationChanges(7);
  const feed = useQuery<{ available: boolean; summaryItems: AutoItem[] | null }>({
    queryKey: ["system-updates-feed"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/system-updates/feed`, { credentials: "include" });
      if (!res.ok) throw new Error(`Couldn't load the change feed (${res.status})`);
      return res.json();
    },
    staleTime: 5 * 60_000,
  });
  return useMemo(() => {
    const areas = changes.data?.areas ?? [];
    const tagged = groupForMeeting(withinDays(changes.data?.entries ?? [], new Date()).map(fromEntry), areas);
    if (tagged.length > 0 || changes.isLoading) return { groups: tagged, source: "tagged" as const, isLoading: changes.isLoading };
    const auto = (feed.data?.summaryItems ?? []).filter(a => a.teamFacing).map(fromAuto);
    return { groups: groupForMeeting(auto, areas), source: "auto" as const, isLoading: feed.isLoading };
  }, [changes.data, changes.isLoading, feed.data, feed.isLoading]);
}

/** true = nothing station-related this week, so leave the slide out of the
 *  deck. undefined while loading (keep it until we know). */
export function useStationUpdatesSlideEmpty(): boolean | undefined {
  const { groups, isLoading } = useMeetingStationGroups();
  if (isLoading) return undefined;
  return groups.length === 0;
}

export function StationUpdatesSlide({ title, subIndex, reportSubCount }: {
  title: string | null | undefined;
  subIndex: number;
  reportSubCount: (n: number) => void;
}) {
  const { groups, source, isLoading } = useMeetingStationGroups();
  // One headline per step, so the deck walks the stations one at a time.
  useEffect(() => { reportSubCount(Math.max(1, groups.length)); }, [groups.length, reportSubCount]);

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }
  if (groups.length === 0) {
    return (
      <div>
        <h2 className="text-5xl font-display font-bold mb-4 leading-tight">{title || "System Updates"}</h2>
        <p className="text-3xl text-muted-foreground italic">Nothing changed on the stations in the last 7 days.</p>
      </div>
    );
  }

  const at = Math.min(subIndex, groups.length - 1);
  const group = groups[at];
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <p className="text-xl font-semibold text-muted-foreground">{title || "System Updates"} · last 7 days</p>
        {groups.length > 1 && <span className="text-lg font-semibold text-muted-foreground tabular-nums">{at + 1} of {groups.length}</span>}
      </div>

      {/* Every headline this week, the current one lit, so the team knows
          what's coming. */}
      <div className="flex flex-wrap gap-2 mt-3 mb-5">
        {groups.map((g, i) => (
          <span key={g.area.key} className={cn(
            "px-3 py-1 rounded-full text-base font-semibold border-2",
            i === at ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground",
          )}>
            {g.area.label} · {g.entries.length}
          </span>
        ))}
      </div>

      <h2 className="text-5xl font-display font-bold leading-tight mb-1">{group.area.label}</h2>
      <p className="text-2xl text-muted-foreground mb-5">
        {group.entries.length} change{group.entries.length === 1 ? "" : "s"} this week
        {group.area.kind === "station" && group.area.stationTypes.length > 0 && " · see them on the station under Station menu → What's changed?"}
      </p>

      <div className="grid gap-4 xl:grid-cols-2">
        {group.entries.map(item => (
          <div key={item.key} className="rounded-2xl border-2 border-border bg-card p-5 flex gap-4">
            {item.imageId != null && (
              <img
                src={`${BASE}/api/system-updates/${item.imageId}/image`}
                alt=""
                className="w-48 h-32 object-cover rounded-xl border border-border shrink-0 bg-secondary/30"
                onError={e => { e.currentTarget.style.display = "none"; }}
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap text-base text-muted-foreground">
                {item.createdAt && <span>{format(new Date(item.createdAt), "EEE d MMM")}</span>}
                {item.alsoIn.map(a => (
                  <span key={a.key} className="px-2 py-0.5 rounded-full bg-secondary text-sm font-semibold">also {a.label}</span>
                ))}
                {item.hasTutorial && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 text-primary text-sm font-bold">
                    <PlayCircle className="w-4 h-4" /> Walkthrough on the station
                  </span>
                )}
              </div>
              <h3 className="text-3xl font-bold leading-snug mt-1">{item.title}</h3>
              {item.bullets.length > 0 && (
                <ul className="mt-2 space-y-1.5 text-xl">
                  {item.bullets.map((b, i) => (
                    <li key={i} className="flex items-start gap-3 leading-snug">
                      <span className="text-primary font-bold shrink-0">•</span><span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
      </div>

      {source === "auto" && (
        <p className="text-sm text-muted-foreground mt-4">From the automatic weekly summary — no hand-written updates were tagged to a station this week.</p>
      )}
    </div>
  );
}
