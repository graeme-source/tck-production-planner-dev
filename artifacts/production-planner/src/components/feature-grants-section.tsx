import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { roleMeets, type Role } from "@workspace/feature-registry";
import {
  ChevronLeft, GraduationCap, KeyRound, Loader2, Lock, Search, ShieldCheck, User as UserIcon,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Feature grants — hand one person one part of the app, whatever their role.
//
// Rebuilt person-first on 2026-09-04. It used to be one card per feature with
// a switch for every person inside it, which worked while there was a single
// feature (APC label printing) and falls apart at twenty-six: to answer "what
// can Lorna get to?" you had to read every card. Now you pick the person, and
// their whole access sits on one screen — what their role already gives them,
// and what you've handed them on top.
//
// Grants only ever ADD. The role is the general level everyone comes in on;
// this tops individuals up. Nothing here takes access away, so there's never a
// second place to look when someone asks why they can't see something.

type Feature = {
  key: string;
  name: string;
  description: string | null;
  requiredSopId: number | null;
  area: string;
  kind: "page" | "settings" | "ability" | "retired";
  target: string | null;
  baselineRole: Role | null;
  retired: boolean;
};
type Grant = { id: number; featureKey: string; userId: number };
type UserRow = { id: number; name: string; email: string; role: string };
type SopRow = { id: number; title: string };
type AccessData = {
  features: Feature[];
  grants: Grant[];
  users: UserRow[];
  sops: SopRow[];
  gateEnforced: boolean;
  trainingByGrant: Record<number, boolean>;
};

async function jsonFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, { credentials: "include", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export function FeatureGrantsSection() {
  const { state } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [personId, setPersonId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [showTraining, setShowTraining] = useState(false);

  const query = useQuery<AccessData>({
    queryKey: ["/api/features"],
    queryFn: () => jsonFetch(`${BASE}/api/features`),
    enabled: state.status === "authenticated" && state.user.role === "admin",
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/features"] });

  const gateMutation = useMutation({
    mutationFn: (enforced: boolean) =>
      jsonFetch(`${BASE}/api/features/sop-gate`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enforced }),
      }),
    onSuccess: (r: { enforced: boolean }) => {
      toast({
        title: r.enforced ? "SOP training gate ON" : "SOP training gate OFF",
        description: r.enforced
          ? "Granted features now unlock only after the person is signed off on the feature's SOP."
          : "Grants work immediately; training status is shown but not enforced.",
      });
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const sopMutation = useMutation({
    mutationFn: ({ key, requiredSopId }: { key: string; requiredSopId: number | null }) =>
      jsonFetch(`${BASE}/api/features/${encodeURIComponent(key)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requiredSopId }),
      }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const grantMutation = useMutation({
    mutationFn: ({ key, userId, grant }: { key: string; userId: number; grant: boolean }) =>
      jsonFetch(`${BASE}/api/features/${encodeURIComponent(key)}/grants/${userId}`, {
        method: grant ? "PUT" : "DELETE",
      }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const data = query.data;
  const person = data?.users.find(u => u.id === personId) ?? null;

  /** How many extras this person has been handed, for the picker cards. */
  const grantCount = useMemo(() => {
    const counts = new Map<number, number>();
    for (const g of data?.grants ?? []) counts.set(g.userId, (counts.get(g.userId) ?? 0) + 1);
    return counts;
  }, [data?.grants]);

  const areas = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (f: Feature) => {
      if (terms.length === 0) return true;
      const hay = `${f.name} ${f.description ?? ""} ${f.area} ${f.target ?? ""}`.toLowerCase();
      return terms.every(t => hay.includes(t));
    };
    const order: string[] = [];
    const groups = new Map<string, Feature[]>();
    for (const f of data?.features ?? []) {
      if (!matches(f)) continue;
      if (!groups.has(f.area)) { groups.set(f.area, []); order.push(f.area); }
      groups.get(f.area)!.push(f);
    }
    return order.map(area => ({ area, features: groups.get(area)! }));
  }, [data?.features, search]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-primary" /> Feature grants
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Pick a person, then hand them any part of the app — a page, or an area of
          Settings — without changing their role. Their access level stays the general
          level they come in on; this only ever adds to it.
        </p>
      </div>

      {query.isLoading && (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      )}
      {query.error && (
        <p className="text-sm text-destructive">Couldn't load access: {(query.error as Error).message}</p>
      )}

      {/* ── Pick a person ─────────────────────────────────────────────── */}
      {data && !person && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.users.filter(u => u.role !== "admin").map(u => {
            const n = grantCount.get(u.id) ?? 0;
            return (
              <button
                key={u.id}
                onClick={() => { setPersonId(u.id); setSearch(""); }}
                className="text-left rounded-2xl border-2 border-border bg-card p-4 hover:border-primary/50 hover:bg-secondary/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <UserIcon className="w-5 h-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{u.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{u.role}</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-3">
                  {n === 0 ? "Role access only" : `${n} extra${n === 1 ? "" : "s"} on top of their role`}
                </p>
              </button>
            );
          })}
          {data.users.filter(u => u.role !== "admin").length === 0 && (
            <p className="text-sm text-muted-foreground">Everyone active is an admin — there's nothing to grant.</p>
          )}
        </div>
      )}

      {data && !person && (
        <p className="text-xs text-muted-foreground">Admins aren't listed: they already have everything.</p>
      )}

      {/* ── One person's access ───────────────────────────────────────── */}
      {data && person && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => setPersonId(null)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-sm font-medium hover:bg-secondary transition-colors"
            >
              <ChevronLeft className="w-4 h-4" /> Everyone
            </button>
            <div className="min-w-0">
              <p className="font-semibold truncate">{person.name}</p>
              <p className="text-xs text-muted-foreground capitalize">{person.role} — their general access level</p>
            </div>
          </div>

          <p className="text-sm text-muted-foreground rounded-xl bg-secondary/40 px-3 py-2">
            Ticked = {person.name.split(" ")[0]} can use it. Locked ticks come with their{" "}
            <span className="capitalize">{person.role}</span> access and are always on — nothing on
            this screen takes access away. The switches you can move are extras just for them.
          </p>

          <div className="relative max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search features…"
              className="w-full pl-8 pr-2.5 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {areas.map(({ area, features }) => (
            <Card key={area}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{area}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {features.map(f => {
                  const grant = data.grants.find(g => g.featureKey === f.key && g.userId === person.id);
                  const viaRole = f.baselineRole ? roleMeets(person.role, f.baselineRole) : false;
                  const trained = grant ? data.trainingByGrant[grant.id] : undefined;
                  return (
                    <div key={f.key} className="flex items-start justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium flex items-center gap-2 flex-wrap">
                          {f.name}
                          {f.retired && <Badge variant="outline" className="text-muted-foreground">retired</Badge>}
                          {viaRole && (
                            <Badge variant="outline" className="text-muted-foreground">
                              <Lock className="h-3 w-3 mr-1" />from their {f.baselineRole} access — always on
                            </Badge>
                          )}
                          {grant && f.requiredSopId !== null && (
                            trained ? (
                              <Badge className="bg-emerald-100 text-emerald-900"><ShieldCheck className="h-3 w-3 mr-1" />trained</Badge>
                            ) : (
                              <Badge variant="outline" className="text-amber-700 border-amber-300">
                                {data.gateEnforced ? "locked — awaiting training" : "not yet trained"}
                              </Badge>
                            )
                          )}
                        </p>
                        {f.description && <p className="text-xs text-muted-foreground mt-0.5">{f.description}</p>}
                        {f.retired && (
                          <p className="text-xs text-amber-700 mt-0.5">
                            Nothing in the app checks this any more. Switch it off to tidy it away.
                          </p>
                        )}
                      </div>
                      <Switch
                        // Ticked = they can use it, from EITHER source. Showing
                        // role-covered features as off read as lost access
                        // (Graeme, 2026-09-04) — but nothing was ever off: the
                        // role's general level keeps applying underneath.
                        checked={!!grant || viaRole}
                        // Role-given access can't be switched off here — grants
                        // only add. The lever for that is the page's access
                        // level or the person's role, and the badge says so.
                        disabled={grantMutation.isPending || (viaRole && !grant)}
                        onCheckedChange={(v) => grantMutation.mutate({ key: f.key, userId: person.id, grant: v })}
                      />
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}

          {areas.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing matches "{search.trim()}".</p>
          )}
        </div>
      )}

      {/* ── Training gate + which SOP each feature needs ───────────────── */}
      {data && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <GraduationCap className="h-4 w-4" /> SOP training gate
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-4">
              <Switch
                checked={data.gateEnforced}
                onCheckedChange={(v) => gateMutation.mutate(v)}
                disabled={gateMutation.isPending}
              />
              <div className="text-sm text-muted-foreground">
                <p className="text-foreground font-medium mb-1">
                  {data.gateEnforced ? "ON — training is enforced" : "OFF — grants work immediately"}
                </p>
                <p>
                  When on, a granted feature stays locked until the person is signed off on
                  that feature's SOP in a training matrix. Training status is always shown
                  either way, so you can see what turning this on would do before you do it.
                </p>
              </div>
            </div>

            <button
              onClick={() => setShowTraining(v => !v)}
              className="text-sm font-medium text-primary hover:underline"
            >
              {showTraining ? "Hide" : "Set which SOP each feature needs"}
            </button>

            {showTraining && (
              <div className="space-y-2">
                {data.sops.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No SOPs in the Documents repository yet — add one there first.
                  </p>
                )}
                {data.features.filter(f => !f.retired).map(f => (
                  <div key={f.key} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2">
                    <Label className="text-sm font-normal min-w-0 truncate">{f.name}</Label>
                    <div className="w-56 flex-shrink-0">
                      <Select
                        value={f.requiredSopId ? String(f.requiredSopId) : "none"}
                        onValueChange={(v) =>
                          sopMutation.mutate({ key: f.key, requiredSopId: v === "none" ? null : Number(v) })
                        }
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No SOP required</SelectItem>
                          {data.sops.map(sopRow => (
                            <SelectItem key={sopRow.id} value={String(sopRow.id)}>{sopRow.title}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
