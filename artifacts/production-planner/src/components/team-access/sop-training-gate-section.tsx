/**
 * SOP training gate — the global switch, and which SOP each feature needs
 * before a grant of it unlocks. Moved unchanged from the old Feature grants
 * section (components/feature-grants-section.tsx) when the grants moved
 * into each person's Access modal (Graeme, 2026-09-30). Each person's
 * grants still show "Trained" / "awaiting training" there.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GraduationCap, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { FEATURES_KEY, jsonFetch, useTeamFeatures } from "@/hooks/use-team-access";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function SopTrainingGateSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data } = useTeamFeatures();
  const [showTraining, setShowTraining] = useState(false);
  const invalidate = () => qc.invalidateQueries({ queryKey: FEATURES_KEY });

  const gateMutation = useMutation({
    mutationFn: (enforced: boolean) =>
      jsonFetch<{ enforced: boolean }>(`${BASE}/api/features/sop-gate`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enforced }),
      }),
    onSuccess: (r) => {
      toast({
        title: r.enforced ? "SOP training gate ON" : "SOP training gate OFF",
        description: r.enforced
          ? "Granted features now unlock only after the person is signed off on the feature's SOP."
          : "Grants work immediately; training status is shown but not enforced.",
      });
      void invalidate();
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });

  const sopMutation = useMutation({
    mutationFn: ({ key, requiredSopId }: { key: string; requiredSopId: number | null }) =>
      jsonFetch(`${BASE}/api/features/${encodeURIComponent(key)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requiredSopId }),
      }),
    onSuccess: () => { void invalidate(); },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });

  if (!data) return null;

  return (
    <div className="rounded-2xl border-2 border-border bg-card p-4 sm:p-5 space-y-4">
      <h2 className="text-base font-semibold flex items-center gap-2">
        <GraduationCap className="w-4 h-4 text-primary" /> SOP training gate
      </h2>
      <div className="flex items-start gap-4">
        <Switch
          checked={data.gateEnforced}
          onCheckedChange={(v) => gateMutation.mutate(v)}
          disabled={gateMutation.isPending}
          aria-label="SOP training gate"
        />
        <div className="text-sm text-muted-foreground">
          <p className="text-foreground font-medium mb-1 flex items-center gap-2">
            {data.gateEnforced ? "ON — training is enforced" : "OFF — extras work immediately"}
            {gateMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          </p>
          <p>
            When on, an extra you give someone stays locked until they're signed off on that feature's SOP in a
            training matrix. Training status shows on each person either way, so you can see what turning this on would do first.
          </p>
        </div>
      </div>

      <button onClick={() => setShowTraining(v => !v)} className="text-sm font-medium text-primary hover:underline min-h-[44px]">
        {showTraining ? "Hide" : "Set which SOP each feature needs"}
      </button>

      {showTraining && (
        <div className="space-y-2">
          {data.sops.length === 0 && (
            <p className="text-xs text-muted-foreground">No SOPs in the Documents repository yet — add one there first.</p>
          )}
          {data.features.filter(f => !f.retired).map(f => (
            <div key={f.key} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
              <span className="text-sm min-w-0 truncate">{f.name}</span>
              <div className="w-full sm:w-56 flex-shrink-0">
                <Select
                  value={f.requiredSopId ? String(f.requiredSopId) : "none"}
                  onValueChange={(v) => sopMutation.mutate({ key: f.key, requiredSopId: v === "none" ? null : Number(v) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No SOP required</SelectItem>
                    {data.sops.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
