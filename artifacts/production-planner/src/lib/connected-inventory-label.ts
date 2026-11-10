/**
 * The Orders line note for a Connected Inventory top-up (Graeme, 10 Nov
 * 2026): what Shopify says is on the shelf and what we're filling up to.
 * Objective C.
 */
export type ConnectedInventoryInfo = { onHandUnits: number | null; inboundUnits: number; maxUnits: number; unitsPerPack: number };

export function connectedInventoryLabel(info: ConnectedInventoryInfo | null | undefined): string | null {
  if (!info) return null;
  if (info.onHandUnits == null) return "Shopify stock didn't load — not topped up";
  const parts = [`Shopify ${Math.max(0, info.onHandUnits)}`];
  if (info.inboundUnits > 0) parts.push(`${info.inboundUnits} on the way`);
  return `${parts.join(" + ")} · fills to ${info.maxUnits}`;
}
