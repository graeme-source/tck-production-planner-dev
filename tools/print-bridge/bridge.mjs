#!/usr/bin/env node
/**
 * TCK print bridge — runs on a factory PC, connects the cloud app to the
 * prep-room TSC label printer.
 *
 * Long-polls the app for queued print jobs and fires each job's TSPL at the
 * printer, then acks success/failure back. ~1 second from iPad tap to label.
 *
 * Two printer modes:
 *   PRINTER_MODE=tcp    — network printer (Ethernet/Wi-Fi): raw TSPL to
 *                         PRINTER_HOST:9100. Preferred.
 *   PRINTER_MODE=share  — USB printer shared from THIS Windows PC: the TSPL
 *                         is written to a temp file and raw-copied to the
 *                         share (share the printer as e.g. "TSC" first).
 *
 * Configuration (environment variables, or a .env file next to this script):
 *   APP_URL             e.g. https://<the live app>            (required)
 *   PRINT_BRIDGE_TOKEN  must match the server's                (required)
 *   PRINTER_MODE        tcp | share                            (default tcp)
 *   PRINTER_HOST        printer IP for tcp mode
 *   PRINTER_PORT        default 9100
 *   PRINTER_SHARE       Windows share name for share mode, e.g. TSC
 *   STATION             default prep
 *
 * Run it with:  node bridge.mjs
 * (See README.md for making it start automatically on boot.)
 */

import net from "node:net";
import { execFile } from "node:child_process";
import { writeFile, unlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── tiny .env loader (no dependencies to install on the factory PC) ──
try {
  const envText = await readFile(join(dirname(fileURLToPath(import.meta.url)), ".env"), "utf8");
  for (const line of envText.split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch { /* no .env — rely on real environment variables */ }

const APP_URL = (process.env.APP_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.PRINT_BRIDGE_TOKEN ?? "";
const MODE = process.env.PRINTER_MODE ?? "tcp";
const HOST = process.env.PRINTER_HOST ?? "";
const PORT = Number(process.env.PRINTER_PORT ?? 9100);
const SHARE = process.env.PRINTER_SHARE ?? "";
const STATION = process.env.STATION ?? "prep";

if (!APP_URL || !TOKEN) {
  console.error("APP_URL and PRINT_BRIDGE_TOKEN must be set (env or .env file).");
  process.exit(1);
}
if (MODE === "tcp" && !HOST) {
  console.error("PRINTER_MODE=tcp needs PRINTER_HOST (the printer's IP).");
  process.exit(1);
}
if (MODE === "share" && !SHARE) {
  console.error("PRINTER_MODE=share needs PRINTER_SHARE (the Windows printer share name).");
  process.exit(1);
}

const log = (...a) => console.log(new Date().toISOString(), ...a);

function printTcp(tspl) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: HOST, port: PORT, timeout: 10_000 });
    sock.on("connect", () => sock.end(tspl, "latin1"));
    sock.on("close", resolve);
    sock.on("timeout", () => { sock.destroy(); reject(new Error(`Printer ${HOST}:${PORT} timed out`)); });
    sock.on("error", err => reject(new Error(`Printer ${HOST}:${PORT}: ${err.message}`)));
  });
}

async function printShare(tspl) {
  const file = join(tmpdir(), `tck-label-${Date.now()}.prn`);
  await writeFile(file, tspl, "latin1");
  try {
    await new Promise((resolve, reject) => {
      execFile("cmd.exe", ["/c", "copy", "/b", file, `\\\\localhost\\${SHARE}`], (err, _out, stderr) =>
        err ? reject(new Error(stderr || err.message)) : resolve());
    });
  } finally {
    await unlink(file).catch(() => {});
  }
}

const printJob = MODE === "tcp" ? printTcp : printShare;

async function api(path, opts = {}) {
  const res = await fetch(`${APP_URL}/api/print-jobs${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(opts.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text().catch(() => "")}`);
  return res.json();
}

log(`TCK print bridge starting — station=${STATION}, mode=${MODE}, target=${MODE === "tcp" ? `${HOST}:${PORT}` : `\\\\localhost\\${SHARE}`}`);

for (;;) {
  try {
    const { jobs } = await api(`/pending?station=${encodeURIComponent(STATION)}&wait=25`);
    for (const job of jobs ?? []) {
      try {
        await printJob(job.tspl);
        await api(`/${job.id}/complete`, { method: "POST", body: JSON.stringify({ ok: true }) });
        log(`printed job ${job.id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`job ${job.id} FAILED: ${message}`);
        await api(`/${job.id}/complete`, { method: "POST", body: JSON.stringify({ ok: false, error: message.slice(0, 500) }) })
          .catch(e => log(`ack failed too: ${e.message}`));
      }
    }
  } catch (err) {
    // App unreachable (or mid-deploy): keep calm, retry shortly. Jobs queue
    // server-side and print the moment we're back.
    log(`poll error: ${err instanceof Error ? err.message : err}`);
    await new Promise(r => setTimeout(r, 5000));
  }
}
