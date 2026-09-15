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
    try {
      const { ensureWeeklyLeanTodosForAll } = await import("../routes/lean-reviews");
      await ensureWeeklyLeanTodosForAll();
    } catch (err) {
      console.warn("[lean-todos] weekly to-do sweep failed (will retry next hour):", err);
    }
  };
  // First sweep shortly after boot — after migrations and seeding settle.
  setTimeout(run, 20_000);
  setInterval(run, INTERVAL_MS);
}
