import { useAuth } from "@/contexts/auth-context";
import { Redirect } from "wouter";
import { PageHeader } from "@/components/page-header";
import { FounderNav } from "@/components/founder-nav";
import { FounderPlanner } from "@/components/founder-planner";

const FOUNDER_EMAIL = "graeme@thecalzonekitchen.co.uk";

export default function FounderFocus() {
  const { state } = useAuth();

  if (state.status !== "authenticated" || state.user.email !== FOUNDER_EMAIL) {
    return <Redirect to="/" />;
  }

  return (
    <div className="space-y-6">
      <FounderNav />
      <PageHeader
        title="Founder Focus"
        description="Time-blocked days against the pillars only you can move."
      />
      <FounderPlanner />
    </div>
  );
}
