/**
 * "What else was going on" — notes under the Numbers spend advice (Graeme,
 * 2026-10-16): slow-delivery days, emails and website/offer changes in the
 * same 7 days, each with what the history suggests. Suggestions with a
 * likelihood, never a verdict. Objective I.
 */
import { Info } from "lucide-react";
import { Link } from "wouter";
import { useSpendContext } from "./api";

export function SpendContextNotes({ from, to }: { from: string; to: string }) {
  const q = useSpendContext(from, to);
  if (q.isLoading || q.error || !q.data || q.data.notes.length === 0) return null;
  return (
    <div className="glass-panel rounded-2xl p-5 space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
        <Info className="w-4 h-4" /> What else was going on in these 7 days
      </p>
      <ul className="space-y-1.5 pl-1">
        {q.data.notes.map((n) => (
          <li key={n} className="text-sm flex gap-2"><span className="text-muted-foreground">•</span><span>{n}</span></li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Likelihoods from your own history, comparing like weekdays. They point at things worth checking, not proof of cause — see{" "}
        <Link href="/founder/sales#sales-drivers" className="underline underline-offset-2 hover:text-foreground">What's driving sales</Link>.
      </p>
    </div>
  );
}
