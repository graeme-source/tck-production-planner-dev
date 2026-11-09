/**
 * "Build approved fixes now" (Graeme, 2 Nov 2026: "once I've done a little
 * session on these issue logs… 'bang, start building all these', merging
 * them into the next live deploy, the 3:05"). Objective E.
 *
 * The Fix queue page can't start the reviewer on Graeme's Mac directly, so
 * the button leaves a request (app_settings) that the reviewer checks every
 * ten minutes. Pure state rules here; the data side is
 * fix-queue-build-request.ts.
 *
 *   requested — the button was pressed; the reviewer hasn't picked it up.
 *   building  — the reviewer claimed it and is building every approved card.
 *   done      — that build finished (its note says what was built).
 *   idle      — never pressed.
 */

export const BUILD_REQUEST_SETTING_KEY = "fix_queue_build_request";

export interface BuildRequest {
  requestedAt: string;
  requestedBy: string | null;
  claimedAt?: string | null;
  finishedAt?: string | null;
  note?: string | null;
}

export type BuildRequestStatus = "idle" | "requested" | "building" | "done";

export function parseBuildRequest(raw: string | null | undefined): BuildRequest | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<BuildRequest>;
    return typeof v.requestedAt === "string" ? { requestedAt: v.requestedAt, requestedBy: v.requestedBy ?? null, claimedAt: v.claimedAt ?? null, finishedAt: v.finishedAt ?? null, note: v.note ?? null } : null;
  } catch {
    return null;
  }
}

export function buildRequestStatus(r: BuildRequest | null): BuildRequestStatus {
  if (!r) return "idle";
  if (r.finishedAt) return "done";
  if (r.claimedAt) return "building";
  return "requested";
}

/** Pressing the button: a fresh request, unless one is already waiting or
 *  being built (then nothing changes — pressing twice doesn't start twice). */
export function pressBuildNow(current: BuildRequest | null, nowIso: string, by: string | null): { next: BuildRequest; changed: boolean } {
  const status = buildRequestStatus(current);
  if (current && (status === "requested" || status === "building")) return { next: current, changed: false };
  return { next: { requestedAt: nowIso, requestedBy: by, claimedAt: null, finishedAt: null, note: null }, changed: true };
}

/** The reviewer picks a waiting request up. Only a waiting one can be claimed. */
export function claimBuild(current: BuildRequest | null, nowIso: string): BuildRequest | null {
  return buildRequestStatus(current) === "requested" ? { ...current!, claimedAt: nowIso } : null;
}

/** The reviewer finished building (or gave up): note says what happened. */
export function finishBuild(current: BuildRequest | null, nowIso: string, note: string): BuildRequest | null {
  const s = buildRequestStatus(current);
  return s === "building" || s === "requested" ? { ...current!, claimedAt: current!.claimedAt ?? nowIso, finishedAt: nowIso, note } : null;
}

/**
 * Which approved cards the button can build (Graeme, 9 Nov 2026: "I keep
 * clicking it and they never get built"). Only a defect or an improvement has
 * code to write. An approved data fix, explanation or needs-more-info card is
 * waiting on something else (a live data change, an answer, someone outside
 * the app), so counting it made the button promise builds that never came.
 */
const CODE_LANES = new Set(["defect", "improvement"]);

export const hasCodeToWrite = (lane: string): boolean => CODE_LANES.has(lane);

/** What an approved card without code is waiting for, in a few words. */
export function approvedBlocker(lane: string): string {
  switch (lane) {
    case "data_fix": return "a live data change";
    case "needs_info": return "more information";
    case "understanding": return "an answer, not code";
    case "not_app": return "something outside the app";
    default: return "something other than code";
  }
}
