// Labels for the NEXT pack day on the pack report and the morning-meeting
// production table. The dashboard's `tomorrow` is the next DISPATCH day —
// calendar tomorrow Mon–Thu, Monday on a Friday, bank holidays skipped — so
// a hard-coded "tomorrow" mislabels it: on a Friday afternoon the next pack
// is Monday's, and "Left to dispatch tomorrow · 0" read as a real (empty)
// Saturday dispatch.

/** "tomorrow" when packDate is literally the next calendar day after today,
 *  otherwise the weekday name ("Monday"). Both dates are YYYY-MM-DD. */
export function packDayName(today: string, packDate: string): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  if (d.toISOString().slice(0, 10) === packDate) return "tomorrow";
  return new Date(`${packDate}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
}

/** Capitalised for titles: "Tomorrow", "Monday". */
export function packDayNameCap(today: string, packDate: string): string {
  const name = packDayName(today, packDate);
  return name.charAt(0).toUpperCase() + name.slice(1);
}
