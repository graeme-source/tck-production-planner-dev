import { describe, it, expect } from "vitest";
import {
  buildTestBoxSchedule, buildDeliverySchedule, buildLaunchTasks, calendarMilestones, calendarSpan, allTasks,
  latestOrderDay, prevWorkingDay, subtractWorkingDays, supplierOrderBy, vipWindowEnd, deliveryTaskKey,
  DEFAULT_LEAD_DAYS, SPECIALIST_EXTRA_WORKING_DAYS, VIP_GUARANTEE_HOURS,
  type DeliveryInput, type ScheduleInput, type SupplierLead,
} from "./test-box-schedule";
import { LAUNCH_CHECKLIST, launchTaskKey } from "./test-box-launch-checklist";

const daily: SupplierLead = { supplierId: 1, name: "Daily Foods", leadTimeDays: 1, cutoffTime: "17:00", orderFrequency: "daily", orderDays: null, items: ["Flour"], specialistItems: [] };
const weekly: SupplierLead = { supplierId: 2, name: "Weekly Meats", leadTimeDays: 2, cutoffTime: "16:00", orderFrequency: "weekly", orderDays: "Monday", items: ["Pork"], specialistItems: [] };
const none: SupplierLead = { supplierId: null, name: "No supplier set", leadTimeDays: null, cutoffTime: null, orderFrequency: null, orderDays: null, items: ["Sage"], specialistItems: [] };

const d1: DeliveryInput = { id: 7, deliveryDate: "2026-10-17", expectedBoxes: 40, status: "open", addedOn: "2026-09-29", closedOn: null, productionMix: null };

const base: ScheduleInput = {
  boxName: "Autumn Box",
  launchDate: "2026-10-05", // Monday
  publicLaunchDate: null,
  plannedOn: "2026-09-29",
  ordersCloseDays: 2,
  bufferDays: 2,
  bufferPct: 25,
  recipes: ["Recipe A", "Recipe B"],
  suppliers: [daily, weekly, none],
  deliveries: [d1],
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
  it("order-by = arrive-by minus lead time (plus any extra) in working days", () => {
    expect(supplierOrderBy("2026-10-12", { leadTimeDays: 1, orderFrequency: "daily", orderDays: null })).toEqual({ date: "2026-10-09", assumed: false });
    expect(supplierOrderBy("2026-10-12", { leadTimeDays: null, orderFrequency: null, orderDays: null })).toEqual({ date: "2026-10-07", assumed: true });
    expect(supplierOrderBy("2026-10-12", { leadTimeDays: 1, orderFrequency: "daily", orderDays: null }, 2)).toEqual({ date: "2026-10-07", assumed: false });
  });
});

describe("one delivery's chain", () => {
  const s = buildDeliverySchedule(d1, base);
  const byKey = Object.fromEntries(s.tasks.map(t => [t.key, t]));

  it("walks back from a Saturday delivery", () => {
    expect(s.despatchDate).toBe("2026-10-16");   // Fri
    expect(s.productionDate).toBe("2026-10-15"); // Thu
    expect(s.prepDate).toBe("2026-10-14");       // Wed
    expect(s.ingredientsInBy).toBe("2026-10-12"); // Mon — 2 working days' buffer
  });

  it("with no specialist ingredients, the latest close is production minus ordersCloseDays", () => {
    expect(s.latestClose).toBe("2026-10-13");
    expect(s.closeDriver).toEqual({ reason: "standard" });
    expect(byKey["d7:close-orders"]).toMatchObject({ date: "2026-10-13", label: "Close orders for 17 Oct (latest)" });
  });

  it("works out each supplier's order-by date, keyed to the delivery", () => {
    expect(byKey["d7:order-supplier-1"]).toMatchObject({ date: "2026-10-09", time: "17:00", beforeOrdersClose: true, deliveryId: 7 });
    expect(byKey["d7:order-supplier-2"]).toMatchObject({ date: "2026-10-05", time: "16:00" }); // Mon only
    expect(byKey["d7:order-supplier-none"]).toMatchObject({ date: "2026-10-07", assumed: true });
    expect(byKey["d7:order-supplier-none"].detail).toContain(`${DEFAULT_LEAD_DAYS} working days`);
  });

  it("specialist ingredients get +2 working days and set the latest close date", () => {
    const special: SupplierLead = { ...daily, items: ["Flour"], specialistItems: ["Properoni pepperoni"] };
    const sp = buildDeliverySchedule(d1, { ...base, suppliers: [special, weekly] });
    const t = Object.fromEntries(sp.tasks.map(x => [x.key, x]));
    // Normal: in by Mon 12 − 1 = Fri 9. Specialist: − (1 + 2) = Wed 7.
    expect(SPECIALIST_EXTRA_WORKING_DAYS).toBe(2);
    expect(t["d7:order-supplier-1"].date).toBe("2026-10-09");
    expect(t["d7:order-supplier-1-specialist"]).toMatchObject({ date: "2026-10-07", specialist: true, items: ["Properoni pepperoni"] });
    expect(sp.latestClose).toBe("2026-10-07");
    expect(sp.closeDriver).toEqual({ reason: "specialist", supplier: "Daily Foods", items: ["Properoni pepperoni"] });
    expect(t["d7:close-orders"].detail).toContain("Properoni pepperoni");
  });

  it("a specialist order-by later than the standard close never pushes the close later", () => {
    const quick: SupplierLead = { ...daily, leadTimeDays: 0, items: [], specialistItems: ["Odd herb"] };
    const sp = buildDeliverySchedule(d1, { ...base, suppliers: [quick], ordersCloseDays: 6 });
    expect(sp.latestClose).toBe(subtractWorkingDays("2026-10-15", 6));
    expect(sp.closeDriver.reason).toBe("standard");
  });

  it("a bigger buffer brings the ingredient deadlines forward", () => {
    const wider = buildDeliverySchedule(d1, { ...base, bufferDays: 4 });
    expect(wider.ingredientsInBy).toBe("2026-10-08");
    expect(wider.tasks.find(t => t.key === "d7:order-supplier-1")!.date).toBe("2026-10-07");
  });

  it("packs to make = expected boxes plus the buffer, rounded up", () => {
    expect(s.packsPerRecipe).toBe(50);
    expect(buildDeliverySchedule({ ...d1, expectedBoxes: 33 }, base).packsPerRecipe).toBe(42);
    expect(buildDeliverySchedule({ ...d1, expectedBoxes: null }, base).packsPerRecipe).toBeNull();
  });

  it("tasks come out in date order with stable, delivery-scoped keys", () => {
    const dates = s.tasks.map(t => t.date);
    expect([...dates].sort()).toEqual(dates);
    expect(s.tasks[s.tasks.length - 1].key).toBe("d7:delivery");
    expect(s.tasks.every(t => t.key.startsWith("d7:"))).toBe(true);
    expect(new Set(s.tasks.map(t => t.key)).size).toBe(s.tasks.length);
    expect(deliveryTaskKey(7, "prep")).toBe("d7:prep");
  });

  it("while open, the after-close steps are listed but are not tasks yet", () => {
    expect(s.tasks.some(t => t.key === "d7:zapiet-off")).toBe(false);
    expect(s.afterClose.join(" ")).toContain("Turn off 17 Oct in Zapiet");
  });

  it("closing unlocks Zapiet off, queue production and the test/normal decision", () => {
    const closed = buildDeliverySchedule({ ...d1, status: "closed", closedOn: "2026-10-12" }, base);
    const t = Object.fromEntries(closed.tasks.map(x => [x.key, x]));
    expect(t["d7:zapiet-off"]).toMatchObject({ date: "2026-10-12", label: "Turn off 17 Oct in Zapiet for 'Autumn Box'" });
    expect(t["d7:queue-production"]).toMatchObject({ date: "2026-10-12", label: "Queue the test production for Thu 15 Oct", link: "/plans/queued?date=2026-10-15" });
    expect(t["d7:decide-mix"].label).toContain("test batches only, or test + normal production");
    expect(closed.afterClose).toEqual([]);
  });

  it("closing early: the queue step waits until a week before production", () => {
    const closed = buildDeliverySchedule({ ...d1, status: "closed", closedOn: "2026-10-01" }, base);
    expect(closed.tasks.find(t => t.key === "d7:queue-production")!.date).toBe("2026-10-08");
  });

  it("a cancelled delivery has no tasks and no warnings", () => {
    const c = buildDeliverySchedule({ ...d1, status: "cancelled" }, base);
    expect(c.tasks).toEqual([]);
    expect(c.warnings).toEqual([]);
  });

  it("warns about a non-delivery day, missing suppliers and no recipes", () => {
    expect(buildDeliverySchedule({ ...d1, deliveryDate: "2026-10-19" }, base).warnings.join(" ")).toContain("Tuesday to Saturday");
    expect(s.warnings.join(" ")).toContain("no supplier set");
    expect(buildDeliverySchedule(d1, { ...base, recipes: [], suppliers: [] }).warnings.join(" ")).toContain("No recipes yet");
  });

  it("warns when still open past the latest close date", () => {
    const late = buildDeliverySchedule(d1, { ...base, today: "2026-10-14" });
    expect(late.warnings.join(" ")).toContain("Still open after its latest close date (Tue 13 Oct)");
    const closed = buildDeliverySchedule({ ...d1, status: "closed", closedOn: "2026-10-13" }, { ...base, today: "2026-10-14" });
    expect(closed.warnings.join(" ")).not.toContain("Still open");
  });

  it("past deadlines count only when not ticked", () => {
    const soon = { ...base, today: "2026-10-10" };
    expect(buildDeliverySchedule(d1, soon).warnings.join(" ")).toContain("already behind us");
    const ticked = buildDeliverySchedule(d1, { ...soon, doneKeys: ["d7:order-supplier-1", "d7:order-supplier-2", "d7:order-supplier-none"] });
    expect(ticked.warnings.join(" ")).not.toContain("already behind us");
  });

  it("warns when orders would have to close inside the VIP 48 hours", () => {
    const tooSoon = buildDeliverySchedule({ ...d1, deliveryDate: "2026-10-09" }, { ...base, launchDate: "2026-10-05" });
    // Production Wed 7 → close Mon 5, before the window ends Wed 7.
    expect(tooSoon.latestClose).toBe("2026-10-05");
    expect(tooSoon.warnings.join(" ")).toContain(`guaranteed ${VIP_GUARANTEE_HOURS} hours`);
  });
});

describe("the launch checklist", () => {
  it("every template step has a key, title and how; keys are unique", () => {
    const keys = LAUNCH_CHECKLIST.map(s => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of LAUNCH_CHECKLIST) {
      expect(s.title({ boxName: "X", deliveryLabel: "1 Jan" }).length).toBeGreaterThan(5);
      expect(s.how({ boxName: "X" }).length).toBeGreaterThan(5);
      expect(s.automated).toBe(false);
    }
  });

  const { tasks, tightTimeline } = buildLaunchTasks(base);
  const byKey = Object.fromEntries(tasks.map(t => [t.key, t]));

  it("dates count back from the launch in working days", () => {
    // Launch Mon 5 Oct.
    expect(byKey["launch:shopify-products"].date).toBe("2026-09-30"); // Wed, −3
    expect(byKey["launch:shopify-collection"].label).toBe("Create a Shopify collection named 'Autumn Box' and add the products");
    expect(byKey["launch:discount-code"].date).toBe("2026-10-01");   // Thu, −2
    expect(byKey["launch:zapiet-collection"].date).toBe("2026-10-01");
    expect(byKey["launch:vip-email"].date).toBe("2026-10-05");
    expect(byKey["launch:social-post"].date).toBe("2026-10-05");
    expect(tightTimeline).toBe(false);
  });

  it("the VIP window is 48 hours and ends with a decision", () => {
    expect(vipWindowEnd("2026-10-05")).toBe("2026-10-07");
    expect(byKey["launch:vip-window-over"]).toMatchObject({ date: "2026-10-07" });
    expect(byKey["launch:vip-window-over"].label).toContain("keep selling, open to the public, or close");
  });

  it("one Zapiet step per delivery date, never due before the delivery was added", () => {
    const d2: DeliveryInput = { ...d1, id: 9, deliveryDate: "2026-10-24", addedOn: "2026-10-12" };
    const t = buildLaunchTasks({ ...base, deliveries: [d1, d2, { ...d1, id: 11, status: "cancelled" }] }).tasks;
    const z7 = t.find(x => x.key === launchTaskKey("zapiet-date", 7))!;
    const z9 = t.find(x => x.key === launchTaskKey("zapiet-date", 9))!;
    expect(z7).toMatchObject({ key: "launch:zapiet-date-d7", date: "2026-10-01", label: "Enable 17 Oct in Zapiet for 'Autumn Box'" });
    expect(z9.date).toBe("2026-10-12");
    expect(z9.clamped).toBeUndefined();
    expect(t.some(x => x.key === "launch:zapiet-date-d11")).toBe(false);
  });

  it("the public launch email only exists with a public launch date", () => {
    expect(byKey["launch:public-email"]).toBeUndefined();
    const withPublic = buildLaunchTasks({ ...base, publicLaunchDate: "2026-10-09" }).tasks;
    expect(withPublic.find(x => x.key === "launch:public-email")!.date).toBe("2026-10-09");
  });

  it("same-day launch: steps that would be in the past are due the planning day, flagged tight", () => {
    // Planned and launched Fri 2 Oct (the Properoni case).
    const r = buildLaunchTasks({ ...base, launchDate: "2026-10-02", plannedOn: "2026-10-02", today: "2026-10-02" });
    const k = Object.fromEntries(r.tasks.map(t => [t.key, t]));
    expect(r.tightTimeline).toBe(true);
    expect(k["launch:shopify-products"]).toMatchObject({ date: "2026-10-02", clamped: true, past: false });
    expect(k["launch:discount-code"]).toMatchObject({ date: "2026-10-02", clamped: true });
    expect(k["launch:vip-email"]).toMatchObject({ date: "2026-10-02" });
    expect(k["launch:vip-email"].clamped).toBeUndefined();
    expect(r.tasks.every(t => t.date >= "2026-10-02")).toBe(true);
  });

  it("the floor is the planning day, not today — an unticked step still goes overdue", () => {
    const r = buildLaunchTasks({ ...base, launchDate: "2026-10-02", plannedOn: "2026-10-02", today: "2026-10-06" });
    expect(r.tasks.find(t => t.key === "launch:shopify-products")).toMatchObject({ date: "2026-10-02", past: true });
  });
});

describe("the whole box", () => {
  it("one chain per delivery, sorted by date, cancelled ones kept but empty", () => {
    const d2: DeliveryInput = { ...d1, id: 9, deliveryDate: "2026-10-24", addedOn: "2026-10-01" };
    const s = buildTestBoxSchedule({ ...base, deliveries: [d2, d1] });
    expect(s.deliveries.map(d => d.id)).toEqual([7, 9]);
    expect(s.deliveries[1].productionDate).toBe("2026-10-22");
    const keys = allTasks(s).map(t => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("box warnings: recipes 2–4, no deliveries, public launch inside the VIP window, tight timeline", () => {
    expect(buildTestBoxSchedule({ ...base, recipes: ["A"] }).warnings.join(" ")).toContain("2–4 recipes");
    expect(buildTestBoxSchedule({ ...base, deliveries: [] }).warnings.join(" ")).toContain("Add a delivery date");
    expect(buildTestBoxSchedule({ ...base, publicLaunchDate: "2026-10-06" }).warnings.join(" ")).toContain("before VIPs' guaranteed");
    expect(buildTestBoxSchedule({ ...base, plannedOn: "2026-10-05" }).warnings.join(" ")).toContain("Tight timeline");
  });

  it("the calendar bar runs from launch to the last live delivery", () => {
    const d2: DeliveryInput = { ...d1, id: 9, deliveryDate: "2026-10-24", addedOn: "2026-10-01" };
    expect(calendarSpan(buildTestBoxSchedule({ ...base, deliveries: [d1, d2] }))).toEqual({ startDate: "2026-10-05", endDate: "2026-10-24" });
    expect(calendarSpan(buildTestBoxSchedule({ ...base, deliveries: [d1, { ...d2, status: "cancelled" }] }))).toEqual({ startDate: "2026-10-05", endDate: "2026-10-17" });
    expect(calendarSpan(buildTestBoxSchedule({ ...base, deliveries: [] }))).toEqual({ startDate: "2026-10-05", endDate: "2026-10-07" });
  });

  it("milestones: VIP launch, window end, public launch, and per delivery close/prep/production/delivery", () => {
    const one = calendarMilestones(buildTestBoxSchedule({ ...base, publicLaunchDate: "2026-10-08" }));
    expect(one.map(m => m.label)).toEqual([
      "VIP launch", "VIP-only window ends", "Public launch", "Close orders by", "Prep & dough", "Production", "Delivery",
    ]);
    const d2: DeliveryInput = { ...d1, id: 9, deliveryDate: "2026-10-24", addedOn: "2026-10-01", status: "closed", closedOn: "2026-10-16" };
    const two = calendarMilestones(buildTestBoxSchedule({ ...base, deliveries: [d1, d2] }));
    expect(two.map(m => m.label)).toContain("Delivery (17 Oct delivery)");
    expect(two.map(m => m.label)).toContain("Orders closed (24 Oct delivery)");
    expect(two.find(m => m.label === "Orders closed (24 Oct delivery)")!.date).toBe("2026-10-16");
  });

  it("the Properoni example: launch Fri 2 Oct, deliver Fri 16 Oct", () => {
    const s = buildTestBoxSchedule({
      ...base, boxName: "Properoni Test Box", launchDate: "2026-10-02", plannedOn: "2026-10-02", today: "2026-10-02",
      recipes: [], suppliers: [],
      deliveries: [{ id: 1, deliveryDate: "2026-10-16", expectedBoxes: null, status: "open", addedOn: "2026-10-02", closedOn: null, productionMix: null }],
    });
    const d = s.deliveries[0];
    expect(d.despatchDate).toBe("2026-10-15");
    expect(d.productionDate).toBe("2026-10-14");
    expect(d.prepDate).toBe("2026-10-13");
    expect(d.ingredientsInBy).toBe("2026-10-09");
    expect(d.latestClose).toBe("2026-10-12");
    expect(s.vipWindowEnds).toBe("2026-10-04");
    expect(s.tightTimeline).toBe(true);
  });
});
