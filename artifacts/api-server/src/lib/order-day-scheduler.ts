import { londonDateString, londonStartOfDay, londonWeekdayName } from "./london-time";

const WEEKDAY_MAP: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Convert a date-or-string to the integer (0-6) weekday in London. */
function londonWeekdayNumber(d: Date): number {
  return WEEKDAY_MAP[londonWeekdayName(d)] ?? 0;
}

/** UTC midnight on the London date that contains `date`. */
function londonDayUTC(date: Date): Date {
  return new Date(`${londonDateString(date)}T00:00:00Z`);
}

export function computeNextOrderDay(
  orderFrequency: string,
  orderDays: string | null,
  fromDate: Date = new Date(),
): Date {
  if (orderFrequency === "daily") {
    return fromDate;
  }

  if (!orderDays) {
    return fromDate;
  }

  const dayNames = orderDays.split(",").map(d => d.trim()).filter(Boolean);
  const dayNumbers = dayNames
    .map(d => WEEKDAY_MAP[d])
    .filter(n => n !== undefined)
    .sort((a, b) => a - b);

  if (dayNumbers.length === 0) {
    return fromDate;
  }

  const currentDay = londonWeekdayNumber(fromDate);

  for (const dayNum of dayNumbers) {
    if (dayNum >= currentDay) {
      const diff = dayNum - currentDay;
      const target = new Date(fromDate);
      target.setDate(target.getDate() + diff);
      return target;
    }
  }

  const diff = 7 - currentDay + dayNumbers[0];
  const target = new Date(fromDate);
  target.setDate(target.getDate() + diff);
  return target;
}

export function formatOrderDayTarget(date: Date): string {
  return londonDateString(date);
}

export function getOrderDayLabel(
  orderDayTarget: string | Date | null,
  orderFrequency: string,
): string {
  if (orderFrequency === "daily") return "Due today";
  if (!orderDayTarget) return "Due today";

  const target = typeof orderDayTarget === "string" ? new Date(orderDayTarget) : orderDayTarget;
  const today = londonStartOfDay();
  const targetDay = londonDayUTC(target);

  const diffMs = targetDay.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return "Due today";
  if (diffDays === 1) return "Due tomorrow";

  const dayName = WEEKDAY_NAMES[londonWeekdayNumber(targetDay)];
  return `Waiting for ${dayName}`;
}

export function isDueToday(orderDayTarget: string | Date | null, orderFrequency: string): boolean {
  if (orderFrequency === "daily") return true;
  if (!orderDayTarget) return true;

  const target = typeof orderDayTarget === "string" ? new Date(orderDayTarget) : orderDayTarget;
  const today = londonStartOfDay();
  const targetDay = londonDayUTC(target);

  return targetDay.getTime() <= today.getTime();
}
