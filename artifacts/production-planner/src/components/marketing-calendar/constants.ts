/**
 * Labels and colours for the marketing calendar. The keys mirror the server's
 * zod enums (routes/marketing-calendar.ts); colour is by event TYPE so a
 * glance at the month tells you what kind of month it is.
 */

export interface TypeStyle { label: string; bar: string; chip: string; dot: string }

export const EVENT_TYPES: Record<string, TypeStyle> = {
  campaign:       { label: "Campaign",       bar: "bg-violet-500 text-white",  chip: "bg-violet-500/15 text-violet-700 dark:text-violet-300", dot: "bg-violet-500" },
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

// Planned emails. Statuses mirror the server (EMAIL_STATUSES).
export const EMAIL_STATUS_OPTIONS: Array<{ key: string; label: string; hint: string; chip: string }> = [
  { key: "idea", label: "Idea", hint: "Not committed yet", chip: "bg-secondary text-muted-foreground" },
  { key: "planned", label: "Planned", hint: "We're sending this", chip: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300" },
  { key: "scheduled", label: "Scheduled", hint: "Built and scheduled in Klaviyo", chip: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  { key: "sent", label: "Sent", hint: "Gone out", chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
];

export function emailStatus(key: string) {
  return EMAIL_STATUS_OPTIONS.find(s => s.key === key) ?? EMAIL_STATUS_OPTIONS[1];
}

export function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || "Someone";
}
