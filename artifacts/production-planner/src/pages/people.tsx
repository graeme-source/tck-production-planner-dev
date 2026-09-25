/**
 * People — straight into the list of people; tap one and you're on their
 * record (Graeme, 2026-09-25: "these three different pathways are confusing
 * me… when I click on the People page, once I click on a person, it goes to
 * their record. From there, we can do the reviews, the return-to-work forms,
 * and book meetings. It's got their attendance record in there.").
 *
 *   /people          the list — big cards, search, people needing action first
 *   /people/:userId  their record (components/people-record.tsx)
 *
 * It replaced a signpost page with three cards (Employee Records report,
 * Return-to-work forms, Reviews & Record) that sent you to three places.
 *
 * Both routes render THIS component, so moving between the list and a record
 * keeps one mounted gate: the private People PIN is asked for once on entry
 * to People (fresh, every entry — the scenario is picking up someone's
 * logged-in iPad), not again on every hop back to the list. Every request
 * behind it is enforced on the server: People access + private PIN.
 */
import { useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Lock, Search, HeartPulse, AlertTriangle, CalendarDays, ChevronRight, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { useIsRtwManager } from "@/hooks/use-rtw-manager";
import { useSensitivePinGate } from "@/hooks/use-sensitive-pin-gate";
import { usePeopleReady, peopleFetch, peopleRetry, PeopleLockedError } from "@/hooks/use-people-gate";
import { UserAvatar } from "@/components/user-avatar";
import { PersonRecord } from "@/components/people-record";
import { PeopleLockedCard } from "@/components/people-locked-card";
import { type PeopleListResponse, type PersonCard, MEETING_KIND_LABEL, roleLabel, fmtDay, fmtDayRange } from "@/lib/people-api";

export default function PeopleSection() {
  const { state } = useAuth();
  const isPeople = useIsRtwManager();
  const [onRecord, params] = useRoute<{ userId: string }>("/people/:userId");
  useSensitivePinGate({ enabled: isPeople, includeAdmins: true, fresh: true, entryKey: "people", scope: "people" });
  const ready = usePeopleReady(isPeople);

  if (state.status !== "authenticated") {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!isPeople) {
    return (
      <div className="max-w-lg mx-auto text-center py-16 space-y-4">
        <Lock className="w-8 h-8 mx-auto text-muted-foreground" />
        <p className="text-2xl font-bold">People records are private</p>
        <p className="text-base text-muted-foreground">They're open only to people with People access.</p>
        <div className="grid gap-3 sm:grid-cols-2 pt-2">
          <Link href="/hub?section=reviews" className="h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center hover:bg-secondary/50">
            My own record
          </Link>
          <Link href="/return-to-work" className="h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center hover:bg-secondary/50">
            My return-to-work forms
          </Link>
        </div>
      </div>
    );
  }

  const userId = onRecord && params ? Number(params.userId) : null;
  if (userId != null && Number.isInteger(userId) && userId > 0) {
    return <PersonRecord userId={userId} ready={ready} />;
  }
  return <PeopleList ready={ready} />;
}

function Flag({ tone, icon: Icon, children }: { tone: "amber" | "rose" | "sky" | "slate"; icon?: typeof HeartPulse; children: React.ReactNode }) {
  const tones = {
    amber: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
    rose: "bg-rose-100 text-rose-900 dark:bg-rose-950/50 dark:text-rose-200",
    sky: "bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200",
    slate: "bg-secondary text-muted-foreground",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm font-bold px-2.5 py-1 rounded-lg", tones[tone])}>
      {Icon && <Icon className="w-4 h-4" />} {children}
    </span>
  );
}

function PersonCardView({ p, policy }: { p: PersonCard; policy: PeopleListResponse["policy"] }) {
  return (
    <Link
      href={`/people/${p.id}`}
      className={cn(
        "block rounded-3xl border-2 bg-card p-4 sm:p-5 transition-all active:scale-[0.995] hover:border-primary/50",
        p.formsNeeded > 0 || p.triggers.sickness || p.triggers.lates ? "border-amber-400/70 dark:border-amber-700" : "border-border",
        !p.isActive && "opacity-70",
      )}
    >
      <div className="flex items-center gap-4">
        <UserAvatar name={p.name} avatarUrl={p.avatarUrl} size="lg" />
        <div className="flex-1 min-w-0">
          <p className="text-xl font-bold leading-snug truncate">{p.name}</p>
          <p className="text-base text-muted-foreground truncate">{p.jobTitle ?? roleLabel(p.role)}</p>
        </div>
        <ChevronRight className="w-6 h-6 text-muted-foreground shrink-0" />
      </div>
      {(p.formsNeeded > 0 || p.triggers.sickness || p.triggers.lates || p.nextMeeting || p.awayNow || !p.isActive) && (
        <div className="flex flex-wrap gap-2 mt-3">
          {!p.isActive && <Flag tone="slate">Leaver</Flag>}
          {p.formsNeeded > 0 && (
            <Flag tone="amber" icon={HeartPulse}>
              Return-to-work form needed{p.formsNeeded > 1 ? ` (${p.formsNeeded})` : ""}
            </Flag>
          )}
          {p.awayNow && <Flag tone="slate">Off now</Flag>}
          {p.triggers.sickness && (
            <Flag tone="rose" icon={AlertTriangle}>Policy trigger: {p.sickInstances} sickness instances</Flag>
          )}
          {p.triggers.lates && (
            <Flag tone="rose" icon={AlertTriangle}>Policy trigger: {p.lates} lates</Flag>
          )}
          {p.nextMeeting && (
            <Flag tone="sky" icon={CalendarDays}>
              {p.nextMeeting.title || MEETING_KIND_LABEL[p.nextMeeting.kind] || "Meeting"} · {fmtDay(p.nextMeeting.date)}
            </Flag>
          )}
        </div>
      )}
      <span className="sr-only">Policy: {policy.sickInstances} sickness instances or {policy.lates} lates in {policy.months} months</span>
    </Link>
  );
}

function PeopleList({ ready }: { ready: boolean }) {
  const [search, setSearch] = useState("");
  const [leavers, setLeavers] = useState(false);
  const { data, isLoading, error } = useQuery<PeopleListResponse>({
    queryKey: ["people-list", leavers],
    queryFn: () => peopleFetch<PeopleListResponse>(`/people${leavers ? "?leavers=1" : ""}`),
    enabled: ready,
    retry: peopleRetry,
  });

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const people = data?.people ?? [];
    if (!q) return people;
    return people.filter(p => p.name.toLowerCase().includes(q) || (p.jobTitle ?? "").toLowerCase().includes(q));
  }, [data, search]);

  if (error instanceof PeopleLockedError) return <PeopleLockedCard error={error} />;

  const outstanding = data?.outstanding ?? [];

  return (
    <div className="max-w-4xl mx-auto space-y-5 pb-24">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
          <UsersRound className="w-6 h-6 text-primary" />
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold leading-tight">People</h1>
          <p className="text-base text-muted-foreground">Tap a person for their whole record — attendance, return-to-work forms, reviews, notes.</p>
        </div>
      </div>

      {outstanding.length > 0 && (
        <section className="rounded-3xl border-2 border-amber-400 dark:border-amber-700 bg-amber-50/80 dark:bg-amber-950/30 p-4 sm:p-5 space-y-3">
          <p className="text-xl font-bold text-amber-950 dark:text-amber-100 flex items-center gap-2">
            <HeartPulse className="w-6 h-6" />
            {outstanding.length} return-to-work form{outstanding.length === 1 ? "" : "s"} needed
          </p>
          <div className="flex flex-wrap gap-2">
            {outstanding.map(f => (
              <Link
                key={`${f.userId}-${f.start}`}
                href={`/people/${f.userId}`}
                className="inline-flex items-center gap-2 h-12 px-4 rounded-2xl bg-card border-2 border-amber-300 dark:border-amber-800 text-base font-bold hover:border-amber-500"
              >
                {f.userName}
                <span className="text-sm font-medium text-muted-foreground">{fmtDayRange(f.start, f.end)} · {f.types.join(" + ")}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <label className="relative flex-1">
          <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Find a person"
            aria-label="Find a person"
            className="w-full h-14 pl-12 pr-4 rounded-2xl border-2 border-border bg-card text-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </label>
        <button
          onClick={() => setLeavers(v => !v)}
          aria-pressed={leavers}
          className={cn(
            "h-14 px-5 rounded-2xl border-2 text-lg font-bold transition-colors",
            leavers ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary/50",
          )}
        >
          {leavers ? "Showing leavers" : "Include leavers"}
        </button>
      </div>

      {!ready || isLoading ? (
        <div className="flex items-center justify-center gap-3 py-16 text-lg text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /> Loading people…</div>
      ) : error ? (
        <div className="p-5 rounded-2xl bg-destructive/10 text-destructive text-lg font-semibold">{error instanceof Error ? error.message : "Couldn't load people."}</div>
      ) : shown.length === 0 ? (
        <p className="text-center py-12 text-lg text-muted-foreground">{search ? "Nobody matches that." : "Nobody here yet."}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {shown.map(p => <PersonCardView key={p.id} p={p} policy={data!.policy} />)}
        </div>
      )}

      {data?.attendance.stale && (
        <p className="text-sm text-muted-foreground">
          Couldn't reach Planday just now — attendance shown as last synced{data.attendance.syncedAt ? ` (${new Date(data.attendance.syncedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })})` : ""}.
        </p>
      )}

      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Lock className="w-3.5 h-3.5" /> Private — People access only. Asks for your private PIN on the way in.
      </p>
    </div>
  );
}
