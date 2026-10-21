/**
 * The daily improvement check-in (Graeme, 2026-10-21; Objectives E and H):
 *
 *   "When any person logs in for the first time each day, give them a
 *    review of their improvement score and encourage them to find just one
 *    small improvement today. They have to acknowledge it before they can
 *    do anything else in the app."
 *
 * WHEN: at each sign-in on this device — the app opening signed in, a
 * password sign-in, the morning PIN unlock, or someone PIN-switching onto a
 * shared iPad — the app asks the server whether this person has
 * acknowledged today (London day). If not, this card covers everything
 * until they press one of its two buttons. Acknowledging is stored per
 * person on the server, so it stays away on every device until tomorrow.
 *
 * ORDER: the morning PIN pad and the People PIN prompts first; then this;
 * then everything else that pops up at sign-in (emergency contact, new
 * to-do / lean lesson, fixed-issue notices, celebrations, test requests,
 * the swipe walkthrough) — they wait on the "daily-checkin" prompt key.
 *
 * NEVER A TRAP: both buttons sit in a footer outside the scrolling area so
 * they're always reachable on a phone or an iPad; the card is capped at
 * 92dvh. If the server can't be reached the card simply doesn't show (and
 * is asked again at the next sign-in); if saving fails they're let through
 * anyway.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Lightbulb, Loader2, Sparkles, Star, Trophy } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { INITIAL_SIGN_IN, nextSignIn, promptHiddenOnPath, type SignInTracker } from "@/lib/emergency-contacts";
import {
  boardLine, checkinHoldsOthers, checkinMessage, goalBarFill, scoreSum, shouldShowCheckin,
  type CheckinCard, type CheckinStatus,
} from "@/lib/daily-checkin";
import { premiumStyle } from "@/lib/improvement-premium";
import { DAILY_CHECKIN_PROMPT_KEY, useReportPromptShowing } from "@/lib/prompt-presence";
import { RecordImprovementModal } from "@/components/record-improvement-modal";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchStatus(): Promise<CheckinStatus> {
  // A hung connection mustn't hold the other pop-ups (or the card) for
  // ever: give up after 10 s and let them through.
  const r = await fetch(`${BASE}/api/daily-checkin`, { credentials: "include", signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`daily-checkin ${r.status}`);
  return r.json();
}

function londonHourNow(): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hourCycle: "h23" }).format(new Date());
  return Number(h) || 0;
}

export function DailyCheckin() {
  const { state, pinLocked, peoplePinPrompt, peoplePinSetupPrompt } = useAuth();
  const [location] = useLocation();
  const qc = useQueryClient();
  const userId = state.status === "authenticated" ? state.user.id : null;

  // A new "sign-in" (person changed, or the PIN pad cleared) asks again.
  const [tracker, setTracker] = useState<SignInTracker>(INITIAL_SIGN_IN);
  useEffect(() => { setTracker(t => nextSignIn(t, { userId, pinLocked })); }, [userId, pinLocked]);
  const [ackedEpoch, setAckedEpoch] = useState<number | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  const otherMustAnswerPrompt = peoplePinPrompt || peoplePinSetupPrompt;
  const enabled = userId != null && !pinLocked && !promptHiddenOnPath(location);
  const q = useQuery({
    queryKey: ["daily-checkin", userId, tracker.epoch],
    queryFn: fetchStatus,
    enabled,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  const facts = {
    signedIn: userId != null,
    pinLocked,
    otherMustAnswerPrompt,
    path: location,
    status: q.isError ? undefined : q.data,
    acknowledgedLocally: ackedEpoch === tracker.epoch,
  };
  const show = shouldShowCheckin(facts);
  const holding = checkinHoldsOthers({ ...facts, loading: enabled && q.isPending && !q.isError });
  // Everything else that pops up at sign-in waits for this — including
  // while the improvement form opened from it is up.
  useReportPromptShowing(DAILY_CHECKIN_PROMPT_KEY, holding || logOpen);

  const ack = useMutation({
    mutationFn: async (choice: "got_it" | "log_now") => {
      const c = q.data?.card;
      const r = await fetch(`${BASE}/api/daily-checkin/acknowledge`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice, scoreShown: c?.scorePct ?? null, creditsShown: c?.credits30 ?? null }),
      });
      if (!r.ok) throw new Error(`acknowledge ${r.status}`);
    },
    // Let them through whatever happens; a failed save just means they'll
    // see it again at their next sign-in.
    onSettled: () => { qc.invalidateQueries({ queryKey: ["daily-checkin"] }); },
  });

  const answer = (choice: "got_it" | "log_now") => {
    setAckedEpoch(tracker.epoch);
    ack.mutate(choice);
    if (choice === "log_now") setLogOpen(true);
  };

  // Someone else signing in never inherits an open improvement form.
  useEffect(() => { setLogOpen(false); }, [userId]);

  return (
    <>
      {show && q.data?.card && <CheckinCardView card={q.data.card} onAnswer={answer} busy={ack.isPending} />}
      <RecordImprovementModal open={logOpen} onClose={() => setLogOpen(false)} />
    </>
  );
}

function CheckinCardView({ card, onAnswer, busy }: {
  card: CheckinCard;
  onAnswer: (choice: "got_it" | "log_now") => void;
  busy: boolean;
}) {
  const msg = checkinMessage(card, londonHourNow());
  const hasScore = card.scorePct != null;
  const fill = goalBarFill(card.scorePct);
  const sum = scoreSum(card);
  const place = boardLine(card.board);

  return (
    <div className="fixed inset-0 z-[9995] flex items-center justify-center bg-background/90 backdrop-blur-sm p-3 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-checkin-title"
        className="w-full max-w-2xl max-h-[92dvh] flex flex-col bg-card border-2 border-border rounded-3xl shadow-xl overflow-hidden"
      >
        <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-7 space-y-5">
          {/* Greeting */}
          <div className="flex items-center gap-3">
            <div className="shrink-0 w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center">
              <Sparkles className="w-7 h-7 text-primary" aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 id="daily-checkin-title" className="text-2xl sm:text-3xl font-display font-bold break-words">{msg.greeting}</h2>
              <p className="text-base text-muted-foreground">Here's your improvement score for the last 30 days.</p>
            </div>
          </div>

          {/* The score */}
          <div className="rounded-3xl border-2 border-primary/30 bg-primary/5 p-5">
            {hasScore ? (
              <>
                <div className="flex items-end justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold text-muted-foreground">Your improvement score</p>
                    <p className="text-6xl sm:text-7xl font-extrabold tabular-nums leading-none mt-1">{card.scorePct}%</p>
                  </div>
                  <p className="text-sm font-semibold text-muted-foreground pb-1">100% = one a shift</p>
                </div>
                <div className="mt-4 h-5 rounded-full bg-secondary overflow-hidden" role="img" aria-label={`${card.scorePct}% of the way to one improvement a shift`}>
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${fill}%` }} />
                </div>
                {sum && <p className="mt-2 text-sm text-muted-foreground">{sum}</p>}
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-muted-foreground">Your credits</p>
                <p className="text-6xl sm:text-7xl font-extrabold tabular-nums leading-none mt-1">{card.credits30}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {card.shifts30 == null ? "Your score needs your shifts from Planday — ask a manager to link you." : "No shifts in the last 30 days, so no score yet."}
                </p>
              </>
            )}
          </div>

          {/* The numbers */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Without a score the big number above IS the credits. */}
            {hasScore && <Tile label="Credits" value={card.credits30} />}
            <Tile label="Improvements" value={card.improvements30} />
            {card.great30 > 0 && (
              <Tile
                label="Great ones ×2"
                value={card.great30}
                className={premiumStyle(2).cardClass}
                icon={<Star className="w-5 h-5 fill-amber-400 text-amber-600 dark:text-amber-400" aria-hidden />}
              />
            )}
            {card.substantial30 > 0 && (
              <Tile
                label="Substantial ×3"
                value={card.substantial30}
                className={premiumStyle(3).cardClass}
                icon={<Crown className="w-5 h-5 fill-yellow-300 text-amber-700 dark:text-yellow-300" aria-hidden />}
              />
            )}
          </div>

          {/* The encouragement */}
          <div className="space-y-2">
            {(msg.step || place) && (
              <div className="flex flex-wrap gap-2">
                {msg.step && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 text-foreground px-3 py-1.5 text-sm font-bold">
                    <Sparkles className="w-4 h-4 text-primary" aria-hidden />{msg.step.message}
                  </span>
                )}
                {place && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 dark:bg-amber-950/50 text-amber-950 dark:text-amber-100 px-3 py-1.5 text-sm font-bold">
                    <Trophy className="w-4 h-4" aria-hidden />{place}
                  </span>
                )}
              </div>
            )}
            <p className="text-xl font-semibold">{msg.line}</p>
          </div>

          {/* The nudge */}
          <div className="rounded-3xl border-2 border-border bg-secondary/40 p-5 space-y-3">
            <div className="flex items-start gap-3">
              <Lightbulb className="shrink-0 w-7 h-7 text-amber-500 mt-0.5" aria-hidden />
              <div>
                <p className="text-xl font-bold">Find just ONE small improvement today</p>
                {card.nudge && <p className="text-base text-muted-foreground">{card.nudge.term} — {card.nudge.nutshell}</p>}
              </div>
            </div>
            {card.prompts.length > 0 && (
              <>
                <p className="text-sm font-semibold text-muted-foreground">Look out for one of today's wastes:</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {card.prompts.map(p => (
                    <div key={p.waste} className="rounded-2xl bg-card border border-border p-3">
                      <p className="font-bold">{p.waste}</p>
                      <p className="text-sm">{p.definition}</p>
                      <p className="text-sm text-muted-foreground mt-1">e.g. {p.example}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Always reachable: outside the scrolling area. */}
        <div className="shrink-0 border-t-2 border-border bg-card p-4 sm:p-5 grid gap-2 sm:grid-cols-2">
          <button
            onClick={() => onAnswer("got_it")}
            disabled={busy}
            className="h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold hover:opacity-90 disabled:opacity-70 inline-flex items-center justify-center gap-2 sm:order-2"
          >
            {busy && <Loader2 className="w-5 h-5 animate-spin" />}Got it — I'll find one today
          </button>
          <button
            onClick={() => onAnswer("log_now")}
            disabled={busy}
            className="h-14 rounded-2xl border-2 border-border bg-secondary/40 hover:bg-secondary text-lg font-semibold disabled:opacity-70 sm:order-1"
          >
            Log an improvement now
          </button>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, className, icon }: { label: string; value: number; className?: string; icon?: ReactNode }) {
  return (
    <div className={cn("rounded-2xl border-2 border-border px-4 py-3", className)}>
      <p className="text-sm font-bold flex items-center gap-1.5">{icon}{label}</p>
      <p className="text-3xl font-extrabold tabular-nums mt-1">{value}</p>
    </div>
  );
}
