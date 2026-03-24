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

  const currentDay = fromDate.getDay();

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
  return date.toISOString().split("T")[0];
}

export function getOrderDayLabel(
  orderDayTarget: string | Date | null,
  orderFrequency: string,
): string {
  if (orderFrequency === "daily") return "Due today";
  if (!orderDayTarget) return "Due today";

  const target = typeof orderDayTarget === "string" ? new Date(orderDayTarget) : orderDayTarget;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDay = new Date(target);
  targetDay.setHours(0, 0, 0, 0);

  const diffMs = targetDay.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return "Due today";
  if (diffDays === 1) return "Due tomorrow";

  const dayName = WEEKDAY_NAMES[targetDay.getDay()];
  return `Waiting for ${dayName}`;
}

export function isDueToday(orderDayTarget: string | Date | null, orderFrequency: string): boolean {
  if (orderFrequency === "daily") return true;
  if (!orderDayTarget) return true;

  const target = typeof orderDayTarget === "string" ? new Date(orderDayTarget) : orderDayTarget;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDay = new Date(target);
  targetDay.setHours(0, 0, 0, 0);

  return targetDay.getTime() <= today.getTime();
}
