import { describe, expect, it } from "vitest";
import { docNameFor, parseDocName, printRun } from "./back-labels.mjs";
import { parseJobStatus } from "./windows-print.mjs";

/**
 * A pretend label printer behind a pretend Windows queue. Windows prints
 * the queue in order; each label takes `ticksToPrint` polls. When the roll
 * is empty the label in the printer comes out half-printed (wasted) and the
 * job sits in "Error, PaperOut" until a new roll goes in, then Windows
 * prints THAT job again — what a real spooler does. `good` is every label
 * that came out whole, by document name.
 */
function fakePrinter({ roll = Infinity, ticksToPrint = 2, vanishFast = false, neverPrints = false } = {}) {
  const st = { roll, queue: [], nextId: 500, good: [], wasted: 0, submitted: [], removed: [] };
  const text = j => (j.state === "error" ? "Error, PaperOut, Printing" : j.state === "deleting" ? "Deleting" : "Printing");
  const tick = () => {
    const head = st.queue[0];
    if (!head || neverPrints) return;
    if (head.state === "deleting") { st.queue.shift(); return; }
    if (head.state === "error") {
      if (st.roll > 0) { head.state = "printing"; head.ticks = 0; } // Windows restarts the one job
      return;
    }
    head.ticks++;
    if (head.ticks < ticksToPrint) return;
    if (st.roll <= 0) { head.state = "error"; st.wasted++; return; }
    st.roll--;
    st.good.push(head.docName);
    st.queue.shift();
  };
  return {
    st,
    tick,
    loadRoll(n) { st.roll = n; },
    async check() { return { ok: true }; },
    async submit(_pdf, docName) {
      st.submitted.push(docName);
      const job = { id: st.nextId++, docName, ticks: 0, state: "printing" };
      st.queue.push(job);
      if (vanishFast && st.roll > 0 && st.queue.length === 1) { st.roll--; st.good.push(docName); st.queue.shift(); }
    },
    async poll() {
      return {
        printer: { reason: null, text: "" },
        jobs: st.queue.map(j => ({ id: j.id, docName: j.docName, text: text(j), flags: parseJobStatus(text(j)) })),
      };
    },
    async remove(id) { st.removed.push(id); st.queue = st.queue.filter(j => j.id !== id); },
  };
}

/** The app as the bridge sees it: progress/finish recorded; `onProgress`
 *  can answer stop (cancel) or a bigger total (print N more). */
function fakeApi({ total, onProgress } = {}) {
  const calls = { progress: [], finish: [], labels: [] };
  let t = total;
  return {
    calls,
    async label(_id, seq) { calls.labels.push(seq); return new Uint8Array([seq]); },
    async progress(_id, body) {
      calls.progress.push(body);
      const extra = onProgress?.(body, calls) ?? {};
      if (extra.total) t = extra.total;
      return { stop: !!extra.stop, total: t, printed: body.printed };
    },
    async finish(_id, body) { calls.finish.push(body); return { state: "done" }; },
  };
}

function memStore(start = {}) {
  const data = { ...start };
  return { data, async load(id) { return data[id] ?? null; }, async save(id, n) { data[id] = n; }, async clear(id) { delete data[id]; } };
}

/** A fake clock: every sleep moves time on and lets the printer work. */
function clock(printer, onSleep) {
  let t = 0;
  return {
    now: () => t,
    sleep: async ms => { t += ms; printer.tick(); onSleep?.(t); },
  };
}

const JOB = 7;
const seqsOf = names => names.map(n => parseDocName(n).seq);

async function run({ total, printed = 0, printer, api, store = memStore(), config = {}, onSleep }) {
  const c = clock(printer, onSleep);
  const out = await printRun({ id: JOB, total, printed }, {
    api, printer, store, bridgeId: "wrap-pc", now: c.now, sleep: c.sleep, config: { pollMs: 400, stuckMs: 30_000, ...config },
  });
  return { out, store };
}

describe("document names", () => {
  it("names each label so the bridge can find it in the Windows queue", () => {
    expect(docNameFor(12, 3)).toBe("tck-bl-12-3");
    expect(parseDocName("C:\\Temp\\tck-bl-12-3.pdf")).toEqual({ jobId: 12, seq: 3 });
    expect(parseDocName("Microsoft Word - Document1")).toBeNull();
  });
});

describe("printing a run one label per Windows job", () => {
  it("prints every label once and reports after each", async () => {
    const printer = fakePrinter();
    const api = fakeApi({ total: 5 });
    const { out } = await run({ total: 5, printer, api });
    expect(out).toMatchObject({ outcome: "done", printed: 5 });
    expect(seqsOf(printer.st.good)).toEqual([0, 1, 2, 3, 4]);
    expect(printer.st.submitted).toHaveLength(5);
    const counts = api.calls.progress.map(p => p.printed);
    expect(counts).toEqual([...counts].sort((a, b) => a - b)); // only ever up
    expect(counts).toContain(1);
    expect(counts).toContain(5);
    expect(api.calls.finish).toEqual([{ bridgeId: "wrap-pc", printed: 5, ok: true, error: null }]);
  });

  it("never has more than one label in the Windows queue by default", async () => {
    const printer = fakePrinter();
    let most = 0;
    await run({ total: 6, printer, api: fakeApi({ total: 6 }), onSleep: () => { most = Math.max(most, printer.st.queue.length); } });
    expect(most).toBe(1);
  });

  it("counts a label that left the queue before the first look", async () => {
    const printer = fakePrinter({ vanishFast: true });
    const { out } = await run({ total: 3, printer, api: fakeApi({ total: 3 }) });
    expect(out.printed).toBe(3);
    expect(printer.st.submitted).toHaveLength(3);
  });
});

describe("out of labels mid-run (the 27 Nov problem)", () => {
  it("pauses with the count, sends nothing more, and carries on by itself after the new roll — no extra labels", async () => {
    const printer = fakePrinter({ roll: 3 });
    const api = fakeApi({ total: 6 });
    let submittedWhilePaused = 0;
    let rollIn = false;
    const onSleep = () => {
      const last = api.calls.progress.at(-1);
      if (last?.paused === "out-of-labels" && !rollIn) {
        submittedWhilePaused = printer.st.submitted.length;
        rollIn = true;
        printer.loadRoll(100); // the packer puts a new roll in
      }
    };
    const { out } = await run({ total: 6, printer, api, onSleep });

    const pause = api.calls.progress.find(p => p.paused === "out-of-labels");
    expect(pause).toMatchObject({ printed: 3, paused: "out-of-labels" });
    expect(pause.detail).toMatch(/PaperOut/);
    expect(submittedWhilePaused).toBe(4); // labels 1–3 printed, label 4 waiting — nothing after it
    expect(out).toMatchObject({ outcome: "done", printed: 6 });
    expect(seqsOf(printer.st.good)).toEqual([0, 1, 2, 3, 4, 5]); // every label exactly once
    expect(printer.st.wasted).toBe(1); // only the half-printed one, like Label LIVE
    expect(printer.st.submitted).toHaveLength(6);
    expect(api.calls.progress.at(-1)).toMatchObject({ printed: 6, paused: null });
  });

  it("with two labels allowed in the queue the count is still exact", async () => {
    const printer = fakePrinter({ roll: 4 });
    const api = fakeApi({ total: 8 });
    let rollIn = false;
    const onSleep = () => {
      if (!rollIn && api.calls.progress.some(p => p.paused === "out-of-labels")) { rollIn = true; printer.loadRoll(100); }
    };
    const { out } = await run({ total: 8, printer, api, onSleep, config: { depth: 2 } });
    expect(out.printed).toBe(8);
    expect(seqsOf(printer.st.good)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(printer.st.submitted).toHaveLength(8);
    expect(printer.st.wasted).toBe(1);
  });

  it("a label that sits without printing pauses the run as stuck", async () => {
    const printer = fakePrinter({ neverPrints: true });
    const api = fakeApi({ total: 3, onProgress: b => (b.paused === "stuck" ? { stop: true } : {}) });
    const { out } = await run({ total: 3, printer, api, config: { stuckMs: 5000 } });
    expect(api.calls.progress.some(p => p.paused === "stuck" && p.printed === 0)).toBe(true);
    expect(out).toMatchObject({ outcome: "cancelled", printed: 0 });
    expect(printer.st.removed).toHaveLength(1); // the stuck label is taken out of the queue
  });
});

describe("cancel and print N more", () => {
  it("cancel stops the rest; the label printing finishes and counts", async () => {
    const printer = fakePrinter();
    const api = fakeApi({ total: 10, onProgress: b => (b.printed >= 3 ? { stop: true } : {}) });
    const { out } = await run({ total: 10, printer, api, config: { depth: 2 } });
    expect(out.outcome).toBe("cancelled");
    expect(printer.st.good.length).toBe(out.printed);
    expect(out.printed).toBeLessThanOrEqual(4);
    expect(printer.st.submitted.length).toBeLessThanOrEqual(5);
    expect(api.calls.finish[0]).toMatchObject({ printed: out.printed, ok: true });
  });

  it("cancel while out of labels takes the waiting label out, so nothing prints when the roll goes in", async () => {
    const printer = fakePrinter({ roll: 2 });
    const api = fakeApi({ total: 6, onProgress: b => (b.paused === "out-of-labels" ? { stop: true } : {}) });
    const { out } = await run({ total: 6, printer, api });
    expect(out).toMatchObject({ outcome: "cancelled", printed: 2 });
    expect(printer.st.removed).toHaveLength(1);
    printer.loadRoll(100);
    for (let i = 0; i < 10; i++) printer.tick();
    expect(printer.st.good).toHaveLength(2);
  });

  it("print N more while printing carries on to the new total", async () => {
    let grown = false;
    const api = fakeApi({ total: 4, onProgress: b => (b.printed === 2 && !grown ? ((grown = true), { total: 6 }) : {}) });
    const printer = fakePrinter();
    const { out } = await run({ total: 4, printer, api });
    expect(out.printed).toBe(6);
    expect(seqsOf(printer.st.good)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("restarts never print a label twice", () => {
  it("carries on from the server's printed count", async () => {
    const printer = fakePrinter();
    const { out } = await run({ total: 5, printed: 3, printer, api: fakeApi({ total: 5 }) });
    expect(out.printed).toBe(5);
    expect(seqsOf(printer.st.good)).toEqual([3, 4]);
  });

  it("trusts the bridge's own saved count when the app missed the last report", async () => {
    const printer = fakePrinter();
    const api = fakeApi({ total: 5 });
    const { out } = await run({ total: 5, printed: 3, store: memStore({ [JOB]: 4 }), printer, api });
    expect(seqsOf(printer.st.good)).toEqual([4]);
    expect(api.calls.progress[0].printed).toBe(4);
    expect(out.printed).toBe(5);
  });

  it("finds its label still waiting in the Windows queue and doesn't send it again", async () => {
    // The old bridge sent label 4 (seq 3), the roll ran out, the PC restarted.
    const printer = fakePrinter({ roll: 0 });
    printer.st.queue.push({ id: 42, docName: "C:\\Temp\\tck-bl-7-3.pdf", ticks: 0, state: "error" });
    const api = fakeApi({ total: 6 });
    let rollIn = false;
    const onSleep = () => { if (!rollIn && api.calls.progress.some(p => p.paused === "out-of-labels")) { rollIn = true; printer.loadRoll(100); } };
    const { out } = await run({ total: 6, printed: 3, printer, api, onSleep });
    expect(out.printed).toBe(6);
    expect(seqsOf(printer.st.good)).toEqual([3, 4, 5]);
    expect(printer.st.submitted.map(n => parseDocName(n).seq)).toEqual([4, 5]);
  });

  it("works out from the queue what came out before a crash", async () => {
    // Server knows 2; the queue still holds label seq 4 — so 2 and 3 came out.
    const printer = fakePrinter();
    printer.st.queue.push({ id: 43, docName: "tck-bl-7-4.pdf", ticks: 0, state: "printing" });
    const { out } = await run({ total: 6, printed: 2, printer, api: fakeApi({ total: 6 }) });
    expect(out.printed).toBe(6);
    expect(printer.st.submitted.map(n => parseDocName(n).seq)).toEqual([5]);
  });
});

describe("when something goes wrong", () => {
  it("a missing printer fails the run with a plain reason", async () => {
    const printer = { ...fakePrinter(), check: async () => ({ ok: false, error: 'Windows has no printer called "Godex"' }) };
    const api = fakeApi({ total: 3 });
    const { out } = await run({ total: 3, printer, api });
    expect(out.outcome).toBe("failed");
    expect(api.calls.finish[0]).toMatchObject({ ok: false, error: 'Windows has no printer called "Godex"', printed: 0 });
  });

  it("a label deleted in Windows before it printed is sent again", async () => {
    const printer = fakePrinter({ ticksToPrint: 3 });
    let deleted = false;
    const onSleep = () => {
      const head = printer.st.queue[0];
      if (!deleted && head && parseDocName(head.docName).seq === 1) { deleted = true; head.state = "deleting"; }
    };
    const { out } = await run({ total: 3, printer, api: fakeApi({ total: 3 }), onSleep });
    expect(out.printed).toBe(3);
    expect(seqsOf(printer.st.good).sort()).toEqual([0, 1, 2]);
  });

  it("keeps printing when the app can't be reached, and keeps the count locally", async () => {
    const printer = fakePrinter();
    const api = { ...fakeApi({ total: 3 }), progress: async () => { throw new Error("offline"); } };
    const store = memStore();
    const { out } = await run({ total: 3, printer, api, store });
    expect(out.printed).toBe(3);
    expect(printer.st.good).toHaveLength(3);
  });
});
