/**
 * "Something else…" on Report defect / waste (Graeme, 2026-10-21;
 * Objective F). Pure, no I/O — routes/defects.ts calls it.
 *
 * A defect type flagged asks_for_detail (migration 0211) needs the person
 * to say in words what went wrong; that text is kept in
 * defects.reason_other. Every other type keeps reason_other NULL, so a
 * record moved off "Something else" never carries stale text.
 *
 * No type names here — the flag decides, so admins can rename the type.
 */
import * as z from "zod";

export const REASON_DETAIL_MIN = 3;
export const REASON_DETAIL_MAX = 200;

/** The body field as sent. Length is checked against the type in
 *  resolveReasonDetail (it's only required for some types). */
export const ReasonOtherField = z.string().max(2000).nullable().optional();

export type ReasonDetail = { ok: true; value: string | null } | { ok: false; error: string };

/**
 * What to store in reason_other for a record of a type.
 *   asksForDetail — the type's flag
 *   text          — what was sent (undefined = not sent)
 *   current       — the record's stored text, when editing (undefined on create)
 */
export function resolveReasonDetail(
  asksForDetail: boolean,
  text: string | null | undefined,
  current?: string | null,
): ReasonDetail {
  if (!asksForDetail) return { ok: true, value: null };
  const t = (text === undefined ? current : text)?.replace(/\s+/g, " ").trim() ?? "";
  if (t.length < REASON_DETAIL_MIN) return { ok: false, error: "Say what went wrong (a few words)" };
  if (t.length > REASON_DETAIL_MAX) return { ok: false, error: `Keep what went wrong to ${REASON_DETAIL_MAX} characters` };
  return { ok: true, value: t };
}
