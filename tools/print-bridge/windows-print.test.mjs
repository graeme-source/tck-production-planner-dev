import { describe, expect, it } from "vitest";
import {
  createWindowsPrinter, jobFinished, parseJobStatus, parsePollOutput, parsePrinterStatus, pauseReasonFor, sumatraArgs, sumatraCandidates,
} from "./windows-print.mjs";

describe("Windows job status", () => {
  it("reads PowerShell's names", () => {
    const f = parseJobStatus("Error, PaperOut, Printing");
    expect(f).toMatchObject({ error: true, paperOut: true, printing: true, printed: false });
    expect(parseJobStatus("Normal")).toMatchObject({ error: false, printing: false });
    expect(parseJobStatus("Printing, Retained")).toMatchObject({ printing: true, retained: true });
    expect(parseJobStatus("BlockedDevQ | Restarted")).toMatchObject({ blocked: true, restart: true });
  });

  it("reads the flag number (JOB_STATUS_*)", () => {
    expect(parseJobStatus(0x40 | 0x2 | 0x10)).toMatchObject({ paperOut: true, error: true, printing: true });
    expect(parseJobStatus("128")).toMatchObject({ printed: true });
    expect(parseJobStatus(0x1000 | 0x2000)).toMatchObject({ complete: true, retained: true });
    expect(parseJobStatus(null)).toMatchObject({ error: false });
  });

  it("knows when Windows has finished with a label", () => {
    expect(jobFinished(parseJobStatus("Printed, Retained"))).toBe(true);
    expect(jobFinished(parseJobStatus("Complete"))).toBe(true);
    expect(jobFinished(parseJobStatus("Printing"))).toBe(false);
  });
});

describe("printer status", () => {
  it("names why the printer can't print", () => {
    expect(parsePrinterStatus("PaperOut")).toEqual({ reason: "out-of-labels", text: "PaperOut" });
    expect(parsePrinterStatus("Offline")).toEqual({ reason: "offline", text: "Offline" });
    expect(parsePrinterStatus("Normal", true)).toEqual({ reason: "offline", text: "Use Printer Offline is ticked" });
    expect(parsePrinterStatus("DoorOpen").reason).toBe("attention");
    expect(parsePrinterStatus("Normal")).toEqual({ reason: null, text: "" });
    expect(parsePrinterStatus(5).reason).toBe("out-of-labels");
    expect(parsePrinterStatus(0).reason).toBeNull();
  });
});

describe("why a run waits", () => {
  const ok = { reason: null, text: "" };
  it("out of labels from the job or the printer", () => {
    expect(pauseReasonFor(parseJobStatus("Error, PaperOut"), ok)).toBe("out-of-labels");
    expect(pauseReasonFor(parseJobStatus("Error, Printing"), { reason: "out-of-labels", text: "PaperOut" })).toBe("out-of-labels");
  });
  it("offline, or anything else that needs a person", () => {
    expect(pauseReasonFor(parseJobStatus("Offline"), ok)).toBe("offline");
    expect(pauseReasonFor(parseJobStatus("Error, Printing"), ok)).toBe("attention");
    expect(pauseReasonFor(parseJobStatus("Paused"), ok)).toBe("attention");
    expect(pauseReasonFor(parseJobStatus("UserIntervention"), ok)).toBe("attention");
  });
  it("printing normally is not a pause", () => {
    expect(pauseReasonFor(parseJobStatus("Printing"), ok)).toBeNull();
    expect(pauseReasonFor(parseJobStatus("Spooling, Restarted"), ok)).toBeNull();
    expect(pauseReasonFor(null, ok)).toBeNull();
  });
});

describe("the PowerShell poll output", () => {
  it("reads one job (ConvertTo-Json gives an object, not a list)", () => {
    const out = '{"printer":{"status":"Normal","offline":false},"jobs":{"id":12,"doc":"C:\\\\Temp\\\\tck-bl-7-3.pdf","status":"Error, PaperOut, Printing","code":82}}';
    const r = parsePollOutput(out);
    expect(r.printer.reason).toBeNull();
    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0]).toMatchObject({ id: 12, docName: "C:\\Temp\\tck-bl-7-3.pdf", text: "Error, PaperOut, Printing" });
    expect(r.jobs[0].flags).toMatchObject({ paperOut: true, error: true });
  });

  it("reads several jobs, none, and the number-only status", () => {
    expect(parsePollOutput('{"printer":{"status":"Normal","offline":false},"jobs":[]}').jobs).toEqual([]);
    expect(parsePollOutput('{"printer":{"status":"PaperOut","offline":false},"jobs":null}')).toMatchObject({ jobs: [], printer: { reason: "out-of-labels" } });
    const two = parsePollOutput('{"printer":{"status":"Normal"},"jobs":[{"id":1,"doc":"a","status":"Printing","code":16},{"id":2,"doc":"b","status":"80","code":80}]}');
    expect(two.jobs.map(j => j.id)).toEqual([1, 2]);
    expect(two.jobs[1].flags).toMatchObject({ printing: true, paperOut: true });
  });
});

describe("SumatraPDF", () => {
  it("prints at actual size to the named printer", () => {
    expect(sumatraArgs("ZDesigner ZD421-203dpi", "C:\\t\\tck-bl-7-0.pdf")).toEqual(
      ["-print-to", "ZDesigner ZD421-203dpi", "-print-settings", "noscale", "-silent", "C:\\t\\tck-bl-7-0.pdf"],
    );
  });
  it("looks in the usual install places, a set path first", () => {
    const c = sumatraCandidates({ SUMATRA_PATH: "D:\\S.exe", LOCALAPPDATA: "C:\\Users\\wrap\\AppData\\Local" });
    expect(c[0]).toBe("D:\\S.exe");
    expect(c[1]).toContain("SumatraPDF");
    expect(c).toContain("C:\\Program Files\\SumatraPDF\\SumatraPDF.exe");
  });
});

describe("the Windows printer (programs faked)", () => {
  it("passes the printer name by environment, never inside the script", async () => {
    const calls = [];
    const run = async (cmd, args, opts) => {
      calls.push({ cmd, args, env: opts.env });
      return '{"printer":{"status":"Normal","offline":false},"jobs":[]}';
    };
    const p = createWindowsPrinter({ printerName: `Label "printer"; rm`, env: {}, run, exists: async () => true });
    expect(await p.check()).toEqual({ ok: true });
    await p.poll();
    expect(calls.every(c => c.cmd === "powershell.exe")).toBe(true);
    expect(calls.every(c => c.env.TCK_PRINTER === `Label "printer"; rm`)).toBe(true);
    expect(calls.some(c => c.args.join(" ").includes("rm"))).toBe(false);
  });

  it("says plainly when SumatraPDF or the printer is missing", async () => {
    const noSumatra = createWindowsPrinter({ printerName: "X", env: {}, run: async () => "", exists: async () => false });
    expect((await noSumatra.check()).error).toMatch(/SumatraPDF/);
    const noPrinter = createWindowsPrinter({ printerName: "Godex", env: {}, run: async () => { throw new Error("No MSFT_Printer objects found"); }, exists: async () => true });
    expect((await noPrinter.check()).error).toMatch(/no printer called "Godex"/);
  });
});
