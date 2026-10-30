/**
 * Routes whose JSON bodies are allowed to exceed the global 1 MB cap, and
 * the limit each one gets.
 *
 * The ONLY place a bigger limit works is app.ts, mounted path-scoped BEFORE
 * the global `express.json({ limit: "1mb" })` — express.json skips a body
 * another parser has already consumed, so a parser attached at router or
 * route level never sees the body: the global parser has already 413'd it.
 * That exact trap shipped once (recipe-designer's /chat carried a dead
 * 30 MB router-level parser while real >1 MB image attachments failed with
 * 413), which is why this map exists and why big-body-routes.test.ts scans
 * the routes folder for reintroductions.
 *
 * Each route must still enforce its own semantic caps (per-image decoded
 * size, image counts) — the limit here only lets the body through parsing.
 */
export const BIG_BODY_JSON_ROUTES: Readonly<Record<string, string>> = {
  // Label photos arrive as base64 JSON (up to 4 re-encoded JPEGs ≤4 MB
  // decoded each).
  "/api/ingredients/scrape-photo": "10mb",
  // Recipe Designer chat accepts up to 10 base64 image attachments of
  // ≤5 MB each (Anthropic's per-image limit), validated in the route.
  "/api/recipe-designer/chat": "30mb",
  // Test box → Shopify products: each recipe's nutrition table PNG (≈50 KB,
  // at most 10 recipes × 800 000 base64 characters, checked in the route).
  "/api/test-boxes/:id/shopify/create": "9mb",
  // A recipe's product photo for Shopify, as base64 (≤10 MB decoded, size
  // and type re-read from the image header in the route).
  "/api/recipes/:id/product-photo": "15mb",
  // "Create Shopify product" on a recipe: its nutrition table PNG (≤800 000
  // base64 characters, checked in the route).
  "/api/recipes/:id/shopify-product/create": "2mb",
};
