/**
 * Printing one PDF label through the printer's normal Windows driver, and
 * reading the Windows print queue — for the back-label runs (back-labels.mjs).
 *
 * Nothing here depends on the printer's own language or model: a label is a
 * one-page PDF at the label size, printed by SumatraPDF at actual size
 * (`-print-settings noscale`) — the same as printing the PDF from Chrome at
 * 100 %, one label per Windows print job. The queue is read with PowerShell
 * (Get-PrintJob / Get-Printer), which every Windows 10/11 PC has.
 *
 * The parsers are pure and tested (windows-print.test.mjs). The functions
 * that run programs take an injectable `run` so nothing here needs Windows
 * to be tested.
 */

import { execFile } from "node:child_process";
import { writeFile, unlink, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Windows job status (MSFT_PrintJob.JobStatus / JOB_STATUS_* flags) ──────

const JOB_BITS = [
  [0x1, "paused"], [0x2, "error"], [0x4, "deleting"], [0x8, "spooling"], [0x10, "printing"],
  [0x20, "offline"], [0x40, "paperOut"], [0x80, "printed"], [0x100, "deleted"], [0x200, "blocked"],
  [0x400, "userIntervention"], [0x800, "restart"], [0x1000, "complete"], [0x2000, "retained"],
  [0x4000, "renderingLocally"],
];

const JOB_WORDS = {
  paused: "paused", error: "error", deleting: "deleting", spooling: "spooling", printing: "printing",
  offline: "offline", paperout: "paperOut", printed: "printed", deleted: "deleted", blocked: "blocked",
  blockeddevq: "blocked", userintervention: "userIntervention", restart: "restart", restarted: "restart",
  complete: "complete", completed: "complete", retained: "retained", renderinglocally: "renderingLocally",
};

function noFlags() {
  return Object.fromEntries(JOB_BITS.map(([, k]) => [k, false]));
}

/** "Error, PaperOut, Printing" or 82 (the flag number) → { error, paperOut, printing, … }.
 *  PowerShell prints the enum's names; ConvertTo-Json sometimes gives the
 *  number instead — both are read. Unknown words are ignored. */
export function parseJobStatus(value) {
  const flags = noFlags();
  if (value == null || value === "") return flags;
  const n = typeof value === "number" ? value : /^\s*\d+\s*$/.test(String(value)) ? Number(value) : NaN;
  if (Number.isFinite(n)) {
    for (const [bit, k] of JOB_BITS) if (n & bit) flags[k] = true;
    return flags;
  }
  for (const word of String(value).split(/[,|]/)) {
    const k = JOB_WORDS[word.replace(/[\s_-]/g, "").toLowerCase()];
    if (k) flags[k] = true;
  }
  return flags;
}

/** Windows has finished with the label (printed, or kept after printing). */
export function jobFinished(flags) {
  return !!(flags.printed || flags.complete);
}

// ── Printer status (MSFT_Printer.PrinterStatus) ──────────────────────────────

const PRINTER_STATUS_NAMES = [
  "Normal", "Paused", "Error", "PendingDeletion", "PaperJam", "PaperOut", "ManualFeed", "PaperProblem",
  "Offline", "IOActive", "Busy", "Printing", "OutputBinFull", "NotAvailable", "Waiting", "Processing",
  "Initialization", "WarmingUp", "TonerLow", "NoToner", "PagePunt", "UserIntervention", "OutOfMemory",
  "DoorOpen", "ServerUnknown", "PowerSave",
];

const PRINTER_REASON = {
  paperout: "out-of-labels", paperproblem: "out-of-labels",
  offline: "offline", notavailable: "offline",
  error: "attention", paperjam: "attention", dooropen: "attention", userintervention: "attention",
  paused: "attention", outofmemory: "attention", manualfeed: "attention", pagepunt: "attention",
};

/** Get-Printer's PrinterStatus (name or number) + WorkOffline → why the
 *  printer can't print right now, or null. */
export function parsePrinterStatus(status, workOffline = false) {
  const words = [];
  if (typeof status === "number" || /^\s*\d+\s*$/.test(String(status ?? ""))) {
    const name = PRINTER_STATUS_NAMES[Number(status)];
    if (name) words.push(name);
  } else if (status) {
    words.push(...String(status).split(/[,|]/).map(w => w.trim()).filter(Boolean));
  }
  const reasons = words.map(w => PRINTER_REASON[w.replace(/[\s_-]/g, "").toLowerCase()]).filter(Boolean);
  // The most specific reason wins: out of labels, then offline, then anything else.
  const reason = reasons.includes("out-of-labels") ? "out-of-labels"
    : workOffline || reasons.includes("offline") ? "offline"
    : reasons[0] ?? null;
  const text = [...words.filter(w => w.toLowerCase() !== "normal"), ...(workOffline ? ["Use Printer Offline is ticked"] : [])].join(", ");
  return { reason, text };
}

/** Why the run must wait, from the label Windows is working on and the
 *  printer itself — or null when it is printing normally. */
export function pauseReasonFor(flags, printer) {
  if (!flags) return null;
  if (flags.paperOut) return "out-of-labels";
  if (printer?.reason === "out-of-labels") return "out-of-labels";
  if (flags.offline || printer?.reason === "offline") return "offline";
  if (flags.error || flags.userIntervention || flags.blocked || flags.paused) return "attention";
  return printer?.reason ?? null;
}

// ── The PowerShell poll ──────────────────────────────────────────────────────

// One PowerShell run reads the printer and its queue. The printer name comes
// in through an environment variable, so no name can break the quoting.
export const POLL_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$name = $env:TCK_PRINTER",
  "$p = Get-Printer -Name $name",
  "$jobs = @(Get-PrintJob -PrinterName $name | ForEach-Object {",
  "  $code = $null; try { $code = [uint32]$_.JobStatus } catch { }",
  "  [pscustomobject]@{ id = [int]$_.Id; doc = [string]$_.DocumentName; status = [string]$_.JobStatus; code = $code }",
  "})",
  "[pscustomobject]@{",
  "  printer = [pscustomobject]@{ status = [string]$p.PrinterStatus; offline = [bool]$p.WorkOffline }",
  "  jobs = $jobs",
  "} | ConvertTo-Json -Compress -Depth 4",
].join("\n");

/** POLL_SCRIPT's JSON → { printer: { reason, text }, jobs: [{ id, docName, flags, text }] }.
 *  ConvertTo-Json gives one job as an object, none as null — all read. */
export function parsePollOutput(stdout) {
  const data = JSON.parse(String(stdout).trim() || "{}");
  const raw = data.jobs == null ? [] : Array.isArray(data.jobs) ? data.jobs : [data.jobs];
  const jobs = raw.map(j => {
    const text = j.status == null ? "" : String(j.status);
    // Names when PowerShell gives them, else the number.
    const flags = text && !/^\s*\d+\s*$/.test(text) ? parseJobStatus(text) : parseJobStatus(j.code ?? text);
    return { id: Number(j.id), docName: String(j.doc ?? ""), flags, text: text || String(j.code ?? "") };
  });
  return { printer: parsePrinterStatus(data.printer?.status, !!data.printer?.offline), jobs };
}

// ── SumatraPDF ──────────────────────────────────────────────────────────────

/** Where SumatraPDF usually installs (per-user is its default), in order. */
export function sumatraCandidates(env = process.env) {
  return [
    env.SUMATRA_PATH,
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, "SumatraPDF", "SumatraPDF.exe"),
    "C:\\Program Files\\SumatraPDF\\SumatraPDF.exe",
    "C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe",
  ].filter(Boolean);
}

/** The SumatraPDF command line for one label. */
export function sumatraArgs(printerName, file, printSettings = "noscale") {
  return ["-print-to", printerName, "-print-settings", printSettings, "-silent", file];
}

function execFileP(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout: 60_000, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr && String(stderr).trim()) || err.message));
      else resolve(String(stdout));
    });
  });
}

/**
 * The real Windows printer for back-labels.mjs:
 *   check()                    the printer exists and SumatraPDF is installed
 *   submit(pdfBytes, docName)  one Windows print job (SumatraPDF, actual size)
 *   poll()                     the printer's state and its queue
 *   remove(id)                 delete a job from the queue (cancel only)
 */
export function createWindowsPrinter({ printerName, printSettings = "noscale", env = process.env, run = execFileP, exists = p => access(p).then(() => true, () => false) }) {
  const ps = (script, extraEnv = {}) =>
    run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      env: { ...env, TCK_PRINTER: printerName, ...extraEnv },
      timeout: 20_000,
    });
  let sumatra = null;

  return {
    async check() {
      for (const c of sumatraCandidates(env)) if (await exists(c)) { sumatra = c; break; }
      if (!sumatra) return { ok: false, error: "SumatraPDF isn't installed on the printer computer (see the bridge README)" };
      try {
        await ps("$ErrorActionPreference = 'Stop'; Get-Printer -Name $env:TCK_PRINTER | Out-Null");
        return { ok: true };
      } catch {
        return { ok: false, error: `Windows has no printer called "${printerName}" — check the name on the Label printer page` };
      }
    },
    async submit(pdf, docName) {
      if (!sumatra) throw new Error("check() first");
      // The file name is the Windows document name, so the bridge can find
      // this label in the queue again (even after a restart).
      const file = join(tmpdir(), `${docName}.pdf`);
      await writeFile(file, pdf);
      try {
        await run(sumatra, sumatraArgs(printerName, file, printSettings), { timeout: 60_000 });
      } finally {
        // Windows has its own copy once the job is spooled.
        await unlink(file).catch(() => {});
      }
    },
    async poll() {
      return parsePollOutput(await ps(POLL_SCRIPT));
    },
    async remove(id) {
      await ps("Remove-PrintJob -PrinterName $env:TCK_PRINTER -ID ([int]$env:TCK_JOB_ID)", { TCK_JOB_ID: String(id) });
    },
  };
}
