// "Done with…" — crediting an improvement to more than one person
// (Graeme, 2026-09-24: "I did an improvement with Bodan recently, and I can
// only assign it to me currently"). Objectives E and H.
//
// Big tap-to-tick chips, iPad-first. The person recording is ticked by
// default; the last ticked chip can't be unticked, so a stray tap never
// leaves an improvement credited to nobody. The rules live in
// lib/improvement-credits.ts (tested); this file is only the chips.

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, AlertCircle, Search, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { isLockedCredit, orderCreditPeople, toggleCreditId } from "@/lib/improvement-credits";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type CreditPerson = { id: number; name: string };

/** The team list the chips are drawn from — active people only. */
export function useCreditPeople() {
  return useQuery<CreditPerson[]>({
    queryKey: ["users-for-credit"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/users`, { credentials: "include" });
      if (!res.ok) throw new Error(`Couldn't load the team list (${res.status})`);
      const rows = (await res.json()) as Array<{ id: number; name: string; isActive?: boolean }>;
      return rows.filter(u => u.isActive !== false).map(u => ({ id: u.id, name: u.name }));
    },
  });
}

/** Past this many people a quick name filter earns its space. */
const FILTER_FROM = 12;

export function CreditPeoplePicker({ selected, onChange, meId, disabled }: {
  selected: number[];
  onChange: (next: number[]) => void;
  /** Labelled "(you)" so the recorder can find themselves at a glance. */
  meId?: number | null;
  disabled?: boolean;
}) {
  const { data: people = [], isLoading, isError, refetch } = useCreditPeople();
  const [filter, setFilter] = useState("");

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-base text-muted-foreground py-3">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading the team…
      </div>
    );
  }
  if (isError) {
    return (
      <button
        type="button"
        onClick={() => refetch()}
        className="w-full h-14 rounded-2xl border-2 border-destructive/40 text-destructive text-base font-bold flex items-center justify-center gap-2"
      >
        <AlertCircle className="w-5 h-5" /> Couldn't load the team — tap to try again
      </button>
    );
  }

  const ordered = orderCreditPeople(people, selected, filter);
  return (
    <div className="space-y-3">
      {people.length > FILTER_FROM && (
        <div className="relative">
          <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Find someone"
            className="w-full h-14 pl-12 pr-4 rounded-2xl border-2 border-border bg-card text-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      )}
      <div className="flex flex-wrap gap-2.5">
        {ordered.map(p => {
          const on = selected.includes(p.id);
          const locked = on && isLockedCredit(selected, p.id);
          return (
            <button
              key={p.id}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              title={locked ? "Someone has to get the credit — tick another person first" : undefined}
              onClick={() => { if (!locked) onChange(toggleCreditId(selected, p.id)); }}
              className={cn(
                "min-h-14 px-5 rounded-2xl border-2 text-lg font-bold flex items-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50",
                on
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border bg-card hover:border-primary/50",
                locked && "cursor-default",
              )}
            >
              {on && <Check className="w-5 h-5 flex-shrink-0" />}
              <span>{p.name}{meId === p.id ? " (you)" : ""}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * The detail page's "who gets the credit" card. Every tap saves straight
 * away (charter rule 5) and says so — Saving… / Saved / Couldn't save.
 */
export function ImprovementCreditEditor({ improvementId, initial, stageIsTodo, meId }: {
  improvementId: number;
  /** Who's credited now, lead first — or who will be by default. */
  initial: number[];
  stageIsTodo: boolean;
  meId?: number | null;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<number[]>(initial);
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  // Only the latest tap's answer may set the badge — taps can overlap.
  const latest = useRef(0);

  // A fresh server answer (another device, a refetch) resets the chips —
  // but never while one of our own saves is in flight.
  const initialKey = initial.join(",");
  useEffect(() => {
    if (state !== "saving") setSelected(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey, improvementId]);

  const save = useMutation({
    mutationFn: async (userIds: number[]) => {
      const res = await fetch(`${BASE}/api/improvements/${improvementId}/credits`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Couldn't save (${res.status})`);
      }
      return res.json() as Promise<{ creditNames: string | null }>;
    },
  });

  const commit = (next: number[]) => {
    setSelected(next);
    setState("saving");
    setError(null);
    const ticket = ++latest.current;
    save.mutate(next, {
      onSuccess: () => {
        if (ticket !== latest.current) return;
        setState("saved");
        queryClient.invalidateQueries({ queryKey: ["improvements"] });
        queryClient.invalidateQueries({ queryKey: ["improvement-scoreboard"] });
        queryClient.invalidateQueries({ queryKey: ["meeting-improvement-feed"] });
        queryClient.invalidateQueries({ queryKey: ["my-improvements"] });
      },
      onError: (e: Error) => {
        if (ticket !== latest.current) return;
        setState("error");
        setError(e.message);
      },
    });
  };

  return (
    <div className="rounded-2xl border-2 border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold flex items-center gap-2"><Users className="w-5 h-5" /> Who did it?</p>
          <p className="text-base text-muted-foreground">
            {stageIsTodo
              ? "Everyone ticked gets the credit once it's done."
              : "Everyone ticked gets the credit — it counts on each of their scoreboards and names them all on the feed."}
          </p>
        </div>
        <SaveBadge state={state} />
      </div>
      <CreditPeoplePicker selected={selected} onChange={commit} meId={meId} />
      {state === "error" && (
        <button
          type="button"
          onClick={() => commit(selected)}
          className="w-full h-14 rounded-2xl border-2 border-destructive/50 bg-destructive/5 text-destructive text-base font-bold flex items-center justify-center gap-2"
        >
          <AlertCircle className="w-5 h-5" /> {error ?? "Couldn't save"} — tap to try again
        </button>
      )}
    </div>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  if (state === "saving") {
    return <span className="text-sm font-bold text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-4 h-4 animate-spin" /> Saving…</span>;
  }
  if (state === "saved") {
    return <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5"><Check className="w-4 h-4" /> Saved</span>;
  }
  if (state === "error") {
    return <span className="text-sm font-bold text-destructive flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> Not saved</span>;
  }
  return null;
}
