import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { GraduationCap, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { Redirect } from "wouter";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Access — per-user feature grants with an optional SOP-training gate.
// Graeme's design (28 Aug): cherry-pick features per person; a global switch
// (default OFF) additionally requires sign-off on the feature's training SOP
// before a grant unlocks. Admin-only page.

type Feature = { key: string; name: string; description: string | null; requiredSopId: number | null };
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

export default function AccessPage() {
  const { state } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

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

  if (state.status === "authenticated" && state.user.role !== "admin") return <Redirect to="/" />;

  const data = query.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Access — feature grants"
        description="Cherry-pick features for individual people, whatever their role. Optionally require training sign-off before a grant unlocks."
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><GraduationCap className="h-4 w-4" /> SOP training gate</CardTitle>
        </CardHeader>
        <CardContent className="flex items-start gap-4">
          <Switch
            checked={data?.gateEnforced ?? false}
            onCheckedChange={(v) => gateMutation.mutate(v)}
            disabled={gateMutation.isPending || !data}
          />
          <div className="text-sm text-muted-foreground">
            <p className="text-foreground font-medium mb-1">
              {data?.gateEnforced ? "ON — training is enforced" : "OFF — grants work immediately"}
            </p>
            <p>
              When on, a granted feature stays locked until the person is signed off on that
              feature's SOP in a training matrix. Training status is always shown below either
              way, so you can see what turning this on would do before you do it.
            </p>
          </div>
        </CardContent>
      </Card>

      {query.isLoading && (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      )}

      {data?.features.map((feature) => {
        const grants = data.grants.filter((g) => g.featureKey === feature.key);
        return (
          <Card key={feature.key}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4" /> {feature.name}</CardTitle>
              {feature.description && <p className="text-sm text-muted-foreground">{feature.description}</p>}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="max-w-md">
                <Label className="text-xs">Training SOP required (used when the gate is on)</Label>
                <Select
                  value={feature.requiredSopId ? String(feature.requiredSopId) : "none"}
                  onValueChange={(v) =>
                    sopMutation.mutate({ key: feature.key, requiredSopId: v === "none" ? null : Number(v) })
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No SOP required</SelectItem>
                    {data.sops.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {data.sops.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    No SOPs in the Documents repository yet — add one there first.
                  </p>
                )}
              </div>

              <div>
                <Label className="text-xs">Who has this feature</Label>
                <div className="mt-1 space-y-1">
                  {data.users
                    .filter((u) => u.role !== "admin")
                    .map((u) => {
                      const grant = grants.find((g) => g.userId === u.id);
                      const trained = grant ? data.trainingByGrant[grant.id] : undefined;
                      return (
                        <div key={u.id} className="flex items-center justify-between rounded border px-3 py-2">
                          <div className="text-sm flex items-center gap-2 min-w-0">
                            <span className="truncate">{u.name}</span>
                            <span className="text-muted-foreground truncate">({u.role})</span>
                            {grant && feature.requiredSopId !== null && (
                              trained ? (
                                <Badge className="bg-emerald-100 text-emerald-900"><ShieldCheck className="h-3 w-3 mr-1" />trained</Badge>
                              ) : (
                                <Badge variant="outline" className="text-amber-700 border-amber-300">
                                  {data.gateEnforced ? "locked — awaiting training" : "not yet trained"}
                                </Badge>
                              )
                            )}
                          </div>
                          <Switch
                            checked={!!grant}
                            onCheckedChange={(v) => grantMutation.mutate({ key: feature.key, userId: u.id, grant: v })}
                            disabled={grantMutation.isPending}
                          />
                        </div>
                      );
                    })}
                </div>
                <p className="text-xs text-muted-foreground mt-2">Admins always have every feature.</p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
