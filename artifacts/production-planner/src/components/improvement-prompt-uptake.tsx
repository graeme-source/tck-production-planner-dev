/**
 * Managers' view of the end-of-day "Have you made an improvement today?"
 * answers (Graeme, 27 Oct 2026; Objectives E and H) — on the Improvements
 * page. Yes/no per day for the last two weeks and who said what, each yes
 * linking to the improvement it's about. Deliberately small: a count and a
 * list, not a report.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronDown, ChevronUp, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { PROMPT_COPY } from "@/lib/improvement-prompt";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DAYS = 14;

interface Uptake {
  from: string;
  to: string;
  days: Array<{ day: string; yes: number; no: number }>;
  totals: { yes: number; no: number; answered: number; people: number };
  answers: Array<{
    day: string; userId: number; name: string; answer: "yes" | "no";
    improvementId: number | null; improvementTitle: string | null; stationType: string | null;
  }>;
}

function dayLabel(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export function ImprovementPromptUptake() {
  const [open, setOpen] = useState(false);
  const q = useQuery<Uptake>({
    queryKey: ["improvement-prompt-uptake", DAYS],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/improvement-prompt/uptake?days=${DAYS}`, { credentials: "include" });
      if (!r.ok) throw new Error("Couldn't load the answers");
      return r.json();
    },
  });
  const t = q.data?.totals;

  return (
    <div className="bg-card border-2 border-border rounded-2xl p-4 space-y-3">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 text-left">
        <Moon className="w-6 h-6 text-indigo-500 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold">End-of-day question</p>
          <p className="text-sm text-muted-foreground">
            "{PROMPT_COPY.question}" — last {DAYS} days
            {t ? ` · ${t.yes} yes · ${t.no} no · ${t.people} ${t.people === 1 ? "person" : "people"}` : q.isLoading ? " · loading…" : ""}
          </p>
        </div>
        {open ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
      </button>

      {open && q.isError && <p className="text-sm text-destructive">Couldn't load the answers.</p>}
      {open && q.data && (
        q.data.answers.length === 0 ? (
          <p className="text-base text-muted-foreground">No answers yet — it's the last item on every closing checklist.</p>
        ) : (
          <div className="space-y-3">
            {q.data.days.map(d => {
              const rows = q.data!.answers.filter(a => a.day === d.day);
              return (
                <div key={d.day} className="rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-base font-bold">{dayLabel(d.day)}</p>
                    <p className="text-sm font-semibold">
                      <span className="text-emerald-600 dark:text-emerald-400">{d.yes} yes</span>
                      <span className="text-muted-foreground"> · {d.no} no</span>
                    </p>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {rows.map(a => (
                      <li key={`${a.day}-${a.userId}`} className="text-sm flex items-baseline gap-2 flex-wrap">
                        <span className={cn("font-bold", a.answer === "yes" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                          {a.answer === "yes" ? "Yes" : "No"}
                        </span>
                        <span className="font-medium">{a.name}</span>
                        {a.answer === "yes" && a.improvementId != null && (
                          <Link href={`/improvements?open=${a.improvementId}`} className="text-primary underline underline-offset-2 break-words">
                            {a.improvementTitle ?? `Improvement #${a.improvementId}`}
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
