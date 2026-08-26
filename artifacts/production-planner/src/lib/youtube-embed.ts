/**
 * Turning a pasted YouTube link into an embed the player will actually load.
 *
 * The bug this exists to prevent (Graeme, morning meeting 2026-08-26): the
 * lesson slide showed "Video player configuration error — Error 153" on the
 * kitchen iPad. YouTube's player refuses to configure itself unless it can
 * tell which site is embedding it. It looks for two things: the Referer
 * header, and an `origin` parameter on the embed URL. We were sending
 * neither — Helmet defaulted the app to `Referrer-Policy: no-referrer`, and
 * the embed URL carried only `rel=0`.
 *
 * Helmet now sends the origin (see api-server/src/app.ts), and the `origin`
 * parameter here is the second belt: if the referrer is ever stripped again
 * — by a proxy, a future header change, a browser in a stricter mode — the
 * player still knows where it is and the morning meeting still plays.
 */

/** Pull the 11-character video id out of any shape of YouTube link. */
export function youtubeIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0] ?? "";
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (u.hostname.endsWith("youtube.com") || u.hostname.endsWith("youtube-nocookie.com")) {
      for (const prefix of ["/embed/", "/shorts/", "/live/"]) {
        if (u.pathname.startsWith(prefix)) {
          const id = u.pathname.split(prefix)[1]?.split("/")[0] ?? "";
          return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
        }
      }
      const v = u.searchParams.get("v");
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    }
  } catch {
    // Not a URL at all — the caller falls back to a plain link.
  }
  return null;
}

/**
 * The embed URL for a video id. `origin` should be the page's own origin;
 * pass undefined only where there is no window (tests, SSR), in which case
 * the parameter is left off rather than sent empty — an empty origin is
 * worse than none, because the player treats it as a mismatch.
 */
export function youtubeEmbedSrc(id: string, origin?: string): string {
  const params = new URLSearchParams({ rel: "0" });
  if (origin) params.set("origin", origin);
  return `https://www.youtube.com/embed/${id}?${params.toString()}`;
}

/** The page's own origin, or undefined when there's no window. */
export function currentOrigin(): string | undefined {
  return typeof window !== "undefined" && window.location?.origin
    ? window.location.origin
    : undefined;
}
