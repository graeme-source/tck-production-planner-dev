/**
 * Pop-ups that can arrive by themselves while a modal dialog is open must
 * take taps back. Radix sets pointer-events:none on <body> while a modal is
 * open; a full-screen overlay without pointer-events-auto paints on top but
 * every tap falls through, trapping the user. The Wish List pop-up did this
 * over Create Production Plan (#375, 2 Nov 2026); the PIN pad (4 Sep) and
 * reschedule box (21 Aug) were fixed the same way before.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const POP_UPS = [
  "wish-list/wish-list-alert.tsx",
  "fixed-notice-interstitial.tsx",
  "pin-lock-overlay.tsx",
  "reschedule-order-dialog.tsx",
];

describe("self-opening pop-ups stay tappable over a modal", () => {
  for (const file of POP_UPS) {
    it(`${file}: every full-screen overlay has pointer-events-auto`, () => {
      const text = readFileSync(path.join(HERE, file), "utf8");
      const overlays = [...text.matchAll(/className="([^"]*\bfixed inset-0\b[^"]*)"/g)].map(m => m[1]);
      expect(overlays.length).toBeGreaterThan(0);
      for (const cls of overlays) expect(cls).toContain("pointer-events-auto");
    });
  }
});
