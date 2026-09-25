/**
 * Return-to-work chase to-dos — the links and wording (pure, tested).
 *
 * Each chase to-do carries a spell tag in its url (`spell=<userId>:<start>`)
 * so the hourly sweep can de-dupe and a signed form can close them. The
 * colleague's own to-do opens /return-to-work; a People-access manager's
 * opens the person's record, /people/<id> (2026-09-25 redesign — it used to
 * open /return-to-work?user=<id>, which still redirects there).
 *
 * Tag matching is anchored on the `?` or `&` before "spell=": a bare
 * `%spell=4:%` also matched `spell=14:`, so signing user 4's form closed
 * user 14's chase to-dos too.
 */
import { absencePhrase } from "./absence-spells";

export function spellTag(userId: number, spellStart: string): string {
  return `spell=${userId}:${spellStart}`;
}

export function colleagueChaseUrl(userId: number, spellStart: string): string {
  return `/return-to-work?${spellTag(userId, spellStart)}`;
}

export function managerChaseUrl(userId: number, spellStart: string): string {
  return `/people/${userId}?${spellTag(userId, spellStart)}`;
}

/** SQL LIKE patterns matching any chase url (old or new format) for ONE spell. */
export function chaseLikePatternsForSpell(userId: number, spellStart: string): [string, string] {
  const tag = spellTag(userId, spellStart);
  return [`%?${tag}`, `%&${tag}`];
}

/** SQL LIKE patterns matching every chase url for ONE person. */
export function chaseLikePatternsForUser(userId: number): [string, string] {
  return [`%?spell=${userId}:%`, `%&spell=${userId}:%`];
}

/** The same rule as the LIKE patterns, for tests and in-memory checks. */
export function chaseUrlIsForUser(url: string, userId: number): boolean {
  return new RegExp(`[?&]spell=${userId}:`).test(url);
}

function fmtDates(start: string, end: string): string {
  return start === end ? `on ${start}` : `${start} to ${end}`;
}

export interface ChaseSpell {
  start: string;
  end: string;
  types: readonly string[];
  sickness: boolean;
}

export function colleagueChaseNotes(spell: ChaseSpell): string {
  return `Welcome back. You were ${absencePhrase(spell)} ${fmtDates(spell.start, spell.end)} — grab a manager and fill in the short return-to-work form together. It's private: only you and the people with People access can see it.`;
}

export function managerChaseNotes(spell: ChaseSpell): string {
  return `Back after being ${absencePhrase(spell)} ${fmtDates(spell.start, spell.end)} with no return-to-work form yet. Sit down with them and complete it together.`;
}
