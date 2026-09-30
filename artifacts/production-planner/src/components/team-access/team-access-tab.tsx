/**
 * Settings → Team & Access (Graeme, 2026-09-30 redesign).
 *
 * The tab used to list everyone twice — a users table, then the Feature
 * grants cards (and a third time in People section access) — plus a Page
 * Access Control table with a Save Changes button. Now:
 *
 *   Team          ONE big card per person: name, email, role, active, and a
 *                 short access summary. Tap → their Access modal
 *                 (person-access-dialog.tsx) with role, extras, Graeme's
 *                 switches and the account in one place.
 *   Page Access   a three-column board (page-access-board.tsx).
 *   SOP training gate (sop-training-gate-section.tsx).
 *
 * Who sees what is unchanged: the tab needs admin or the settings.team
 * grant; the access controls and account details are admin only (the
 * server gives non-admins names only).
 */
import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Mail, Plus, Search, Users } from "lucide-react";
import { useListUsers } from "@workspace/api-client-react";
import { isFounderEmail } from "@workspace/feature-registry";
import { useAuth } from "@/contexts/auth-context";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { accessSummary, extrasCount, filterTeam, roleLabel } from "@/lib/team-access";
import { usePeopleAccessList, useTeamFeatures, type TeamUser } from "@/hooks/use-team-access";
import { PersonAccessDialog } from "./person-access-dialog";
import { PageAccessBoard } from "./page-access-board";
import { SopTrainingGateSection } from "./sop-training-gate-section";
import { AddPersonDialog, InviteDialog } from "./add-person-dialogs";

export function TeamAccessTab() {
  const { state } = useAuth();
  const me = state.status === "authenticated" ? state.user : null;
  const isAdmin = me?.role === "admin";
  const viewerIsFounder = isFounderEmail(me?.email);

  const usersQuery = useListUsers();
  const features = useTeamFeatures();
  const peopleAccess = usePeopleAccessList();

  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const users = (usersQuery.data ?? []) as unknown as TeamUser[];
  const { active, inactive } = useMemo(() => filterTeam(users, search), [users, search]);
  const searching = search.trim().length > 0;

  const summaryFor = (u: TeamUser) => {
    const row = peopleAccess.data?.users.find(p => p.id === u.id);
    const isFounder = row?.isFounder === true || isFounderEmail(u.email);
    const grantedKeys = new Set((features.data?.grants ?? []).filter(g => g.userId === u.id).map(g => g.featureKey));
    return accessSummary({
      role: u.role,
      isFounder,
      extras: extrasCount({ features: features.data?.features ?? [], grantedKeys, targetRole: u.role, targetIsFounder: isFounder }),
      peopleAccess: row != null && row.state !== "none",
    });
  };

  const openPerson = users.find(u => u.id === openId) ?? null;

  const card = (u: TeamUser) => {
    const body = (
      <div className="flex items-center gap-4">
        <UserAvatar name={u.name} avatarUrl={u.avatarUrl ?? null} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold truncate">{u.name}</p>
          {u.email && <p className="text-sm text-muted-foreground truncate">{u.email}</p>}
          <div className="flex flex-wrap gap-2 mt-1.5">
            <span className="rounded-full bg-primary/15 text-primary px-3 py-0.5 text-sm font-semibold">
              {isAdmin ? summaryFor(u) : roleLabel(u.role)}
            </span>
            {!u.isActive && <span className="rounded-full bg-secondary text-muted-foreground px-3 py-0.5 text-sm font-semibold">Inactive</span>}
          </div>
        </div>
      </div>
    );
    return isAdmin ? (
      <button
        key={u.id}
        type="button"
        onClick={() => setOpenId(u.id)}
        className={cn("text-left rounded-2xl border-2 border-border bg-card p-4 hover:border-primary/50 hover:bg-secondary/30 transition-colors", !u.isActive && "opacity-70")}
      >
        {body}
      </button>
    ) : (
      <div key={u.id} className={cn("rounded-2xl border-2 border-border bg-card p-4", !u.isActive && "opacity-70")}>{body}</div>
    );
  };

  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" /> Team
              {usersQuery.data && (
                <span className="text-xs font-normal text-muted-foreground bg-secondary/60 px-2 py-0.5 rounded-full">{active.length + inactive.length}{searching ? " found" : ""}</span>
              )}
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isAdmin
                ? "Everyone with an account. Tap a person for their role, what they can open, and their account."
                : "Everyone with an account. Only admins can change roles and access."}
            </p>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setInviteOpen(true)}
                className="h-11 px-4 bg-secondary text-foreground rounded-xl text-sm font-semibold flex items-center gap-2 hover:bg-secondary/70 border border-border"
              >
                <Mail className="w-4 h-4" /> Invite
              </button>
              <button
                onClick={() => setAddOpen(true)}
                className="h-11 px-4 bg-primary text-primary-foreground rounded-xl text-sm font-semibold flex items-center gap-2 hover:bg-primary/90"
              >
                <Plus className="w-4 h-4" /> Add person
              </button>
            </div>
          )}
        </div>

        <div className="relative max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Find a person"
            aria-label="Find a person"
            className="w-full h-12 pl-9 pr-3 rounded-xl border-2 border-border bg-card text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>

        {usersQuery.isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : usersQuery.isError ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center justify-between gap-3">
            <span>Couldn't load the team.</span>
            <button onClick={() => usersQuery.refetch()} className="px-3 py-2 rounded-lg border border-destructive/40 font-semibold">Try again</button>
          </div>
        ) : (
          <>
            <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
              {active.map(card)}
            </div>
            {active.length === 0 && (
              <p className="text-sm text-muted-foreground">{searching ? "No active person matches that search." : "No active accounts."}</p>
            )}

            {inactive.length > 0 && (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setShowInactive(v => !v)}
                  aria-expanded={showInactive || searching}
                  className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border-2 border-border text-sm font-semibold hover:bg-secondary/50"
                >
                  Inactive ({inactive.length})
                  {showInactive || searching ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                {/* A search opens the group, so a match is never hidden. */}
                {(showInactive || searching) && (
                  <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                    {inactive.map(card)}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Deciding who gets in stays admin-only, even for someone granted
          Team & Access — the board sets every page's level and the grants
          hand out access, so either would be a back door to admin. */}
      {isAdmin && <PageAccessBoard />}
      {isAdmin && <SopTrainingGateSection />}

      {isAdmin && openPerson && me && (
        <PersonAccessDialog
          key={openPerson.id}
          person={openPerson}
          features={features.data}
          peopleAccess={peopleAccess.data}
          viewer={{ id: me.id, isFounder: viewerIsFounder }}
          onClose={() => setOpenId(null)}
        />
      )}
      {isAdmin && <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />}
      {isAdmin && <AddPersonDialog open={addOpen} onOpenChange={setAddOpen} />}
    </div>
  );
}
