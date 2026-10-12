import { describe, expect, it } from "vitest";
import {
  checkNotesUrl, wisprSharedSlug, htmlToText, jsonToText, fetchNotesText, PASTE_INSTEAD, type Fetcher,
} from "./meeting-notes-source";

const LONG = "We talked about the return date and the hours. ".repeat(5);

function res(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(status >= 300 && status < 400 ? null : body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
}

/** A fake network: a map of URL → response, recording every call. */
function fakeFetch(routes: Record<string, () => Response>): Fetcher & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    const r = routes[url];
    if (!r) throw new Error(`unexpected fetch ${url}`);
    return r();
  }) as Fetcher & { calls: string[] };
  f.calls = calls;
  return f;
}

describe("which links may be fetched", () => {
  it("allows a Wispr Flow shared link", () => {
    const c = checkNotesUrl(" https://notes.wisprflow.ai/shared/abc123 ");
    expect(c.ok).toBe(true);
  });
  it.each([
    ["http://notes.wisprflow.ai/shared/abc123", "https"],
    ["https://evil.example/shared/abc123", "Only shared notes"],
    ["https://notes.wisprflow.ai.evil.example/x", "Only shared notes"],
    ["https://sub.notes.wisprflow.ai/x", "Only shared notes"],
    ["https://169.254.169.254/latest", "Only shared notes"],
    ["https://localhost/x", "Only shared notes"],
    ["https://user:pw@notes.wisprflow.ai/x", "can't be read"],
    ["https://notes.wisprflow.ai:8443/x", "can't be read"],
    ["file:///etc/passwd", "https"],
    ["not a link", "doesn't look like a link"],
    ["", "Paste the link"],
  ])("refuses %s", (url, why) => {
    const c = checkNotesUrl(url);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error).toContain(why);
  });
  it("refuses an over-long link", () => expect(checkNotesUrl(`https://notes.wisprflow.ai/${"a".repeat(2100)}`).ok).toBe(false));
  it("reads the share id only from a /shared/<id> path on the notes host", () => {
    expect(wisprSharedSlug(new URL("https://notes.wisprflow.ai/shared/Ab-12_cd"))).toBe("Ab-12_cd");
    expect(wisprSharedSlug(new URL("https://notes.wisprflow.ai/shared/../admin"))).toBeNull();
    expect(wisprSharedSlug(new URL("https://notes.wisprflow.ai/other/abcd"))).toBeNull();
  });
});

describe("readable text", () => {
  it("drops scripts, styles and markup, keeps line breaks and entities", () => {
    const t = htmlToText(`<html><head><title>x</title><script>alert(1)</script></head><body><style>p{}</style><h1>Notes</h1><p>Back on 4 May &amp; 24 hrs</p><ul><li>One</li></ul></body></html>`);
    expect(t).toBe("Notes\nBack on 4 May & 24 hrs\n• One");
  });
  it("pulls the longer strings out of JSON, skipping ids, links and emails", () => {
    const t = jsonToText({ id: "f3b0c1e2-aaaa-bbbb-cccc-1234567890ab", title: "Maternity chat", summary: "We agreed a phased return.",
      owner: { email: "someone@example.com", avatar_url: "https://x/y.png" }, items: [{ text: "Keeping in touch days: three" }], created_at: "2026-10-12T10:00:00Z" });
    expect(t).toBe("Maternity chat\n\nWe agreed a phased return.\n\nKeeping in touch days: three");
  });
});

describe("fetching shared notes", () => {
  const link = "https://notes.wisprflow.ai/shared/abc123";
  const api = "https://api.wisprflow.ai/api/v1/meetings/shared/abc123";

  it("uses the page when it has the notes", async () => {
    const f = fakeFetch({ [link]: () => res(200, `<main><p>${LONG}</p></main>`) });
    const r = await fetchNotesText(link, { fetchImpl: f });
    expect(r.ok && r.from).toBe("page");
    expect(f.calls).toEqual([link]);
  });

  it("an empty JavaScript shell falls back to the notes data, built from the id only", async () => {
    const f = fakeFetch({
      [link]: () => res(200, `<html><head><script src="/a.js"></script></head><body><div id="root"></div></body></html>`),
      [api]: () => res(200, JSON.stringify({ summary: LONG }), { "content-type": "application/json" }),
    });
    const r = await fetchNotesText(link, { fetchImpl: f });
    expect(r.ok && r.from).toBe("data");
    expect(r.ok && r.text).toContain("return date");
  });

  it("says plainly to paste the text when nothing readable comes back — never fakes it", async () => {
    const f = fakeFetch({
      [link]: () => res(200, `<div id="root"></div>`),
      [api]: () => res(200, JSON.stringify({ id: "x" }), { "content-type": "application/json" }),
      [`${api}/transcript`]: () => res(200, "{}", { "content-type": "application/json" }),
    });
    const r = await fetchNotesText(link, { fetchImpl: f });
    expect(r).toEqual({ ok: false, status: 422, error: PASTE_INSTEAD });
  });

  it("notes that aren't public say so", async () => {
    const f = fakeFetch({
      [link]: () => res(200, `<div id="root"></div>`),
      [api]: () => res(403, "{}", { "content-type": "application/json" }),
      [`${api}/transcript`]: () => res(403, "{}", { "content-type": "application/json" }),
    });
    const r = await fetchNotesText(link, { fetchImpl: f });
    expect(!r.ok && r.error).toContain("aren't shared publicly");
  });

  it("follows a redirect that stays on the allowed site", async () => {
    const f = fakeFetch({
      "https://notes.wisprflow.ai/s/abc": () => res(302, "", { location: "/shared/abc123" }),
      [link]: () => res(200, `<p>${LONG}</p>`),
    });
    const r = await fetchNotesText("https://notes.wisprflow.ai/s/abc", { fetchImpl: f });
    expect(r.ok).toBe(true);
  });

  it("never follows a redirect off the allowed site", async () => {
    const f = fakeFetch({ "https://notes.wisprflow.ai/s/abc": () => res(302, "", { location: "http://169.254.169.254/latest/meta-data" }) });
    const r = await fetchNotesText("https://notes.wisprflow.ai/s/abc", { fetchImpl: f });
    expect(r.ok).toBe(false);
    expect(f.calls).toEqual(["https://notes.wisprflow.ai/s/abc"]);
  });

  it("stops at the byte cap", async () => {
    const f = fakeFetch({ [link]: () => res(200, "x".repeat(5000)) });
    const r = await fetchNotesText(link, { fetchImpl: f, maxBytes: 1000 });
    expect(!r.ok && r.status).toBe(413);
  });

  it("refuses something that isn't text", async () => {
    const f = fakeFetch({ [link]: () => res(200, "%PDF", { "content-type": "application/pdf" }), [api]: () => res(404, "{}") , [`${api}/transcript`]: () => res(404, "{}") });
    const r = await fetchNotesText(link, { fetchImpl: f });
    expect(r.ok).toBe(false);
  });

  it("gives up when the site is too slow", async () => {
    const slow: Fetcher = (_u, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    const r = await fetchNotesText(link, { fetchImpl: slow, timeoutMs: 10 });
    expect(!r.ok && r.status).toBe(504);
  });

  it("never fetches a link that isn't allowed", async () => {
    const f = fakeFetch({});
    const r = await fetchNotesText("https://example.com/notes", { fetchImpl: f });
    expect(r.ok).toBe(false);
    expect(f.calls).toEqual([]);
  });
});
