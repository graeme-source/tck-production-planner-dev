import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/contexts/auth-context";
import { ImprovementsTab } from "@/pages/reports";

/**
 * First-class Improvements page. Log ideas and niggles, track them through the
 * review workflow to completed. Reuses the management UI that previously lived
 * only as a tab inside Reports.
 */
export default function Improvements() {
  const { state } = useAuth();
  const userRole = state.status === "authenticated" ? state.user.role : "viewer";
  const currentUserName = state.status === "authenticated" ? state.user.name : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Improvements"
        description="Log ideas and niggles, big or small — then review and track them through to done."
      />
      <ImprovementsTab userRole={userRole} currentUserName={currentUserName} />
    </div>
  );
}
