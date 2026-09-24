/**
 * Station training — bits shared by the station list and the per-station
 * matrix inside the Training section (pages/training-matrix.tsx).
 */
import { format, parseISO } from "date-fns";
import { CheckCircle2, RefreshCw, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATIONS } from "@/pages/station/shared/constants";
import type { ReviewStatus } from "@/lib/station-training";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const STATION_TRAINING_API = `${BASE}/api/station-training`;

const PREP_SUB_STATIONS: Record<string, string> = {
  main_prep: "Prep — Main Prep",
  prep_bases: "Prep — Bases & Sauces",
  prep_meat: "Prep — Raw Meat",
};

export const stationLabel = (key: string) =>
  STATIONS.find(s => s.key === key)?.label ?? PREP_SUB_STATIONS[key] ?? key.replace(/_/g, " ");

/** Every station a matrix can belong to, prep's sub-stations listed straight after Prep. */
export const TRAINING_STATION_KEYS: string[] = STATIONS.flatMap(s =>
  s.key === "prep" ? [s.key, ...Object.keys(PREP_SUB_STATIONS)] : [s.key as string]);

export async function getStationTraining<T>(path: string): Promise<T> {
  const res = await fetch(`${STATION_TRAINING_API}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error("Couldn't load station training");
  return res.json();
}

export function fmtWhen(ts: string | null): string {
  if (!ts) return "";
  try { return format(parseISO(ts.replace(" ", "T")), "d MMM, HH:mm"); } catch { return ""; }
}

export function StatusIcon({ status, large }: { status: ReviewStatus; large?: boolean }) {
  const cls = large ? "w-7 h-7 flex-shrink-0" : "w-4 h-4 flex-shrink-0";
  if (status === "trained") return <CheckCircle2 className={cn(cls, "text-emerald-600")} />;
  if (status === "refresher") return <RefreshCw className={cn(cls, "text-amber-600")} />;
  return <Minus className={cn(cls, "text-muted-foreground")} />;
}
