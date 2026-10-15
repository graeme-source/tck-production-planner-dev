import { describe, it, expect } from "vitest";
import {
  createDictationRegistry,
  detectDictationPlatform,
  dictationCapability,
  micBlockedHelp,
  speechErrorMessage,
  osDictationTip,
} from "./dictation-support";

const UA = {
  chromeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  edgeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
  firefoxWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
};

describe("detectDictationPlatform", () => {
  it("tells the desktop browsers apart", () => {
    expect(detectDictationPlatform(UA.chromeWin)).toEqual({ os: "windows", browser: "chrome" });
    expect(detectDictationPlatform(UA.edgeWin)).toEqual({ os: "windows", browser: "edge" });
    expect(detectDictationPlatform(UA.firefoxWin)).toEqual({ os: "windows", browser: "firefox" });
    expect(detectDictationPlatform(UA.safariMac)).toEqual({ os: "mac", browser: "safari" });
  });

  it("treats a touch-screen 'Mac' as an iPad (iPadOS desktop user agent)", () => {
    expect(detectDictationPlatform(UA.safariMac, 5)).toEqual({ os: "ios", browser: "safari" });
  });

  it("recognises phones", () => {
    expect(detectDictationPlatform(UA.androidChrome)).toEqual({ os: "android", browser: "chrome" });
    expect(detectDictationPlatform(UA.iphone)).toEqual({ os: "ios", browser: "safari" });
  });
});

describe("dictationCapability", () => {
  const win = { os: "windows", browser: "chrome" } as const;

  it("dictates when the speech API is there on a secure page", () => {
    expect(dictationCapability({ hasSpeechApi: true, isSecureContext: true, platform: win })).toEqual({ mode: "speech" });
  });

  it("never just disappears without speech recognition — it gives a tip (Firefox case)", () => {
    const cap = dictationCapability({ hasSpeechApi: false, isSecureContext: true, platform: { os: "windows", browser: "firefox" } });
    expect(cap.mode).toBe("unavailable");
    if (cap.mode !== "unavailable") throw new Error("expected unavailable");
    expect(cap.reason).toBe("no-speech-api");
    expect(cap.tip).toContain("Chrome, Edge or Safari");
    expect(cap.tip).toContain("Windows key + H");
  });

  it("explains that http pages can't use the mic", () => {
    const cap = dictationCapability({ hasSpeechApi: true, isSecureContext: false, platform: win });
    expect(cap.mode === "unavailable" && cap.reason).toBe("insecure");
  });
});

describe("messages", () => {
  it("OS tip matches the device", () => {
    expect(osDictationTip("ios")).toMatch(/microphone key/);
    expect(osDictationTip("mac")).toMatch(/Mac/);
  });

  it("blocked-mic help is browser-specific", () => {
    expect(micBlockedHelp({ os: "ios", browser: "safari" })).toContain("Website Settings");
    expect(micBlockedHelp({ os: "mac", browser: "safari" })).toContain("Settings for This Website");
    expect(micBlockedHelp({ os: "windows", browser: "edge" })).toContain("reload");
    expect(micBlockedHelp({ os: "android", browser: "chrome" })).toContain("Permissions");
  });

  it("maps speech errors to plain advice", () => {
    const p = { os: "windows", browser: "chrome" } as const;
    expect(speechErrorMessage("aborted", p)).toBeNull();
    expect(speechErrorMessage("not-allowed", p)).toContain("blocked");
    expect(speechErrorMessage("no-speech", p)).toMatch(/Didn't hear/);
    expect(speechErrorMessage("audio-capture", p)).toMatch(/No microphone/);
    expect(speechErrorMessage("network", p)).toMatch(/Brave/);
    expect(speechErrorMessage("something-new", p)).toContain("something-new");
  });

  it("Safari's service-not-allowed means system dictation is off", () => {
    expect(speechErrorMessage("service-not-allowed", { os: "ios", browser: "safari" })).toContain("Enable Dictation");
    expect(speechErrorMessage("service-not-allowed", { os: "mac", browser: "safari" })).toContain("System Settings");
  });
});

describe("freeing the microphone before the camera (Graeme, 2026-10-15)", () => {
  it("releaseAll aborts every running dictation (abort, not just stop) and forgets it", () => {
    const reg = createDictationRegistry<{ stop: () => void; abort?: () => void }>();
    const calls: string[] = [];
    const a = { stop: () => calls.push("a.stop"), abort: () => calls.push("a.abort") };
    const b = { stop: () => calls.push("b.stop") }; // a browser without abort()
    reg.active.add(a); reg.active.add(b);
    reg.releaseAll();
    expect(calls).toEqual(["a.abort", "b.stop"]);
    expect(reg.active.size).toBe(0);
  });
  it("a recognition that already ended doesn't throw", () => {
    const reg = createDictationRegistry<{ stop: () => void; abort?: () => void }>();
    reg.active.add({ stop: () => {}, abort: () => { throw new Error("InvalidStateError"); } });
    expect(() => reg.releaseAll()).not.toThrow();
    expect(reg.active.size).toBe(0);
  });
});
