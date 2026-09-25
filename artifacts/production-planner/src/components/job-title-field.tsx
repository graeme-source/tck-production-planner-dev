/**
 * A person's job title, typed straight in and autosaved with a visible save
 * state (charter rule 5) — on the record header and the "Set job titles"
 * list. It's what they DO ("Production Operative", "Head Chef"), never the
 * app permission role, which this doesn't touch.
 *
 * Saves ~0.8s after typing stops, straight away on blur/Enter, and on
 * unmount if anything is unsaved (hooks/use-autosave.ts).
 * Server: PATCH /api/people/:userId/job-title (People access + private PIN).
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function saveJobTitle(userId: number, jobTitle: string): Promise<string | null> {
  const res = await fetch(`${BASE}/api/people/${userId}/job-title`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobTitle: jobTitle.trim() === "" ? null : jobTitle }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 423 || res.status === 428) throw new Error("People is locked — enter your private PIN");
  if (!res.ok) throw new Error(body?.error ?? `Couldn't save (${res.status})`);
  return body.jobTitle ?? null;
}

export function JobTitleField({ userId, initial, suggestion, size = "lg", label = "Job title" }: {
  userId: number;
  initial: string | null;
  /** e.g. the title on their latest contract — offered as a one-tap fill
   *  when it differs from what's typed. */
  suggestion?: string | null;
  size?: "lg" | "md";
  label?: string;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(initial ?? "");
  const auto = useAutosave(async (next: string) => {
    await saveJobTitle(userId, next);
    void queryClient.invalidateQueries({ queryKey: ["people-list"] });
    void queryClient.invalidateQueries({ queryKey: ["people-job-titles"] });
    void queryClient.invalidateQueries({ queryKey: ["people-record", userId] });
  });

  const change = (next: string) => { setValue(next); auto.schedule(next); };
  const showSuggestion = suggestion != null && suggestion.trim() !== "" && suggestion.trim() !== value.trim();

  return (
    <div className="space-y-1.5 min-w-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <input
          value={value}
          onChange={e => change(e.target.value)}
          onBlur={() => void auto.flush()}
          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          placeholder="Add a job title"
          aria-label={label}
          maxLength={120}
          className={cn(
            "flex-1 min-w-[12rem] rounded-2xl border-2 bg-card px-4 font-bold focus:outline-none focus:ring-2 focus:ring-primary/40",
            size === "lg" ? "h-14 text-lg" : "h-12 text-base",
            auto.state === "error" ? "border-destructive" : "border-border",
          )}
        />
        <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />
      </div>
      {showSuggestion && (
        <button
          type="button"
          onClick={() => { change(suggestion!); void auto.flush(); }}
          className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl bg-secondary text-sm font-bold hover:bg-secondary/70"
        >
          <Wand2 className="w-4 h-4" /> Use contract title: {suggestion}
        </button>
      )}
    </div>
  );
}
