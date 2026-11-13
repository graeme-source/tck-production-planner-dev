/**
 * Packing & wrapping ROOM run rate (Graeme, 13 Nov 2026) — one score for the
 * team's whole day, not just the time at the bench: "factor in boxes packed
 * and packs wrapped in the total amount of hours used by both the packing and
 * wrapping shifts … receiving goods through the door will also contribute".
 * Pure; the job (services/room-kpi-job.ts) reads the data.
 *
 *   earned hours = boxes ÷ packing standard (orders/hr)
 *                + packs ÷ wrapping standard (packs/hr)
 *                + deliveries × delivery minutes + lines × line minutes
 *   ratio        = earned hours ÷ paid hours (Planday Packer + Wrapper
 *                  shifts, whole shift, unpaid breaks off)
 *   score        = ratio ÷ standard ratio × 100%
 *
 * The three measured jobs only cover part of the day (set-up, mayos,
 * clean-down are the rest), so like Team efficiency the 100% line is a
 * typical recent day's ratio (calibrateStandardRatio), set once and kept
 * fixed so the score shows real change. The packing and wrapping standards
 * are the ones on Analytics → Production KPIs; changing them restates
 * history, because only raw counts are stored.
 */
import { isProductiveShift, shiftPaidHours, type PlandayPayrollShift } from "./team-efficiency";

export interface RoomDay {
  date: string;
  boxes: number;
  packs: number;
  deliveries: number;
  deliveryLines: number;
  paidHours: number;
  people: number;
}

export interface RoomWeights {
  /** Orders an hour — the packing standard. */
  packingPerHour: number;
  /** Packs an hour — the wrapping standard. */
  wrappingPerHour: number;
  /** Minutes credited per delivery received. */
  deliveryMinutes: number;
  /** Minutes credited per line received on it. */
  lineMinutes: number;
}

export const DEFAULT_ROOM_SETTINGS = {
  positions: ["Packer", "Wrapper"],
  deliveryMinutes: 10,
  lineMinutes: 2,
};

export interface EarnedBreakdown {
  packingHours: number;
  wrappingHours: number;
  deliveryHours: number;
  earnedHours: number;
}

export function earnedHours(d: Pick<RoomDay, "boxes" | "packs" | "deliveries" | "deliveryLines">, w: RoomWeights): EarnedBreakdown {
  const packingHours = w.packingPerHour > 0 ? d.boxes / w.packingPerHour : 0;
  const wrappingHours = w.wrappingPerHour > 0 ? d.packs / w.wrappingPerHour : 0;
  const deliveryHours = (d.deliveries * w.deliveryMinutes + d.deliveryLines * w.lineMinutes) / 60;
  return { packingHours, wrappingHours, deliveryHours, earnedHours: packingHours + wrappingHours + deliveryHours };
}

/** Earned ÷ paid; null when nobody was paid on the room that day. */
export function roomRatio(d: RoomDay, w: RoomWeights): number | null {
  if (!(d.paidHours > 0)) return null;
  return earnedHours(d, w).earnedHours / d.paidHours;
}

/** The score, as a whole-number percentage of the standard ratio. */
export function roomScore(ratio: number | null, standardRatio: number | null): number | null {
  if (ratio == null || !standardRatio || standardRatio <= 0) return null;
  return Math.round((ratio / standardRatio) * 100);
}

/** 100% = the median ratio over the days given (typical, not best). */
export function calibrateStandardRatio(days: readonly RoomDay[], w: RoomWeights, minDays = 5): number | null {
  const ratios = days.map(d => roomRatio(d, w)).filter((r): r is number => r != null && r > 0).sort((a, b) => a - b);
  if (ratios.length < minDays) return null;
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return Math.round(median * 1000) / 1000;
}

/** Colour band — the same 110 / 100 / 90 lines as every other KPI. */
export function roomBand(score: number | null): "platinum" | "green" | "amber" | "red" | "neutral" {
  if (score == null) return "neutral";
  if (score >= 110) return "platinum";
  if (score >= 100) return "green";
  if (score >= 90) return "amber";
  return "red";
}

// ── Hours from Planday ────────────────────────────────────────────────────

export interface RoomShiftInputs {
  payroll: ReadonlyArray<PlandayPayrollShift & { id: number; employeeId: number; date: string; positionId?: number | null }>;
  /** Rota shifts, for shift type and approval. Payroll only carries
   *  APPROVED shifts, so a rota shift on the room not yet approved is what
   *  marks a day as still waiting. */
  rota: ReadonlyArray<{ id: number; date: string; status: string | null; shiftTypeId: number | null; positionId: number | null }>;
  positions: ReadonlyArray<{ id: number; name: string }>;
  shiftTypes: ReadonlyArray<{ id: number; name: string }>;
  /** Position names that are the room (case-insensitive). */
  positionNames: readonly string[];
}

/** Paid hours and headcount per day for the room's positions, and whether
 *  any of those shifts is still waiting for approval. */
export function roomHoursByDay(i: RoomShiftInputs): Map<string, { paidHours: number; people: number; pending: boolean }> {
  const wanted = new Set(i.positionNames.map(n => n.trim().toLowerCase()));
  const positionName = new Map(i.positions.map(p => [p.id, p.name.trim().toLowerCase()]));
  const typeName = new Map(i.shiftTypes.map(t => [t.id, t.name]));
  const rotaById = new Map(i.rota.map(s => [s.id, s]));
  const out = new Map<string, { paidHours: number; people: Set<number>; pending: boolean }>();
  for (const row of i.payroll) {
    const pos = row.positionId != null ? positionName.get(row.positionId) : undefined;
    if (!pos || !wanted.has(pos)) continue;
    const rota = rotaById.get(row.id);
    const type = rota?.shiftTypeId != null ? typeName.get(rota.shiftTypeId) : null;
    // Training, meetings, holiday, sickness: not room work.
    if (!isProductiveShift(0, 0, type)) continue;
    const day = out.get(row.date) ?? { paidHours: 0, people: new Set<number>(), pending: false };
    day.paidHours += shiftPaidHours(row);
    day.people.add(row.employeeId);
    out.set(row.date, day);
  }
  for (const r of i.rota) {
    const pos = r.positionId != null ? positionName.get(r.positionId) : undefined;
    if (!pos || !wanted.has(pos)) continue;
    if (!isProductiveShift(0, 0, r.shiftTypeId != null ? typeName.get(r.shiftTypeId) : null)) continue;
    if ((r.status ?? "").toLowerCase() === "approved") continue;
    const day = out.get(r.date) ?? { paidHours: 0, people: new Set<number>(), pending: false };
    day.pending = true;
    out.set(r.date, day);
  }
  return new Map([...out].map(([d, v]) => [d, { paidHours: Math.round(v.paidHours * 100) / 100, people: v.people.size, pending: v.pending }]));
}
