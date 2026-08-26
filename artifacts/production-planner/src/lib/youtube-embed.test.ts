import { describe, it, expect } from "vitest";
import { youtubeIdFromUrl, youtubeEmbedSrc } from "./youtube-embed";

const ID = "VOkBhGgaO6Q";

describe("youtubeIdFromUrl", () => {
  it("reads a standard watch link", () => {
    expect(youtubeIdFromUrl(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it("reads a short youtu.be link", () => {
    expect(youtubeIdFromUrl(`https://youtu.be/${ID}`)).toBe(ID);
  });

  it("reads an already-embed link", () => {
    expect(youtubeIdFromUrl(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
  });

  it("reads a shorts link", () => {
    expect(youtubeIdFromUrl(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
  });

  it("reads a live link", () => {
    expect(youtubeIdFromUrl(`https://www.youtube.com/live/${ID}`)).toBe(ID);
  });

  it("reads a watch link carrying extra parameters", () => {
    expect(youtubeIdFromUrl(`https://www.youtube.com/watch?v=${ID}&t=42s&list=PLabc`)).toBe(ID);
  });

  it("returns null for a non-YouTube URL", () => {
    expect(youtubeIdFromUrl("https://vimeo.com/123456")).toBeNull();
  });

  it("returns null for something that isn't a URL", () => {
    expect(youtubeIdFromUrl("watch the 8 wastes video")).toBeNull();
  });

  it("returns null for a malformed id", () => {
    expect(youtubeIdFromUrl("https://www.youtube.com/watch?v=tooshort")).toBeNull();
  });
});

describe("youtubeEmbedSrc", () => {
  // The regression this file exists for: without an origin the player
  // returns "Video player configuration error — Error 153".
  it("carries the embedding origin so the player can configure itself", () => {
    const src = youtubeEmbedSrc(ID, "https://planner.thecalzonekitchen.co.uk");
    const params = new URL(src).searchParams;
    expect(params.get("origin")).toBe("https://planner.thecalzonekitchen.co.uk");
  });

  it("points at the right video and suppresses unrelated suggestions", () => {
    const url = new URL(youtubeEmbedSrc(ID, "https://example.com"));
    expect(url.pathname).toBe(`/embed/${ID}`);
    expect(url.searchParams.get("rel")).toBe("0");
  });

  it("omits origin entirely when there isn't one, rather than sending it empty", () => {
    const src = youtubeEmbedSrc(ID, undefined);
    expect(new URL(src).searchParams.has("origin")).toBe(false);
  });

  it("omits origin when handed an empty string", () => {
    const src = youtubeEmbedSrc(ID, "");
    expect(new URL(src).searchParams.has("origin")).toBe(false);
  });
});
