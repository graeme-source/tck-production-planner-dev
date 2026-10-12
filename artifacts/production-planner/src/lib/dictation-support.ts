/**
 * Dictation capability + messages (Graeme, 2026-10-12).
 *
 * "I looked at it earlier on a desktop PC, and we couldn't see a dictation
 * button." The Dictate button used to return null whenever the browser had
 * no Web Speech API, so on Firefox (and anywhere else without it) it simply
 * vanished and nobody knew dictation existed. It now never hides: where the
 * browser can listen it dictates, and where it can't it says what to do
 * instead (the operating system's own dictation works in any text box).
 *
 * There is no server speech-to-text in this app (Anthropic's API can't do
 * it, and Whisper was dropped with SOP video narration), so there is no
 * record-and-upload fallback — the fallback is a clear tip.
 *
 * Pure functions only, so the decisions are unit-tested without a browser.
 */

export type DictationOs = "windows" | "mac" | "ios" | "android" | "other";
export type DictationBrowser = "chrome" | "edge" | "safari" | "firefox" | "other";

export interface DictationPlatform {
  os: DictationOs;
  browser: DictationBrowser;
}

/** Works out the OS and browser from the user agent. iPadOS 13+ claims to be
 *  a Mac, so a "Mac" with a touch screen is treated as an iPad. */
export function detectDictationPlatform(userAgent: string, maxTouchPoints = 0): DictationPlatform {
  const ua = userAgent || "";
  let os: DictationOs = "other";
  if (/iPad|iPhone|iPod/.test(ua)) os = "ios";
  else if (/Android/i.test(ua)) os = "android";
  else if (/Macintosh|Mac OS X/.test(ua)) os = maxTouchPoints > 1 ? "ios" : "mac";
  else if (/Windows/.test(ua)) os = "windows";

  let browser: DictationBrowser = "other";
  if (/Edg(e|A|iOS)?\//.test(ua)) browser = "edge";
  else if (/Firefox\/|FxiOS\//.test(ua)) browser = "firefox";
  else if (/Chrome\/|CriOS\//.test(ua)) browser = "chrome";
  else if (/Safari\//.test(ua)) browser = "safari";
  return { os, browser };
}

export type DictationCapability =
  | { mode: "speech" }
  | { mode: "unavailable"; reason: "insecure" | "no-speech-api"; tip: string };

/** The operating system's own dictation — works in any text box, any browser. */
export function osDictationTip(os: DictationOs): string {
  switch (os) {
    case "windows": return "On Windows, click in the box and press the Windows key + H to talk instead.";
    case "mac": return "On a Mac, click in the box and press the microphone key (or Fn twice) to talk instead.";
    case "ios": return "Or tap the microphone key on the on-screen keyboard.";
    case "android": return "Or tap the microphone key on the on-screen keyboard.";
    default: return "Or use your keyboard's microphone key.";
  }
}

export function dictationCapability(env: {
  hasSpeechApi: boolean;
  /** window.isSecureContext — https, or localhost. Browsers block the mic otherwise. */
  isSecureContext: boolean;
  platform: DictationPlatform;
}): DictationCapability {
  if (!env.isSecureContext) {
    return {
      mode: "unavailable",
      reason: "insecure",
      tip: `Dictation only works on the secure (https://) address of the app. ${osDictationTip(env.platform.os)}`,
    };
  }
  if (!env.hasSpeechApi) {
    return {
      mode: "unavailable",
      reason: "no-speech-api",
      tip: `Dictation needs Chrome, Edge or Safari. ${osDictationTip(env.platform.os)}`,
    };
  }
  return { mode: "speech" };
}

/** How to un-block the microphone, in the words of the browser in hand. */
export function micBlockedHelp(platform: DictationPlatform): string {
  const lead = "The microphone is blocked for this app.";
  if (platform.os === "ios") {
    return `${lead} Tap "aA" in the address bar → Website Settings → Microphone → Allow, then try again. (Also check Settings → Safari → Microphone.)`;
  }
  if (platform.os === "android") {
    return `${lead} Tap the icon left of the web address → Permissions → Microphone → Allow, then try again.`;
  }
  if (platform.browser === "safari") {
    return `${lead} In the menu bar choose Safari → Settings for This Website → Microphone → Allow, then try again.`;
  }
  if (platform.browser === "chrome" || platform.browser === "edge") {
    return `${lead} Click the icon left of the web address → Microphone → Allow, then reload the page.`;
  }
  return `${lead} Allow the microphone in your browser's site settings, then reload the page.`;
}

/** Turns a SpeechRecognition error code into something a person can act on.
 *  Returns null for errors that need no message (the user stopped it). */
export function speechErrorMessage(error: string, platform: DictationPlatform): string | null {
  switch (error) {
    case "aborted":
      return null;
    case "not-allowed":
      return micBlockedHelp(platform);
    case "service-not-allowed":
      // Safari reports this when the Mac/iPad's own Dictation is switched off.
      if (platform.browser === "safari" || platform.os === "ios" || platform.os === "mac") {
        return platform.os === "ios"
          ? "Dictation is switched off on this iPad. Turn it on in Settings → General → Keyboard → Enable Dictation, then try again."
          : "Dictation is switched off on this Mac. Turn it on in System Settings → Keyboard → Dictation, then try again.";
      }
      return micBlockedHelp(platform);
    case "no-speech":
      return "Didn't hear anything. Tap Dictate and try again.";
    case "audio-capture":
      return "No microphone found. Check one is plugged in and not in use by another app.";
    case "network":
      return `Dictation couldn't reach the speech service — check the internet. (Some browsers, like Brave, block it: use Chrome, Edge or Safari.) ${osDictationTip(platform.os)}`;
    case "language-not-supported":
      return `This browser can't dictate in English (UK). ${osDictationTip(platform.os)}`;
    default:
      return `Dictation stopped (${error}). Tap Dictate to try again.`;
  }
}
