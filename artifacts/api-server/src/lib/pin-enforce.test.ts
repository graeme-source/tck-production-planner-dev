import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import {
  createPinEnforceMiddleware,
  enforcementEnabled,
  matchAttributingWrite,
  PIN_REQUIRED_BODY,
} from "./pin-enforce";

// Fri 25 Sep 2026 07:50 London (06:50 UTC) — the first of the 16 batches.
const MORNING = new Date("2026-09-25T06:50:00Z");
const LAST_NIGHT_PIN = "2026-09-24T22:42:00Z"; // Grant's session, 23:42 London
const THIS_MORNING_PIN = "2026-09-25T06:45:00Z";

function fakeReq(method: string, path: string, session: { userId?: number; pinVerifiedAt?: string } | undefined) {
  return { method, path, session } as unknown as Request;
}

function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { res.statusCode = code; return res; },
    json(body: unknown) { res.body = body; return res; },
  };
  return res;
}

async function run(
  req: Request,
  setting: string | null | (() => Promise<string | null>) = null,
) {
  const readSetting = typeof setting === "function" ? setting : async () => setting;
  const mw = createPinEnforceMiddleware({ readSetting, now: () => MORNING, log: () => {} });
  const res = fakeRes();
  const next = vi.fn();
  await mw(req, res as unknown as Response, next);
  return { res, next };
}

describe("matchAttributingWrite", () => {
  it.each([
    ["POST", "/production-plans/180/batch-completions"],
    ["POST", "/production-plans/180/batch-completions/bulk"],
    ["PUT", "/app-settings/station_assignment_180_building_2"],
    ["PUT", "/app-settings/checklist_done_180_building_1_55_12"],
    ["POST", "/checklists/completions"],
    ["POST", "/checklists/packing-batch-record"],
    ["POST", "/temperature-records"],
    ["POST", "/oven-events/oven-in"],
    ["PATCH", "/production-plans/180/items/9/wrapping-complete"],
    ["POST", "/fulfilment/verify-label-scan"],
    ["POST", "/deliveries/12/receive"],
    ["POST", "/production-plans/180/items/9/wonly"], // wonky reject (+1)
    ["POST", "/production-plans/180/items/9/dog-bin"], // dog bin reject (+1)
  ])("guards %s %s", (method, path) => {
    expect(matchAttributingWrite(method, path)).not.toBeNull();
  });

  it.each([
    ["GET", "/production-plans/180/batch-completions"], // reads
    ["DELETE", "/production-plans/180/batch-completions/last"], // undo
    ["DELETE", "/production-plans/180/items/9/wonly"], // undo a wonky
    ["DELETE", "/production-plans/180/items/9/dog-bin"], // undo a dog bin
    ["POST", "/production-plans/180/wonky-to-freezer"], // rack transfer, no person recorded
    ["POST", "/oven-events/oven-out"], // food-safety timer
    ["PUT", "/app-settings/total_daily_batches"], // not a station claim
    ["PUT", "/app-settings/schedule_break_anchors_180"],
    ["POST", "/andon"], // safety alerts
    ["POST", "/visitors"], // visitor kiosk
    ["PUT", "/production-plans/180"], // planning edit
    ["POST", "/production-plans/180/items/9/fridge-extra"], // not an exact match
  ])("leaves %s %s alone", (method, path) => {
    expect(matchAttributingWrite(method, path)).toBeNull();
  });
});

describe("enforcementEnabled (kill switch)", () => {
  it("is on by default and for anything but 'false'", () => {
    expect(enforcementEnabled(null)).toBe(true);
    expect(enforcementEnabled(undefined)).toBe(true);
    expect(enforcementEnabled("true")).toBe(true);
    expect(enforcementEnabled("")).toBe(true);
  });
  it("'false' turns it off", () => {
    expect(enforcementEnabled("false")).toBe(false);
    expect(enforcementEnabled(" FALSE ")).toBe(false);
  });
});

describe("requireFreshPinForAttributingWrites", () => {
  // Regression, 25 Sep 2026: the server recorded batches from a session whose
  // PIN had been due since 05:00.
  it("refuses a batch completion from a session whose PIN is stale", async () => {
    const { res, next } = await run(fakeReq("POST", "/production-plans/180/batch-completions", { userId: 7, pinVerifiedAt: LAST_NIGHT_PIN }));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(423);
    expect(res.body).toEqual(PIN_REQUIRED_BODY);
  });

  it("refuses a building-table claim from a stale session", async () => {
    const { res, next } = await run(fakeReq("PUT", "/app-settings/station_assignment_180_building_2", { userId: 7, pinVerifiedAt: LAST_NIGHT_PIN }));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(423);
  });

  it("refuses when the PIN was cleared by a lock (never verified)", async () => {
    const { res } = await run(fakeReq("POST", "/checklists/completions", { userId: 7 }));
    expect(res.statusCode).toBe(423);
  });

  it("lets the write through once the PIN has been entered this morning", async () => {
    const { res, next } = await run(fakeReq("POST", "/production-plans/180/batch-completions", { userId: 7, pinVerifiedAt: THIS_MORNING_PIN }));
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });

  it("never blocks reads or non-attributing writes, even with a stale PIN", async () => {
    for (const [method, path] of [["GET", "/production-plans/180"], ["POST", "/oven-events/oven-out"], ["POST", "/auth/pin/verify"]] as const) {
      const { next } = await run(fakeReq(method, path, { userId: 7, pinVerifiedAt: LAST_NIGHT_PIN }));
      expect(next).toHaveBeenCalledOnce();
    }
  });

  it("the kill switch 'false' lets stale sessions write again", async () => {
    const { next } = await run(fakeReq("POST", "/production-plans/180/batch-completions", { userId: 7, pinVerifiedAt: LAST_NIGHT_PIN }), "false");
    expect(next).toHaveBeenCalledOnce();
  });

  it("a failed kill-switch read lets the write through rather than locking a station", async () => {
    const { next } = await run(
      fakeReq("POST", "/production-plans/180/batch-completions", { userId: 7, pinVerifiedAt: LAST_NIGHT_PIN }),
      async () => { throw new Error("db down"); },
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it("does not read the kill switch unless a refusal is on the cards", async () => {
    const readSetting = vi.fn(async () => null);
    const mw = createPinEnforceMiddleware({ readSetting, now: () => MORNING, log: () => {} });
    await mw(fakeReq("POST", "/production-plans/180/batch-completions", { userId: 7, pinVerifiedAt: THIS_MORNING_PIN }), fakeRes() as unknown as Response, vi.fn());
    await mw(fakeReq("GET", "/production-plans/180", { userId: 7 }), fakeRes() as unknown as Response, vi.fn());
    expect(readSetting).not.toHaveBeenCalled();
  });

  it("passes requests with no session to the normal auth guard", async () => {
    const { next } = await run(fakeReq("POST", "/production-plans/180/batch-completions", undefined));
    expect(next).toHaveBeenCalledOnce();
  });
});
