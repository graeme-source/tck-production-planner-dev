/**
 * The gratitude slide's picture — shared by the slide itself and the
 * thumbnail on the meeting prep page, so the two can never disagree.
 *
 * Bug fixed 23 Oct 2026: the automatic image comes from LoremFlickr, a free
 * third-party photo service. When it errors (it was answering HTTP 500 to
 * every request that day), the SLIDE already dropped back to the emoji +
 * prompt, but the prep-page thumbnail had no error handling and showed a
 * broken image with its alt text. Both now go through gratitudeImageMode.
 */

function dateSeed(dateIso: string): number {
  return dateIso.split("-").reduce((acc, part) => acc * 31 + Number(part), 0);
}

// Fallback photo themes when no photo is uploaded — deliberately narrowed
// to reliably beautiful subjects only (Graeme, 2026-08-25): sunsets,
// flowers, beaches. One theme is chosen per day, deterministically from
// the date.
const GRATITUDE_PHOTO_THEMES = [
  "sunset", "sunset,sky", "sunset,sea",
  "flowers", "flowers,garden", "flowers,meadow",
  "beach", "beach,ocean",
] as const;

// Live, key-less themed image for the fallback. LoremFlickr serves a random
// Creative-Commons photo matching the tag; `lock=<seed>` pins it for the whole
// day so it doesn't reshuffle on every render, but rotates day to day.
// `shuffle` is the meeting's stored shuffle counter — bumping it from the
// setup screen re-rolls the day's pick when it's a dud (the cat incident,
// Graeme 2026-09-11). Prime multiplier so consecutive bumps land on a
// genuinely different lock, not the next photo in the same sequence.
export function fallbackGratitudePhotoUrl(dateIso: string, shuffle = 0): string {
  const seed = dateSeed(dateIso) + shuffle * 7919;
  const theme = GRATITUDE_PHOTO_THEMES[seed % GRATITUDE_PHOTO_THEMES.length];
  return `https://loremflickr.com/1200/800/${encodeURIComponent(theme)}?lock=${seed}`;
}

/** What the gratitude picture area should show:
 *   uploaded  — the host's own photo
 *   automatic — today's themed image from the photo service
 *   prompt    — the image failed to load: the warm emoji + prompt instead,
 *               never a broken-image icon */
export type GratitudeImageMode = "uploaded" | "automatic" | "prompt";

export function gratitudeImageMode(hasPhoto: boolean, imageFailed: boolean): GratitudeImageMode {
  if (imageFailed) return "prompt";
  return hasPhoto ? "uploaded" : "automatic";
}
