/**
 * The Business → Live offers (Graeme, 28 Oct 2026): its own tab next to the
 * floor map — was an inner tab of Sales & Marketing. Switchable sales offers;
 * Lucky Order Number first. Same people as Sales & Marketing. Objective I.
 */
import { Redirect } from "wouter";
import { useFounderArea } from "@/hooks/use-founder-area";
import { FounderNav } from "@/components/founder-nav";
import { PageHeader } from "@/components/page-header";
import { LuckyOrderOffer } from "@/components/live-offers/lucky-order-offer";

export default function FounderLiveOffers() {
  const { ready, canSales, isFounder, home } = useFounderArea();
  if (!ready) return null;
  if (!canSales) return <Redirect to={home ?? "/"} />;
  return (
    <div className="space-y-6">
      <FounderNav />
      <PageHeader title="Live offers" description="Offers you can switch on and off — what each one does, and who's won." />
      <LuckyOrderOffer isFounder={isFounder} />
    </div>
  );
}
