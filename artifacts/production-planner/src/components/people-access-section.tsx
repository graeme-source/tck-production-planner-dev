/**
 * People section access — Settings → Team & Access (Graeme, 2026-09-25).
 *
 * One card per person with a big switch: can they open People (everyone's
 * employee records, reviews and return-to-work forms)? Only the founder
 * account can flip it — the server enforces that; everyone else sees the
 * switches disabled with the reason. The founder's own switch can't be
 * turned off. Each switch saves the moment it's tapped and shows its own
 * save state (Saving… / Saved / Couldn't save + Try again).
 *
 * Switching someone on is not the whole story: they must set their own
 * private People PIN before People opens for them, and each card shows
 * whether they have. Deliberately separate from Feature grants, which any
 * admin can hand out.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, Search, ShieldCheck, UsersRound } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { peopleAccessLabel, peopleAccessToggleBlocked, type PeopleAccessState } from "@/lib/people-access-labels";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const QUERY_KEY = ["/api/people-access/users"];

type Row = {
  id: number;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  isFounder: boolean;
  state: PeopleAccessState;
  /** YYYY-MM-DD */
  grantedAt: string | null;
  grantedByName: string | null;
};
type ListResponse = { canGrant: boolean; reason: string | null; users: Row[] };
type SaveState = { status: "saving" | "saved" | "error"; wanted: boolean; error?: string };

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as T;
}

const TONE: Record<"muted" | "warn" | "good", string> = {
  muted: "bg-secondary text-muted-foreground",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  good: "bg-primary/15 text-primary",
};

export function PeopleAccessSection() {
  const { state } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [saves, setSaves] = useState<Record<number, SaveState>>({});

  const query = useQuery<ListResponse>({
    queryKey: QUERY_KEY,
    queryFn: () => jsonFetch<ListResponse>(`${BASE}/api/people-access/users`),
    enabled: state.status === "authenticated" && state.user.role === "admin",
  });

  const change = useMutation({
    mutationFn: ({ userId, enabled }: { userId: number; enabled: boolean }) =>
      jsonFetch<Row>(`${BASE}/api/people-access/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      }),
    onMutate: ({ userId, enabled }) => {
      setSaves(s => ({ ...s, [userId]: { status: "saving", wanted: enabled } }));
    },
    onSuccess: (row, { userId, enabled }) => {
      queryClient.setQueryData<ListResponse>(QUERY_KEY, old =>
        old ? { ...old, users: old.users.map(u => (u.id === row.id ? row : u)) } : old);
      setSaves(s => ({ ...s, [userId]: { status: "saved", wanted: enabled } }));
    },
    onError: (err: Error, { userId, enabled }) => {
      setSaves(s => ({ ...s, [userId]: { status: "error", wanted: enabled, error: err.message } }));
    },
  });

  const rows = useMemo(() => {
    const all = query.data?.users ?? [];
    const q = search.trim().toLowerCase();
    return q ? all.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) : all;
  }, [query.data, search]);

  const canGrant = query.data?.canGrant === true;
  const withAccess = (query.data?.users ?? []).filter(u => u.state !== "none").length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <UsersRound className="w-4 h-4 text-primary" /> People section access
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Who can open People — everyone's employee records, reviews and return-to-work forms. A role never gives it.
          Anyone switched on must set their own{" "}
          <Link href="/account/people-pin" className="underline underline-offset-2 hover:text-foreground">private People PIN</Link>{" "}
          before People opens for them.
        </p>
      </div>

      {query.data && !canGrant && (
        <p className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm font-medium text-amber-800 dark:text-amber-300">
          <ShieldCheck className="w-4 h-4 flex-shrink-0" />
          {query.data.reason ?? "Only Graeme (the founder account) can turn People access on or off."}
        </p>
      )}

      {query.isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : query.isError ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center justify-between gap-3">
          <span>Couldn't load People access: {(query.error as Error).message}</span>
          <button onClick={() => query.refetch()} className="px-3 py-2 rounded-lg border border-destructive/40 font-semibold">Try again</button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Find a person"
                className="w-full h-12 pl-9 pr-3 rounded-xl border-2 border-border bg-card text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <span className="text-sm text-muted-foreground">{withAccess} with access</span>
          </div>

          <div className="grid gap-3 grid-cols-1 xl:grid-cols-2">
            {rows.map(u => {
              const save = saves[u.id];
              const serverOn = u.state !== "none";
              // While saving, show what was asked for; after a failed save it
              // falls back to what the server holds, with the error beneath.
              const shownOn = save?.status === "saving" ? save.wanted : serverOn;
              const blocked = peopleAccessToggleBlocked({ viewerCanGrant: canGrant, rowIsFounder: u.isFounder, rowHasAccess: serverOn });
              const label = peopleAccessLabel(u.state);
              return (
                <div key={u.id} className="rounded-2xl border-2 border-border bg-card p-4 sm:p-5">
                  <div className="flex items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-lg font-semibold truncate">{u.name}{!u.isActive && <span className="ml-2 text-sm font-normal text-muted-foreground">(inactive)</span>}</p>
                      <p className="text-sm text-muted-foreground truncate capitalize">{u.role} · <span className="normal-case">{u.email}</span></p>
                      <span className={`inline-block mt-2 rounded-full px-3 py-1 text-sm font-semibold ${TONE[label.tone]}`}>{label.label}</span>
                      {serverOn && u.grantedAt && (
                        <p className="text-xs text-muted-foreground mt-2">
                          Switched on {u.grantedByName ? `by ${u.grantedByName} ` : ""}on {new Date(`${u.grantedAt}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        </p>
                      )}
                    </div>
                    <button
                      role="switch"
                      aria-checked={shownOn}
                      aria-label={`People access for ${u.name}`}
                      disabled={blocked != null || save?.status === "saving"}
                      onClick={() => change.mutate({ userId: u.id, enabled: !serverOn })}
                      className={`relative flex-shrink-0 w-[72px] h-11 rounded-full transition-colors disabled:cursor-not-allowed ${shownOn ? "bg-primary" : "bg-muted-foreground/30"} ${blocked ? "opacity-50" : ""}`}
                    >
                      <span className={`absolute top-1 left-1 w-9 h-9 rounded-full bg-white shadow transition-transform ${shownOn ? "translate-x-[28px]" : ""}`} />
                    </button>
                  </div>

                  <div className="mt-2 min-h-[1.5rem] text-sm">
                    {save?.status === "saving" && (
                      <span className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Saving…</span>
                    )}
                    {save?.status === "saved" && (
                      <span className="flex items-center gap-1.5 text-primary font-medium"><Check className="w-4 h-4" /> Saved</span>
                    )}
                    {save?.status === "error" && (
                      <span className="flex flex-wrap items-center gap-2 text-destructive font-medium">
                        <AlertTriangle className="w-4 h-4" /> Couldn't save — {save.error}
                        <button
                          onClick={() => change.mutate({ userId: u.id, enabled: save.wanted })}
                          className="px-3 py-1.5 rounded-lg border border-destructive/40 text-sm font-semibold"
                        >
                          Try again
                        </button>
                      </span>
                    )}
                    {!save && blocked && canGrant && (
                      <span className="text-muted-foreground">{blocked}</span>
                    )}
                    {!save && serverOn && u.state === "pin_needed" && (
                      <span className="block text-amber-700 dark:text-amber-400">People stays shut for them until they set their private PIN.</span>
                    )}
                  </div>
                </div>
              );
            })}
            {rows.length === 0 && <p className="text-sm text-muted-foreground">No one matches that search.</p>}
          </div>
        </>
      )}
    </div>
  );
}
