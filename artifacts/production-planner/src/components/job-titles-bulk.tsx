/**
 * "Set job titles" — everyone on one screen with their job title ready to
 * type over (Graeme, 2026-09-25: "we've got a lot of team members, but we
 * want to change that to what's in their contract"). Each field autosaves on
 * its own; where their latest contract names a different title, one tap
 * copies it across. Reached from the People list: /people/job-titles.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, ChevronLeft, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { peopleFetch, peopleRetry, PeopleLockedError } from "@/hooks/use-people-gate";
import { PeopleLockedCard } from "@/components/people-locked-card";
import { UserAvatar } from "@/components/user-avatar";
import { JobTitleField } from "@/components/job-title-field";
import type { JobTitlesResponse } from "@/lib/people-api";

export function JobTitlesBulk({ ready }: { ready: boolean }) {
  const [search, setSearch] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const { data, isLoading, error } = useQuery<JobTitlesResponse>({
    queryKey: ["people-job-titles"],
    queryFn: () => peopleFetch<JobTitlesResponse>("/people/job-titles"),
    enabled: ready,
    retry: peopleRetry,
    // Each row keeps its own typed value; a refetch after a save must not
    // reshuffle the list under the person typing.
    refetchOnWindowFocus: false,
  });

  // Freeze the "no title yet" filter to what was missing when it was
  // switched on — otherwise a row vanishes the moment its title saves.
  const [missingIds, setMissingIds] = useState<Set<number> | null>(null);
  const toggleMissing = () => {
    if (onlyMissing) { setOnlyMissing(false); setMissingIds(null); return; }
    setMissingIds(new Set((data?.people ?? []).filter(p => !p.jobTitle).map(p => p.id)));
    setOnlyMissing(true);
  };

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.people ?? []).filter(p =>
      (!q || p.name.toLowerCase().includes(q)) && (!missingIds || missingIds.has(p.id)));
  }, [data, search, missingIds]);

  if (error instanceof PeopleLockedError) return <PeopleLockedCard error={error} />;

  const missing = (data?.people ?? []).filter(p => !p.jobTitle).length;

  return (
    <div className="max-w-4xl mx-auto space-y-5 pb-24">
      <Link href="/people" className="inline-flex items-center gap-2 px-4 h-14 rounded-2xl bg-secondary hover:bg-secondary/70 text-lg font-bold transition-colors">
        <ChevronLeft className="w-5 h-5" /> Everyone
      </Link>
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
          <BadgeCheck className="w-6 h-6 text-primary" />
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold leading-tight">Set job titles</h1>
          <p className="text-base text-muted-foreground">
            Type each person's job title as their contract states it. Every field saves on its own. This is their job, not their app access.
          </p>
        </div>
      </div>

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
          onClick={toggleMissing}
          aria-pressed={onlyMissing}
          className={cn(
            "h-14 px-5 rounded-2xl border-2 text-lg font-bold transition-colors",
            onlyMissing ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary/50",
          )}
        >
          {onlyMissing ? "Showing no title yet" : `No title yet (${missing})`}
        </button>
      </div>

      {!ready || isLoading ? (
        <div className="flex items-center justify-center gap-3 py-16 text-lg text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /> Loading…</div>
      ) : error ? (
        <div className="p-5 rounded-2xl bg-destructive/10 text-destructive text-lg font-semibold">{error instanceof Error ? error.message : "Couldn't load."}</div>
      ) : shown.length === 0 ? (
        <p className="text-center py-12 text-lg text-muted-foreground">{search ? "Nobody matches that." : "Everyone has a job title."}</p>
      ) : (
        <div className="space-y-3">
          {shown.map(p => (
            <div key={p.id} className="rounded-3xl border-2 border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <Link href={`/people/${p.id}`} className="flex items-center gap-3 sm:w-64 shrink-0 min-w-0 hover:text-primary">
                <UserAvatar name={p.name} avatarUrl={p.avatarUrl} size="lg" />
                <span className="text-lg font-bold truncate">{p.name}</span>
              </Link>
              <div className="flex-1 min-w-0">
                <JobTitleField userId={p.id} initial={p.jobTitle} suggestion={p.contractJobTitle} size="md" label={`Job title for ${p.name}`} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
