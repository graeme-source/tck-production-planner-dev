import { describe, it, expect, vi } from "vitest";
import { installPinRequiredFetchHook, isPinRequiredResponse, isQuietRequest, PIN_REQUIRED_EVENT, QUIET_REQUEST_HEADER } from "./pin-required-fetch";

describe("isQuietRequest", () => {
  it("finds the header in a plain object, an array or a Headers, any case", () => {
    expect(isQuietRequest("/x", { headers: { "x-tck-background": "1" } })).toBe(true);
    expect(isQuietRequest("/x", { headers: [[QUIET_REQUEST_HEADER, "1"]] })).toBe(true);
    expect(isQuietRequest("/x", { headers: new Headers({ [QUIET_REQUEST_HEADER]: "1" }) })).toBe(true);
    expect(isQuietRequest(new Request("http://localhost/x", { headers: { [QUIET_REQUEST_HEADER]: "1" } }))).toBe(true);
  });
  it("is false for ordinary requests", () => {
    expect(isQuietRequest("/x")).toBe(false);
    expect(isQuietRequest("/x", { headers: { "Content-Type": "application/json" } })).toBe(false);
  });
});

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

  it("stays quiet for a background request marked with the quiet header", async () => {
    const { h, events } = host(new Response(JSON.stringify({ code: "PIN_REQUIRED" }), { status: 423 }));
    installPinRequiredFetchHook(h);
    const res = await h.fetch("/api/prep-sessions/open", { method: "POST", headers: { "Content-Type": "application/json", [QUIET_REQUEST_HEADER]: "1" } });
    expect(res.status).toBe(423); // the refusal still reaches the caller
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
