/**
 * Weekly lean to-do scheduler (Graeme, 2026-09-14): the reminder lands on
 * MONDAY for everyone, due Friday, doable any day — instead of appearing
 * lazily whenever someone first opened a page that week (which people who
 * don't work Fridays met too late, or as a Friday scramble).
 *
 * Runs at boot and then hourly; ensureWeeklyLeanTodosForAll is idempotent
 * on (assignee, lean_week_start), so the first run after Monday midnight
 * (London) seeds the whole team and every later run is a no-op unless
 * someone new was activated. Respects the weekly-review kill switch.
 * The route module is imported lazily to keep this lib out of the route
 * import cycle (same pattern as the other boot schedulers).
 */

const INTERVAL_MS = 60 * 60 * 1000;

export function startLeanTodoScheduler(): void {
  const run = async () => {
    // Fix this week's lesson first (19 Nov 2026): once a week has started,
    // writing or approving lessons can't switch it mid-week.
    try {
      const [{ fixWeek }, { mondayOf }, { londonDateString }] = await Promise.all([
        import("../routes/lean-curriculum"), import("../routes/morning-meetings"), import("./london-time"),
      ]);
      await fixWeek(mondayOf(londonDateString()));
    } catch (err) {
      console.warn("[lean-todos] fixing this week's lesson failed (will retry next hour):", err);
    }
    try {
      const { ensureWeeklyLeanTodosForAll } = await import("../routes/lean-reviews");
      await ensureWeeklyLeanTodosForAll();
    } catch (err) {
      console.warn("[lean-todos] weekly to-do sweep failed (will retry next hour):", err);
    }
    // Keep two weeks ahead: if the plan would run out, add and write the next
    // subject for the founder to approve. Never teaches it until it's locked.
    try {
      const { fillLeanPlanIfRunningOut } = await import("../routes/lean-curriculum");
      const r = await fillLeanPlanIfRunningOut();
      if (r.added) console.log(`[lean-plan] plan was running out — added ${r.added} (${r.reason})`);
    } catch (err) {
      console.warn("[lean-plan] running-out check failed (will retry next hour):", err);
    }
  };
  // First sweep shortly after boot — after migrations and seeding settle.
  setTimeout(run, 20_000);
  setInterval(run, INTERVAL_MS);
}
