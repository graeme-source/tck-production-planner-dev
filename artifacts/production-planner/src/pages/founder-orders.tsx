/**
 * The Business → Orders (Graeme, 28 Nov 2026; Objective I): the Every order
 * table on a page of its own, just to the left of Numbers. It's a tab on
 * touch screens only (lib/business-pager.ts), where it comes off the bottom
 * of Numbers and you swipe across to it; with a mouse Numbers keeps the
 * table and there's no tab. Same door as Numbers: whoever can open Numbers
 * can open this. The panel keeps its own dates, opening on today.
 */
import { Redirect } from "wouter";
import { FounderNav } from "@/components/founder-nav";
import { PageHeader } from "@/components/page-header";
import { NumbersEveryOrder } from "@/components/founder/numbers-every-order";
import { useFounderArea } from "@/hooks/use-founder-area";

export default function FounderOrders() {
  const { ready, canNumbers, home } = useFounderArea();
  if (!ready) return null;
  if (!canNumbers) return <Redirect to={home ?? "/"} />;
  return (
    <div className="space-y-8">
      <FounderNav />
      <PageHeader title="Orders" />
      <NumbersEveryOrder />
    </div>
  );
}
