/** Box labels for a local delivery (Graeme, 29 Oct 2026). No courier, so no
 *  APC label — the packer sets how many boxes the order went into while
 *  packing and prints one label per box: "LOCAL DELIVERY · #136900 · BOX 1
 *  OF 2", then "2 OF 2", so the van driver knows every box of an order is on
 *  board. Sized for the 4×6in label printer the APC labels use. Pure —
 *  unit-tested; the page opens the print window. */

export const MAX_LOCAL_BOXES = 20;

export interface LocalDeliveryLabelOrder {
  name: string;
  customer?: { first_name?: string | null; last_name?: string | null } | null;
  shipping_address?: { name?: string | null; address1?: string | null; address2?: string | null; city?: string | null; zip?: string | null } | null;
}

export interface LocalDeliveryBoxLabel {
  orderName: string;
  recipient: string;
  addressLines: string[];
  box: number;
  boxes: number;
}

/** Whole boxes from 1 to MAX_LOCAL_BOXES — whatever the stepper or a typo hands over. */
export function clampBoxes(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_LOCAL_BOXES, Math.max(1, Math.round(n)));
}

export function localDeliveryBoxLabels(order: LocalDeliveryLabelOrder, boxes: number): LocalDeliveryBoxLabel[] {
  const total = clampBoxes(boxes);
  const a = order.shipping_address;
  const recipient = a?.name?.trim()
    || `${order.customer?.first_name ?? ""} ${order.customer?.last_name ?? ""}`.trim()
    || "—";
  const addressLines = [a?.address1, a?.address2, a?.city, a?.zip]
    .map(l => (l ?? "").trim())
    .filter(Boolean);
  return Array.from({ length: total }, (_, i) => ({ orderName: order.name, recipient, addressLines, box: i + 1, boxes: total }));
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One printed page per box; prints itself as soon as it opens. */
export function localDeliveryLabelHtml(labels: LocalDeliveryBoxLabel[]): string {
  const pages = labels.map(l => `
    <section class="label">
      <div class="kind">LOCAL DELIVERY</div>
      <div class="order">${esc(l.orderName)}</div>
      <div class="name">${esc(l.recipient)}</div>
      <div class="addr">${l.addressLines.map(esc).join("<br>")}</div>
      <div class="box">BOX ${l.box} OF ${l.boxes}</div>
    </section>`).join("");
  const title = labels[0] ? `Local delivery ${esc(labels[0].orderName)}` : "Local delivery";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>
      @page { size: 4in 6in; margin: 0; }
      * { box-sizing: border-box; }
      body { font-family: -apple-system, Helvetica, Arial, sans-serif; margin: 0; }
      .label { width: 4in; height: 6in; padding: 0.25in; display: flex; flex-direction: column; text-align: center; border: 4px solid #000; page-break-after: always; break-after: page; }
      .label:last-child { page-break-after: auto; break-after: auto; }
      .kind { font-size: 22px; letter-spacing: 4px; font-weight: 900; background: #000; color: #fff; padding: 8px 0; border-radius: 6px; }
      .order { font-size: 52px; font-weight: 900; margin: 18px 0 6px; }
      .name { font-size: 26px; font-weight: 800; margin: 6px 0; }
      .addr { font-size: 20px; font-weight: 600; line-height: 1.3; }
      .box { margin-top: auto; font-size: 48px; font-weight: 900; border: 4px solid #000; border-radius: 10px; padding: 10px 0; }
    </style></head><body>${pages}
    <script>window.onload = () => { window.print(); };</script>
    </body></html>`;
}
