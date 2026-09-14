/**
 * Admin housekeeping notices for the Employee Records report (Graeme,
 * 2026-09-14): the "Plan Day employees without a planner login" invite
 * cards and the unmatched-app-users banner sat between the summary cards
 * and the table, permanently in the way. They now collapse to one slim
 * line at the top of the tab, expandable on demand — and each Plan Day
 * person can be DISMISSED (persisted server-side for everyone: the
 * accountant is on the rota but will never need a planner login).
 * Lives in its own file because pages/reports.tsx is frozen by the charter.
 */
import { useState } from "react";
import { ChevronDown, ChevronUp, UserPlus, X, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface UnmatchedPlandayEmployee {
  plandayEmployeeId: number;
  name: string;
  email: string | null;
  dismissed?: boolean;
}

function UnmatchedPlandayRow({ employee, onDismissed }: {
  employee: UnmatchedPlandayEmployee;
  onDismissed: (id: number, dismissed: boolean) => void;
}) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [role, setRole] = useState<"viewer" | "manager" | "admin">("viewer");

  const invite = async () => {
    if (!employee.email) {
      toast({ title: "No email on Plan Day", description: "Add an email in Plan Day first, or create the user manually in Settings.", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const resp = await fetch(`${BASE}/api/auth/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: employee.email, role }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${resp.status}`);
      }
      setSent(true);
      toast({ title: "Invite sent", description: `${employee.name} will get an email with a sign-up link. Their Plan Day record auto-links when they accept.` });
    } catch (err) {
      toast({ title: "Failed to send invite", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const dismiss = async () => {
    try {
      const resp = await fetch(`${BASE}/api/employees/attendance/unmatched-dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ plandayEmployeeId: employee.plandayEmployeeId, dismissed: true }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      onDismissed(employee.plandayEmployeeId, true);
    } catch {
      toast({ title: "Couldn't dismiss", description: "Try again in a moment.", variant: "destructive" });
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 bg-background rounded-lg px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="font-medium truncate">{employee.name}</div>
        <div className="text-xs text-muted-foreground truncate">
          {employee.email ?? <span className="text-amber-600">no email on Plan Day</span>}
        </div>
      </div>
      {!sent && (
        <select
          value={role}
          onChange={e => setRole(e.target.value as "viewer" | "manager" | "admin")}
          disabled={sending}
          className="text-xs px-2 py-1 rounded-md bg-background border border-border"
        >
          <option value="viewer">Viewer</option>
          <option value="manager">Manager</option>
          <option value="admin">Admin</option>
        </select>
      )}
      <button
        onClick={invite}
        disabled={sending || sent || !employee.email}
        className={cn(
          "text-xs px-3 py-1.5 rounded-md border transition-colors whitespace-nowrap",
          sent
            ? "bg-emerald-50 border-emerald-300 text-emerald-700"
            : "bg-primary text-primary-foreground border-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed",
        )}
      >
        {sent ? "Invite sent" : sending ? "Sending…" : "Invite to planner"}
      </button>
      <button
        onClick={dismiss}
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        title="Dismiss — this person doesn't need a planner login"
        aria-label={`Dismiss ${employee.name} — doesn't need a planner login`}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export function AttendanceAdminNotices({ unmatchedAppUsers, unmatchedPlandayEmployees, showUnlinked, onToggleUnlinked }: {
  unmatchedAppUsers: Array<{ userId: number; name: string; email: string }>;
  unmatchedPlandayEmployees: UnmatchedPlandayEmployee[];
  showUnlinked: boolean;
  onToggleUnlinked: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  // Local overlay on the server's dismissed flags so a dismiss/restore
  // takes effect instantly without refetching the whole report.
  const [overrides, setOverrides] = useState<Record<number, boolean>>({});

  const isDismissed = (e: UnmatchedPlandayEmployee) => overrides[e.plandayEmployeeId] ?? e.dismissed ?? false;
  const active = unmatchedPlandayEmployees.filter(e => !isDismissed(e));
  const dismissed = unmatchedPlandayEmployees.filter(isDismissed);

  const setDismissState = (id: number, value: boolean) =>
    setOverrides(prev => ({ ...prev, [id]: value }));

  const restore = async (id: number) => {
    try {
      const resp = await fetch(`${BASE}/api/employees/attendance/unmatched-dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ plandayEmployeeId: id, dismissed: false }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setDismissState(id, false);
    } catch {
      toast({ title: "Couldn't restore", description: "Try again in a moment.", variant: "destructive" });
    }
  };

  const parts: string[] = [];
  if (active.length > 0) parts.push(`${active.length} Plan Day ${active.length === 1 ? "person" : "people"} without a planner login`);
  if (unmatchedAppUsers.length > 0) parts.push(`${unmatchedAppUsers.length} app user${unmatchedAppUsers.length === 1 ? "" : "s"} unmatched`);
  if (parts.length === 0 && dismissed.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-secondary/30 text-sm overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-secondary/50 transition-colors"
      >
        <UserPlus className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <span className="flex-1 min-w-0 truncate text-muted-foreground">
          {parts.length > 0 ? parts.join(" · ") : `${dismissed.length} dismissed`}
        </span>
        {open ? <ChevronUp className="w-4 h-4 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 flex-shrink-0" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {unmatchedAppUsers.length > 0 && (
            <div className="flex items-center justify-between gap-2 bg-background rounded-lg px-3 py-2">
              <span>
                <span className="font-medium">{unmatchedAppUsers.length}</span>{" "}
                app user{unmatchedAppUsers.length === 1 ? "" : "s"} could not be matched to a Plan Day employee by email or name.
              </span>
              <button
                onClick={onToggleUnlinked}
                className="text-xs px-2 py-1 rounded-md bg-background border border-border hover:bg-secondary transition-colors whitespace-nowrap"
              >
                {showUnlinked ? "Hide unlinked" : "Show unlinked"}
              </button>
            </div>
          )}

          {active.length > 0 && (
            <div className="space-y-2">
              {active.map(emp => (
                <UnmatchedPlandayRow key={emp.plandayEmployeeId} employee={emp} onDismissed={setDismissState} />
              ))}
            </div>
          )}

          {dismissed.length > 0 && (
            <div>
              <button onClick={() => setShowDismissed(v => !v)} className="text-xs text-muted-foreground hover:text-foreground">
                {showDismissed ? "Hide" : "Show"} {dismissed.length} dismissed
              </button>
              {showDismissed && (
                <div className="mt-2 space-y-1">
                  {dismissed.map(emp => (
                    <div key={emp.plandayEmployeeId} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-muted-foreground bg-background/60 rounded-lg">
                      <span className="truncate">{emp.name}</span>
                      <button onClick={() => restore(emp.plandayEmployeeId)} className="flex items-center gap-1 hover:text-foreground">
                        <Undo2 className="w-3 h-3" /> Restore
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
