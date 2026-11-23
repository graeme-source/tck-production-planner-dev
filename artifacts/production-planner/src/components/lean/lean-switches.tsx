/**
 * The two Lean on/off switches — weekly lesson reviews and Curiosity Time.
 * They lived in the morning meeting's own copy of the curriculum editor;
 * that copy is gone (Graeme, 23 Nov 2026: one Lean curriculum page, not
 * two), so they sit on the Lean curriculum page now.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function LeanSwitches() {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      <WeeklyReviewToggleCard />
      <CuriosityTimeToggleCard />
    </div>
  );
}

/** The weekly-review kill switch — one tap to pull the whole "review this
 *  week's lesson" experience (strip, page, auto to-dos) if it's not landing
 *  well, without a deploy. Admin/manager only (this editor is admin-gated). */
function WeeklyReviewToggleCard() {
  const queryClient = useQueryClient();
  const { data } = useQuery<{ enabled: boolean }>({
    queryKey: ["lean-review-settings"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/lean-reviews/settings`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load setting");
      return res.json();
    },
  });
  const toggle = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await fetch(`${BASE}/api/lean-reviews/settings`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed to save");
    },
    onSuccess: (_r, enabled) => {
      queryClient.invalidateQueries({ queryKey: ["lean-review-settings"] });
      queryClient.invalidateQueries({ queryKey: ["lean-weekly-review"] });
      toast({ title: enabled ? "Weekly reviews are ON" : "Weekly reviews are OFF" });
    },
    onError: () => toast({ title: "Couldn't save the setting", variant: "destructive" }),
  });
  const enabled = data?.enabled ?? true;
  return (
    <div className="border border-border rounded-xl bg-card p-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="font-medium">Weekly lesson reviews</p>
        <p className="text-xs text-muted-foreground">
          The team's "review this week's lesson" flow: the reminder strip, the module with the quiz, and the auto
          to-dos. Switch it off to pull the whole thing instantly if it's not working.
        </p>
      </div>
      <button
        onClick={() => toggle.mutate(!enabled)}
        disabled={toggle.isPending || !data}
        className={cn(
          "flex-shrink-0 px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50",
          enabled ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground border border-border",
        )}
      >
        {enabled ? "On" : "Off"}
      </button>
    </div>
  );
}

/** The Curiosity Time switch — the waste-spotting walk on every station
 *  checklist stays hidden until the team has been taught the eight wastes,
 *  then one tap here launches it (and one tap pulls it if it isn't
 *  landing). Off by default; same idiom as the weekly-review switch. */
function CuriosityTimeToggleCard() {
  const queryClient = useQueryClient();
  const { data } = useQuery<{ enabled: boolean }>({
    queryKey: ["curiosity-settings"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/curiosity/settings`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load setting");
      return res.json();
    },
  });
  const toggle = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await fetch(`${BASE}/api/curiosity/settings`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed to save");
    },
    onSuccess: (_r, enabled) => {
      queryClient.invalidateQueries({ queryKey: ["curiosity-settings"] });
      queryClient.invalidateQueries({ queryKey: ["curiosity-walk"] });
      toast({ title: enabled ? "Curiosity Time is ON" : "Curiosity Time is OFF" });
    },
    onError: () => toast({ title: "Couldn't save the setting", variant: "destructive" }),
  });
  const enabled = data?.enabled ?? false;
  return (
    <div className="border border-border rounded-xl bg-card p-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="font-medium">Curiosity Time</p>
        <p className="text-xs text-muted-foreground">
          The waste-spotting walk on every station checklist: walk the area, go through the 8 wastes,
          photograph what you spot. Keep it off until the team has learned the wastes.
        </p>
      </div>
      <button
        onClick={() => toggle.mutate(!enabled)}
        disabled={toggle.isPending || !data}
        className={cn(
          "flex-shrink-0 px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50",
          enabled ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground border border-border",
        )}
      >
        {enabled ? "On" : "Off"}
      </button>
    </div>
  );
}
