/** Wrap-to-Shopify status words for the wrapping screen — pure, tested.
 *  States come from the server (api-server lib/shopify-wrap-push-rules.ts). */
export type ShopifyWrapState =
  | { state: "none" }
  | { state: "ok"; sentPacks: number }
  | { state: "sending"; packs: number }
  | { state: "failed"; failedIds: number[]; failedPacks: number; error: string | null; sentPacks: number }
  | { state: "skipped"; packs: number }
  | { state: "stuck"; ids: number[] };

export function shopifyWrapStatusText(state: ShopifyWrapState | undefined): { tone: "ok" | "busy" | "bad" | "off" | "none"; text: string } {
  if (!state || state.state === "none") return { tone: "none", text: "Shopify: nothing sent yet — each freezer add goes to Shopify" };
  switch (state.state) {
    case "ok": return { tone: "ok", text: `${signed(state.sentPacks)} sent to Shopify ✓` };
    case "sending": return { tone: "busy", text: `Sending ${signed(state.packs)} to Shopify…` };
    case "failed": return { tone: "bad", text: `Shopify update failed (${signed(state.failedPacks)}) — retry${state.error ? `: ${state.error}` : ""}` };
    case "skipped": return { tone: "off", text: `Not sent — Shopify writes are switched off on this server (${signed(state.packs)})` };
    case "stuck": return { tone: "bad", text: "Shopify didn't answer — check the stock in Shopify before doing anything else" };
  }
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
