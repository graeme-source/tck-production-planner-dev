/**
 * Short-delivery report settings (Graeme, 2026-10-15) — managers and admins,
 * from the Deliveries page. Which team list gets a report when goods-in comes
 * in short, and who always gets a to-do + bell (the goods-in "Also tell…"
 * picker opens with these people ticked; they can be changed per delivery).
 *
 * Every tap saves at once with the save state in the header. Modal rules: X,
 * backdrop and Escape close it; card capped at 92dvh with internal scroll.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { X, ListChecks, Users, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAutosave } from "@/hooks/use-autosave";
import { useModalScrollKeeper } from "@/hooks/use-modal-scroll";
import { SaveChip } from "@/components/save-chip";
import { usePeople } from "@/components/messages/messages-api";
import { SHORT_REPORT_SETTINGS_KEY, saveShortReportSettings, useShortReportSettings } from "./short-report-api";

const card = (on: boolean) => cn(
  "min-h-[56px] px-4 py-3 rounded-2xl border-2 text-left text-base font-semibold transition-colors flex items-center gap-3",
  on ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-secondary/60",
);

export function ShortReportSettingsModal({ onClose }: { onClose: () => void }) {
  useModalScrollKeeper();
  const qc = useQueryClient();
  const { data, isLoading, error } = useShortReportSettings();
  const { data: peopleData } = usePeople();
  const [form, setForm] = useState<{ teamListId: number | null; recipientIds: number[] } | null>(null);
  useEffect(() => {
    if (data && !form) setForm({ teamListId: data.teamListId, recipientIds: data.recipientIds });
  }, [data, form]);

  const auto = useAutosave<{ teamListId: number | null; recipientIds: number[] }>(async v => {
    const saved = await saveShortReportSettings(v);
    qc.setQueryData(SHORT_REPORT_SETTINGS_KEY, saved);
  });

  function change(next: { teamListId: number | null; recipientIds: number[] }) {
    setForm(next);
    auto.schedule(next);
    void auto.flush();
  }

  async function close() {
    const ok = await auto.flush();
    if (!ok && !window.confirm("The last change didn't save. Close anyway?")) return;
    onClose();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") void close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const people = peopleData?.people ?? [];

  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-2 sm:p-4" onClick={() => void close()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Short-delivery reports"
        className="bg-background border-2 border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <h2 className="font-display text-xl font-bold flex-1">Short-delivery reports</h2>
          <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />
          <button type="button" onClick={() => void close()} className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0" aria-label="Close">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5 space-y-6">
          <p className="text-base text-muted-foreground max-w-prose">
            When a delivery comes in short — something missing, or less than we ordered — goods-in puts a short report on a team
            list for that day and gives a to-do to the people below. Whoever books the delivery in can add or remove people each time.
            Nothing is sent outside the app.
          </p>

          {isLoading || !form ? (
            error ? <p className="text-destructive">{(error as Error).message}</p> : <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          ) : (
            <>
              <section className="space-y-2">
                <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                  <ListChecks className="w-4 h-4" /> Team list that gets the report
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {data!.teamLists.map(l => (
                    <button key={l.id} type="button" className={card(form.teamListId === l.id)}
                      onClick={() => change({ ...form, teamListId: l.id })} aria-pressed={form.teamListId === l.id}>
                      <span className={cn("w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0",
                        form.teamListId === l.id ? "bg-primary border-primary text-primary-foreground" : "border-border")}>
                        {form.teamListId === l.id && <Check className="w-4 h-4" strokeWidth={3} />}
                      </span>
                      {l.name}
                    </button>
                  ))}
                  <button type="button" className={card(form.teamListId == null)}
                    onClick={() => change({ ...form, teamListId: null })} aria-pressed={form.teamListId == null}>
                    <span className={cn("w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0",
                      form.teamListId == null ? "bg-primary border-primary text-primary-foreground" : "border-border")}>
                      {form.teamListId == null && <Check className="w-4 h-4" strokeWidth={3} />}
                    </span>
                    No team list — people only
                  </button>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                  <Users className="w-4 h-4" /> Always tell these people
                </h3>
                <p className="text-sm text-muted-foreground">Each gets a to-do and a bell. Tap to add or remove.</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {people.map(p => {
                    const on = form.recipientIds.includes(p.id);
                    return (
                      <button key={p.id} type="button" className={card(on)} aria-pressed={on}
                        onClick={() => change({ ...form, recipientIds: on ? form.recipientIds.filter(id => id !== p.id) : [...form.recipientIds, p.id] })}>
                        <span className={cn("w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0",
                          on ? "bg-primary border-primary text-primary-foreground" : "border-border")}>
                          {on && <Check className="w-4 h-4" strokeWidth={3} />}
                        </span>
                        <span className="truncate">{p.name}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
