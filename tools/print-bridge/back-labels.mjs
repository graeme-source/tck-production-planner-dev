/**
 * Back-label runs on the wrapping PC — Label LIVE's behaviour (Graeme,
 * 27 Nov 2026). Objective C.
 *
 * Every label is its OWN Windows print job, sent through the printer's
 * normal driver, and the next one only goes once Windows says the last one
 * finished. So when the roll runs out, the label in the printer is the only
 * one Windows retries after the new roll goes in — the run then carries on
 * by itself from the exact count. The old one-PDF-per-run job made Windows
 * reprint the WHOLE run (50–60 extra labels on 27 Nov).
 *
 * The loop is pure apart from what it is handed — the app (`api`), the
 * printer (`printer`, windows-print.mjs on the PC, a fake in the tests), a
 * small progress file (`store`) and the clock — so it is tested with a fake
 * printer that runs out of labels mid-run (back-labels.test.mjs).
 *
 * The rules:
 *   - a label counted printed is never sent again (the count only goes up,
 *     here and on the server);
 *   - at most `depth` labels sit in the Windows queue (1 by default);
 *   - if Windows says error / out of paper / offline, or a label sits too
 *     long, nothing more is sent and the app is told why, with the count;
 *     it carries on when Windows finishes that label;
 *   - after a restart the bridge takes its own run back, finds its labels
 *     still in the Windows queue by name, and carries on from the count.
 */

import { readFile, writeFile, rename } from "node:fs/promises";
import { pauseReasonFor } from "./windows-print.mjs";

export const DOC_PREFIX = "tck-bl";

/** The Windows document name (and temp file name) of label `seq` of run `jobId`. */
export function docNameFor(jobId, seq) {
  return `${DOC_PREFIX}-${jobId}-${seq}`;
}

export function parseDocName(name) {
  const m = /tck-bl-(\d+)-(\d+)(?!\d)/.exec(String(name ?? ""));
  return m ? { jobId: Number(m[1]), seq: Number(m[2]) } : null;
}

export const DEFAULTS = {
  /** Labels allowed in the Windows queue at once. 1 = strictly one at a time. */
  depth: 1,
  /** How often the Windows queue is read while a label prints. */
  pollMs: 400,
  /** A label that sits this long without printing pauses the run as "stuck". */
  stuckMs: 30_000,
  /** Tell the app we're alive at least this often while waiting. */
  heartbeatMs: 10_000,
  /** Extra wait after each label before sending the next (0 = none). */
  settleMs: 0,
};

const errText = e => (e instanceof Error ? e.message : String(e));

/**
 * Print one claimed run to the end (or until cancelled / it fails).
 * `job` is the claim: { id, total, printed }.
 * Returns { printed, outcome: "done" | "cancelled" | "failed", error? }.
 */
export async function printRun(job, deps) {
  const { api, printer, store, bridgeId } = deps;
  const log = deps.log ?? (() => {});
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
  const cfg = { ...DEFAULTS, ...(deps.config ?? {}) };
  const depth = Math.max(1, Math.min(2, Math.floor(cfg.depth)));

  let total = job.total;
  let printed = Math.min(total, Math.max(job.printed, Number((await store.load(job.id)) ?? 0)));
  let paused = null;
  let detail = null;
  let stopping = false;
  let lastDoneAt = 0;
  let reported = { printed: job.printed, paused: undefined, at: 0 };
  let headSeq = null;

  const report = async force => {
    const due = force || printed !== reported.printed || paused !== reported.paused || now() - reported.at >= cfg.heartbeatMs;
    if (!due) return null;
    try {
      const r = await api.progress(job.id, { bridgeId, printed, paused, detail: paused ? detail : null });
      reported = { printed, paused, at: now() };
      return r;
    } catch (e) {
      // The app is unreachable: keep printing (the packer asked for these
      // labels) and keep the count locally; it is sent when the app is back.
      log(`run ${job.id}: progress not sent (${errText(e)}) — carrying on`);
      return null;
    }
  };

  const finishWith = async (ok, error) => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await api.finish(job.id, { bridgeId, printed, ok, error: error ?? null });
        break;
      } catch (e) {
        log(`run ${job.id}: finish not sent (${errText(e)}), try ${attempt}`);
        await sleep(3000);
      }
    }
    await store.clear?.(job.id);
    return { printed, outcome: ok ? (stopping ? "cancelled" : "done") : "failed", error };
  };

  const check = await printer.check();
  if (!check.ok) {
    log(`run ${job.id}: ${check.error}`);
    return finishWith(false, check.error);
  }

  // ── Labels this run already has in the Windows queue (a restart) ──
  /** In flight, oldest first: { seq, docName, winId, headSince, seenDeleting } */
  const inflight = [];
  let knownIds = new Set();
  try {
    const snap = await printer.poll();
    knownIds = new Set(snap.jobs.map(j => j.id));
    for (const wj of snap.jobs) {
      const p = parseDocName(wj.docName);
      if (p && p.jobId === job.id && p.seq >= printed && p.seq < total) {
        inflight.push({ seq: p.seq, docName: wj.docName, winId: wj.id, headSince: now(), seenDeleting: false });
      }
    }
  } catch (e) {
    log(`run ${job.id}: couldn't read the Windows queue (${errText(e)})`);
  }
  inflight.sort((a, b) => a.seq - b.seq);
  if (inflight.length) {
    // Windows prints in order, so every label before the oldest one still
    // waiting has come out.
    printed = Math.max(printed, inflight[0].seq);
    log(`run ${job.id}: found ${inflight.length} label(s) still in the Windows queue — not sending those again`);
  }
  let nextSeq = inflight.length ? inflight[inflight.length - 1].seq + 1 : printed;
  /** Labels deleted from the Windows queue before they printed — sent again. */
  const resend = [];
  if (printed > job.printed) await report(true);

  let prefetch = null;
  const fetchLabel = async seq => {
    if (prefetch && prefetch.seq === seq) {
      const p = prefetch.promise;
      prefetch = null;
      try { return await p; } catch { /* fall through to a fresh try */ }
    }
    for (let attempt = 1; ; attempt++) {
      try {
        return await api.label(job.id, seq);
      } catch (e) {
        if (attempt >= 5 || e?.status === 404 || e?.status === 410) throw e;
        log(`run ${job.id}: label ${seq + 1} download failed (${errText(e)}), retrying`);
        await sleep(2000);
      }
    }
  };

  const markPrinted = async () => {
    printed = Math.min(total, printed + 1);
    lastDoneAt = now();
    await store.save(job.id, printed);
  };

  for (;;) {
    // ── 1. Send labels while there's room in the queue ──
    while (!stopping && !paused && inflight.length < depth && (resend.length || nextSeq < total)) {
      if (cfg.settleMs > 0 && lastDoneAt && now() - lastDoneAt < cfg.settleMs) break;
      const seq = resend.length ? resend[0] : nextSeq;
      let pdf;
      try {
        pdf = await fetchLabel(seq);
      } catch (e) {
        return finishWith(false, `Couldn't fetch label ${seq + 1} from the app: ${errText(e)}`);
      }
      const docName = docNameFor(job.id, seq);
      try {
        await printer.submit(pdf, docName);
      } catch (e) {
        log(`run ${job.id}: label ${seq + 1} couldn't be sent to Windows: ${errText(e)}`);
        return finishWith(false, `Couldn't send a label to the printer: ${errText(e)}`);
      }
      if (resend.length) resend.shift(); else nextSeq++;
      inflight.push({ seq, docName, winId: null, headSince: now(), seenDeleting: false });
      const ahead = nextSeq;
      if (ahead < total && !prefetch) {
        prefetch = { seq: ahead, promise: api.label(job.id, ahead) };
        prefetch.promise.catch(() => {});
      }
    }

    // ── 2. Nothing left in flight: done, cancelled, or the run grew ──
    if (!inflight.length && (stopping || (!resend.length && nextSeq >= total))) {
      const r = await report(true);
      if (!stopping && r && !r.stop && r.total > total) {
        total = r.total;
        log(`run ${job.id}: ${total - printed} more asked for`);
        continue;
      }
      return finishWith(true);
    }

    // ── 3. Watch the Windows queue ──
    await sleep(cfg.pollMs);
    let snap = null;
    try {
      snap = await printer.poll();
    } catch (e) {
      log(`run ${job.id}: couldn't read the Windows queue (${errText(e)})`);
    }
    if (snap) {
      const taken = new Set(inflight.map(e => e.winId).filter(id => id != null));
      for (const e of inflight) {
        if (e.winId != null) continue;
        const byName = snap.jobs.find(j => !taken.has(j.id) && j.docName.includes(e.docName));
        // Fallback: a job Windows didn't have last time (in case the driver
        // names documents differently).
        const byNew = byName ? null : snap.jobs.find(j => !taken.has(j.id) && !knownIds.has(j.id) && !parseDocName(j.docName));
        const m = byName ?? byNew;
        if (m) { e.winId = m.id; taken.add(m.id); }
      }
      knownIds = new Set(snap.jobs.map(j => j.id));

      // Oldest first: has Windows finished with it?
      for (let i = 0; i < inflight.length; ) {
        const e = inflight[i];
        const wj = e.winId != null ? snap.jobs.find(j => j.id === e.winId) : null;
        if (!wj) {
          if (e.winId == null) {
            // Not in the queue on the first look after sending: Windows took
            // it and finished before we looked (SumatraPDF only returns once
            // the job is handed to Windows).
            inflight.splice(i, 1);
            await markPrinted();
          } else if (e.seenDeleting) {
            // Someone deleted it in Windows before it printed: send it again.
            inflight.splice(i, 1);
            resend.push(e.seq);
            log(`run ${job.id}: label ${e.seq + 1} was deleted in Windows before it printed — sending it again`);
          } else {
            // Left the queue normally = printed.
            inflight.splice(i, 1);
            await markPrinted();
          }
          continue;
        }
        if (wj.flags.deleting || wj.flags.deleted) e.seenDeleting = !wj.flags.printed;
        if (wj.flags.printed || wj.flags.complete) {
          // Printed (Windows may keep it listed when "Keep printed documents" is on).
          inflight.splice(i, 1);
          knownIds.add(wj.id);
          await markPrinted();
          continue;
        }
        i++;
      }
      if (inflight[0] && inflight[0].seq !== headSeq) {
        // A new label is at the front: its "stuck" clock starts now.
        headSeq = inflight[0].seq;
        inflight[0].headSince = now();
      }

      // Why we're waiting, if we are.
      const head = inflight[0];
      const wj = head && head.winId != null ? snap.jobs.find(j => j.id === head.winId) : null;
      let reason = head ? pauseReasonFor(wj?.flags ?? null, snap.printer) : null;
      if (head && !reason && now() - head.headSince > cfg.stuckMs) reason = "stuck";
      detail = reason ? [wj?.text, snap.printer?.text].filter(Boolean).join("; ") || null : null;
      if (reason !== paused) log(`run ${job.id}: ${reason ? `waiting — ${reason}${detail ? ` (${detail})` : ""}` : "printing again"} — ${printed} of ${total} printed`);
      paused = reason;
    }

    // ── 4. Tell the app; hear about cancel / more ──
    const r = await report(false);
    if (r) {
      if (r.total > total) total = r.total;
      if (r.stop && !stopping) {
        stopping = true;
        resend.length = 0;
        log(`run ${job.id}: cancelled at ${printed} of ${total}`);
      }
    }
    if (stopping) {
      // Take back what hasn't started. The label printing now finishes —
      // unless the printer is stuck, then it goes too (it would otherwise
      // print the moment the roll goes in).
      for (const e of inflight.slice(paused ? 0 : 1)) {
        if (e.winId != null) await printer.remove(e.winId).catch(err => log(`couldn't delete Windows job ${e.winId}: ${errText(err)}`));
      }
      inflight.splice(paused ? 0 : 1);
    }
  }
}

/** A tiny file next to the bridge with each run's printed count, written
 *  before the app is told — so a crash between the two never loses a count. */
export function fileStore(path) {
  const read = async () => {
    try { return JSON.parse(await readFile(path, "utf8")); } catch { return {}; }
  };
  const write = async data => {
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(data));
    await rename(tmp, path);
  };
  return {
    async load(id) { return (await read())[id] ?? null; },
    async save(id, printed) {
      const data = await read();
      data[id] = printed;
      // Keep the last 20 runs only.
      const keys = Object.keys(data).map(Number).sort((a, b) => b - a);
      for (const k of keys.slice(20)) delete data[k];
      await write(data);
    },
    async clear(id) {
      const data = await read();
      if (id in data) { delete data[id]; await write(data); }
    },
  };
}

/** The app's back-label bridge endpoints. */
export function createApi({ appUrl, token, station, bridgeId, fetchFn = fetch }) {
  const base = `${appUrl.replace(/\/$/, "")}/api/print-jobs/back-labels/bridge`;
  const call = async (path, opts = {}) => {
    const res = await fetchFn(`${base}${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers ?? {}) },
    });
    if (!res.ok) {
      const err = new Error(`${path}: HTTP ${res.status} ${await res.text().catch(() => "")}`);
      err.status = res.status;
      throw err;
    }
    return res;
  };
  return {
    async next(waitS = 25) {
      const res = await call(`/next?station=${encodeURIComponent(station)}&bridge=${encodeURIComponent(bridgeId)}&wait=${waitS}`);
      return (await res.json()).job ?? null;
    },
    async label(id, seq) {
      const res = await call(`/${id}/label/${seq}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async progress(id, body) {
      return (await call(`/${id}/progress`, { method: "POST", body: JSON.stringify(body) })).json();
    },
    async finish(id, body) {
      return (await call(`/${id}/finish`, { method: "POST", body: JSON.stringify(body) })).json();
    },
  };
}

/** The wrapping PC's main loop: wait for a run, print it, repeat. */
export async function runBackLabelBridge({ api, makePrinter, store, bridgeId, log, config, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  for (;;) {
    try {
      const job = await api.next(25);
      if (!job) continue;
      log(`run ${job.id}: ${job.title ?? "back labels"} — ${job.printed} of ${job.total} printed, printing on "${job.printerName}"`);
      const printer = makePrinter(job.printerName);
      const out = await printRun(job, { api, printer, store, bridgeId, log, config, sleep });
      log(`run ${job.id}: ${out.outcome} — ${out.printed} printed${out.error ? ` (${out.error})` : ""}`);
    } catch (e) {
      // App unreachable (or mid-deploy): keep calm, retry shortly.
      log(`poll error: ${errText(e)}`);
      await sleep(5000);
    }
  }
}
