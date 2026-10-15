/**
 * The last step of a short goods-in (Graeme, 2026-10-15): before the
 * delivery is completed, show what's short, where the report goes, a note
 * box and "Also tell…" (pre-filled with the people in the settings; add or
 * remove for this delivery). The report itself is made on the server when
 * goods-in is saved (lib/short-delivery-report.ts).
 */
import { AlertTriangle, Check, ListChecks, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { reportLineText, type ShortLine } from "@workspace/goods-in";
import type { Person } from "@/components/messages/messages-api";

export function ShortReportStep({
  lines, teamListName, note, onNote, alsoTell, onAlsoTell, people, myId,
}: {
  lines: ShortLine[];
  teamListName: string | null;
  note: string;
  onNote: (v: string) => void;
  alsoTell: number[];
  onAlsoTell: (ids: number[]) => void;
  people: Person[];
  myId: number | null;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-3">
        <h3 className="text-xl font-bold flex items-center gap-2 text-amber-900 dark:text-amber-200">
          <AlertTriangle className="w-6 h-6 shrink-0" /> Short delivery
        </h3>
        <p className="text-base flex items-center gap-2">
          <ListChecks className="w-5 h-5 shrink-0" />
          {teamListName
            ? <>This goes on the <strong>{teamListName}</strong> list for today.</>
            : <>No team list is set for these reports — only the people ticked below will hear.</>}
        </p>
        <ul className="space-y-2">
          {lines.map(l => (
            <li key={l.lineId} className={cn(
              "rounded-xl px-3 py-2 text-base font-semibold border",
              l.missing
                ? "bg-red-50 border-red-300 text-red-900 dark:bg-red-950/30 dark:border-red-800 dark:text-red-200"
                : "bg-background border-amber-300 text-amber-900 dark:text-amber-200",
            )}>
              {reportLineText(l)}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <label htmlFor="short-report-note" className="text-base font-semibold block mb-1">Note for the report</label>
        <textarea
          id="short-report-note"
          value={note}
          onChange={e => onNote(e.target.value)}
          maxLength={2000}
          className="w-full px-3 py-2 bg-background border-2 border-border rounded-xl text-base focus:outline-none focus:border-primary min-h-[84px] resize-none"
          placeholder="e.g. Needed for cinnamon buns today — someone needs to buy milk"
        />
      </div>

      <div className="space-y-2">
        <h4 className="text-base font-semibold flex items-center gap-2"><Users className="w-5 h-5" /> Also tell…</h4>
        <p className="text-sm text-muted-foreground">Each person ticked gets a to-do and a bell.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {people.map(p => {
            const on = alsoTell.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                onClick={() => onAlsoTell(on ? alsoTell.filter(id => id !== p.id) : [...alsoTell, p.id])}
                className={cn(
                  "min-h-[52px] px-3 py-2 rounded-xl border-2 text-left text-base font-semibold flex items-center gap-2 transition-colors",
                  on ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-secondary/60",
                )}
              >
                <span className={cn("w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0",
                  on ? "bg-primary border-primary text-primary-foreground" : "border-border")}>
                  {on && <Check className="w-4 h-4" strokeWidth={3} />}
                </span>
                <span className="truncate">{p.name}{p.id === myId ? " (you)" : ""}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
