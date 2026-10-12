/**
 * People — straight into the list of people; tap one and you're on their
 * record (Graeme, 2026-09-25: "these three different pathways are confusing
 * me… when I click on the People page, once I click on a person, it goes to
 * their record. From there, we can do the reviews, the return-to-work forms,
 * and book meetings. It's got their attendance record in there.").
 *
 *   /people            the list — a sortable table (lib/people-list-table.ts), search
 *   /people/:userId    their record (components/people-record.tsx)
 *   /people/job-titles everyone's job title on one screen (components/job-titles-bulk.tsx)
 *   /people/contracts  contracts & starter forms — founder/HR only (pages/founder-contracts.tsx,
 *                      its own route in App.tsx, outside this component)
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
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useRoute, useSearch, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Lock, Search, HeartPulse, AlertTriangle, ChevronRight, UsersRound, BadgeCheck, Clock3, FileSignature } from "lucide-react";
import { cn } from "@/lib/utils";
import { isFounderEmail } from "@workspace/feature-registry";
import { useAuth } from "@/contexts/auth-context";
import { useIsRtwManager } from "@/hooks/use-rtw-manager";
import { useSensitivePinGate } from "@/hooks/use-sensitive-pin-gate";
import { usePeopleReady, peopleFetch, peopleRetry, PeopleLockedError } from "@/hooks/use-people-gate";
import { usePeopleKeepAlive } from "@/hooks/use-people-keep-alive";
import { useRecordBadges, type BadgeRow } from "@/components/people/reviews-api";
import { ReviewStatusBadge } from "@/components/people/review-status-badge";
import { NeedsAttention } from "@/components/people/needs-attention";
import { PEOPLE_PIN_NEEDED_EVENT } from "@/components/employee-reviews";
import { UserAvatar } from "@/components/user-avatar";
import { PersonRecord } from "@/components/people-record";
import { PeopleLockedCard } from "@/components/people-locked-card";
import { JobTitlesBulk } from "@/components/job-titles-bulk";
import { TeamHoursView } from "@/components/team-hours-view";
import { type PeopleListResponse, type PersonCard, MEETING_KIND_LABEL, fmtDay, fmtDayRange } from "@/lib/people-api";
import { SortableTh } from "@/components/sortable-th";
import { nextSort, type SortState } from "@/lib/sortable-table";
import {
  DEFAULT_PEOPLE_SORT, PEOPLE_FIRST_DIR, PERSON_STATUS_LABEL, personStatus, sortPeopleRows, type PeopleSortKey,
} from "@/lib/people-list-table";

export default function PeopleSection() {
  const { state } = useAuth();
  const isPeople = useIsRtwManager();
  const [onRecord, params] = useRoute<{ userId: string }>("/people/:userId");
  const [onJobTitles] = useRoute("/people/job-titles");
  // The private HR queue — where the generic "Your attention is required in
  // HR" to-do lands, behind the same PIN gate as everything else here.
  const [onAttention] = useRoute("/people/attention");
  useSensitivePinGate({ enabled: isPeople, includeAdmins: true, fresh: true, entryKey: "people", scope: "people" });
  const ready = usePeopleReady(isPeople);
  // Typing keeps the PIN lock open; a write refused by the lock asks for the
  // PIN at once instead of a dead red message (Graeme, 2026-10-12).
  usePeopleKeepAlive(ready);
  const { requireSensitivePin } = useAuth();
  const askPinRef = useRef(requireSensitivePin);
  askPinRef.current = requireSensitivePin;
  useEffect(() => {
    const ask = () => askPinRef.current({ includeAdmins: true, scope: "people" });
    window.addEventListener(PEOPLE_PIN_NEEDED_EVENT, ask);
    return () => window.removeEventListener(PEOPLE_PIN_NEEDED_EVENT, ask);
  }, []);

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

  if (onJobTitles) return <JobTitlesBulk ready={ready} />;
  if (onAttention) return <NeedsAttention ready={ready} />;

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

/**
 * One person per row, sortable by any column (Graeme, 12 Oct 2026: "on the
 * people section we've got two columns of people. We want to put these into
 * tables that we can sort, a bit more like the recipe database"). Shows only
 * what the old cards showed. Tapping a row opens their record.
 */
function PeopleTable({ people, policy, badgeByUser, sort, onSort }: {
  people: PersonCard[];
  policy: PeopleListResponse["policy"];
  badgeByUser: Map<number, BadgeRow>;
  sort: SortState<PeopleSortKey>;
  onSort: (key: PeopleSortKey) => void;
}) {
  const [, navigate] = useLocation();
  const th = (label: string, key: PeopleSortKey, className?: string) => (
    <SortableTh label={label} sortKey={key} activeKey={sort.key} dir={sort.dir} onSort={onSort} className={className} />
  );
  return (
    <div className="overflow-x-auto glass-panel rounded-2xl">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
            {th("Name", "name")}
            {th("Job title", "jobTitle", "hidden sm:table-cell")}
            {th("Needs attention", "attention")}
            {th("Next meeting", "nextMeeting", "hidden md:table-cell")}
            {th("Status", "status")}
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {people.map(p => {
            const review = badgeByUser.get(p.id);
            const status = personStatus(p);
            const flagged = p.formsNeeded > 0 || p.triggers.sickness || p.triggers.lates;
            return (
              <tr
                key={p.id}
                onClick={() => navigate(`/people/${p.id}`)}
                className={cn(
                  "group border-b border-border/50 last:border-0 hover:bg-secondary/40 cursor-pointer align-middle",
                  !p.isActive && "opacity-70",
                )}
              >
                <td className="py-3 px-3 min-w-[10rem]">
                  <span className="flex items-center gap-3">
                    <UserAvatar name={p.name} avatarUrl={p.avatarUrl} size="md" />
                    <span className="min-w-0">
                      <Link
                        href={`/people/${p.id}`}
                        onClick={e => e.stopPropagation()}
                        className="block text-base font-semibold leading-snug hover:text-primary"
                      >
                        {p.name}
                      </Link>
                      {/* Their job, not their app access (Graeme, 2026-09-25). */}
                      <span className={cn("sm:hidden block text-xs text-muted-foreground", !p.jobTitle && "italic opacity-70")}>
                        {p.jobTitle ?? "No job title yet"}
                      </span>
                    </span>
                  </span>
                </td>
                <td className={cn("py-3 px-3 text-muted-foreground hidden sm:table-cell", !p.jobTitle && "italic opacity-70")}>
                  {p.jobTitle ?? "No job title yet"}
                </td>
                <td className="py-3 px-3">
                  {flagged || review?.badge || review?.liveWarningUntil ? (
                    <div className="flex flex-wrap gap-1.5">
                      {p.formsNeeded > 0 && (
                        <Flag tone="amber" icon={HeartPulse}>
                          Return-to-work form{p.formsNeeded > 1 ? ` (${p.formsNeeded})` : ""}
                        </Flag>
                      )}
                      {p.triggers.sickness && <Flag tone="rose" icon={AlertTriangle}>{p.sickInstances} sickness instances</Flag>}
                      {p.triggers.lates && <Flag tone="rose" icon={AlertTriangle}>{p.lates} lates</Flag>}
                      {review && <ReviewStatusBadge badge={review.badge} liveWarningUntil={review.liveWarningUntil} size="sm" />}
                    </div>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="py-3 px-3 hidden md:table-cell">
                  {p.nextMeeting ? (
                    <span className="leading-snug">
                      <span className="font-semibold whitespace-nowrap">{fmtDay(p.nextMeeting.date)}</span>
                      <span className="block text-xs text-muted-foreground">{p.nextMeeting.title || MEETING_KIND_LABEL[p.nextMeeting.kind] || "Meeting"}</span>
                    </span>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="py-3 px-3">
                  <span className={cn(
                    "inline-flex px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap",
                    status === "working" ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200" : "bg-secondary text-muted-foreground",
                  )}>
                    {PERSON_STATUS_LABEL[status]}
                  </span>
                </td>
                <td className="py-3 pr-3 text-right">
                  <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary inline" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <span className="sr-only">Policy trigger: {policy.sickInstances} sickness instances or {policy.lates} lates in {policy.months} months</span>
    </div>
  );
}

function PeopleList({ ready }: { ready: boolean }) {
  const { state } = useAuth();
  // Contracts & starter forms: the founder/HR account only (server:
  // middleware/hr-access.ts). People access alone does not open them.
  const isFounder = state.status === "authenticated" && isFounderEmail(state.user.email);
  const [search, setSearch] = useState("");
  const [leavers, setLeavers] = useState(false);
  const [inReviewOnly, setInReviewOnly] = useState(false);
  const badges = useRecordBadges(ready);
  const badgeByUser = useMemo(() => new Map((badges.data?.badges ?? []).map(b => [b.userId, b])), [badges.data]);
  // "Hours vs contract" lives in the URL (?view=hours) so Back from
  // someone's record returns to it.
  const [, navigate] = useLocation();
  const view = new URLSearchParams(useSearch()).get("view") === "hours" ? "hours" : "people";
  const { data, isLoading, error } = useQuery<PeopleListResponse>({
    queryKey: ["people-list", leavers],
    queryFn: () => peopleFetch<PeopleListResponse>(`/people${leavers ? "?leavers=1" : ""}`),
    enabled: ready && view === "people",
    retry: peopleRetry,
  });

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = data?.people ?? [];
    const people = inReviewOnly ? all.filter(p => badgeByUser.get(p.id)?.badge) : all;
    if (!q) return people;
    return people.filter(p => p.name.toLowerCase().includes(q) || (p.jobTitle ?? "").toLowerCase().includes(q));
  }, [data, search, inReviewOnly, badgeByUser]);
  const [sort, setSort] = useState<SortState<PeopleSortKey>>(DEFAULT_PEOPLE_SORT);
  const sorted = useMemo(
    () => sortPeopleRows(shown, sort, p => !!badgeByUser.get(p.id)?.badge),
    [shown, sort, badgeByUser],
  );

  if (error instanceof PeopleLockedError) return <PeopleLockedCard error={error} />;

  const outstanding = data?.outstanding ?? [];

  return (
    <div className="space-y-5 pb-24">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
          <UsersRound className="w-6 h-6 text-primary" />
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold leading-tight">People</h1>
          <p className="text-base text-muted-foreground">Tap a person for their whole record — attendance, return-to-work forms, reviews, notes.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-secondary/60" role="tablist" aria-label="People view">
        {([["people", "Everyone", UsersRound], ["hours", "Hours vs contract", Clock3]] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            role="tab"
            aria-selected={view === key}
            onClick={() => navigate(key === "hours" ? "/people?view=hours" : "/people", { replace: true })}
            className={cn(
              "h-14 rounded-xl text-lg font-bold flex items-center justify-center gap-2 transition-colors",
              view === key ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="w-5 h-5" /> {label}
          </button>
        ))}
      </div>

      {view === "hours" ? <TeamHoursView ready={ready} /> : <>
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
        {isFounder && (
          <Link
            href="/people/contracts"
            className="h-14 px-5 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50"
          >
            <FileSignature className="w-5 h-5" /> Contracts
          </Link>
        )}
        <Link
          href="/people/job-titles"
          className="h-14 px-5 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50"
        >
          <BadgeCheck className="w-5 h-5" /> Set job titles
        </Link>
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
        {badges.data && (
          <Link href="/people/attention"
            className="h-14 px-5 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50">
            Needs attention
          </Link>
        )}
        {badges.data && (
          <button
            onClick={() => setInReviewOnly(v => !v)}
            aria-pressed={inReviewOnly}
            className={cn(
              "h-14 px-5 rounded-2xl border-2 text-lg font-bold transition-colors",
              inReviewOnly ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary/50",
            )}
          >
            In review{inReviewOnly ? " only" : ""}
          </button>
        )}
      </div>

      {!ready || isLoading ? (
        <div className="flex items-center justify-center gap-3 py-16 text-lg text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /> Loading people…</div>
      ) : error ? (
        <div className="p-5 rounded-2xl bg-destructive/10 text-destructive text-lg font-semibold">{error instanceof Error ? error.message : "Couldn't load people."}</div>
      ) : shown.length === 0 ? (
        <p className="text-center py-12 text-lg text-muted-foreground">{search ? "Nobody matches that." : "Nobody here yet."}</p>
      ) : (
        <PeopleTable
          people={sorted}
          policy={data!.policy}
          badgeByUser={badgeByUser}
          sort={sort}
          onSort={k => setSort(s => nextSort(s, k, PEOPLE_FIRST_DIR[k]))}
        />
      )}

      {data?.attendance.stale && (
        <p className="text-sm text-muted-foreground">
          Couldn't reach Planday just now — attendance shown as last synced{data.attendance.syncedAt ? ` (${new Date(data.attendance.syncedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })})` : ""}.
        </p>
      )}
      </>}

      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Lock className="w-3.5 h-3.5" /> Private — People access only. Asks for your private PIN on the way in.
      </p>
    </div>
  );
}
