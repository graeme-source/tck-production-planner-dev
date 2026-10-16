/**
 * A pop-up must stay pinned to the middle of the screen. DialogContent is
 * `fixed` + centred by translate; adding `relative` / `absolute` / `static` /
 * `sticky` to its className overrides `fixed` (tailwind-merge keeps the
 * last position class), so the card is laid out down the page and its
 * bottom runs off screen. That happened to Create Plan on 15 Oct 2026
 * (Graeme, 16 Oct: "the modal seems to be cut off. I can't see the bottom").
 * `fixed` is already a containing block for absolutely-positioned children,
 * so `relative` is never needed there.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : tsxFiles(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

describe("pop-ups stay centred on screen", () => {
  it("no DialogContent overrides its fixed position", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/<DialogContent\b[^>]*?className=(?:"([^"]*)"|\{cn\(\s*"([^"]*)")/g)) {
        const classes = (m[1] ?? m[2] ?? "").split(/\s+/);
        if (classes.some(c => ["relative", "absolute", "static", "sticky"].includes(c))) {
          offenders.push(`${path.relative(SRC, file)}: ${classes.join(" ").slice(0, 80)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
