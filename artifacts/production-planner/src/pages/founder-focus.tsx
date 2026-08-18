import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Redirect, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { FounderNav, FocusLink } from "@/components/founder-nav";
import { Skeleton } from "@/components/ui/skeleton";
import { format, addDays, parseISO } from "date-fns";
import {
  ChevronLeft, ChevronRight, ChevronDown, Plus, Trash2, Check, X, Play,
  CalendarDays, Inbox, Target, LayoutTemplate, CircleDashed,
  SkipForward, Pencil, Repeat, Copy, Video, ExternalLink, Eye, EyeOff,
  BellRing, BellOff, GripVertical, Sparkles, Loader2,
  LineChart, Calculator, Megaphone,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const FOUNDER_EMAIL = "graeme@thecalzonekitchen.co.uk";

// ── Types (mirror the founder-focus API) ────────────────────────────────────
interface Goal {
  id: number;
  pillarId: number;
  title: string;
  detail: string | null;
  url: string | null;
  status: "active" | "done" | "parked";
  sort: number;
}

type RecurringSchedule = "daily" | "weekdays" | "weekly" | "biweekly";

interface Pillar {
  id: number;
  name: string;
  color: string | null;
  sort: number;
  targetSharePct: number | null;
  notes: string | null;
  goals: Goal[];
}

interface Block {
  id: number;
  date: string;
  startMin: number;
  endMin: number;
  pillarId: number | null;
  title: string;
  notes: string | null;
  status: "planned" | "done" | "skipped";
  source: string;
}

interface TemplateRow {
  id: number;
  weekday: number;
  startMin: number;
  endMin: number;
  pillarId: number | null;
  title: string;
}

interface ParkingItem {
  id: number;
  text: string;
  createdAt: string;
}

interface CalEvent {
  title: string;
  calendar: string;
  startMin: number;
  endMin: number;
  allDay: boolean;
  joinUrl: string | null;
  joinIsCall: boolean;
}

interface RecurringItem {
  id: number;
  pillarId: number;
  title: string;
  url: string | null;
  schedule: RecurringSchedule;
  scheduleDay: number | null;
  ticked: boolean;
  dueOnDate: boolean;
}

// A one-off to-do for a given day. Distinct from a Goal (long-term, lives on
// the pillar for ever) and a RecurringItem (repeats on a schedule).
interface Task {
  id: number;
  title: string;
  detail: string | null;
  url: string | null;
  pillarId: number | null;
  blockId: number | null;
  date: string;
  status: "open" | "done";
  doneAt: string | null;
  source: string;
  sort: number;
}

// What the AI quick-add router proposes. Nothing is written until confirmed.
interface TaskRoute {
  pillarId: number | null;
  blockId: number | null;
  recurring: boolean;
  reason: string | null;
  available: boolean;
}

const SCHEDULE_LABELS: Record<RecurringSchedule, string> = {
  daily: "Every day",
  weekdays: "Weekdays",
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
};

// 0=Sunday..6=Saturday, matching Date.getDay().
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function scheduleLabel(r: RecurringItem): string {
  if (r.schedule === "weekly" && r.scheduleDay != null) return `Every ${DAY_NAMES[r.scheduleDay]}`;
  if (r.schedule === "biweekly" && r.scheduleDay != null) return `Every 2nd ${DAY_NAMES[r.scheduleDay]}`;
  return SCHEDULE_LABELS[r.schedule];
}

interface Objective {
  id: number;
  horizon: "moonshot" | "mission" | "stepping_stone";
  title: string;
  detail: string | null;
  metric: string | null;
  targetDate: string | null;
  achieved: boolean;
}

interface Overview {
  objectives: Objective[];
  date: string;
  weekday: number;
  pillars: Pillar[];
  blocks: Block[];
  templates: TemplateRow[];
  parkingLot: ParkingItem[];
  recurringItems: RecurringItem[];
  tasks: Task[];
  overdueTasks: Task[];
  calendarConfigured: boolean;
}

// Apple Calendar payload — its own query since 2026-08-18: a cold iCloud
// fetch takes seconds, and split out it can't hold up the rest of the page.
interface DayEvents {
  calendarConfigured: boolean;
  events: CalEvent[];
  calendarError: string | null;
}

interface CaldavCalendar {
  url: string;
  name: string;
  enabled: boolean;
}

interface CaldavStatus {
  configured: boolean;
  appleId?: string;
  calendars?: CaldavCalendar[];
  error?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function timeToMin(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

const DEFAULT_PILLAR_COLOR = "#9ca3af";

// Last-known copies on the device, so returning to the page paints
// instantly (stale) while the fresh fetch runs — instead of a blank screen.
// Only ever used as react-query placeholderData; real data replaces it.
const FOCUS_CACHE_PREFIX = "founder-focus-cache:";
function readCachedFocus<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(FOCUS_CACHE_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}
function writeCachedFocus(key: string, value: unknown): void {
  try {
    localStorage.setItem(FOCUS_CACHE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota/private-mode failures just lose the instant paint, nothing else.
  }
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}/api/founder-focus${path}`, {
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

// ── Page ───────────────────────────────────────────────────────────────────
export default function FounderFocus() {
  const { state } = useAuth();
  const queryClient = useQueryClient();
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const [dateStr, setDateStr] = useState(todayStr);

  // Re-render every 30s so the Now/Next strip tracks the clock.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const isFounder = state.status === "authenticated" && state.user.email === FOUNDER_EMAIL;

  const { data, isLoading } = useQuery<Overview>({
    queryKey: ["founder-focus", dateStr],
    queryFn: async () => {
      const fresh = (await api(`/overview?date=${dateStr}`)) as Overview;
      writeCachedFocus(`overview:${dateStr}`, fresh);
      return fresh;
    },
    placeholderData: () => readCachedFocus<Overview>(`overview:${dateStr}`),
    enabled: isFounder,
  });

  // Meetings load separately — see DayEvents. Not touched by invalidate():
  // app mutations never change the diary, so no iCloud churn on every tick.
  const { data: dayEvents } = useQuery<DayEvents>({
    queryKey: ["founder-focus-events", dateStr],
    queryFn: async () => {
      const fresh = (await api(`/events?date=${dateStr}`)) as DayEvents;
      writeCachedFocus(`events:${dateStr}`, fresh);
      return fresh;
    },
    placeholderData: () => readCachedFocus<DayEvents>(`events:${dateStr}`),
    enabled: isFounder,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["founder-focus"] });

  // ── Mutations ────────────────────────────────────────────────────────────
  const addBlock = useMutation({
    mutationFn: (b: { date: string; startMin: number; endMin: number; title?: string; pillarId: number | null }) =>
      api("/blocks", { method: "POST", body: JSON.stringify(b) }),
    onSuccess: invalidate,
  });
  const patchBlock = useMutation({
    mutationFn: ({ id, ...fields }: { id: number } & Partial<Pick<Block, "status" | "title" | "startMin" | "endMin" | "pillarId">>) =>
      api(`/blocks/${id}`, { method: "PATCH", body: JSON.stringify(fields) }),
    onSuccess: invalidate,
  });
  const deleteBlock = useMutation({
    mutationFn: (id: number) => api(`/blocks/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  const applyTemplate = useMutation({
    mutationFn: () => api("/blocks/apply-template", { method: "POST", body: JSON.stringify({ date: dateStr }) }),
    onSuccess: invalidate,
  });
  const addParking = useMutation({
    mutationFn: (text: string) => api("/parking-lot", { method: "POST", body: JSON.stringify({ text }) }),
    onSuccess: invalidate,
  });
  const resolveParking = useMutation({
    mutationFn: (id: number) => api(`/parking-lot/${id}`, { method: "PATCH", body: JSON.stringify({ resolved: true }) }),
    onSuccess: invalidate,
  });
  const addGoal = useMutation({
    mutationFn: (g: { pillarId: number; title: string; url?: string }) => api("/goals", { method: "POST", body: JSON.stringify(g) }),
    onSuccess: invalidate,
  });
  const patchGoal = useMutation({
    mutationFn: ({ id, ...fields }: { id: number; status?: Goal["status"]; title?: string; url?: string | null }) =>
      api(`/goals/${id}`, { method: "PATCH", body: JSON.stringify(fields) }),
    onSuccess: invalidate,
  });
  const deleteGoal = useMutation({
    mutationFn: (id: number) => api(`/goals/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  const addPillar = useMutation({
    mutationFn: (p: { name: string; color: string }) => api("/pillars", { method: "POST", body: JSON.stringify(p) }),
    onSuccess: invalidate,
  });
  const patchPillar = useMutation({
    mutationFn: ({ id, ...fields }: { id: number; name?: string; targetSharePct?: number | null; notes?: string | null; archived?: boolean }) =>
      api(`/pillars/${id}`, { method: "PATCH", body: JSON.stringify(fields) }),
    onSuccess: invalidate,
  });
  const addRecurring = useMutation({
    mutationFn: (r: { pillarId: number; title: string; url?: string; schedule?: RecurringSchedule; scheduleDay?: number | null }) =>
      api("/recurring-items", { method: "POST", body: JSON.stringify(r) }),
    onSuccess: invalidate,
  });
  const patchRecurring = useMutation({
    mutationFn: ({ id, ...fields }: { id: number; title?: string; url?: string | null }) =>
      api(`/recurring-items/${id}`, { method: "PATCH", body: JSON.stringify(fields) }),
    onSuccess: invalidate,
  });
  const deleteRecurring = useMutation({
    mutationFn: (id: number) => api(`/recurring-items/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  const tickRecurring = useMutation({
    mutationFn: ({ id, ticked }: { id: number; ticked: boolean }) =>
      api(`/recurring-items/${id}/tick`, { method: "POST", body: JSON.stringify({ date: dateStr, ticked }) }),
    onSuccess: invalidate,
  });
  const addTask = useMutation({
    mutationFn: (t: { title: string; date: string; pillarId?: number | null; blockId?: number | null; source?: string }) =>
      api("/tasks", { method: "POST", body: JSON.stringify(t) }),
    onSuccess: invalidate,
  });
  const patchTask = useMutation({
    mutationFn: ({ id, ...fields }: { id: number; status?: Task["status"]; title?: string; date?: string; pillarId?: number | null; blockId?: number | null }) =>
      api(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(fields) }),
    onSuccess: invalidate,
  });
  const deleteTask = useMutation({
    mutationFn: (id: number) => api(`/tasks/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  const addTemplateRow = useMutation({
    mutationFn: (t: { weekday: number; startMin: number; endMin: number; title?: string; pillarId: number | null }) =>
      api("/templates", { method: "POST", body: JSON.stringify(t) }),
    onSuccess: invalidate,
  });
  const deleteTemplateRow = useMutation({
    mutationFn: (id: number) => api(`/templates/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  // ── Derived ──────────────────────────────────────────────────────────────
  const pillarById = useMemo(() => {
    const m = new Map<number, Pillar>();
    for (const p of data?.pillars ?? []) m.set(p.id, p);
    return m;
  }, [data?.pillars]);

  const isToday = dateStr === todayStr;
  const now = nowMinutes();
  const blocks = data?.blocks ?? [];
  const events = dayEvents?.events ?? [];

  // One merged timeline: blocks you planned plus meetings from the diary.
  // Meetings are immovable, so Now/Next treats them as first-class items —
  // "you're in the supplier call until 2" beats pretending the block matters.
  type TimelineItem =
    | { kind: "block"; startMin: number; endMin: number; block: Block }
    | { kind: "event"; startMin: number; endMin: number; event: CalEvent };
  const timeline: TimelineItem[] = [
    ...blocks.map(b => ({ kind: "block" as const, startMin: b.startMin, endMin: b.endMin, block: b })),
    ...events.filter(e => !e.allDay).map(e => ({ kind: "event" as const, startMin: e.startMin, endMin: e.endMin, event: e })),
  ].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const allDayEvents = events.filter(e => e.allDay);

  const isLive = (t: TimelineItem) => t.kind === "event" || t.block.status === "planned";
  const currentItem = isToday ? timeline.find(t => isLive(t) && t.startMin <= now && now < t.endMin) : undefined;
  const nextItem = isToday ? timeline.find(t => isLive(t) && t.startMin > now) : undefined;

  // Completed things are clutter mid-day: hide done/skipped blocks and (for
  // today only) meetings that have already ended, behind a toggle. Past
  // dates always show everything — that's the day's record.
  const [showCompleted, setShowCompleted] = useState(false);
  const isCompleted = (t: TimelineItem) =>
    t.kind === "block"
      ? t.block.status !== "planned"
      : (isToday && t.endMin <= now);
  const completedCount = (isToday ? timeline.filter(isCompleted).length : 0)
    + (data?.tasks ?? []).filter(t => t.status === "done").length;
  const visibleTimeline = isToday && !showCompleted ? timeline.filter(t => !isCompleted(t)) : timeline;

  // ── Reminders ────────────────────────────────────────────────────────────
  // Pop-up 10 minutes before anything on today's timeline (meetings and
  // blocks). Browser Notification API: works while the app is open in a
  // desktop/tablet browser; on an iPhone it needs the app added to the home
  // screen. The fired-set stops the 30s tick re-firing the same reminder.
  const notifSupported = typeof window !== "undefined" && "Notification" in window;
  const [notifPermission, setNotifPermission] = useState<string>(
    () => (typeof Notification !== "undefined" ? Notification.permission : "unsupported"),
  );
  const firedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isToday || notifPermission !== "granted") return;
    const LEAD_MIN = 10;
    for (const t of timeline) {
      if (t.kind === "block" && t.block.status !== "planned") continue;
      const minsTo = t.startMin - now;
      if (minsTo <= 0 || minsTo > LEAD_MIN) continue;
      const title = t.kind === "event" ? t.event.title : t.block.title;
      const key = `${dateStr}|${t.startMin}|${title}`;
      if (firedRef.current.has(key)) continue;
      firedRef.current.add(key);
      try {
        const n = new Notification(`${title} — in ${minsTo} min`, {
          body: t.kind === "event"
            ? `${minToTime(t.startMin)} · ${t.event.calendar}${t.event.joinIsCall ? " · join from the planner" : ""}`
            : `${minToTime(t.startMin)} · time block`,
          tag: key,
        });
        n.onclick = () => window.focus();
      } catch {
        // Some platforms expose the API but refuse page-context notifications.
      }
    }
  });

  // Accordion: one pillar open at a time keeps the rail scannable.
  const [openPillarId, setOpenPillarId] = useState<number | null>(null);

  // ── AI replan ────────────────────────────────────────────────────────────
  const [replanOpen, setReplanOpen] = useState(false);
  // Quick-add form visibility + a sensible default start: the next full
  // hour when looking at today, 09:00 for any other day.
  const [addOpen, setAddOpen] = useState(false);
  const defaultAddStartMin = isToday ? Math.min(Math.ceil(now / 60) * 60, 23 * 60) : 9 * 60;
  const [replanPrompt, setReplanPrompt] = useState("");
  const [replanNote, setReplanNote] = useState<string | null>(null);
  const replan = useMutation({
    mutationFn: () =>
      api("/replan", { method: "POST", body: JSON.stringify({ date: dateStr, prompt: replanPrompt.trim() }) }) as Promise<{ explanation: string }>,
    onSuccess: r => {
      setReplanNote(r.explanation);
      setReplanPrompt("");
      setReplanOpen(false);
      invalidate();
    },
    onError: (e: Error) => setReplanNote(e.message),
  });

  // ── Drag-to-move / drag-to-resize commits ────────────────────────────────
  const [timelineBusy, setTimelineBusy] = useState(false);

  async function handleMoveBlock(id: number, newStart: number) {
    const b = blocks.find(x => x.id === id);
    if (!b || timelineBusy) return;
    const dur = b.endMin - b.startMin;
    const start = Math.max(0, Math.min(1440 - dur, newStart));
    setTimelineBusy(true);
    try {
      await api(`/blocks/${id}`, { method: "PATCH", body: JSON.stringify({ startMin: start, endMin: start + dur }) });
    } finally {
      setTimelineBusy(false);
      invalidate();
    }
  }

  // Growing a block pushes later planned blocks down until the overlap
  // clears (cascading); shrinking just leaves a gap.
  async function handleResizeBlock(id: number, newEnd: number) {
    const b = blocks.find(x => x.id === id);
    if (!b || timelineBusy) return;
    const end = Math.max(b.startMin + 5, Math.min(1440, newEnd));
    setTimelineBusy(true);
    try {
      await api(`/blocks/${id}`, { method: "PATCH", body: JSON.stringify({ endMin: end }) });
      if (end > b.endMin) {
        const later = blocks
          .filter(x => x.id !== id && x.status === "planned" && x.startMin >= b.endMin)
          .sort((p, q) => p.startMin - q.startMin);
        let cursor = end;
        for (const x of later) {
          if (x.startMin >= cursor) break;
          const dur = x.endMin - x.startMin;
          const ns = Math.min(cursor, 1440 - dur);
          await api(`/blocks/${x.id}`, { method: "PATCH", body: JSON.stringify({ startMin: ns, endMin: ns + dur }) });
          cursor = ns + dur;
        }
      }
    } finally {
      setTimelineBusy(false);
      invalidate();
    }
  }

  // Recurring rituals attach to the FIRST block of their pillar for the day,
  // so "30-min one-on-one" shows inside the morning Team & Coaching block
  // and simply doesn't appear on days whose template skips the pillar.
  const recurringByBlockId = useMemo(() => {
    const firstBlockForPillar = new Map<number, number>();
    for (const b of blocks) {
      if (b.pillarId != null && !firstBlockForPillar.has(b.pillarId)) {
        firstBlockForPillar.set(b.pillarId, b.id);
      }
    }
    const m = new Map<number, RecurringItem[]>();
    for (const item of data?.recurringItems ?? []) {
      if (!item.dueOnDate) continue;
      const blockId = firstBlockForPillar.get(item.pillarId);
      if (blockId == null) continue;
      if (!m.has(blockId)) m.set(blockId, []);
      m.get(blockId)!.push(item);
    }
    return m;
  }, [blocks, data?.recurringItems]);

  // Tasks land in a block the same way rituals do: an explicit blockId wins,
  // otherwise they fall to the first block of their pillar. Anything with no
  // pillar (or a pillar with no block today) collects in the unassigned tray
  // below the timeline rather than disappearing.
  const tasks = data?.tasks ?? [];
  const { tasksByBlockId, unassignedTasks } = useMemo(() => {
    const firstBlockForPillar = new Map<number, number>();
    for (const b of blocks) {
      if (b.pillarId != null && !firstBlockForPillar.has(b.pillarId)) firstBlockForPillar.set(b.pillarId, b.id);
    }
    const blockIds = new Set(blocks.map(b => b.id));
    const byBlock = new Map<number, Task[]>();
    const loose: Task[] = [];
    for (const t of tasks) {
      const target = t.blockId != null && blockIds.has(t.blockId)
        ? t.blockId
        : t.pillarId != null ? firstBlockForPillar.get(t.pillarId) : undefined;
      if (target == null) { loose.push(t); continue; }
      if (!byBlock.has(target)) byBlock.set(target, []);
      byBlock.get(target)!.push(t);
    }
    return { tasksByBlockId: byBlock, unassignedTasks: loose };
  }, [blocks, tasks]);

  // Done tasks follow the same "show completed" toggle as finished blocks.
  const visibleTask = (t: Task) => showCompleted || t.status === "open";

  if (state.status !== "authenticated" || state.user.email !== FOUNDER_EMAIL) {
    return <Redirect to="/" />;
  }

  return (
    <div className="space-y-6">
      <FounderNav />
      <PageHeader
        title="Founder Focus"
        description="Time-blocked days against the pillars only you can move."
      />

      {/* ── Date navigation ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <button onClick={() => setDateStr(format(addDays(parseISO(dateStr), -1), "yyyy-MM-dd"))}
          className="p-2 rounded-lg border border-border hover:bg-secondary/50" aria-label="Previous day">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 text-center">
          <span className="font-display font-bold text-lg">{format(parseISO(dateStr), "EEEE d MMMM")}</span>
          {!isToday && (
            <button onClick={() => setDateStr(todayStr)} className="ml-3 text-xs text-primary underline hover:no-underline">
              Back to today
            </button>
          )}
        </div>
        {notifSupported && notifPermission === "default" && (
          <button
            onClick={() => Notification.requestPermission().then(setNotifPermission)}
            title="Get a pop-up 10 minutes before meetings and time blocks"
            className="p-2 rounded-lg border border-border hover:bg-secondary/50 text-muted-foreground"
            aria-label="Enable reminders"
          >
            <BellRing className="w-4 h-4" />
          </button>
        )}
        {notifSupported && notifPermission === "denied" && (
          <span title="Notifications are blocked for this site in your browser settings" className="p-2 text-muted-foreground/50">
            <BellOff className="w-4 h-4" />
          </span>
        )}
        <button onClick={() => setDateStr(format(addDays(parseISO(dateStr), 1), "yyyy-MM-dd"))}
          className="p-2 rounded-lg border border-border hover:bg-secondary/50" aria-label="Next day">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* ── Now / Next ──────────────────────────────────────────────────── */}
      {isToday && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NowNextCard label="Now" item={currentItem} pillarById={pillarById} now={now}
            empty={timeline.length === 0 ? "No plan yet — block the day out below." : "Nothing blocked right now."} />
          <NowNextCard label="Next" item={nextItem} pillarById={pillarById} now={now}
            empty="Nothing else planned today." />
        </div>
      )}

      {/* ── All-day + calendar warnings ─────────────────────────────────── */}
      {allDayEvents.length > 0 && (
        <div className="rounded-xl border border-border bg-secondary/30 px-4 py-2.5 text-sm flex items-center gap-2 flex-wrap">
          <CalendarDays className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          {allDayEvents.map((e, i) => (
            <span key={i} className="font-medium">
              {e.title}
              <span className="text-muted-foreground font-normal text-xs ml-1">({e.calendar})</span>
              {i < allDayEvents.length - 1 && <span className="text-muted-foreground"> · </span>}
            </span>
          ))}
        </div>
      )}
      {dayEvents?.calendarError && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-400">
          Apple Calendar unavailable: {dayEvents.calendarError}
        </div>
      )}

      {/* ── Two columns on wide screens: the day on the left, planning
             tools on the right; stacked on tablet/mobile. ─────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px] gap-6 items-start">
      <div className="space-y-6 min-w-0">

      {/* ── Day blocks ──────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-primary" /> Time blocks
          </h2>
          <div className="flex items-center gap-2">
            {completedCount > 0 && (
              <button
                onClick={() => setShowCompleted(s => !s)}
                className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary/50 flex items-center gap-1.5 text-muted-foreground"
              >
                {showCompleted ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                {showCompleted ? "Hide completed" : `Show completed (${completedCount})`}
              </button>
            )}
            <button
              onClick={() => setAddOpen(o => !o)}
              className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary/50 flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> Add block
            </button>
            <button
              onClick={() => applyTemplate.mutate()}
              disabled={applyTemplate.isPending || (data?.templates.length ?? 0) === 0}
              title={(data?.templates.length ?? 0) === 0 ? "No template rows for this weekday yet — add some below." : undefined}
              className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary/50 disabled:opacity-50 flex items-center gap-1.5"
            >
              <LayoutTemplate className="w-3.5 h-3.5" /> Fill from template
            </button>
            <button
              onClick={() => { setReplanOpen(o => !o); setReplanNote(null); }}
              className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" /> Replan with AI
            </button>
          </div>
        </div>

        {/* ── Add a task ───────────────────────────────────────────────────
            The main way things get onto the day. Type it, let the AI say
            where it belongs, confirm or override, done. */}
        <QuickAddTask
          pillars={data?.pillars ?? []}
          blocks={blocks}
          dateStr={dateStr}
          pending={addTask.isPending}
          onAdd={t => addTask.mutate(t)}
          onAddRecurring={(pillarId, title) => addRecurring.mutate({ pillarId, title })}
        />

        {/* Yesterday's unfinished work, surfaced once so it gets rescheduled
            deliberately instead of rolling forward on its own. */}
        {(data?.overdueTasks.length ?? 0) > 0 && (
          <OverdueStrip
            tasks={data!.overdueTasks}
            pillarById={pillarById}
            todayStr={todayStr}
            onReschedule={(id, date) => patchTask.mutate({ id, date })}
            onDone={id => patchTask.mutate({ id, status: "done" })}
            onDrop={id => deleteTask.mutate(id)}
          />
        )}

        {/* Quick manual add — no AI, no template: pick times, pillar or
            title, done. Lives at the TOP of the section so it's findable
            (the old copy at the bottom of a full day's timeline was
            effectively invisible). Pre-fills the next full hour. */}
        {addOpen && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
            <AddBlockForm
              pillars={data?.pillars ?? []}
              pending={addBlock.isPending}
              defaultStartMin={defaultAddStartMin}
              onAdd={(startMin, endMin, pillarId, title) =>
                addBlock.mutate({ date: dateStr, startMin, endMin, pillarId, ...(title ? { title } : {}) })}
            />
          </div>
        )}

        {replanOpen && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
            <textarea
              value={replanPrompt}
              onChange={e => setReplanPrompt(e.target.value)}
              placeholder={'e.g. "Finishing at midday today — fit in two hours of sales & marketing before I go."'}
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-y"
              autoFocus
            />
            <div className="flex items-center gap-2 justify-end">
              <span className="text-xs text-muted-foreground mr-auto">
                Meetings and anything already done stay put — only the rest of the day is rearranged.
              </span>
              <button onClick={() => setReplanOpen(false)} className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary/50">
                Cancel
              </button>
              <button
                onClick={() => replan.mutate()}
                disabled={replan.isPending || !replanPrompt.trim()}
                className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
              >
                {replan.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {replan.isPending ? "Replanning…" : "Replan"}
              </button>
            </div>
          </div>
        )}
        {replanNote && (
          <div className="rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm flex items-start gap-2">
            <Sparkles className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
            <span className="flex-1">{replanNote}</span>
            <button onClick={() => setReplanNote(null)} className="p-1 text-muted-foreground" aria-label="Dismiss">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">No blocks for this day yet.</p>
        ) : visibleTimeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">Everything's done or wrapped up — nice. Toggle "Show completed" to review the day.</p>
        ) : (
          <DayTimeline
            items={visibleTimeline}
            pillarById={pillarById}
            recurringByBlockId={recurringByBlockId}
            tasksByBlockId={tasksByBlockId}
            showTask={visibleTask}
            isToday={isToday}
            now={now}
            busy={timelineBusy}
            onMove={handleMoveBlock}
            onResize={handleResizeBlock}
            onToggleDone={b => patchBlock.mutate({ id: b.id, status: b.status === "done" ? "planned" : "done" })}
            onSkip={b => patchBlock.mutate({ id: b.id, status: "skipped" })}
            onDelete={id => deleteBlock.mutate(id)}
            onTickRecurring={(id, ticked) => tickRecurring.mutate({ id, ticked })}
            onToggleGoal={(id, done) => patchGoal.mutate({ id, status: done ? "done" : "active" })}
            onToggleTask={(id, done) => patchTask.mutate({ id, status: done ? "done" : "open" })}
            onDeleteTask={id => deleteTask.mutate(id)}
            onAddTaskToBlock={(block, title) =>
              addTask.mutate({ title, date: dateStr, pillarId: block.pillarId, blockId: block.id })}
          />
        )}

        {/* Tasks with no pillar, or whose pillar has no block today. They'd
            otherwise be invisible — the timeline has nowhere to draw them. */}
        {unassignedTasks.filter(visibleTask).length > 0 && (
          <div className="rounded-xl border border-border bg-secondary/20 p-3 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <CircleDashed className="w-3.5 h-3.5" /> Not in a block yet
            </p>
            {unassignedTasks.filter(visibleTask).map(t => (
              <TaskRow key={t.id} task={t}
                pillar={t.pillarId != null ? pillarById.get(t.pillarId) : undefined}
                onToggle={done => patchTask.mutate({ id: t.id, status: done ? "done" : "open" })}
                onDelete={() => deleteTask.mutate(t.id)}
              />
            ))}
          </div>
        )}

      </section>

      {/* ── Weekly template (edits like a normal day once opened) ───────── */}
      <TemplateEditor
        pillars={data?.pillars ?? []}
        pendingAdd={addTemplateRow.isPending}
        onAdd={row => addTemplateRow.mutate(row)}
        onDelete={id => deleteTemplateRow.mutate(id)}
      />

      </div>{/* end main column */}
      <div className="space-y-6 min-w-0">

      {/* ── North Star (moonshot → mission → stepping stones) ───────────── */}
      <NorthStarCard objectives={data?.objectives ?? []} />

      {/* ── Parking lot ─────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Inbox className="w-4 h-4 text-primary" /> Parking lot
          <span className="text-xs font-normal text-muted-foreground">— things pulling at you; write them down, stay on the block</span>
        </h2>
        <ParkingInput pending={addParking.isPending} onAdd={t => addParking.mutate(t)} />
        {(data?.parkingLot.length ?? 0) > 0 && (
          <ul className="space-y-1.5">
            {data!.parkingLot.map(item => (
              <li key={item.id} className="flex items-center gap-2 text-sm rounded-lg bg-secondary/30 px-3 py-2">
                <span className="flex-1">{item.text}</span>
                <button onClick={() => resolveParking.mutate(item.id)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10"
                  title="Resolve — dealt with or planned" aria-label="Resolve item">
                  <Check className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Pillars & goals ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Target className="w-4 h-4 text-primary" /> Pillars &amp; goals
        </h2>
        {(data?.pillars ?? []).map(p => (
          <PillarCard key={p.id} pillar={p}
            open={openPillarId === p.id}
            onToggle={() => setOpenPillarId(id => (id === p.id ? null : p.id))}
            recurring={(data?.recurringItems ?? []).filter(r => r.pillarId === p.id)}
            onAddGoal={(title, url) => addGoal.mutate({ pillarId: p.id, title, ...(url ? { url } : {}) })}
            onEditGoal={(id, title, url) => patchGoal.mutate({ id, title, url })}
            onToggleGoal={g => patchGoal.mutate({ id: g.id, status: g.status === "done" ? "active" : "done" })}
            onDeleteGoal={id => deleteGoal.mutate(id)}
            onAddRecurring={r => addRecurring.mutate({ pillarId: p.id, ...r })}
            onEditRecurring={(id, title, url) => patchRecurring.mutate({ id, title, url })}
            onDeleteRecurring={id => deleteRecurring.mutate(id)}
            onRename={name => patchPillar.mutate({ id: p.id, name })}
            onTarget={pct => patchPillar.mutate({ id: p.id, targetSharePct: pct })}
            onArchive={() => patchPillar.mutate({ id: p.id, archived: true })}
          />
        ))}
        <AddPillarForm pending={addPillar.isPending} onAdd={(name, color) => addPillar.mutate({ name, color })} />
      </section>

      {/* ── Apple Calendar connection ───────────────────────────────────── */}
      <AppleCalendarCard />

      </div>{/* end right rail */}
      </div>{/* end two-column grid */}
    </div>
  );
}

// Generic list-of-objectives section (used for the Mission's multiple goals).
function ObjectiveList({ label, sub, horizon, items, placeholder, onChanged }: {
  label: string; sub: string;
  horizon: Objective["horizon"];
  items: Objective[];
  placeholder: string;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState("");
  async function add() {
    if (!draft.trim()) return;
    await api("/objectives", { method: "POST", body: JSON.stringify({ horizon, title: draft.trim() }) });
    setDraft("");
    onChanged();
  }
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground mb-1.5">
        {label} <span className="font-normal normal-case">— {sub}</span>
      </p>
      <ul className="space-y-1.5">
        {items.map(o => (
          <li key={o.id} className="flex items-center gap-2 text-sm group">
            <button
              onClick={async () => { await api(`/objectives/${o.id}`, { method: "PATCH", body: JSON.stringify({ achieved: !o.achieved }) }); onChanged(); }}
              className={cn(
                "w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                o.achieved ? "bg-primary border-primary text-primary-foreground" : "border-border hover:border-primary",
              )}
              aria-label={o.achieved ? "Mark not achieved" : "Mark achieved"}
            >
              {o.achieved && <Check className="w-3 h-3" />}
            </button>
            <span className={cn("flex-1 min-w-0", o.achieved && "line-through text-muted-foreground")}>{o.title}</span>
            <button
              onClick={async () => { await api(`/objectives/${o.id}`, { method: "DELETE" }); onChanged(); }}
              className="p-1 rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
              aria-label={`Delete ${label.toLowerCase()} goal`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2 mt-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") add(); }}
          placeholder={placeholder}
          className="flex-1 px-2.5 py-1.5 rounded-lg border border-border bg-background text-sm"
        />
        <button onClick={add} disabled={!draft.trim()}
          className="px-2.5 py-1.5 rounded-lg border border-border text-sm hover:bg-secondary/50 disabled:opacity-50" aria-label={`Add ${label.toLowerCase()} goal`}>
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ── North Star card ────────────────────────────────────────────────────────
// The top of the goal pyramid: Moonshot (10yr) → Mission (3–5yr) →
// Stepping Stones (~3 months, measurable). Fed to the AI replanner so
// daily prioritisation is pulled by these, not just the week's template.
function NorthStarCard({ objectives }: { objectives: Objective[] }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["founder-focus"] });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [stoneTitle, setStoneTitle] = useState("");
  const [stoneMetric, setStoneMetric] = useState("");

  const moonshot = objectives.find(o => o.horizon === "moonshot");
  const stones = objectives.filter(o => o.horizon === "stepping_stone");

  async function save(horizon: Objective["horizon"], existing: Objective | undefined, title: string) {
    const t = title.trim();
    if (!t) return;
    if (existing) {
      await api(`/objectives/${existing.id}`, { method: "PATCH", body: JSON.stringify({ title: t }) });
    } else {
      await api("/objectives", { method: "POST", body: JSON.stringify({ horizon, title: t }) });
    }
    invalidate();
  }

  async function addStone() {
    if (!stoneTitle.trim()) return;
    await api("/objectives", {
      method: "POST",
      body: JSON.stringify({ horizon: "stepping_stone", title: stoneTitle.trim(), metric: stoneMetric.trim() || null }),
    });
    setStoneTitle(""); setStoneMetric("");
    invalidate();
  }

  const singleRow = (label: string, sub: string, horizon: Objective["horizon"], existing: Objective | undefined) => {
    const key = horizon;
    const value = drafts[key] ?? existing?.title ?? "";
    return (
      <div>
        <p className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">
          {label} <span className="font-normal normal-case">— {sub}</span>
        </p>
        <input
          value={value}
          onChange={e => setDrafts(d => ({ ...d, [key]: e.target.value }))}
          onBlur={() => { if ((drafts[key] ?? "") && drafts[key] !== existing?.title) save(horizon, existing, drafts[key]!); }}
          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          placeholder={horizon === "moonshot" ? "The 10-year moonshot…" : "The 3–5 year mission…"}
          className="w-full mt-0.5 bg-transparent border-b border-border focus:border-primary outline-none py-1 text-sm font-medium"
        />
        {existing?.metric && (
          <span className="inline-block mt-1 text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{existing.metric}</span>
        )}
      </div>
    );
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <Target className="w-4 h-4 text-primary" /> North Star
      </h2>
      {singleRow("Moonshot", "10 years", "moonshot", moonshot)}
      <ObjectiveList
        label="Mission" sub="3–5 years"
        horizon="mission"
        items={objectives.filter(o => o.horizon === "mission")}
        placeholder="Add a 3–5 year goal…"
        onChanged={invalidate}
      />

      <div>
        <p className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground mb-1.5">
          Stepping stones <span className="font-normal normal-case">— next ~3 months, measurable</span>
        </p>
        <ul className="space-y-1.5">
          {stones.map(s => (
            <li key={s.id} className="flex items-center gap-2 text-sm group">
              <button
                onClick={async () => { await api(`/objectives/${s.id}`, { method: "PATCH", body: JSON.stringify({ achieved: !s.achieved }) }); invalidate(); }}
                className={cn(
                  "w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                  s.achieved ? "bg-primary border-primary text-primary-foreground" : "border-border hover:border-primary",
                )}
                aria-label={s.achieved ? "Mark not achieved" : "Mark achieved"}
              >
                {s.achieved && <Check className="w-3 h-3" />}
              </button>
              <span className={cn("flex-1 min-w-0", s.achieved && "line-through text-muted-foreground")}>
                {s.title}
                {s.metric && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary whitespace-nowrap">{s.metric}</span>}
              </span>
              <button
                onClick={async () => { await api(`/objectives/${s.id}`, { method: "DELETE" }); invalidate(); }}
                className="p-1 rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
                aria-label="Delete stepping stone"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2 mt-2">
          <input
            value={stoneTitle}
            onChange={e => setStoneTitle(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") addStone(); }}
            placeholder="Add a stepping stone…"
            className="flex-1 min-w-[150px] px-2.5 py-1.5 rounded-lg border border-border bg-background text-sm"
          />
          <input
            value={stoneMetric}
            onChange={e => setStoneMetric(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") addStone(); }}
            placeholder="Metric (e.g. £120k/mo)"
            className="w-36 px-2.5 py-1.5 rounded-lg border border-border bg-background text-sm"
          />
          <button onClick={addStone} disabled={!stoneTitle.trim()}
            className="px-2.5 py-1.5 rounded-lg border border-border text-sm hover:bg-secondary/50 disabled:opacity-50" aria-label="Add stepping stone">
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        The AI replanner reads these — days get prioritised toward the stepping stones.
      </p>
    </section>
  );
}

// ── Now / Next card ────────────────────────────────────────────────────────
type TimelineCardItem =
  | { kind: "block"; startMin: number; endMin: number; block: Block }
  | { kind: "event"; startMin: number; endMin: number; event: CalEvent };

function NowNextCard({ label, item, pillarById, now, empty }: {
  label: string;
  item: TimelineCardItem | undefined;
  pillarById: Map<number, Pillar>;
  now: number;
  empty: string;
}) {
  const pillar = item?.kind === "block" && item.block.pillarId != null ? pillarById.get(item.block.pillarId) : undefined;
  const color = item?.kind === "event" ? "#64748b" : (pillar?.color ?? DEFAULT_PILLAR_COLOR);
  const title = item?.kind === "event" ? item.event.title : item?.block.title;
  const tag = item?.kind === "event" ? `${item.event.calendar} · diary` : pillar?.name;
  return (
    <div className="rounded-2xl border border-border bg-card p-4"
      style={item ? { borderTop: `4px solid ${color}` } : undefined}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1.5">
        {label === "Now" ? <Play className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} {label}
      </p>
      {item ? (
        <>
          <p className="font-display font-bold text-lg leading-tight mt-1">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {minToTime(item.startMin)}–{minToTime(item.endMin)}
            {label === "Now" && <span className="ml-1.5 font-medium text-foreground">· {item.endMin - now} min left</span>}
            {tag && <span className="ml-1.5" style={{ color }}>{tag}</span>}
          </p>
          {item.kind === "event" && item.event.joinUrl && (
            <a
              href={item.event.joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "mt-2 inline-flex px-3 py-1.5 rounded-lg text-xs font-medium items-center gap-1.5",
                item.event.joinIsCall
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "border border-border hover:bg-secondary/50 text-muted-foreground",
              )}
            >
              {item.event.joinIsCall ? <Video className="w-3.5 h-3.5" /> : <ExternalLink className="w-3.5 h-3.5" />}
              {item.event.joinIsCall ? "Join call" : "Open link"}
            </a>
          )}
          {/* The Numbers Check block IS the numbers page — link straight
              there so the check starts with one tap from the schedule. */}
          {item.kind === "block" && /\bnumbers?\b/i.test(`${item.block.title} ${pillar?.name ?? ""}`) && (
            <Link
              href="/founder/numbers"
              className="mt-2 inline-flex px-3 py-1.5 rounded-lg text-xs font-medium items-center gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <LineChart className="w-3.5 h-3.5" /> Open Numbers
            </Link>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground mt-1.5">{empty}</p>
      )}
    </div>
  );
}

// ── Apple Calendar connection card ─────────────────────────────────────────
function AppleCalendarCard() {
  const queryClient = useQueryClient();
  const { data: status } = useQuery<CaldavStatus>({
    queryKey: ["founder-focus-caldav"],
    queryFn: () => api("/caldav"),
    staleTime: 5 * 60 * 1000,
  });
  const [appleId, setAppleId] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const connect = useMutation({
    mutationFn: () => api("/caldav", { method: "POST", body: JSON.stringify({ appleId: appleId.trim(), appPassword: appPassword.trim() }) }),
    onSuccess: () => {
      setAppPassword("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["founder-focus-caldav"] });
      queryClient.invalidateQueries({ queryKey: ["founder-focus"] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const disconnect = useMutation({
    mutationFn: () => api("/caldav", { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["founder-focus-caldav"] });
      queryClient.invalidateQueries({ queryKey: ["founder-focus"] });
    },
  });
  const saveCalendarToggles = useMutation({
    mutationFn: (enabledUrls: string[]) =>
      api("/caldav/calendars", { method: "PUT", body: JSON.stringify({ enabledUrls }) }),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["founder-focus-caldav"] });
      queryClient.invalidateQueries({ queryKey: ["founder-focus"] });
    },
    // A silently-failed save looks like the toggle "not sticking" next
    // session — surface it in the card instead.
    onError: (e: Error) => setError(`Calendar choice didn't save: ${e.message}`),
  });

  function toggleCalendar(cal: CaldavCalendar) {
    const calendars = status?.calendars ?? [];
    const enabledUrls = calendars
      .filter(c => (c.url === cal.url ? !c.enabled : c.enabled))
      .map(c => c.url);
    saveCalendarToggles.mutate(enabledUrls);
  }

  const inputCls = "px-2.5 py-2 rounded-lg border border-border bg-background text-sm";

  return (
    <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <CalendarDays className="w-4 h-4 text-primary" /> Apple Calendar
      </h2>
      {status?.configured ? (
        <>
          <p className="text-sm">Connected as <b>{status.appleId}</b></p>
          {status.calendars && status.calendars.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">
                Tap a calendar to show or hide it in the day view. New calendars you create in Apple stay hidden until you switch them on here.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {status.calendars.map(c => (
                  <button
                    key={c.url}
                    onClick={() => toggleCalendar(c)}
                    disabled={saveCalendarToggles.isPending}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors flex items-center gap-1.5 disabled:opacity-60",
                      c.enabled
                        ? "bg-primary/10 border-primary/40 text-primary"
                        : "bg-secondary/40 border-border text-muted-foreground line-through",
                    )}
                    aria-pressed={c.enabled}
                  >
                    {c.enabled ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    {c.name}
                  </button>
                ))}
              </div>
            </>
          )}
          {status.error && (
            <p className="text-sm text-amber-700 dark:text-amber-400">{status.error}</p>
          )}
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <button onClick={() => disconnect.mutate()} disabled={disconnect.isPending}
            className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-destructive/10 hover:text-destructive disabled:opacity-50">
            Disconnect
          </button>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Read-only: meetings appear in the day view; nothing is ever written to your calendar.
            Use an <b>app-specific password</b> from account.apple.com (Sign-In &amp; Security → App-Specific
            Passwords), never your real Apple ID password. Generate a fresh one — if a password has ever been
            shared anywhere else (a chat, a note), revoke it first.
          </p>
          <div className="flex flex-wrap gap-2">
            <input value={appleId} onChange={e => setAppleId(e.target.value)} placeholder="Apple ID email"
              type="email" autoComplete="off" className={inputCls + " flex-1 min-w-[200px]"} />
            <input value={appPassword} onChange={e => setAppPassword(e.target.value)} placeholder="xxxx-xxxx-xxxx-xxxx"
              type="password" autoComplete="off" className={inputCls + " flex-1 min-w-[180px] font-mono"} />
            <button
              onClick={() => connect.mutate()}
              disabled={connect.isPending || !appleId.trim() || appPassword.trim().length < 8}
              className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
              {connect.isPending ? "Connecting…" : "Connect"}
            </button>
          </div>
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </>
      )}
    </section>
  );
}

// ── Add block form ─────────────────────────────────────────────────────────
// The pillar IS the block: pick a pillar and a time range and go. The title
// is an optional override for one-offs that don't fit a pillar.
function AddBlockForm({ pillars, pending, onAdd, defaultStartMin }: {
  pillars: Pillar[];
  pending: boolean;
  onAdd: (startMin: number, endMin: number, pillarId: number | null, title: string | null) => void;
  defaultStartMin?: number;
}) {
  const minToTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const s0 = defaultStartMin ?? 9 * 60;
  const [start, setStart] = useState(minToTime(s0));
  const [end, setEnd] = useState(minToTime(Math.min(s0 + 60, 1440)));
  const [title, setTitle] = useState("");
  const [pillarId, setPillarId] = useState<string>("");

  const canSubmit = !!pillarId || !!title.trim();

  function submit() {
    const s = timeToMin(start);
    const e = timeToMin(end);
    if (s == null || e == null || e <= s || !canSubmit) return;
    onAdd(s, e, pillarId ? Number(pillarId) : null, title.trim() || null);
    setTitle("");
  }

  const inputCls = "px-2.5 py-2 rounded-lg border border-border bg-background text-sm";

  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <input type="time" value={start} onChange={e => setStart(e.target.value)} className={inputCls} aria-label="Start time" />
      <span className="text-muted-foreground text-sm">–</span>
      <input type="time" value={end} onChange={e => setEnd(e.target.value)} className={inputCls} aria-label="End time" />
      <select value={pillarId} onChange={e => setPillarId(e.target.value)} className={inputCls + " flex-1 min-w-[140px]"} aria-label="Pillar">
        <option value="">Pick a pillar…</option>
        {pillars.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") submit(); }}
        placeholder="Title (optional)"
        className={inputCls + " flex-1 min-w-[120px]"}
      />
      <button onClick={submit} disabled={pending || !canSubmit}
        className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5">
        <Plus className="w-4 h-4" /> Add
      </button>
    </div>
  );
}

// ── Parking input ──────────────────────────────────────────────────────────
function ParkingInput({ pending, onAdd }: { pending: boolean; onAdd: (text: string) => void }) {
  const [text, setText] = useState("");
  function submit() {
    if (!text.trim()) return;
    onAdd(text.trim());
    setText("");
  }
  return (
    <div className="flex gap-2">
      <input
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") submit(); }}
        placeholder="It can wait — park it…"
        className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm"
      />
      <button onClick={submit} disabled={pending || !text.trim()}
        className="px-3 py-2 rounded-lg border border-border text-sm hover:bg-secondary/50 disabled:opacity-50">
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}

// ── Pillar card (accordion) ────────────────────────────────────────────────
function PillarCard({ pillar, open, onToggle, recurring, onAddGoal, onEditGoal, onToggleGoal, onDeleteGoal, onAddRecurring, onEditRecurring, onDeleteRecurring, onRename, onTarget, onArchive }: {
  pillar: Pillar;
  open: boolean;
  onToggle: () => void;
  recurring: RecurringItem[];
  onAddGoal: (title: string, url: string | null) => void;
  onEditGoal: (id: number, title: string, url: string | null) => void;
  onToggleGoal: (g: Goal) => void;
  onDeleteGoal: (id: number) => void;
  onAddRecurring: (r: { title: string; url?: string; schedule: RecurringSchedule; scheduleDay?: number | null }) => void;
  onEditRecurring: (id: number, title: string, url: string | null) => void;
  onDeleteRecurring: (id: number) => void;
  onRename: (name: string) => void;
  onTarget: (pct: number | null) => void;
  onArchive: () => void;
}) {
  const [newGoal, setNewGoal] = useState("");
  const [newGoalUrl, setNewGoalUrl] = useState("");
  const [newRecurring, setNewRecurring] = useState("");
  const [newRecurringUrl, setNewRecurringUrl] = useState("");
  const [newRecurringSchedule, setNewRecurringSchedule] = useState<RecurringSchedule>("daily");
  const [newRecurringDay, setNewRecurringDay] = useState(1); // Monday
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(pillar.name);
  const color = pillar.color ?? DEFAULT_PILLAR_COLOR;
  const activeGoals = pillar.goals.filter(g => g.status !== "done");
  const doneGoals = pillar.goals.filter(g => g.status === "done");

  function submitGoal() {
    if (!newGoal.trim()) return;
    onAddGoal(newGoal.trim(), newGoalUrl.trim() || null);
    setNewGoal("");
    setNewGoalUrl("");
  }

  function submitRecurring() {
    if (!newRecurring.trim()) return;
    onAddRecurring({
      title: newRecurring.trim(),
      ...(newRecurringUrl.trim() ? { url: newRecurringUrl.trim() } : {}),
      schedule: newRecurringSchedule,
      scheduleDay: newRecurringSchedule === "weekly" || newRecurringSchedule === "biweekly" ? newRecurringDay : null,
    });
    setNewRecurring("");
    setNewRecurringUrl("");
  }

  return (
    <div className="rounded-2xl border border-border bg-card" style={{ borderLeft: `5px solid ${color}` }}>
      {/* Accordion header — always visible, summarises what's inside */}
      <button onClick={onToggle} className="w-full flex items-center gap-2 p-4 text-left" aria-expanded={open}>
        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color }} />
        <h3 className="font-semibold text-sm flex-1 min-w-0 truncate">{pillar.name}</h3>
        <span className="text-xs text-muted-foreground flex-shrink-0">
          {activeGoals.length} goal{activeGoals.length !== 1 ? "s" : ""}
          {recurring.length > 0 && ` · ${recurring.length} daily`}
          {pillar.targetSharePct != null && ` · ${pillar.targetSharePct}%`}
        </span>
        <ChevronRight className={cn("w-4 h-4 text-muted-foreground transition-transform flex-shrink-0", open && "rotate-90")} />
      </button>

      {open && (
      <div className="px-4 pb-4 space-y-3">
      <div className="flex items-center gap-2">
        {editingName ? (
          <span className="flex items-center gap-1.5 flex-1">
            <input value={nameDraft} onChange={e => setNameDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && nameDraft.trim()) { onRename(nameDraft.trim()); setEditingName(false); } }}
              className="px-2 py-1 rounded-md border border-border bg-background text-sm font-semibold flex-1" autoFocus />
            <button onClick={() => { if (nameDraft.trim()) { onRename(nameDraft.trim()); } setEditingName(false); }}
              className="p-1 text-primary" aria-label="Save name"><Check className="w-4 h-4" /></button>
            <button onClick={() => { setNameDraft(pillar.name); setEditingName(false); }}
              className="p-1 text-muted-foreground" aria-label="Cancel rename"><X className="w-4 h-4" /></button>
          </span>
        ) : (
          <button onClick={() => { setNameDraft(pillar.name); setEditingName(true); }}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary/50 flex items-center gap-1.5 text-xs" aria-label="Rename pillar">
            <Pencil className="w-3.5 h-3.5" /> Rename
          </button>
        )}
        <span className="flex-1" />
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input
            type="number" min={0} max={100}
            defaultValue={pillar.targetSharePct ?? ""}
            onBlur={e => {
              const v = e.target.value === "" ? null : Math.max(0, Math.min(100, Number(e.target.value)));
              if (v !== pillar.targetSharePct) onTarget(v);
            }}
            className="w-14 px-1.5 py-1 rounded-md border border-border bg-background text-right"
            aria-label="Target share of week (%)"
          />
          %
        </label>
        <button onClick={onArchive} className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          title="Archive pillar (goals kept, hidden from view)" aria-label="Archive pillar">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {pillar.notes && <p className="text-xs text-muted-foreground">{pillar.notes}</p>}

      <ul className="space-y-1">
        {activeGoals.map(g => (
          <EditableGoalRow key={g.id} goal={g} done={false}
            onToggle={() => onToggleGoal(g)}
            onSave={(title, url) => onEditGoal(g.id, title, url)}
            onDelete={() => onDeleteGoal(g.id)} />
        ))}
        {doneGoals.map(g => (
          <EditableGoalRow key={g.id} goal={g} done
            onToggle={() => onToggleGoal(g)}
            onSave={(title, url) => onEditGoal(g.id, title, url)}
            onDelete={() => onDeleteGoal(g.id)} />
        ))}
      </ul>

      <div className="space-y-1.5">
        <div className="flex gap-2">
          <input
            value={newGoal}
            onChange={e => setNewGoal(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") submitGoal(); }}
            placeholder="Add a goal…"
            className="flex-1 px-2.5 py-1.5 rounded-lg border border-border bg-background text-sm"
          />
          <button onClick={submitGoal} disabled={!newGoal.trim()}
            className="px-2.5 py-1.5 rounded-lg border border-border text-sm hover:bg-secondary/50 disabled:opacity-50" aria-label="Add goal">
            <Plus className="w-4 h-4" />
          </button>
        </div>
        {newGoal.trim() && (
          <input
            value={newGoalUrl}
            onChange={e => setNewGoalUrl(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") submitGoal(); }}
            placeholder="Link URL (optional) — e.g. your Meta ads dashboard"
            className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-background text-xs"
          />
        )}
      </div>

      {/* Recurring rituals — tickable inside this pillar's time block on the
          days their schedule falls */}
      <div className="pt-1 border-t border-border/60 space-y-1.5">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1">
          <Repeat className="w-3 h-3" /> Recurring
        </p>
        {recurring.map(r => (
          <EditableRecurringRow key={r.id} item={r}
            onSave={(title, url) => onEditRecurring(r.id, title, url)}
            onDelete={() => onDeleteRecurring(r.id)} />
        ))}
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <input
              value={newRecurring}
              onChange={e => setNewRecurring(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") submitRecurring(); }}
              placeholder="Add a recurring item…"
              className="flex-1 px-2.5 py-1.5 rounded-lg border border-border bg-background text-sm"
            />
            <button
              onClick={submitRecurring}
              disabled={!newRecurring.trim()}
              className="px-2.5 py-1.5 rounded-lg border border-border text-sm hover:bg-secondary/50 disabled:opacity-50" aria-label="Add recurring item">
              <Plus className="w-4 h-4" />
            </button>
          </div>
          {newRecurring.trim() && (
            <div className="flex flex-wrap gap-2">
              <select
                value={newRecurringSchedule}
                onChange={e => setNewRecurringSchedule(e.target.value as RecurringSchedule)}
                className="px-2 py-1.5 rounded-lg border border-border bg-background text-xs"
                aria-label="Repeats"
              >
                <option value="daily">Every day</option>
                <option value="weekdays">Weekdays (Mon–Fri)</option>
                <option value="weekly">Every week on…</option>
                <option value="biweekly">Every 2nd week on…</option>
              </select>
              {(newRecurringSchedule === "weekly" || newRecurringSchedule === "biweekly") && (
                <select
                  value={newRecurringDay}
                  onChange={e => setNewRecurringDay(Number(e.target.value))}
                  className="px-2 py-1.5 rounded-lg border border-border bg-background text-xs"
                  aria-label="Day of week"
                >
                  {[1, 2, 3, 4, 5, 6, 0].map(d => <option key={d} value={d}>{DAY_NAMES[d]}</option>)}
                </select>
              )}
              <input
                value={newRecurringUrl}
                onChange={e => setNewRecurringUrl(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") submitRecurring(); }}
                placeholder="Link URL (optional)"
                className="flex-1 min-w-[140px] px-2.5 py-1.5 rounded-lg border border-border bg-background text-xs"
              />
            </div>
          )}
        </div>
      </div>
      </div>
      )}
    </div>
  );
}

// ── Add pillar ─────────────────────────────────────────────────────────────
const PILLAR_COLORS = ["#7cb342", "#3b82f6", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6", "#ec4899"];

function AddPillarForm({ pending, onAdd }: { pending: boolean; onAdd: (name: string, color: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PILLAR_COLORS[4]);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="w-full rounded-2xl border border-dashed border-border p-3 text-sm text-muted-foreground hover:bg-secondary/30 flex items-center justify-center gap-2">
        <Plus className="w-4 h-4" /> Add pillar
      </button>
    );
  }
  return (
    <div className="rounded-2xl border border-border bg-card p-4 flex flex-wrap items-center gap-2">
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Pillar name"
        className="flex-1 min-w-[160px] px-2.5 py-2 rounded-lg border border-border bg-background text-sm" autoFocus />
      <div className="flex gap-1.5">
        {PILLAR_COLORS.map(c => (
          <button key={c} onClick={() => setColor(c)}
            className={cn("w-6 h-6 rounded-full", color === c && "ring-2 ring-offset-2 ring-foreground/40")}
            style={{ background: c }} aria-label={`Colour ${c}`} />
        ))}
      </div>
      <button
        onClick={() => { if (name.trim()) { onAdd(name.trim(), color); setName(""); setOpen(false); } }}
        disabled={pending || !name.trim()}
        className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
        Add
      </button>
      <button onClick={() => setOpen(false)} className="p-2 text-muted-foreground" aria-label="Cancel">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// ── Weekly template editor ─────────────────────────────────────────────────
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Display order Mon..Sun ↔ JS getDay() values 1..6,0
const WEEKDAY_VALUES = [1, 2, 3, 4, 5, 6, 0];

function TemplateEditor({ pillars, pendingAdd, onAdd, onDelete }: {
  pillars: Pillar[];
  pendingAdd: boolean;
  onAdd: (row: { weekday: number; startMin: number; endMin: number; title?: string; pillarId: number | null }) => void;
  onDelete: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dayIdx, setDayIdx] = useState(0);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [title, setTitle] = useState("");
  const [pillarId, setPillarId] = useState<string>("");

  const weekday = WEEKDAY_VALUES[dayIdx];

  const { data: allRows } = useQuery<TemplateRow[]>({
    queryKey: ["founder-focus-templates"],
    queryFn: () => api("/templates"),
    enabled: open,
  });
  const queryClient = useQueryClient();
  const rows = (allRows ?? []).filter(r => r.weekday === weekday);

  const copyDay = useMutation({
    mutationFn: () => api("/templates/copy-day", {
      method: "POST",
      body: JSON.stringify({ fromWeekday: weekday, toWeekdays: [1, 2, 3, 4, 5] }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["founder-focus-templates"] });
      queryClient.invalidateQueries({ queryKey: ["founder-focus"] });
    },
  });

  function submit() {
    const s = timeToMin(start);
    const e = timeToMin(end);
    if (s == null || e == null || e <= s || (!pillarId && !title.trim())) return;
    onAdd({ weekday, startMin: s, endMin: e, ...(title.trim() ? { title: title.trim() } : {}), pillarId: pillarId ? Number(pillarId) : null });
    setTitle("");
    // templates list is a separate query from the day overview
    setTimeout(() => queryClient.invalidateQueries({ queryKey: ["founder-focus-templates"] }), 300);
  }

  // Template rows edit exactly like a day: drag to move, drag the bottom
  // edge to resize. Same endpoint family, no ripple (a template is sparse).
  const [templateBusy, setTemplateBusy] = useState(false);
  function invalidateTemplates() {
    queryClient.invalidateQueries({ queryKey: ["founder-focus-templates"] });
    queryClient.invalidateQueries({ queryKey: ["founder-focus"] });
  }
  async function moveRow(id: number, newStart: number) {
    const r = rows.find(x => x.id === id);
    if (!r || templateBusy) return;
    const dur = r.endMin - r.startMin;
    const s = Math.max(0, Math.min(1440 - dur, newStart));
    setTemplateBusy(true);
    try {
      await api(`/templates/${id}`, { method: "PATCH", body: JSON.stringify({ startMin: s, endMin: s + dur }) });
    } finally { setTemplateBusy(false); invalidateTemplates(); }
  }
  async function resizeRow(id: number, newEnd: number) {
    const r = rows.find(x => x.id === id);
    if (!r || templateBusy) return;
    const e = Math.max(r.startMin + 5, Math.min(1440, newEnd));
    setTemplateBusy(true);
    try {
      await api(`/templates/${id}`, { method: "PATCH", body: JSON.stringify({ endMin: e }) });
    } finally { setTemplateBusy(false); invalidateTemplates(); }
  }

  const templateItems: TimelineCardItem[] = rows.map(r => ({
    kind: "block" as const,
    startMin: r.startMin,
    endMin: r.endMin,
    block: {
      id: r.id, date: "", startMin: r.startMin, endMin: r.endMin,
      pillarId: r.pillarId, title: r.title, notes: null,
      status: "planned" as const, source: "template",
    },
  }));

  const inputCls = "px-2.5 py-2 rounded-lg border border-border bg-background text-sm";

  return (
    <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <LayoutTemplate className="w-4 h-4 text-primary" /> Weekly template
        </h2>
        <ChevronRight className={cn("w-4 h-4 text-muted-foreground transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <>
          <div className="flex gap-1.5 flex-wrap items-center">
            {WEEKDAYS.map((d, i) => (
              <button key={d} onClick={() => setDayIdx(i)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm border",
                  i === dayIdx ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-secondary/50",
                )}>
                {d}
              </button>
            ))}
            <button
              onClick={() => copyDay.mutate()}
              disabled={copyDay.isPending || rows.length === 0}
              title={rows.length === 0 ? "Nothing to copy on this day yet." : `Replace Mon–Fri with ${WEEKDAYS[dayIdx]}'s blocks`}
              className="ml-auto text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary/50 disabled:opacity-50 flex items-center gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" /> {copyDay.isPending ? "Copying…" : `Copy ${WEEKDAYS[dayIdx]} to Mon–Fri`}
            </button>
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No template blocks for {WEEKDAYS[dayIdx]} yet.</p>
          ) : (
            <DayTimeline
              items={templateItems}
              pillarById={new Map(pillars.map(p => [p.id, p]))}
              isToday={false}
              now={0}
              busy={templateBusy}
              statusControls={false}
              onMove={moveRow}
              onResize={resizeRow}
              onDelete={id => { onDelete(id); setTimeout(invalidateTemplates, 300); }}
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input type="time" value={start} onChange={e => setStart(e.target.value)} className={inputCls} aria-label="Start time" />
            <span className="text-muted-foreground text-sm">–</span>
            <input type="time" value={end} onChange={e => setEnd(e.target.value)} className={inputCls} aria-label="End time" />
            <select value={pillarId} onChange={e => setPillarId(e.target.value)} className={inputCls + " flex-1 min-w-[140px]"} aria-label="Pillar">
              <option value="">Pick a pillar…</option>
              {pillars.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input value={title} onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") submit(); }}
              placeholder="Title (optional)" className={inputCls + " flex-1 min-w-[110px]"} />
            <button onClick={submit} disabled={pendingAdd || (!pillarId && !title.trim())}
              className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// ── Day timeline — proportional heights, drag to move, drag bottom to resize ─
const PX_PER_MIN = 1.6;
const SNAP_MIN = 5;

interface TimelineDrag {
  id: number;
  mode: "move" | "resize";
  startY: number;
  origStart: number;
  origEnd: number;
  delta: number;
}

/** Greedy lane layout so overlapping items sit side by side. */
function layoutLanes(items: Array<{ startMin: number; endMin: number }>): Array<{ col: number; cols: number }> {
  const result = items.map(() => ({ col: 0, cols: 1 }));
  let lanes: number[] = [];
  let cluster: number[] = [];
  let clusterCols = 0;
  let clusterEnd = -1;

  const close = () => {
    for (const j of cluster) result[j].cols = Math.max(1, clusterCols);
    lanes = [];
    cluster = [];
    clusterCols = 0;
    clusterEnd = -1;
  };

  items.forEach((it, i) => {
    if (cluster.length && it.startMin >= clusterEnd) close();
    let lane = lanes.findIndex(end => end <= it.startMin);
    if (lane === -1) { lane = lanes.length; lanes.push(0); }
    lanes[lane] = it.endMin;
    result[i].col = lane;
    cluster.push(i);
    clusterCols = Math.max(clusterCols, lane + 1);
    clusterEnd = Math.max(clusterEnd, it.endMin);
  });
  close();
  return result;
}

function DayTimeline({ items, pillarById, recurringByBlockId, tasksByBlockId, showTask, isToday, now, busy, statusControls = true, onMove, onResize, onToggleDone, onSkip, onDelete, onTickRecurring, onToggleGoal, onToggleTask, onDeleteTask, onAddTaskToBlock }: {
  items: TimelineCardItem[];
  pillarById: Map<number, Pillar>;
  recurringByBlockId?: Map<number, RecurringItem[]>;
  /** Today's one-off tasks, grouped by the block they belong to. */
  tasksByBlockId?: Map<number, Task[]>;
  /** Honours the day's "show completed" toggle. */
  showTask?: (t: Task) => boolean;
  isToday: boolean;
  now: number;
  busy: boolean;
  statusControls?: boolean;
  onMove: (id: number, newStart: number) => void;
  onResize: (id: number, newEnd: number) => void;
  onToggleDone?: (b: Block) => void;
  onSkip?: (b: Block) => void;
  onDelete: (id: number) => void;
  onTickRecurring?: (id: number, ticked: boolean) => void;
  /** Tick a pillar goal off (or back on) from inside a block. */
  onToggleGoal?: (goalId: number, done: boolean) => void;
  onToggleTask?: (taskId: number, done: boolean) => void;
  onDeleteTask?: (taskId: number) => void;
  onAddTaskToBlock?: (block: Block, title: string) => void;
}) {
  const [drag, setDrag] = useState<TimelineDrag | null>(null);
  // Tap-to-expand: a block card only has room for a preview of its rituals
  // and goals (short blocks clip everything). Expanding pops the card out
  // over the timeline at full width with the complete, tickable list;
  // tapping again (or the chevron) collapses it back. One at a time.
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // Which block currently has its inline "add a task" box open. Opening one
  // also expands that card, so the new task is visible the moment it lands.
  const [addingToId, setAddingToId] = useState<number | null>(null);

  // Displayed positions, with the in-flight drag applied.
  const displayed = items.map(t => {
    let s = t.startMin;
    let e = t.endMin;
    if (t.kind === "block" && drag && drag.id === t.block.id) {
      if (drag.mode === "move") {
        const dur = e - s;
        s = Math.max(0, Math.min(1440 - dur, drag.origStart + drag.delta));
        e = s + dur;
      } else {
        e = Math.max(s + SNAP_MIN, Math.min(1440, drag.origEnd + drag.delta));
      }
    }
    return { ...t, dispStart: s, dispEnd: e };
  }).sort((a, b) => a.dispStart - b.dispStart || a.dispEnd - b.dispEnd);

  const winStart = Math.floor(Math.min(7 * 60, ...displayed.map(t => t.dispStart)) / 60) * 60;
  const winEnd = Math.ceil(Math.max(18 * 60, ...displayed.map(t => Math.min(1440, t.dispEnd))) / 60) * 60;
  const totalH = (winEnd - winStart) * PX_PER_MIN;
  const lanes = layoutLanes(displayed.map(t => ({ startMin: t.dispStart, endMin: t.dispEnd })));

  const hours: number[] = [];
  for (let h = winStart; h <= winEnd; h += 60) hours.push(h);

  // Listeners are attached synchronously here, NOT in an effect: a fast drag
  // (hardware pen, automation, quick flick) can deliver pointermove/up before
  // React re-renders and mounts effect listeners, leaving the drag stranded.
  function startDrag(e: React.PointerEvent, block: Block, mode: "move" | "resize") {
    if (busy) return;
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const d: TimelineDrag = { id: block.id, mode, startY, origStart: block.startMin, origEnd: block.endMin, delta: 0 };
    setDrag({ ...d });
    const onPointerMove = (ev: PointerEvent) => {
      const raw = (ev.clientY - startY) / PX_PER_MIN;
      const snapped = Math.round(raw / SNAP_MIN) * SNAP_MIN;
      if (snapped !== d.delta) {
        d.delta = snapped;
        setDrag({ ...d });
      }
    };
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      if (d.delta !== 0) {
        if (mode === "move") onMove(d.id, d.origStart + d.delta);
        else onResize(d.id, d.origEnd + d.delta);
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }

  return (
    <div className={cn("relative", drag && "select-none")} style={{ height: totalH }}>
      {/* Hour grid */}
      {hours.map(h => (
        <div key={h} className="absolute left-0 right-0 border-t border-border/50" style={{ top: (h - winStart) * PX_PER_MIN }}>
          <span className="absolute -top-2 left-0 text-[10px] text-muted-foreground font-mono">{minToTime(h)}</span>
        </div>
      ))}
      {/* Now line */}
      {isToday && now >= winStart && now <= winEnd && (
        <div className="absolute left-8 right-0 z-20 pointer-events-none" style={{ top: (now - winStart) * PX_PER_MIN }}>
          <div className="border-t-2 border-red-500/80 relative">
            <span className="absolute -left-1.5 -top-1 w-2 h-2 rounded-full bg-red-500" />
          </div>
        </div>
      )}

      {/* Cards */}
      <div className="absolute inset-y-0 left-10 right-0">
        {displayed.map((t, i) => {
          const { col, cols } = lanes[i];
          const top = (t.dispStart - winStart) * PX_PER_MIN;
          const rawH = (t.dispEnd - t.dispStart) * PX_PER_MIN;
          const h = Math.max(26, rawH);
          const leftPct = (col / cols) * 100;
          const widthPct = 100 / cols;
          const compact = h < 52;

          if (t.kind === "event") {
            const ev = t.event;
            const isNow = isToday && t.dispStart <= now && now < t.dispEnd;
            return (
              <div key={`e-${ev.calendar}-${t.startMin}-${ev.title}`}
                className={cn(
                  "absolute rounded-lg border border-dashed border-border bg-secondary/40 backdrop-blur-[1px] px-2 py-1 overflow-hidden",
                  isNow && "ring-2 ring-primary/60",
                )}
                style={{ top, height: h, left: `calc(${leftPct}% + 2px)`, width: `calc(${widthPct}% - 4px)` }}
              >
                <div className="flex items-center gap-1.5 h-full min-h-0">
                  <CalendarDays className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{ev.title}</p>
                    {!compact && (
                      <p className="text-[10px] text-muted-foreground truncate">
                        {minToTime(t.dispStart)}–{minToTime(t.dispEnd)} · {ev.calendar}
                      </p>
                    )}
                  </div>
                  {ev.joinUrl && (
                    <a href={ev.joinUrl} target="_blank" rel="noopener noreferrer"
                      className={cn(
                        "flex-shrink-0 rounded-md text-[11px] font-medium flex items-center gap-1 px-2 py-1",
                        ev.joinIsCall ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border border-border text-muted-foreground hover:bg-secondary/50",
                      )}>
                      {ev.joinIsCall ? <Video className="w-3 h-3" /> : <ExternalLink className="w-3 h-3" />}
                      {!compact && (ev.joinIsCall ? "Join" : "Open")}
                    </a>
                  )}
                </div>
              </div>
            );
          }

          const b = t.block;
          const pillar = b.pillarId != null ? pillarById.get(b.pillarId) : undefined;
          const color = pillar?.color ?? DEFAULT_PILLAR_COLOR;
          const isNow = isToday && t.dispStart <= now && now < t.dispEnd;
          const rituals = recurringByBlockId?.get(b.id) ?? [];
          const blockTasks = (tasksByBlockId?.get(b.id) ?? []).filter(t => showTask ? showTask(t) : true);
          const dragging = drag?.id === b.id;
          const expanded = expandedId === b.id;
          const adding = addingToId === b.id;
          const toggleExpanded = () => setExpandedId(expanded ? null : b.id);
          const openAdd = () => { setAddingToId(b.id); setExpandedId(b.id); };

          return (
            <div key={`b-${b.id}`}
              className={cn(
                "absolute rounded-lg border border-border bg-background shadow-sm",
                expanded ? "z-40 shadow-xl overflow-visible" : "overflow-hidden",
                b.status === "done" && "opacity-60",
                b.status === "skipped" && "opacity-40",
                isNow && b.status === "planned" && "ring-2 ring-primary/60",
                dragging && "z-30 shadow-lg",
              )}
              style={{
                top,
                // Expanded: pop out to full width and grow to fit every item —
                // the card floats over the timeline instead of clipping.
                height: expanded ? "auto" : h,
                minHeight: h,
                left: expanded ? "2px" : `calc(${leftPct}% + 2px)`,
                width: expanded ? "calc(100% - 4px)" : `calc(${widthPct}% - 4px)`,
                borderLeft: `4px solid ${color}`,
              }}
            >
              <div className="flex items-start gap-1.5 px-1.5 py-1 h-full min-h-0">
                {/* Drag handle */}
                <button
                  onPointerDown={e => startDrag(e, b, "move")}
                  className="flex-shrink-0 p-0.5 mt-0.5 text-muted-foreground/60 hover:text-foreground cursor-grab active:cursor-grabbing"
                  style={{ touchAction: "none" }}
                  aria-label="Drag to move block"
                  title="Drag to move"
                >
                  <GripVertical className="w-3.5 h-3.5" />
                </button>
                {statusControls && onToggleDone && (
                  <button
                    onClick={() => onToggleDone(b)}
                    className={cn(
                      "flex-shrink-0 w-5 h-5 mt-0.5 rounded-full border-2 flex items-center justify-center transition-colors",
                      b.status === "done" ? "bg-primary border-primary text-primary-foreground" : "border-border hover:border-primary",
                    )}
                    aria-label={b.status === "done" ? "Mark not done" : "Mark done"}
                  >
                    {b.status === "done" && <Check className="w-3 h-3" />}
                  </button>
                )}
                {/* The whole body is the tap target: the title toggles
                    expand, and any dead space below opens the add-a-task box.
                    Before this, a three-hour block was mostly unclickable —
                    tapping it did nothing at all. */}
                {/* self-stretch matters: the parent is items-start, so
                    without it this column is only as tall as its content and
                    the empty space in a long block belongs to the parent —
                    i.e. still unclickable, which was the original complaint. */}
                <div
                  className="flex-1 min-w-0 self-stretch"
                  onClick={e => { if (e.target === e.currentTarget && onAddTaskToBlock) openAdd(); }}
                >
                  {/* Title doubles as the expand/collapse tap target — the
                      chips below are their own buttons, so only the title
                      (and the chevron) toggles. */}
                  <p
                    onClick={toggleExpanded}
                    className={cn("text-xs font-medium cursor-pointer", expanded ? "whitespace-normal" : "truncate", b.status !== "planned" && "line-through")}
                  >
                    {b.title}
                  </p>
                  {(!compact || expanded) && (
                    <p className="text-[10px] text-muted-foreground truncate">
                      {minToTime(t.dispStart)}–{minToTime(t.dispEnd)}
                      {pillar && pillar.name !== b.title && <span className="ml-1" style={{ color }}>{pillar.name}</span>}
                      {b.status === "skipped" && <span className="ml-1">skipped</span>}
                    </p>
                  )}
                  {/* Today's to-dos come first — they're the reason you're
                      looking at the block. */}
                  {onToggleTask && blockTasks.length > 0 && (h >= 68 || expanded) && (
                    <div className="mt-1 space-y-0.5">
                      {(expanded ? blockTasks : blockTasks.slice(0, 4)).map(t => (
                        <div key={t.id} className="flex items-center gap-1 group/task">
                          <button
                            onClick={() => onToggleTask(t.id, t.status !== "done")}
                            className={cn(
                              "flex items-center gap-1.5 text-[11px] rounded-md px-1.5 py-0.5 border min-w-0",
                              t.status === "done"
                                ? "border-primary/40 bg-primary/10 text-muted-foreground line-through"
                                : "border-border hover:border-primary",
                            )}
                          >
                            <span className={cn(
                              "w-3 h-3 rounded-sm border flex items-center justify-center flex-shrink-0",
                              t.status === "done" ? "bg-primary border-primary text-primary-foreground" : "border-border",
                            )}>
                              {t.status === "done" && <Check className="w-2 h-2" />}
                            </span>
                            <span className="truncate">{t.title}</span>
                          </button>
                          {t.url && (
                            <FocusLink url={t.url} label={`Open link for ${t.title}`}
                              className="flex-shrink-0 p-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20">
                              <ExternalLink className="w-3 h-3" />
                            </FocusLink>
                          )}
                          {onDeleteTask && expanded && (
                            <button onClick={() => onDeleteTask(t.id)}
                              className="p-0.5 rounded text-muted-foreground opacity-0 group-hover/task:opacity-100 hover:text-destructive"
                              aria-label={`Delete task ${t.title}`}>
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      ))}
                      {!expanded && blockTasks.length > 4 && (
                        <button onClick={toggleExpanded} className="text-[10px] text-primary pl-1 hover:underline">
                          +{blockTasks.length - 4} more — tap to expand
                        </button>
                      )}
                    </div>
                  )}
                  {adding && onAddTaskToBlock && (
                    <InlineTaskInput
                      onCancel={() => setAddingToId(null)}
                      onSubmit={title => { onAddTaskToBlock(b, title); }}
                    />
                  )}
                  {onTickRecurring && rituals.length > 0 && (h >= 84 || expanded) && (
                    <div className="mt-1 space-y-0.5">
                      {rituals.map(r => (
                        <div key={r.id} className="flex items-center gap-1">
                          <button
                            onClick={() => onTickRecurring(r.id, !r.ticked)}
                            className={cn(
                              "flex items-center gap-1.5 text-[11px] rounded-md px-1.5 py-0.5 border min-w-0",
                              r.ticked ? "border-primary/40 bg-primary/10 text-muted-foreground line-through" : "border-border hover:border-primary",
                            )}
                          >
                            <span className={cn(
                              "w-3 h-3 rounded-sm border flex items-center justify-center flex-shrink-0",
                              r.ticked ? "bg-primary border-primary text-primary-foreground" : "border-border",
                            )}>
                              {r.ticked && <Check className="w-2 h-2" />}
                            </span>
                            <span className="truncate">{r.title}</span>
                            <Repeat className="w-2.5 h-2.5 text-muted-foreground flex-shrink-0" />
                          </button>
                          {(() => {
                            // A "Numbers check" item links itself to the
                            // Numbers page even with no URL set — that's
                            // where the numbers live.
                            const linkUrl = r.url || (/\bnumbers?\b/i.test(r.title) ? "/founder/numbers" : null);
                            return linkUrl ? (
                              <FocusLink url={linkUrl} label={`Open link for ${r.title}`}
                                className="flex-shrink-0 p-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20">
                                <ExternalLink className="w-3 h-3" />
                              </FocusLink>
                            ) : null;
                          })()}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* The pillar's long-term goals — EXPANDED ONLY (2026-08-12).
                      They used to render on the collapsed card, which meant
                      every block of a pillar showed the same standing goals
                      every day and buried the day's actual to-dos. They're
                      still tickable here, and fully managed on the pillar
                      panel; one tap on the card brings them back. */}
                  {onToggleGoal && pillar && expanded && (() => {
                    const goals = pillar.goals.filter(g => g.status !== "parked");
                    if (goals.length === 0) return null;
                    const shown = goals;
                    return (
                      <div className="mt-1 space-y-0.5 pb-2">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground pt-1">Goals — {pillar.name}</p>
                        {shown.map(g => (
                          <button
                            key={g.id}
                            onClick={() => onToggleGoal(g.id, g.status !== "done")}
                            className={cn(
                              "flex items-center gap-1.5 text-[11px] rounded-md px-1.5 py-0.5 border min-w-0 max-w-full",
                              g.status === "done" ? "border-primary/40 bg-primary/10 text-muted-foreground line-through" : "border-border hover:border-primary",
                            )}
                          >
                            <span className={cn(
                              "w-3 h-3 rounded-full border flex items-center justify-center flex-shrink-0",
                              g.status === "done" ? "bg-primary border-primary text-primary-foreground" : "border-border",
                            )}>
                              {g.status === "done" && <Check className="w-2 h-2" />}
                            </span>
                            <span className="truncate">{g.title}</span>
                          </button>
                        ))}
                        {goals.length > shown.length && (
                          <button onClick={toggleExpanded} className="text-[10px] text-primary pl-1 hover:underline">
                            +{goals.length - shown.length} more — tap to expand
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <div className="flex-shrink-0 flex items-center gap-0.5">
                  {onAddTaskToBlock && b.status === "planned" && (
                    <button
                      onClick={openAdd}
                      className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10"
                      title="Add a task to this block"
                      aria-label={`Add a task to ${b.title}`}
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    onClick={toggleExpanded}
                    className="p-1 rounded-md text-muted-foreground hover:bg-secondary/50"
                    aria-expanded={expanded}
                    aria-label={expanded ? "Collapse block" : "Expand block to see everything in it"}
                    title={expanded ? "Collapse" : "Expand — see everything in this block"}
                  >
                    <ChevronDown className={cn("w-3 h-3 transition-transform", expanded && "rotate-180")} />
                  </button>
                  {statusControls && onSkip && b.status === "planned" && !compact && (
                    <button onClick={() => onSkip(b)}
                      className="p-1 rounded-md text-muted-foreground hover:bg-secondary/50" title="Skip" aria-label="Skip block">
                      <SkipForward className="w-3 h-3" />
                    </button>
                  )}
                  <button onClick={() => onDelete(b.id)}
                    className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10" aria-label="Delete block">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
              {/* Resize handle */}
              {b.status === "planned" && (
                <div
                  onPointerDown={e => startDrag(e, b, "resize")}
                  className="absolute bottom-0 inset-x-0 h-2.5 cursor-ns-resize flex items-center justify-center group"
                  style={{ touchAction: "none" }}
                  title="Drag to lengthen or shorten"
                >
                  <div className="w-8 h-1 rounded-full bg-border group-hover:bg-primary/60" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Tasks ──────────────────────────────────────────────────────────────────

/** The add-a-task box that opens inside a block card. */
function InlineTaskInput({ onSubmit, onCancel }: {
  onSubmit: (title: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const submit = () => {
    const t = title.trim();
    if (!t) return;
    onSubmit(t);
    // Stay open so several tasks can be typed in a row — Escape closes it.
    setTitle("");
  };
  return (
    <div className="mt-1 flex items-center gap-1" onClick={e => e.stopPropagation()}>
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") { e.preventDefault(); submit(); }
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Add a task…"
        autoFocus
        className="flex-1 min-w-0 px-1.5 py-0.5 rounded-md border border-primary/40 bg-background text-[11px]"
      />
      <button onClick={submit} disabled={!title.trim()}
        className="p-1 rounded-md text-primary hover:bg-primary/10 disabled:opacity-40" aria-label="Save task">
        <Check className="w-3 h-3" />
      </button>
      <button onClick={onCancel} className="p-1 rounded-md text-muted-foreground hover:bg-secondary/50" aria-label="Close">
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

/** A task outside the timeline — the unassigned tray and the overdue strip. */
function TaskRow({ task, pillar, onToggle, onDelete }: {
  task: Task;
  pillar?: Pillar;
  onToggle: (done: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2 group/row">
      <button
        onClick={() => onToggle(task.status !== "done")}
        className={cn(
          "flex items-center gap-2 text-sm rounded-lg px-2 py-1 border flex-1 min-w-0 text-left",
          task.status === "done"
            ? "border-primary/40 bg-primary/10 text-muted-foreground line-through"
            : "border-border hover:border-primary",
        )}
      >
        <span className={cn(
          "w-3.5 h-3.5 rounded-sm border flex items-center justify-center flex-shrink-0",
          task.status === "done" ? "bg-primary border-primary text-primary-foreground" : "border-border",
        )}>
          {task.status === "done" && <Check className="w-2.5 h-2.5" />}
        </span>
        <span className="truncate flex-1">{task.title}</span>
        {pillar && (
          <span className="text-[10px] flex-shrink-0" style={{ color: pillar.color ?? DEFAULT_PILLAR_COLOR }}>
            {pillar.name}
          </span>
        )}
      </button>
      <button onClick={onDelete}
        className="p-1 rounded-md text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:text-destructive"
        aria-label={`Delete task ${task.title}`}>
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/**
 * Quick add with AI routing. Type a task, the router proposes a pillar and a
 * block, and nothing is written until it's confirmed — a wrong guess costs
 * one dropdown, not a misfiled task. Works with the AI switched off too: the
 * dropdowns just start empty.
 */
function QuickAddTask({ pillars, blocks, dateStr, pending, onAdd, onAddRecurring }: {
  pillars: Pillar[];
  blocks: Block[];
  dateStr: string;
  pending: boolean;
  onAdd: (t: { title: string; date: string; pillarId: number | null; blockId: number | null; source: string }) => void;
  onAddRecurring: (pillarId: number, title: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [route, setRoute] = useState<TaskRoute | null>(null);
  const [pillarId, setPillarId] = useState<number | null>(null);
  const [blockId, setBlockId] = useState<number | null>(null);
  const [makeRecurring, setMakeRecurring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const classify = useMutation({
    mutationFn: (t: string) => api("/tasks/classify", { method: "POST", body: JSON.stringify({ title: t, date: dateStr }) }) as Promise<TaskRoute>,
    onSuccess: r => {
      setRoute(r);
      setPillarId(r.pillarId);
      setBlockId(r.blockId);
      setMakeRecurring(r.recurring);
    },
    // A router failure must never block capture — fall through to the manual
    // dropdowns with nothing pre-filled.
    onError: () => setRoute({ pillarId: null, blockId: null, recurring: false, reason: null, available: false }),
  });

  const reset = () => {
    setTitle(""); setRoute(null); setPillarId(null); setBlockId(null); setMakeRecurring(false); setError(null);
  };

  const confirm = () => {
    const t = title.trim();
    if (!t) return;
    if (makeRecurring) {
      if (pillarId == null) { setError("A repeating item needs a pillar."); return; }
      onAddRecurring(pillarId, t);
    } else {
      onAdd({ title: t, date: dateStr, pillarId, blockId, source: route?.available ? "ai" : "manual" });
    }
    reset();
  };

  // Only blocks of the chosen pillar are offered — pinning a Sales task to a
  // Product block is nearly always a mis-tap.
  const blockChoices = pillarId == null ? blocks : blocks.filter(b => b.pillarId === pillarId);

  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <input
          value={title}
          onChange={e => { setTitle(e.target.value); setRoute(null); setError(null); }}
          onKeyDown={e => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (route) confirm();
            else if (title.trim()) classify.mutate(title.trim());
          }}
          placeholder="Add a task for today — e.g. chase Salvo about the pallet rate"
          className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-border bg-background text-sm"
        />
        {!route ? (
          <button
            onClick={() => title.trim() && classify.mutate(title.trim())}
            disabled={!title.trim() || classify.isPending}
            className="text-xs px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5 flex-shrink-0"
          >
            {classify.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {classify.isPending ? "Thinking…" : "Add task"}
          </button>
        ) : (
          <>
            <button
              onClick={confirm}
              disabled={pending}
              className="text-xs px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5 flex-shrink-0"
            >
              <Check className="w-3.5 h-3.5" /> Confirm
            </button>
            <button onClick={reset} className="p-2 rounded-lg text-muted-foreground hover:bg-secondary/50 flex-shrink-0" aria-label="Cancel">
              <X className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      {route && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-muted-foreground">
            {route.available
              ? route.reason ? `Suggested — ${route.reason}` : "Suggested"
              : "AI routing unavailable — pick a home:"}
          </span>
          <select
            value={pillarId ?? ""}
            onChange={e => { const v = e.target.value ? Number(e.target.value) : null; setPillarId(v); setBlockId(null); }}
            className="px-2 py-1 rounded-md border border-border bg-background text-xs"
            aria-label="Pillar"
          >
            <option value="">No pillar</option>
            {pillars.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {!makeRecurring && (
            <select
              value={blockId ?? ""}
              onChange={e => setBlockId(e.target.value ? Number(e.target.value) : null)}
              className="px-2 py-1 rounded-md border border-border bg-background text-xs"
              aria-label="Block"
            >
              <option value="">No specific block</option>
              {blockChoices.map(b => (
                <option key={b.id} value={b.id}>{minToTime(b.startMin)} {b.title}</option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-1.5 text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={makeRecurring} onChange={e => setMakeRecurring(e.target.checked)} />
            <Repeat className="w-3 h-3" /> Every day
          </label>
          {error && <span className="text-destructive">{error}</span>}
        </div>
      )}
    </div>
  );
}

/**
 * Open tasks left on earlier days. They stay on their own date until dealt
 * with here — Graeme's call (2026-08-12): overdue work should be rescheduled
 * on purpose, not silently carried forward.
 */
function OverdueStrip({ tasks, pillarById, todayStr, onReschedule, onDone, onDrop }: {
  tasks: Task[];
  pillarById: Map<number, Pillar>;
  todayStr: string;
  onReschedule: (id: number, date: string) => void;
  onDone: (id: number) => void;
  onDrop: (id: number) => void;
}) {
  const [open, setOpen] = useState(true);
  const tomorrow = format(addDays(parseISO(todayStr), 1), "yyyy-MM-dd");

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 text-left">
        <CircleDashed className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
        <span className="text-sm font-medium text-amber-700 dark:text-amber-400 flex-1">
          {tasks.length} overdue {tasks.length === 1 ? "task" : "tasks"} — needs rescheduling
        </span>
        <ChevronDown className={cn("w-4 h-4 text-amber-700 dark:text-amber-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="space-y-1.5">
          {tasks.map(t => {
            const pillar = t.pillarId != null ? pillarById.get(t.pillarId) : undefined;
            return (
              <li key={t.id} className="flex items-center gap-2 flex-wrap rounded-lg bg-background/60 px-2 py-1.5">
                <span className="text-xs text-muted-foreground flex-shrink-0 tabular-nums">
                  {format(parseISO(t.date), "d MMM")}
                </span>
                <span className="text-sm flex-1 min-w-0 truncate">{t.title}</span>
                {pillar && (
                  <span className="text-[10px] flex-shrink-0" style={{ color: pillar.color ?? DEFAULT_PILLAR_COLOR }}>
                    {pillar.name}
                  </span>
                )}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => onReschedule(t.id, todayStr)}
                    className="text-[11px] px-2 py-1 rounded-md border border-border bg-background hover:bg-secondary/50">
                    Today
                  </button>
                  <button onClick={() => onReschedule(t.id, tomorrow)}
                    className="text-[11px] px-2 py-1 rounded-md border border-border bg-background hover:bg-secondary/50">
                    Tomorrow
                  </button>
                  <input
                    type="date"
                    value={t.date}
                    onChange={e => e.target.value && onReschedule(t.id, e.target.value)}
                    className="text-[11px] px-1.5 py-1 rounded-md border border-border bg-background"
                    aria-label={`Pick a new date for ${t.title}`}
                  />
                  <button onClick={() => onDone(t.id)}
                    className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10"
                    title="Already done" aria-label={`Mark ${t.title} done`}>
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => onDrop(t.id)}
                    className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    title="Drop it" aria-label={`Delete ${t.title}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Editable goal / recurring rows ─────────────────────────────────────────
function EditableGoalRow({ goal, done, onToggle, onSave, onDelete }: {
  goal: Goal;
  done: boolean;
  onToggle: () => void;
  onSave: (title: string, url: string | null) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(goal.title);
  const [url, setUrl] = useState(goal.url ?? "");

  function save() {
    if (!title.trim()) return;
    onSave(title.trim(), url.trim() || null);
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="space-y-1.5 rounded-lg border border-border p-2">
        <input value={title} onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") save(); }}
          className="w-full px-2 py-1 rounded-md border border-border bg-background text-sm" autoFocus />
        <input value={url} onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") save(); }}
          placeholder="Link URL (optional) — https://…"
          className="w-full px-2 py-1 rounded-md border border-border bg-background text-xs" />
        <div className="flex gap-1.5 justify-end">
          <button onClick={() => { setTitle(goal.title); setUrl(goal.url ?? ""); setEditing(false); }}
            className="p-1 text-muted-foreground" aria-label="Cancel"><X className="w-4 h-4" /></button>
          <button onClick={save} disabled={!title.trim()} className="p-1 text-primary disabled:opacity-50" aria-label="Save">
            <Check className="w-4 h-4" />
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className={cn("flex items-center gap-2 text-sm group", done && "text-muted-foreground")}>
      <button onClick={onToggle}
        className={cn(
          "w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0",
          done ? "bg-primary border-primary text-primary-foreground" : "border-border hover:border-primary",
        )}
        aria-label={done ? "Mark goal active" : "Mark goal done"}>
        {done && <Check className="w-3 h-3" />}
      </button>
      <span className={cn("flex-1 min-w-0 truncate", done && "line-through")}>
        {goal.title}
        {!done && goal.detail && <span className="text-muted-foreground text-xs ml-1.5">— {goal.detail}</span>}
      </span>
      {goal.url && goal.url.startsWith("/") ? (
        <FocusLink url={goal.url} label={`Open link for ${goal.title}`}
          className="flex-shrink-0 px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium flex items-center gap-1 hover:bg-primary/20">
          <ExternalLink className="w-3 h-3" /> Open
        </FocusLink>
      ) : goal.url && (
        <a href={goal.url} target="_blank" rel="noopener noreferrer"
          className="flex-shrink-0 px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium flex items-center gap-1 hover:bg-primary/20"
          title={goal.url}>
          <ExternalLink className="w-3 h-3" /> Open
        </a>
      )}
      <button onClick={() => setEditing(true)}
        className="p-1 rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-secondary/50" aria-label="Edit goal">
        <Pencil className="w-3.5 h-3.5" />
      </button>
      <button onClick={onDelete}
        className="p-1 rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive" aria-label="Delete goal">
        <X className="w-3.5 h-3.5" />
      </button>
    </li>
  );
}

function EditableRecurringRow({ item, onSave, onDelete }: {
  item: RecurringItem;
  onSave: (title: string, url: string | null) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [url, setUrl] = useState(item.url ?? "");

  function save() {
    if (!title.trim()) return;
    onSave(title.trim(), url.trim() || null);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="space-y-1.5 rounded-lg border border-border p-2">
        <input value={title} onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") save(); }}
          className="w-full px-2 py-1 rounded-md border border-border bg-background text-sm" autoFocus />
        <input value={url} onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") save(); }}
          placeholder="Link URL (optional) — https://…"
          className="w-full px-2 py-1 rounded-md border border-border bg-background text-xs" />
        <div className="flex gap-1.5 justify-end">
          <button onClick={() => { setTitle(item.title); setUrl(item.url ?? ""); setEditing(false); }}
            className="p-1 text-muted-foreground" aria-label="Cancel"><X className="w-4 h-4" /></button>
          <button onClick={save} disabled={!title.trim()} className="p-1 text-primary disabled:opacity-50" aria-label="Save">
            <Check className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm group">
      <Repeat className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
      <span className="flex-1 min-w-0 truncate">{item.title}</span>
      <span className="text-[10px] text-muted-foreground flex-shrink-0">{scheduleLabel(item)}</span>
      {(() => {
        const linkUrl = item.url || (/\bnumbers?\b/i.test(item.title) ? "/founder/numbers" : null);
        return linkUrl ? (
          <FocusLink url={linkUrl} label={`Open link for ${item.title}`}
            className="flex-shrink-0 px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium flex items-center gap-1 hover:bg-primary/20">
            <ExternalLink className="w-3 h-3" /> Open
          </FocusLink>
        ) : null;
      })()}
      <button onClick={() => setEditing(true)}
        className="p-1 rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-secondary/50" aria-label="Edit recurring item">
        <Pencil className="w-3.5 h-3.5" />
      </button>
      <button onClick={onDelete}
        className="p-1 rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive" aria-label="Delete recurring item">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
