/**
 * Settings → Production → Timed reminders. Moved out of pages/settings.tsx
 * (Development Charter: no new code there) when the conditions became
 * station-aware (Graeme, 13 Oct 2026):
 *
 *   • "Only if stock checks are still outstanding" is offered only when the
 *     reminder includes a prep station — it never applies on Packing/Wrapping.
 *   • "Only until today's factory count is done" is offered when it includes
 *     Packing or Wrapping.
 *
 * The rules live in pages/station/shared/reminder-conditions.ts so the editor
 * and the station banner agree.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { STATIONS } from "@/pages/station/shared/constants";
import { TIMED_REMINDERS_KEY, parseReminders, type TimedReminder } from "@/pages/station/shared/timed-reminders";
import { conditionsOffered } from "@/pages/station/shared/reminder-conditions";

export function TimedRemindersSettings() {
  const queryClient = useQueryClient();
  const { data: loadedReminders, isLoading } = useQuery({
    queryKey: ["app-setting", TIMED_REMINDERS_KEY],
    queryFn: async () => {
      const res = await fetch(`/api/app-settings/${TIMED_REMINDERS_KEY}`, { credentials: "include" });
      if (!res.ok) return null;
      const j = await res.json();
      return (j?.value as string) ?? null;
    },
  });

  const [reminders, setReminders] = useState<TimedReminder[]>([]);
  const [dirty, setDirty] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // Take the server copy whenever it arrives, unless there are unsaved edits.
  useEffect(() => {
    if (!dirty && loadedReminders !== undefined) setReminders(parseReminders(loadedReminders));
  }, [loadedReminders, dirty]);

  const saveMutation = useMutation({
    mutationFn: async (list: TimedReminder[]) => {
      const res = await fetch(`/api/app-settings/${TIMED_REMINDERS_KEY}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: JSON.stringify(list) }),
      });
      if (!res.ok) throw new Error("save failed");
    },
    onSuccess: (_void, list) => {
      // Seed the cache with what was saved so clearing `dirty` doesn't
      // briefly reload the pre-save copy.
      queryClient.setQueryData(["app-setting", TIMED_REMINDERS_KEY], JSON.stringify(list));
      setDirty(false);
      setSavedMsg("Saved");
      setTimeout(() => setSavedMsg(null), 2000);
      queryClient.invalidateQueries({ queryKey: ["app-setting", TIMED_REMINDERS_KEY] });
    },
    onError: () => setSavedMsg("Error saving"),
  });

  const update = (id: string, patch: Partial<TimedReminder>) => {
    setReminders(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
    setDirty(true);
    setSavedMsg(null);
  };

  const addReminder = () => {
    setReminders(prev => [...prev, {
      id: `reminder_${Date.now()}`,
      title: "New reminder",
      message: "",
      stations: [],
      startTime: "14:45",
      endTime: "15:00",
      enabled: false,
    }]);
    setDirty(true);
  };

  const removeReminder = (id: string) => {
    setReminders(prev => prev.filter(r => r.id !== id));
    setDirty(true);
  };

  /** Toggling a station also drops a condition that no longer applies, so a
   *  hidden flag can't linger on a reminder (e.g. stock checks on Packing). */
  const toggleStation = (r: TimedReminder, key: string) => {
    const stations = r.stations.includes(key) ? r.stations.filter(k => k !== key) : [...r.stations, key];
    const offered = conditionsOffered(stations);
    update(r.id, {
      stations,
      onlyIfStockChecksOutstanding: offered.stockChecks ? r.onlyIfStockChecksOutstanding : undefined,
      onlyIfFactoryCountOutstanding: offered.factoryCount ? r.onlyIfFactoryCountOutstanding : undefined,
    });
  };

  const saving = saveMutation.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <AlarmClock className="w-4 h-4 text-primary" /> Timed reminders
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Daily warnings on station screens with a countdown to a deadline —
            e.g. stock checks due by 3pm. Shown between the start and end time
            (UK clock) on the chosen stations, only while a plan is live.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {(savedMsg || dirty) && (
            <span className={cn("text-xs font-medium", savedMsg === "Saved" ? "text-green-600" : savedMsg ? "text-destructive" : "text-amber-600")}>
              {savedMsg ?? "Unsaved changes"}
            </span>
          )}
          <button
            onClick={() => saveMutation.mutate(reminders)}
            disabled={saving || !dirty}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-3">
          {reminders.map(r => {
            const offered = conditionsOffered(r.stations);
            return (
              <div key={r.id} className="rounded-2xl border border-border bg-card p-5 space-y-3">
                <div className="flex items-center gap-3">
                  <Switch checked={r.enabled} onCheckedChange={v => update(r.id, { enabled: v })} />
                  <input
                    type="text"
                    value={r.title}
                    onChange={e => update(r.id, { title: e.target.value })}
                    placeholder="Title shown in bold"
                    className="flex-1 px-3 py-2 border border-border rounded-lg text-sm font-semibold bg-background"
                  />
                  <button
                    onClick={() => removeReminder(r.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors p-1.5"
                    title="Delete reminder"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <input
                  type="text"
                  value={r.message}
                  onChange={e => update(r.id, { message: e.target.value })}
                  placeholder="Message shown under the title"
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background"
                />
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Show from</span>
                    <input
                      type="time"
                      value={r.startTime}
                      onChange={e => update(r.id, { startTime: e.target.value })}
                      className="px-2 py-1.5 border border-border rounded-lg text-sm bg-background"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Count down to</span>
                    <input
                      type="time"
                      value={r.endTime}
                      onChange={e => update(r.id, { endTime: e.target.value })}
                      className="px-2 py-1.5 border border-border rounded-lg text-sm bg-background"
                    />
                  </label>
                  {offered.stockChecks && (
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!r.onlyIfStockChecksOutstanding}
                        onChange={e => update(r.id, { onlyIfStockChecksOutstanding: e.target.checked })}
                        className="w-4 h-4"
                      />
                      <span className="text-muted-foreground">Only if stock checks are still outstanding (Prep)</span>
                    </label>
                  )}
                  {offered.factoryCount && (
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!r.onlyIfFactoryCountOutstanding}
                        onChange={e => update(r.id, { onlyIfFactoryCountOutstanding: e.target.checked })}
                        className="w-4 h-4"
                      />
                      <span className="text-muted-foreground">Only until today's factory count is done (Packing/Wrapping)</span>
                    </label>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {STATIONS.map(s => {
                    const on = r.stations.includes(s.key);
                    return (
                      <button
                        key={s.key}
                        onClick={() => toggleStation(r, s.key)}
                        className={cn(
                          "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                          on
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border text-muted-foreground hover:bg-secondary/60",
                        )}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <button
            onClick={addReminder}
            className="w-full py-2.5 rounded-2xl border-2 border-dashed border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Add reminder
          </button>
        </div>
      )}
    </div>
  );
}
