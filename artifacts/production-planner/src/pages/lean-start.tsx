/**
 * /lean-start — the self-paced Lean curriculum for full-access users:
 * Graeme's preview of what new starters see on the gated onboarding
 * screen, and a catch-up path for anyone who joined mid-curriculum.
 * Completions here are real (matrix-ticking), same as everywhere else.
 */
import { PageHeader } from "@/components/page-header";
import { LeanResources, LeanSelfPaced } from "@/components/lean-self-paced";

export default function LeanStart() {
  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-16">
      <PageHeader
        title="Lean — Start Here"
        description="The whole curriculum, self-paced. New starters see exactly this on their onboarding screen; completing a module ticks the Lean training matrix for real."
      />
      <LeanResources />
      <div className="bg-card border border-border rounded-2xl p-5">
        <LeanSelfPaced />
      </div>
    </div>
  );
}
