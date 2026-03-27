export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let remaining = days;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      remaining--;
    }
  }
  return d;
}

export function nextBusinessDay(d: Date, direction: 1 | -1): Date {
  const result = new Date(d);
  do {
    result.setDate(result.getDate() + direction);
  } while (result.getDay() === 0 || result.getDay() === 6);
  return result;
}

export function calcExpectedDeliveryDate(leadTimeDays = 1, cutoffTime = "17:00"): Date {
  const now = new Date();
  const [cutH, cutM] = cutoffTime.split(":").map(Number);
  const isBeforeCutoff = now.getHours() < cutH || (now.getHours() === cutH && now.getMinutes() < cutM);
  const days = isBeforeCutoff ? leadTimeDays : leadTimeDays + 1;
  return addBusinessDays(now, days);
}

export function formatDeliveryDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
