/**
 * Labels and colours for the marketing calendar. The keys mirror the server's
 * zod enums (routes/marketing-calendar.ts); colour is by event TYPE so a
 * glance at the month tells you what kind of month it is.
 */

export interface TypeStyle { label: string; bar: string; chip: string; dot: string }

/** A phase is a backdrop, not an entry (Graeme, 2026-10-01): it draws as a
 *  thin pale band across the days, so the emails inside it stand out. */
export const THIN_TYPES = new Set(["campaign"]);

/** Klaviyo emails are TEAL everywhere; our planned emails are INDIGO
 *  (2026-10-01 — they were two shades of blue and hard to tell apart). */
export const KLAVIYO_TONE = {
  solid: "bg-teal-600 text-white",
  sent: "bg-teal-500/15 text-teal-900/70 dark:text-teal-100/70",
  soft: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  border: "border-teal-500/50",
  borderFaint: "border-teal-500/25",
  icon: "text-teal-600",
};

/** A Klaviyo DRAFT not yet linked to a planned email (2026-10-09): dashed
 *  violet, same as its card in the List view — clearly not a real send. */
export const KLAVIYO_DRAFT_TONE = {
  chip: "border-2 border-dashed border-violet-500/70 bg-violet-500/10 text-violet-800 dark:text-violet-200",
  card: "border-dashed border-violet-500/60 bg-violet-500/5 hover:bg-violet-500/10",
  icon: "text-violet-600",
};

/** Notes (2026-10-01): an idea or note on a day — a quiet yellow sticky
 *  note, nothing like the solid email chips. */
export const NOTE_TONE = {
  chip: "bg-yellow-100 text-yellow-900 border border-yellow-300 dark:bg-yellow-400/15 dark:text-yellow-100 dark:border-yellow-400/40",
  card: "border-yellow-400/60 bg-yellow-50 dark:bg-yellow-400/10",
  icon: "text-yellow-600 dark:text-yellow-300",
};

/** To-dos (2026-10-01): slate with a checkbox; done ones faded and struck. */
export const TODO_TONE = {
  chip: "bg-slate-100 text-slate-800 border border-slate-300 dark:bg-slate-500/20 dark:text-slate-100 dark:border-slate-400/40",
  done: "bg-slate-100/60 text-slate-500 border border-slate-200 line-through dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/30",
  card: "border-slate-400/50 bg-slate-50 dark:bg-slate-500/10",
  icon: "text-slate-600 dark:text-slate-300",
};

export const EVENT_TYPES: Record<string, TypeStyle> = {
  campaign:       { label: "Phase",       bar: "bg-violet-500/15 text-violet-900 dark:text-violet-100 border-y border-violet-500/30",  chip: "bg-violet-500/15 text-violet-700 dark:text-violet-300", dot: "bg-violet-500" },
  email:          { label: "Email",          bar: "bg-sky-500 text-white",     chip: "bg-sky-500/15 text-sky-700 dark:text-sky-300",          dot: "bg-sky-500" },
  offer:          { label: "Offer",          bar: "bg-amber-500 text-white",   chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300",    dot: "bg-amber-500" },
  product_launch: { label: "Product launch", bar: "bg-emerald-600 text-white", chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-600" },
  seasonal:       { label: "Seasonal",       bar: "bg-orange-600 text-white",  chip: "bg-orange-500/15 text-orange-700 dark:text-orange-300", dot: "bg-orange-600" },
  test_box:       { label: "Test box",       bar: "bg-rose-600 text-white",    chip: "bg-rose-500/15 text-rose-700 dark:text-rose-300",       dot: "bg-rose-600" },
  other:          { label: "Other",          bar: "bg-slate-500 text-white",   chip: "bg-slate-500/15 text-slate-700 dark:text-slate-300",    dot: "bg-slate-500" },
};

/** Types a person can choose (test boxes are made on the Test boxes page). */
export const PICKABLE_TYPES = ["campaign", "email", "offer", "product_launch", "seasonal", "other"] as const;

export function typeStyle(type: string): TypeStyle {
  return EVENT_TYPES[type] ?? EVENT_TYPES["other"];
}

export const CHANNELS: Array<{ key: string; label: string }> = [
  { key: "vip_email", label: "VIP email" },
  { key: "public_email", label: "Public email" },
  { key: "social", label: "Social" },
  { key: "website", label: "Website" },
  { key: "ads", label: "Ads" },
  { key: "sms", label: "SMS" },
  { key: "in_box_insert", label: "In-box insert" },
  { key: "other", label: "Other" },
];

export const STATUSES: Array<{ key: string; label: string; hint: string }> = [
  { key: "idea", label: "Idea", hint: "Not committed yet" },
  { key: "planned", label: "Planned", hint: "Locked in" },
  { key: "live", label: "Live", hint: "Running now" },
  { key: "done", label: "Done", hint: "Finished" },
];

export function statusLabel(key: string): string {
  return STATUSES.find(s => s.key === key)?.label ?? key;
}

// Planned emails: the STAGE (2026-09-30). Keys mirror the server
// (EMAIL_STAGES in @workspace/marketing-calendar). Linked to Klaviyo, the
// stage comes from Klaviyo (effectiveStage); unlinked, it's set by hand.
export const EMAIL_STAGE_OPTIONS: Array<{ key: string; label: string; hint: string; chip: string }> = [
  { key: "planned", label: "Planned", hint: "We'll build this email", chip: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300" },
  { key: "created", label: "Created in Klaviyo", hint: "A draft exists in Klaviyo", chip: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  { key: "scheduled", label: "Scheduled", hint: "Scheduled in Klaviyo", chip: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  { key: "sent", label: "Sent", hint: "Gone out", chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
];

export function emailStage(key: string) {
  return EMAIL_STAGE_OPTIONS.find(s => s.key === key) ?? EMAIL_STAGE_OPTIONS[0];
}

/** Badge colours for approval (approvalBadge() in @workspace/marketing-calendar gives the words). */
export const APPROVAL_TONE: Record<"green" | "amber" | "grey", string> = {
  green: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/40",
  amber: "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/50",
  grey: "bg-secondary text-muted-foreground border-border",
};

export function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || "Someone";
}

// ── Email plan (2026-10-14) ───────────────────────────────────────────────
/** Offer colours, by the key stored on each offer (Calendar setup). Light
 *  and dark both readable; chip = the "Offer N" pill, head = the week
 *  card's header wash, edge = its left border, big = "Offer N live". */
export interface OfferTone { label: string; chip: string; head: string; edge: string; big: string; swatch: string }
export const OFFER_TONES: Record<string, OfferTone> = {
  green: { label: "Green", chip: "bg-emerald-600 text-white dark:bg-emerald-500/25 dark:text-emerald-200", head: "bg-emerald-500/10", edge: "border-l-emerald-600 dark:border-l-emerald-400", big: "text-emerald-800 dark:text-emerald-300", swatch: "bg-emerald-600" },
  rust: { label: "Rust", chip: "bg-orange-700 text-white dark:bg-orange-500/25 dark:text-orange-200", head: "bg-orange-500/10", edge: "border-l-orange-700 dark:border-l-orange-400", big: "text-orange-800 dark:text-orange-300", swatch: "bg-orange-700" },
  plum: { label: "Plum", chip: "bg-fuchsia-800 text-white dark:bg-fuchsia-500/25 dark:text-fuchsia-200", head: "bg-fuchsia-500/10", edge: "border-l-fuchsia-800 dark:border-l-fuchsia-400", big: "text-fuchsia-800 dark:text-fuchsia-300", swatch: "bg-fuchsia-800" },
  blue: { label: "Blue", chip: "bg-blue-700 text-white dark:bg-blue-500/25 dark:text-blue-200", head: "bg-blue-500/10", edge: "border-l-blue-700 dark:border-l-blue-400", big: "text-blue-800 dark:text-blue-300", swatch: "bg-blue-700" },
  gold: { label: "Gold", chip: "bg-amber-600 text-white dark:bg-amber-500/25 dark:text-amber-200", head: "bg-amber-500/10", edge: "border-l-amber-600 dark:border-l-amber-400", big: "text-amber-800 dark:text-amber-300", swatch: "bg-amber-600" },
  teal: { label: "Teal", chip: "bg-teal-700 text-white dark:bg-teal-500/25 dark:text-teal-200", head: "bg-teal-500/10", edge: "border-l-teal-700 dark:border-l-teal-400", big: "text-teal-800 dark:text-teal-300", swatch: "bg-teal-700" },
  rose: { label: "Rose", chip: "bg-rose-700 text-white dark:bg-rose-500/25 dark:text-rose-200", head: "bg-rose-500/10", edge: "border-l-rose-700 dark:border-l-rose-400", big: "text-rose-800 dark:text-rose-300", swatch: "bg-rose-700" },
  slate: { label: "Slate", chip: "bg-slate-700 text-white dark:bg-slate-500/25 dark:text-slate-200", head: "bg-slate-500/10", edge: "border-l-slate-700 dark:border-l-slate-400", big: "text-slate-800 dark:text-slate-300", swatch: "bg-slate-700" },
};
export function offerTone(colour: string | null | undefined): OfferTone {
  return OFFER_TONES[colour ?? ""] ?? OFFER_TONES.green;
}
/** A paused week (Black Friday …) — warm gold, not an offer colour. */
export const PAUSE_TONE = { head: "bg-yellow-400/15", edge: "border-l-yellow-600 dark:border-l-yellow-300", big: "text-yellow-900 dark:text-yellow-200", chip: "bg-yellow-200 text-yellow-900 dark:bg-yellow-400/20 dark:text-yellow-100" };

/** Email-type chips: launch solid, last call red, teaser/free slot dashed. */
export const EMAIL_TYPE_TONE: Record<string, string> = {
  launch: "bg-primary text-primary-foreground border-primary",
  follow_up: "bg-secondary text-foreground border-border",
  new_angle: "bg-secondary text-foreground border-border",
  last_call: "bg-red-100 text-red-800 border-red-300 dark:bg-red-500/20 dark:text-red-200 dark:border-red-400/40",
  free_slot: "bg-transparent text-muted-foreground border-dashed border-muted-foreground",
  teaser: "bg-transparent text-primary border-dashed border-primary",
  extension: "bg-secondary text-foreground border-border",
};
