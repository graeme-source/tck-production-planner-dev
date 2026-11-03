/**
 * Stage timings for a slow request, logged as ONE line so it can be read in
 * Railway's logs (Fix queue #376: the Orders page sat on "Calculating order
 * requirements…" for minutes and nobody could tell which step was slow).
 *
 *   const t = createStageTimer("[orders/calculate]");
 *   …; t.mark("recipes");
 *   …; t.mark("ledger");
 *   console.log(t.line());   // "[orders/calculate] recipes 120ms ledger 900ms total 1020ms"
 *
 * Each mark is the time since the previous mark. Cheap enough to leave in.
 */
export interface StageTimer {
  /** Close the current stage under this name. */
  mark(name: string): void;
  /** Milliseconds per stage, in order. */
  stages(): Array<[string, number]>;
  /** The log line: label, each stage, then the total. */
  line(extra?: string): string;
}

export function createStageTimer(label: string, now: () => number = () => performance.now()): StageTimer {
  const start = now();
  let last = start;
  const done: Array<[string, number]> = [];
  return {
    mark(name) {
      const t = now();
      done.push([name, Math.round(t - last)]);
      last = t;
    },
    stages: () => done.slice(),
    line(extra) {
      const parts = done.map(([n, ms]) => `${n} ${ms}ms`);
      parts.push(`total ${Math.round(now() - start)}ms`);
      return `${label} ${parts.join(" ")}${extra ? ` ${extra}` : ""}`;
    },
  };
}
