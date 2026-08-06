import { useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Redirect } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { FounderNav } from "@/components/founder-nav";
import { Skeleton } from "@/components/ui/skeleton";
import { format, parseISO } from "date-fns";
import {
  TrendingUp, TrendingDown, Mail, CalendarDays, Sparkles, Loader2, Plus,
  Trash2, Check, X, AlertTriangle, Megaphone, Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const FOUNDER_EMAIL = "graeme@thecalzonekitchen.co.uk";

// ── Types (mirror the founder-sales API) ────────────────────────────────────
interface Pace {
  monthToDate: number;
  orderCount: number;
  projected: number;
  target: number;
  onPace: boolean;
  requiredDailyRate: number;
  averageDailyRevenue: number;
  daysLeft: number;
}

interface EmailStatus {
  configured: boolean;
  lastSentAt: string | null;
  daysSince: number | null;
  cadenceDays: number;
  recent: Array<{ name: string; sentAt: string }>;
  error?: string;
}

interface MarketingEvent {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  offer: string | null;
  notes: string | null;
  status: "idea" | "planned";
  source: "manual" | "ai";
}

interface Pulse {
  today: string;
  pace: Pace | null;
  email: EmailStatus;
  events: MarketingEvent[];
  liveEvents: MarketingEvent[];
  gapWeeks: string[];
  attention: Array<{ kind: string; message: string }>;
}

interface Suggestion {
  name: string;
  startDate: string;
  endDate: string;
  angle: string;
  offerIdea: string;
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}/api/founder-sales${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

const gbp = (n: number) => `£${Math.round(n).toLocaleString()}`;
const shortDate = (iso: string) => format(parseISO(iso), "d MMM");

// ── Page ───────────────────────────────────────────────────────────────────
export default function FounderSales() {
  const { state } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<Pulse>({
    queryKey: ["founder-sales-pulse"],
    queryFn: () => api("/pulse"),
    enabled: state.status === "authenticated" && state.user.email === FOUNDER_EMAIL,
    refetchInterval: 5 * 60_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["founder-sales-pulse"] });

  if (state.status !== "authenticated" || state.user.email !== FOUNDER_EMAIL) {
    return <Redirect to="/" />;
  }

  return (
    <div className="space-y-6">
      <FounderNav />
      <PageHeader
        title="Sales & Marketing"
        description="Revenue pace, email cadence and the marketing calendar — there's always something on."
      />

      {/* ── Attention strip: the assistant speaks first ─────────────────── */}
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : (data?.attention.length ?? 0) > 0 ? (
        <div className="space-y-2">
          {data!.attention.map((a, i) => (
            <div key={i} className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <span className="text-amber-800 dark:text-amber-300">{a.message}</span>
            </div>
          ))}
        </div>
      ) : data ? (
        <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm flex items-center gap-2.5">
          <Check className="w-4 h-4 text-primary flex-shrink-0" />
          <span>On pace, emails flowing, calendar covered. Nothing needs you here today.</span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px] gap-6 items-start">
        <div className="space-y-6 min-w-0">
          <PaceCard pace={data?.pace ?? null} loading={isLoading} />
          <CalendarSection
            today={data?.today}
            events={data?.events ?? []}
            gapWeeks={data?.gapWeeks ?? []}
            onChanged={invalidate}
          />
        </div>
        <div className="space-y-6 min-w-0">
          <EmailCadenceCard email={data?.email} loading={isLoading} onChanged={invalidate} />
        </div>
      </div>
    </div>
  );
}

// ── Revenue pace ────────────────────────────────────────────────────────────
function PaceCard({ pace, loading }: { pace: Pace | null; loading: boolean }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        {pace && !pace.onPace
          ? <TrendingDown className="w-4 h-4 text-red-500" />
          : <TrendingUp className="w-4 h-4 text-primary" />}
        Revenue pace — this month
      </h2>
      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : !pace ? (
        <p className="text-sm text-muted-foreground">
          Shopify sales are unavailable right now — pace will reappear when the sales summary loads.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <PaceStat label="Month to date" value={gbp(pace.monthToDate)} sub={`${pace.orderCount} orders`} />
            <PaceStat
              label="Projected"
              value={gbp(pace.projected)}
              sub={`target ${gbp(pace.target)}`}
              tone={pace.onPace ? "good" : "bad"}
            />
            <PaceStat label="Daily average" value={gbp(pace.averageDailyRevenue)} sub="so far" />
            <PaceStat
              label="Needed per day"
              value={gbp(pace.requiredDailyRate)}
              sub={`${pace.daysLeft} days left`}
              tone={pace.requiredDailyRate > pace.averageDailyRevenue ? "bad" : "good"}
            />
          </div>
          {/* Progress toward target, with a tick showing where "on pace today" sits. */}
          <div className="space-y-1">
            <div className="relative h-3 rounded-full bg-secondary overflow-hidden">
              <div
                className={cn("absolute inset-y-0 left-0 rounded-full", pace.onPace ? "bg-primary" : "bg-red-500")}
                style={{ width: `${Math.min(100, (pace.monthToDate / pace.target) * 100)}%` }}
              />
              <div
                className="absolute inset-y-0 w-0.5 bg-foreground/50"
                title="Where month-to-date should be to be on pace"
                style={{ left: `${Math.min(100, (new Date().getDate() / (new Date().getDate() + pace.daysLeft)) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {Math.round((pace.monthToDate / pace.target) * 100)}% of {gbp(pace.target)} · the marker is where today should be
            </p>
          </div>
        </>
      )}
    </section>
  );
}

function PaceStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl bg-secondary/30 px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums",
        tone === "good" && "text-primary", tone === "bad" && "text-red-500")}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ── Marketing calendar ──────────────────────────────────────────────────────
function CalendarSection({ today, events, gapWeeks, onChanged }: {
  today?: string;
  events: MarketingEvent[];
  gapWeeks: string[];
  onChanged: () => void;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const suggest = useMutation({
    mutationFn: () => api("/suggest-events", { method: "POST" }) as Promise<{ suggestions: Suggestion[] }>,
    onSuccess: r => { setSuggestions(r.suggestions); setSuggestError(r.suggestions.length ? null : "No suggestions came back — the next 8 weeks may already be covered."); },
    onError: (e: Error) => setSuggestError(e.message),
  });

  const lockIn = useMutation({
    mutationFn: (s: Suggestion) => api("/events", {
      method: "POST",
      body: JSON.stringify({ name: s.name, startDate: s.startDate, endDate: s.endDate, offer: s.offerIdea, notes: s.angle, status: "planned", source: "ai" }),
    }),
    onSuccess: (_r, s) => { setSuggestions(list => list.filter(x => x !== s)); onChanged(); },
  });

  const patchEvent = useMutation({
    mutationFn: ({ id, ...fields }: { id: number; status?: "idea" | "planned" }) =>
      api(`/events/${id}`, { method: "PATCH", body: JSON.stringify(fields) }),
    onSuccess: onChanged,
  });
  const deleteEvent = useMutation({
    mutationFn: (id: number) => api(`/events/${id}`, { method: "DELETE" }),
    onSuccess: onChanged,
  });

  return (
    <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Megaphone className="w-4 h-4 text-primary" /> Marketing calendar
          <span className="text-xs font-normal text-muted-foreground">— next 6 weeks</span>
        </h2>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowAdd(s => !s)}
            className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary/50 flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Add event
          </button>
          <button onClick={() => suggest.mutate()} disabled={suggest.isPending}
            className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5">
            {suggest.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {suggest.isPending ? "Thinking…" : "Suggest events"}
          </button>
        </div>
      </div>

      {showAdd && <AddEventForm onAdded={() => { setShowAdd(false); onChanged(); }} />}

      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing on the calendar in the next 6 weeks yet.</p>
      ) : (
        <ul className="space-y-2">
          {events.map(e => {
            const live = today != null && e.startDate <= today && e.endDate >= today && e.status === "planned";
            return (
              <li key={e.id} className={cn(
                "rounded-xl border px-3 py-2.5 flex items-start gap-3",
                live ? "border-primary/40 bg-primary/5" : "border-border bg-secondary/20",
                e.status === "idea" && "border-dashed",
              )}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium flex items-center gap-2 flex-wrap">
                    {e.name}
                    {live && <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary text-primary-foreground">Live now</span>}
                    {e.status === "idea" && <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">Idea</span>}
                    {e.source === "ai" && <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-600 dark:text-violet-400">AI</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">{shortDate(e.startDate)} → {shortDate(e.endDate)}{e.offer ? ` · ${e.offer}` : ""}</p>
                  {e.notes && <p className="text-xs text-muted-foreground mt-0.5">{e.notes}</p>}
                </div>
                {e.status === "idea" && (
                  <button onClick={() => patchEvent.mutate({ id: e.id, status: "planned" })}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10"
                    title="Lock in" aria-label="Lock in event">
                    <Lock className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => deleteEvent.mutate(e.id)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                  title="Remove" aria-label="Remove event">
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {gapWeeks.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Uncovered weeks: {gapWeeks.map(w => `w/c ${shortDate(w)}`).join(", ")}
        </p>
      )}

      {/* AI suggestions land here as dashed idea cards until locked in. */}
      {suggestError && (
        <div className="rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm flex items-start gap-2">
          <Sparkles className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <span className="flex-1">{suggestError}</span>
          <button onClick={() => setSuggestError(null)} className="p-1 text-muted-foreground" aria-label="Dismiss"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-primary" /> Suggested — lock in the ones you like
          </h3>
          {suggestions.map((s, i) => (
            <div key={i} className="rounded-xl border border-dashed border-primary/40 bg-primary/5 px-3 py-2.5 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{s.name}</p>
                <p className="text-xs text-muted-foreground">{shortDate(s.startDate)} → {shortDate(s.endDate)} · {s.offerIdea}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.angle}</p>
              </div>
              <button onClick={() => lockIn.mutate(s)} disabled={lockIn.isPending}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1">
                <Lock className="w-3 h-3" /> Lock in
              </button>
              <button onClick={() => setSuggestions(list => list.filter(x => x !== s))}
                className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary/50" aria-label="Dismiss suggestion">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AddEventForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [offer, setOffer] = useState("");
  const add = useMutation({
    mutationFn: () => api("/events", {
      method: "POST",
      body: JSON.stringify({ name: name.trim(), startDate, endDate, offer: offer.trim() || null, status: "planned" }),
    }),
    onSuccess: onAdded,
  });
  const valid = name.trim() && /^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate) && endDate >= startDate;
  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-3 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Event name (e.g. Bonfire Night Box)"
          className="px-3 py-2 rounded-lg border border-border bg-background text-sm" />
        <input value={offer} onChange={e => setOffer(e.target.value)} placeholder="Offer (optional)"
          className="px-3 py-2 rounded-lg border border-border bg-background text-sm" />
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
          className="px-3 py-2 rounded-lg border border-border bg-background text-sm" aria-label="Start date" />
        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
          className="px-3 py-2 rounded-lg border border-border bg-background text-sm" aria-label="End date" />
      </div>
      {add.isError && <p className="text-xs text-red-500">{(add.error as Error).message}</p>}
      <button onClick={() => add.mutate()} disabled={!valid || add.isPending}
        className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5">
        {add.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add to calendar
      </button>
    </div>
  );
}

// ── Email cadence + Klaviyo connection ─────────────────────────────────────
function EmailCadenceCard({ email, loading, onChanged }: {
  email?: EmailStatus;
  loading: boolean;
  onChanged: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [connectError, setConnectError] = useState<string | null>(null);
  const connect = useMutation({
    mutationFn: () => api("/klaviyo", { method: "POST", body: JSON.stringify({ apiKey: apiKey.trim() }) }),
    onSuccess: () => { setApiKey(""); setConnectError(null); onChanged(); },
    onError: (e: Error) => setConnectError(e.message),
  });
  const disconnect = useMutation({
    mutationFn: () => api("/klaviyo", { method: "DELETE" }),
    onSuccess: onChanged,
  });

  const overdue = email?.configured && !email.error && (email.daysSince == null || email.daysSince >= email.cadenceDays);

  return (
    <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <Mail className={cn("w-4 h-4", overdue ? "text-amber-500" : "text-primary")} /> Email cadence
        {email && <span className="text-xs font-normal text-muted-foreground">— every {email.cadenceDays} days minimum</span>}
      </h2>
      {loading ? (
        <Skeleton className="h-20 w-full" />
      ) : !email?.configured ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Connect Klaviyo with a <b>private API key</b> (Klaviyo → Settings → API keys, read-only is enough).
            Once connected, this card tracks when the last campaign went out and nudges you at the cadence.
          </p>
          <input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Klaviyo private API key (pk_…)"
            type="password" className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
          {connectError && <p className="text-xs text-red-500">{connectError}</p>}
          <button onClick={() => connect.mutate()} disabled={connect.isPending || apiKey.trim().length < 10}
            className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5">
            {connect.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Connect
          </button>
        </div>
      ) : email.error ? (
        <div className="space-y-2">
          <p className="text-sm text-amber-600 dark:text-amber-400">Klaviyo error: {email.error}</p>
          <button onClick={() => disconnect.mutate()} className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary/50">
            Disconnect &amp; re-enter key
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className={cn("rounded-xl px-3 py-2.5", overdue ? "bg-amber-500/10" : "bg-secondary/30")}>
            <p className="text-lg font-semibold tabular-nums">
              {email.daysSince == null ? "No sends found" : email.daysSince === 0 ? "Sent today" : `${email.daysSince} day${email.daysSince === 1 ? "" : "s"} since last email`}
            </p>
            {overdue && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Over the {email.cadenceDays}-day cadence — send one today. Segments (VIPs, lapsed, new) can be mailed more often than the full list.
              </p>
            )}
          </div>
          {email.recent.length > 0 && (
            <ul className="space-y-1">
              {email.recent.map((c, i) => (
                <li key={i} className="text-xs flex items-center justify-between gap-2 px-1">
                  <span className="truncate">{c.name}</span>
                  <span className="text-muted-foreground flex-shrink-0">{format(parseISO(c.sentAt), "d MMM")}</span>
                </li>
              ))}
            </ul>
          )}
          <button onClick={() => disconnect.mutate()} disabled={disconnect.isPending}
            className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary/50 text-muted-foreground">
            Disconnect Klaviyo
          </button>
        </div>
      )}
    </section>
  );
}
