/**
 * The app's Content-Security-Policy directives (Helmet, app.ts).
 *
 * img-src and media-src include blob: — the browser's own in-memory URLs for
 * files already on the person's device (URL.createObjectURL). Several
 * features preview or re-encode a picked photo that way: the ingredient
 * label reader, avatar and image croppers, attachment previews. Without
 * blob: the browser silently refuses to load the picked file, which shipped
 * as "Couldn't read one of those photos" on every label photo (Graeme,
 * 2026-09-24). blob: URLs can only ever point at this page's own data, so
 * allowing them opens nothing to other sites. csp.test.ts guards it.
 */
export const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "'unsafe-inline'"],
  styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  fontSrc: ["'self'", "https://fonts.gstatic.com"],
  imgSrc: ["'self'", "data:", "blob:", "https:"],
  mediaSrc: ["'self'", "data:", "blob:"],
  connectSrc: ["'self'", "https:"],
  // Allow YouTube + Vimeo iframes — used by:
  //   - Lean Cave "Video Learning" section (Lean Made Simple shorts)
  //   - SOP step descriptions that contain a YouTube/Vimeo URL, which
  //     the SOP viewer auto-embeds (see detectVideoEmbed in
  //     standards-sops-dialog.tsx). Without this, both surfaces render
  //     blocked-frame placeholders on production.
  frameSrc: [
    "'self'",
    "https://www.youtube.com",
    "https://www.youtube-nocookie.com",
    "https://player.vimeo.com",
  ],
};
