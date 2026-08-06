// Where the public survey widget lives on the Shopify site. The path may
// change before launch — this constant is the ONE place the base URL is
// defined; share links and QR codes are both derived from it server-side.
export const SURVEY_PUBLIC_BASE_URL = "https://thecalzonekitchen.co.uk/pages/feedback";

export function surveyShareUrl(token: string): string {
  return `${SURVEY_PUBLIC_BASE_URL}?s=${encodeURIComponent(token)}`;
}
