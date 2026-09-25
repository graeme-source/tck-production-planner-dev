import { describe, it, expect, vi } from "vitest";
import { installPinRequiredFetchHook, isPinRequiredResponse, PIN_REQUIRED_EVENT } from "./pin-required-fetch";

describe("isPinRequiredResponse", () => {
  it("recognises the daily-PIN refusal", () => {
    expect(isPinRequiredResponse(423, { code: "PIN_REQUIRED", error: "Enter your PIN, then tap again" })).toBe(true);
  });
  it("ignores the People private-PIN refusal and other errors", () => {
    expect(isPinRequiredResponse(423, { code: "PEOPLE_PIN_REQUIRED" })).toBe(false);
    expect(isPinRequiredResponse(403, { code: "PIN_REQUIRED" })).toBe(false);
    expect(isPinRequiredResponse(423, null)).toBe(false);
  });
});

function host(response: Response) {
  const events: string[] = [];
  const h = {
    fetch: vi.fn(async () => response) as unknown as typeof fetch,
    dispatchEvent: (e: Event) => { events.push(e.type); return true; },
  };
  return { h, events };
}

describe("installPinRequiredFetchHook", () => {
  it("raises the event on a PIN_REQUIRED refusal and still hands back the response", async () => {
    const { h, events } = host(new Response(JSON.stringify({ code: "PIN_REQUIRED" }), { status: 423 }));
    installPinRequiredFetchHook(h);
    const res = await h.fetch("/api/production-plans/180/batch-completions", { method: "POST" });
    expect(res.status).toBe(423);
    expect(await res.json()).toEqual({ code: "PIN_REQUIRED" }); // body still readable by the caller
    expect(events).toEqual([PIN_REQUIRED_EVENT]);
  });

  it("stays quiet for normal responses", async () => {
    const { h, events } = host(new Response("{}", { status: 200 }));
    installPinRequiredFetchHook(h);
    await h.fetch("/api/anything");
    expect(events).toEqual([]);
  });

  it("wraps only once", async () => {
    const { h, events } = host(new Response(JSON.stringify({ code: "PIN_REQUIRED" }), { status: 423 }));
    installPinRequiredFetchHook(h);
    installPinRequiredFetchHook(h);
    await h.fetch("/api/x");
    expect(events).toHaveLength(1);
  });
});
