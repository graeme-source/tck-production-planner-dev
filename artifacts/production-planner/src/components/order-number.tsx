/**
 * Order number as a link into the Shopify admin.
 *
 * Wanted everywhere an order number appears — a packer or manager assessing
 * anything (an untagged order, a booking failure, an address that won't fit a
 * label) ends up in Shopify, and hunting for the order by hand is the slow
 * part. Opens in a new tab so the screen behind it stays put.
 *
 * The base URL arrives once from /config-status rather than per order: a wave
 * is several hundred rows. Falls back to plain text when the base hasn't
 * loaded, so the number is never missing.
 *
 * Lives here rather than in pages/fulfilment.tsx so the booking dialog and any
 * other screen showing an order number link the same way instead of growing a
 * second copy.
 */
import { cn } from "@/lib/utils";

export function OrderNumber({ orderId, name, adminBase, className }: {
  orderId: number | string;
  name: string;
  adminBase?: string;
  className?: string;
}) {
  if (!adminBase) return <span className={className}>{name}</span>;
  return (
    <a
      href={`${adminBase}${orderId}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      // Underlined ALWAYS, not just on hover: the packing screen is used on
      // an iPad, where there is no hover state, so a hover-only affordance is
      // invisible to the people actually using it.
      className={cn(className, "underline decoration-dotted underline-offset-2 decoration-current/40 hover:decoration-current")}
      title={`Open ${name} in Shopify`}
    >
      {name}
    </a>
  );
}
