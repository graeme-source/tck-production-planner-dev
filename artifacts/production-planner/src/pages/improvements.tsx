import { useEffect, useState } from "react";
import { CheckCircle2, Wrench } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/contexts/auth-context";
import { ImprovementsTab } from "@/pages/reports";
import { ImprovementAttachments } from "@/components/improvement-attachments";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Improvement {
  id: number;
  title: string;
  description: string;
  progressStatus: string;
  station: string;
  assignedToName: string | null;
  updatedAt: string;
  createdAt: string;
}

/**
 * First-class Improvements page. Two at-a-glance panels (what's outstanding,
 * what's recently shipped with its photos/videos) sit above the full
 * management table reused from Reports.
 */
export default function Improvements() {
  const { state } = useAuth();
  const userRole = state.status === "authenticated" ? state.user.role : "viewer";
  const currentUserName = state.status === "authenticated" ? state.user.name : null;

  const [all, setAll] = useState<Improvement[] | null>(null);
  useEffect(() => {
    fetch(`${BASE}/api/improvements`, { credentials: "include" })
      .then(r => (r.ok ? r.json() : []))
      .then(setAll)
      .catch(() => setAll([]));
  }, []);

  const open = (all ?? []).filter(i => i.progressStatus !== "complete");
  const completed = (all ?? [])
    .filter(i => i.progressStatus === "complete")
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 12);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Improvements"
        description="Log ideas big or small — then review and track them through to done."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="bg-card border border-border rounded-2xl p-5">
          <h2 className="text-base font-semibold flex items-center gap-2 mb-3">
            <Wrench className="w-4 h-4 text-amber-500" /> Improvements Required
            <span className="text-sm text-muted-foreground">({open.length})</span>
          </h2>
          {all === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : open.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing outstanding right now.</p>
          ) : (
            <ul className="space-y-2">
              {open.slice(0, 12).map(i => (
                <li key={i.id} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                  <span>
                    <span className="font-medium">{i.title}</span>
                    {i.description ? <span className="text-muted-foreground"> — {i.description}</span> : null}
                    {i.assignedToName ? <span className="text-xs text-muted-foreground"> ({i.assignedToName})</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-card border border-border rounded-2xl p-5">
          <h2 className="text-base font-semibold flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-4 h-4 text-green-500" /> Recently Completed
            <span className="text-sm text-muted-foreground">({completed.length})</span>
          </h2>
          {all === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : completed.length === 0 ? (
            <p className="text-sm text-muted-foreground">No completed improvements yet.</p>
          ) : (
            <ul className="space-y-3">
              {completed.map(i => (
                <li key={i.id} className="border-b border-border/50 last:border-0 pb-3 last:pb-0">
                  <p className="text-sm font-medium">{i.title}</p>
                  {i.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{i.description}</p>}
                  <div className="mt-2">
                    <ImprovementAttachments improvementId={i.id} thumbSize="w-16 h-16" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ImprovementsTab userRole={userRole} currentUserName={currentUserName} />
    </div>
  );
}
