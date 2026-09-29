import { describe, it, expect } from "vitest";
import {
  buildTestBoxSchedule, calendarMilestones, latestOrderDay, prevWorkingDay, subtractWorkingDays,
  supplierOrderBy, DEFAULT_LEAD_DAYS, type ScheduleInput,
} from "./test-box-schedule";

const base: ScheduleInput = {
  deliveryDate: "2026-10-17", // Saturday
  audience: "vip_then_public",
  sellingDays: 14,
  ordersCloseDays: 2,
  bufferDays: 2,
  vipHeadStartDays: 3,
  bufferPct: 25,
  expectedBoxes: 40,
  recipes: ["Recipe A", "Recipe B"],
  suppliers: [
    { supplierId: 1, name: "Daily Foods", leadTimeDays: 1, cutoffTime: "17:00", orderFrequency: "daily", orderDays: null, items: ["Flour"] },
    { supplierId: 2, name: "Weekly Meats", leadTimeDays: 2, cutoffTime: "16:00", orderFrequency: "weekly", orderDays: "Monday", items: ["Pork"] },
    { supplierId: null, name: "No supplier set", leadTimeDays: null, cutoffTime: null, orderFrequency: null, orderDays: null, items: ["Sage"] },
  ],
  today: "2026-09-29",
};

describe("working-day helpers", () => {
  it("skips weekends going back", () => {
    expect(prevWorkingDay("2026-10-19")).toBe("2026-10-16"); // Mon → Fri
    expect(prevWorkingDay("2026-10-16")).toBe("2026-10-15");
    expect(subtractWorkingDays("2026-10-12", 2)).toBe("2026-10-08"); // Mon − 2 → Thu
    expect(subtractWorkingDays("2026-10-18", 0)).toBe("2026-10-16"); // Sunday → Friday
  });
  it("rolls back to a supplier's order day", () => {
    expect(latestOrderDay("2026-10-08", "Monday")).toBe("2026-10-05");
    expect(latestOrderDay("2026-10-08", "Monday,Thursday")).toBe("2026-10-08");
    expect(latestOrderDay("2026-10-08", null)).toBe("2026-10-08");
  });
  it("order-by = arrive-by minus lead time in working days", () => {
    expect(supplierOrderBy("2026-10-12", { leadTimeDays: 1, orderFrequency: "daily", orderDays: null })).toEqual({ date: "2026-10-09", assumed: false });
    expect(supplierOrderBy("2026-10-12", { leadTimeDays: null, orderFrequency: null, orderDays: null })).toEqual({ date: "2026-10-07", assumed: true });
  });
});

describe("buildTestBoxSchedule", () => {
  const s = buildTestBoxSchedule(base);

  it("walks back from a Saturday delivery", () => {
    expect(s.despatchDate).toBe("2026-10-16");   // Fri
    expect(s.productionDate).toBe("2026-10-15"); // Thu
    expect(s.prepDate).toBe("2026-10-14");       // Wed
    expect(s.ingredientsInBy).toBe("2026-10-12"); // Mon — 2 working days' buffer
    expect(s.ordersClose).toBe("2026-10-13");    // 2 working days before production
    expect(s.sellingStart).toBe("2026-09-29");   // 14 days before orders close
    expect(s.publicStart).toBe("2026-10-02");    // VIPs get 3 days
  });

  it("works out each supplier's order-by date", () => {
    const byKey = Object.fromEntries(s.tasks.map(t => [t.key, t]));
    expect(byKey["order-supplier-1"]).toMatchObject({ date: "2026-10-09", time: "17:00", beforeOrdersClose: true });
    expect(byKey["order-supplier-2"]).toMatchObject({ date: "2026-10-05", time: "16:00" }); // Mon only
    expect(byKey["order-supplier-none"]).toMatchObject({ date: "2026-10-07", assumed: true });
    expect(byKey["order-supplier-none"].detail).toContain(`${DEFAULT_LEAD_DAYS} working days`);
  });

  it("a bigger buffer brings the ingredient deadlines forward", () => {
    const wider = buildTestBoxSchedule({ ...base, bufferDays: 4 });
    expect(wider.ingredientsInBy).toBe("2026-10-08");
    expect(wider.tasks.find(t => t.key === "order-supplier-1")!.date).toBe("2026-10-07");
  });

  it("packs to make = expected boxes plus the buffer, rounded up", () => {
    expect(s.packsPerRecipe).toBe(50);
    expect(buildTestBoxSchedule({ ...base, expectedBoxes: 33 }).packsPerRecipe).toBe(42);
    expect(buildTestBoxSchedule({ ...base, expectedBoxes: null }).packsPerRecipe).toBeNull();
  });

  it("tasks come out in date order with stable keys", () => {
    const dates = s.tasks.map(t => t.date);
    expect([...dates].sort()).toEqual(dates);
    expect(s.tasks[0].key).toBe("sell-start");
    expect(s.tasks[s.tasks.length - 1].key).toBe("delivery");
    expect(new Set(s.tasks.map(t => t.key)).size).toBe(s.tasks.length);
  });

  it("public-only boxes have no public launch; VIP-only says so", () => {
    expect(buildTestBoxSchedule({ ...base, audience: "public" }).publicStart).toBeNull();
    const vip = buildTestBoxSchedule({ ...base, audience: "vip" });
    expect(vip.publicStart).toBeNull();
    expect(vip.tasks[0].detail).toContain("VIP");
  });

  it("warns about a non-delivery day, late deadlines and missing suppliers", () => {
    const monday = buildTestBoxSchedule({ ...base, deliveryDate: "2026-10-19" });
    expect(monday.warnings.join(" ")).toContain("Tuesday to Saturday");
    const soon = buildTestBoxSchedule({ ...base, deliveryDate: "2026-10-03" });
    expect(soon.tasks.find(t => t.key === "sell-start")!.past).toBe(true);
    expect(soon.warnings.join(" ")).toContain("already behind us");
    expect(s.warnings.join(" ")).toContain("no supplier set");
  });

  it("moving the delivery date moves every deadline", () => {
    const later = buildTestBoxSchedule({ ...base, deliveryDate: "2026-10-24" });
    expect(later.productionDate).toBe("2026-10-22");
    expect(later.sellingStart).toBe("2026-10-06");
  });

  it("calendar milestones are the key deadlines, in order", () => {
    const m = calendarMilestones(s);
    expect(m.map(x => x.label)).toEqual([
      "Public launch", "First ingredient order (Weekly Meats)", "Orders close", "Prep & dough", "Production", "Delivery",
    ]);
  });
});
