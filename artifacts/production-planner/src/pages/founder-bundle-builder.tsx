/**
 * The Business → Bundle builder (Graeme, 28 Oct 2026): its own tab next to
 * Live offers — was an inner tab of Sales & Marketing. Objective I.
 */
import { Redirect } from "wouter";
import { Calculator } from "lucide-react";
import { useFounderArea } from "@/hooks/use-founder-area";
import { useAuth } from "@/contexts/auth-context";
import { FounderNav } from "@/components/founder-nav";
import { PageHeader } from "@/components/page-header";
import { BundleCalculator } from "@/components/bundle-calculator";

export default function FounderBundleBuilder() {
  const { ready, canSales, home } = useFounderArea();
  // The bundle calculator's API (/api/bundles) is managers and admins only.
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.user.role : "viewer";
  const canBundles = role === "admin" || role === "manager";
  if (!ready) return null;
  if (!canSales) return <Redirect to={home ?? "/"} />;
  return (
    <div className="space-y-6">
      <FounderNav />
      <PageHeader title="Bundle builder" description="Build a bundle from recipes and extras, and see its cost, margin and shipping at a price." />
      {canBundles ? (
        <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Calculator className="w-4 h-4 text-primary" /> Bundle calculator
          </h2>
          <BundleCalculator />
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">The bundle builder is for managers and admins.</p>
      )}
    </div>
  );
}
