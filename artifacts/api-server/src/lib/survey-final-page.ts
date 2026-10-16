/**
 * The optional final page of a customer survey (Graeme, 2026-10-16): shown
 * on the Shopify feedback page once the customer submits — a heading, a
 * short formatted body, one big button and, if chosen, this week's offer
 * from the email plan. Off by default; switched on per survey.
 *
 * Pure rules only (link allow-list, offer wording, what the public API
 * sends). The body HTML goes through the same sanitiser as the intro.
 * Objective I (customer feedback shapes what we launch — and the moment
 * after feedback is a good time to order).
 */
import {
  fillProduct, offerIndexForWeek, startOfWeek, PRODUCT_TOKEN, type CycleConfig,
} from "@workspace/marketing-calendar";
import { sanitiseSurveyIntroHtml } from "./survey-intro";

/** The shop the button may point at. Nothing else is allowed. */
export const SHOP_HOSTS = ["thecalzonekitchen.co.uk", "www.thecalzonekitchen.co.uk"] as const;

/**
 * Button presets. Menu = the page the theme itself links "Order Calzones"
 * to (cart page, portal, announcement bar).
 */
export const FINAL_LINK_PRESETS = {
  home: { label: "Homepage", url: "https://thecalzonekitchen.co.uk/" },
  menu: { label: "Menu (all calzones)", url: "https://thecalzonekitchen.co.uk/pages/menu" },
} as const;

/**
 * A button link we're willing to put on the website: http(s) on our own
 * shop's host only, no username/password part. Returns the normalised
 * https URL, or null when it isn't allowed.
 */
export function normaliseFinalLink(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  // Absolute URLs only — "//evil.com" or "javascript:" never get this far.
  if (!/^https?:\/\//i.test(text)) return null;
  let url: URL;
  try { url = new URL(text); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  if (url.port) return null;
  if (!(SHOP_HOSTS as readonly string[]).includes(url.hostname.toLowerCase())) return null;
  url.protocol = "https:";
  return url.toString();
}

/**
 * This week's offer as customers read it, from the email plan — or null
 * when there isn't one (plan not set up, a paused week, no offers, or the
 * offer names the week's product and no product is set for the week).
 */
export function currentOfferText(input: {
  config: Pick<CycleConfig, "startDate" | "weeklyPlan" | "pauses" | "offers">;
  configured: boolean;
  today: string;
  weekProduct: string | null;
}): string | null {
  if (!input.configured) return null;
  const idx = offerIndexForWeek(startOfWeek(input.today), input.config);
  if (idx == null) return null;
  const offer = input.config.offers[idx];
  if (!offer) return null;
  const text = fillProduct(offer.name, offer.featuresProduct ? input.weekProduct : null).trim();
  if (!text) return null;
  // Never show a customer the "(Product)" placeholder.
  if (text.toLowerCase().includes(PRODUCT_TOKEN.toLowerCase())) return null;
  return text;
}

export interface FinalPageRow {
  finalPageEnabled: boolean;
  finalHeading: string | null;
  finalHtml: string | null;
  finalButtonLabel: string | null;
  finalButtonUrl: string | null;
  finalShowOffer: boolean;
}

export interface PublicFinalPage {
  heading: string | null;
  html: string | null;
  button: { label: string; url: string } | null;
  offer: string | null;
}

/**
 * What the public survey API sends for the final page: null when switched
 * off (the survey ends exactly as before). Everything is re-checked on the
 * way out — body re-sanitised, link re-validated — and the offer is only
 * included when the survey asks for it AND the plan has one.
 */
export function publicFinalPage(row: FinalPageRow, offer: string | null): PublicFinalPage | null {
  if (!row.finalPageEnabled) return null;
  const url = normaliseFinalLink(row.finalButtonUrl);
  const label = (row.finalButtonLabel ?? "").trim();
  return {
    heading: (row.finalHeading ?? "").trim() || null,
    html: sanitiseSurveyIntroHtml(row.finalHtml),
    button: url && label ? { label, url } : null,
    offer: row.finalShowOffer ? (offer?.trim() || null) : null,
  };
}
