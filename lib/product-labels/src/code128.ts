/**
 * Code 128 — for product barcodes that aren't EAN-13, e.g. Shopify's
 * 14-digit "97748478844497" on TCK Garlic Mayo (Graeme, 2026-10-27). Pure.
 *
 * All-digit, even-length codes use code set C (two digits per symbol — the
 * most compact); anything else uses code set B (printable ASCII). Returns
 * one boolean per module (true = bar), without quiet zones.
 */

/** Bar/space widths for symbols 0–105, then STOP (106, seven elements). */
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
] as const;

export const CODE128_PATTERNS: readonly string[] = PATTERNS;
const START_B = 104;
const START_C = 105;
const STOP = 106;
/** Quiet zone each side, in modules (the standard asks for at least 10). */
export const CODE128_QUIET = 10;

/** Can this text be drawn as Code 128 (set B or C)? */
export function code128Ok(text: string): boolean {
  return text.length > 0 && text.length <= 40 && /^[\x20-\x7e]+$/.test(text);
}

/** The symbol values, start and check included, stop excluded. */
export function code128Symbols(text: string): number[] {
  if (!code128Ok(text)) throw new Error(`Can't make a Code 128 barcode from "${text}"`);
  const setC = /^\d+$/.test(text) && text.length % 2 === 0;
  const symbols = [setC ? START_C : START_B];
  if (setC) for (let i = 0; i < text.length; i += 2) symbols.push(Number(text.slice(i, i + 2)));
  else for (const ch of text) symbols.push(ch.charCodeAt(0) - 32);
  const check = symbols.reduce((sum, v, i) => sum + v * (i === 0 ? 1 : i), 0) % 103;
  symbols.push(check);
  return symbols;
}

/** Modules, bar first, start to stop (no quiet zones). */
export function encodeCode128(text: string): boolean[] {
  const out: boolean[] = [];
  for (const s of [...code128Symbols(text), STOP]) {
    [...PATTERNS[s]!].forEach((w, i) => { for (let k = 0; k < Number(w); k++) out.push(i % 2 === 0); });
  }
  return out;
}
