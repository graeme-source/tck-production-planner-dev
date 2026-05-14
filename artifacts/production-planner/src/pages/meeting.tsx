/**
 * Morning Meeting — Two Second Lean style 10-minute stand-up.
 *
 * Four modes:
 *   - setup:   pick a host, optionally read the lesson briefing, then start
 *   - prep:    3-page "teach the teacher" walkthrough for today's lean
 *              lesson (what it means → what to show → how to deliver)
 *   - meeting: 12-slide slideshow with auto-pulled data and inline inputs
 *              for safety / struggles / gratitude
 *   - done:    summary of what was covered, link back to dashboard
 *
 * The slideshow tries to land in 10 minutes — most slides are quick
 * status reviews. Stretches and the lean lesson take the most time
 * because they're meant to.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type React from "react";
import { useLocation, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, addDays } from "date-fns";
import {
  ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, X, Play, Pause, RotateCcw,
  Sparkles, ChefHat, Truck, ShoppingBag, AlertCircle, FileText, MessageCircle,
  HeartHandshake, Activity, BookOpen, Award, Loader2, ClipboardCheck, Sun,
  CheckCircle2, Heart, Settings, Edit3, Calendar, GripVertical, Plus, Trash2, Save,
} from "lucide-react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { StandardsSopsDialog } from "@/components/standards-sops-dialog";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface MeetingSlide {
  id: number;
  kind: string;
  title: string;
  orderPosition: number;
  contentMd: string | null;
  configJson: Record<string, unknown> | null;
}

interface DashboardData {
  today: string;
  yesterday: string;
  tomorrow: string;
  special: { id: number; name: string } | null;
  tomorrowNonCoreItems: Array<{ recipeId: number; recipeName: string; recipeColor: string | null; batchesTarget: number; recipeCategory: string | null }>;
  todayPlan: {
    id: number | null;
    items: Array<{ recipeId: number; recipeName: string; recipeColor: string | null; batchesTarget: number; recipeCategory: string | null; eightPackBagCount: number }>;
  };
  yesterdayKpis: {
    wonkyCount: number;
    shortCount: number;
    leftoverFillingGrams: number;
    builderBatchesPerHour: number | null;
    packingBatchesPerHour: number | null;
    batchesTarget: number;
  };
  todayDeliveries: Array<{ id: number; supplierName: string; status: string }>;
  safetyIssues: Array<{ id: number; category: string; severity: string; description: string | null; createdAt: string }>;
  struggles: Array<{ id: number; title: string; description: string; createdAt: string }>;
  recentSops: Array<{ id: number; title: string; updatedAt: string }>;
  lesson: {
    id: number; weekNumber: number; title: string; summary: string;
    explanationMd: string; whatToShowMd: string; deliveryNotesMd: string;
    videoUrl: string | null;
    principleId?: number;
    principleTitle?: string;
  } | null;
  meeting: { id: number; hostName: string | null; startedAt: string; endedAt: string | null; lessonId: number | null; exampleId: number | null } | null;
  slides: MeetingSlide[];
  gratitude: Array<{ id: number; fromName: string; toName: string | null; content: string }>;
}

async function fetchDashboard(): Promise<DashboardData> {
  const res = await fetch(`${BASE}/api/morning-meetings/dashboard`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Stretches slide ──────────────────────────────────────────────────
// Five stretches per session — bookended by a sky-reach, with three
// rotating middle stretches picked at random per day so the routine
// doesn't get stale. Each runs for STRETCH_SECONDS with no clicks
// required; all five appear on screen and the active one is
// highlighted, so the team sees what's coming and what just finished.
const STRETCH_SECONDS = 10;
const SKY_STRETCH = { name: "Reach for the sky", emoji: "🙆", description: "Big breath in, arms straight up." };
const STRETCH_POOL: ReadonlyArray<{ name: string; emoji: string; description: string }> = [
  { name: "Neck rolls",        emoji: "🦒", description: "Slow circles, both directions." },
  { name: "Shoulder rolls",    emoji: "🤷", description: "Backwards then forwards." },
  { name: "Side bend",         emoji: "🧍", description: "Lean to each side." },
  { name: "Forward fold",      emoji: "🙇", description: "Soft knees, drop the head." },
  { name: "Wrist + finger",    emoji: "👐", description: "Roll wrists, splay fingers." },
  { name: "Calf stretch",      emoji: "🚶", description: "Push the back heel down." },
  { name: "Torso twist",       emoji: "🌀", description: "Hands on hips, slow rotation." },
  { name: "Chest opener",      emoji: "🫁", description: "Hands behind back, lift the chest." },
  { name: "Hip circles",       emoji: "🕺", description: "Hands on hips, draw slow circles." },
  { name: "Ankle rolls",       emoji: "🦶", description: "One foot at a time." },
];

/** Deterministic shuffle so the same day shows the same stretches
 *  for everyone on every device — important for a TV-mirrored meeting. */
function pickStretchesForDay(dateIso: string) {
  const seed = dateIso.split("-").reduce((acc, part) => acc * 31 + Number(part), 0);
  let s = seed;
  const rng = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const pool = [...STRETCH_POOL];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const middle = pool.slice(0, 3);
  return [SKY_STRETCH, ...middle, SKY_STRETCH];
}

function StretchesPanel() {
  const [index, setIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(STRETCH_SECONDS);
  const [running, setRunning] = useState(false);
  const todayIso = new Date().toISOString().slice(0, 10);
  const stretches = pickStretchesForDay(todayIso);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) {
          if (index < stretches.length - 1) {
            setIndex(i => i + 1);
            return STRETCH_SECONDS;
          }
          setRunning(false);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, index, stretches.length]);

  const allDone = !running && index === stretches.length - 1 && secondsLeft === 0;

  return (
    <div className="flex flex-col items-center gap-6 w-full">
      {/* Five stretch tiles — all visible at once. The active one
          pulses + scales up; finished ones dim; upcoming ones sit
          quiet. Sized for TV readability from across the kitchen. */}
      <div className="grid grid-cols-5 gap-4 w-full">
        {stretches.map((st, i) => {
          const isActive = i === index && running;
          const isDone = i < index || (i === index && secondsLeft === 0 && !running && allDone);
          return (
            <div
              key={i}
              className={cn(
                "rounded-2xl border p-6 flex flex-col items-center text-center gap-4 transition-all min-h-[280px] justify-center",
                isActive && "border-emerald-500 bg-emerald-500/10 scale-105 shadow-lg shadow-emerald-500/20",
                isDone && "opacity-40",
                !isActive && !isDone && "border-border bg-card",
              )}
            >
              <div className="text-8xl leading-none">{st.emoji}</div>
              <p className="text-2xl font-semibold leading-tight">{st.name}</p>
              {isActive && (
                <div className="text-6xl font-display font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{secondsLeft}s</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Active stretch description — big, central, only shows while running. */}
      <div className="text-center min-h-[80px] flex items-center justify-center">
        {running ? (
          <p className="text-3xl text-muted-foreground max-w-3xl leading-snug">{stretches[index].description}</p>
        ) : allDone ? (
          <p className="text-4xl font-display font-semibold text-emerald-600 dark:text-emerald-400">Nice work — let's get into the day.</p>
        ) : (
          <p className="text-2xl text-muted-foreground">Press Start. {STRETCH_SECONDS}s per stretch, no clicking — just follow along.</p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            if (allDone) { setIndex(0); setSecondsLeft(STRETCH_SECONDS); }
            setRunning(r => !r);
          }}
          className="px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center gap-2 hover:bg-primary/90 text-base"
        >
          {running ? <><Pause className="w-5 h-5" /> Pause</> : <><Play className="w-5 h-5" /> {allDone ? "Restart" : "Start"}</>}
        </button>
        <button
          onClick={() => { setIndex(0); setSecondsLeft(STRETCH_SECONDS); setRunning(false); }}
          className="px-5 py-3 rounded-xl border border-border text-muted-foreground hover:text-foreground flex items-center gap-2"
        >
          <RotateCcw className="w-4 h-4" /> Reset
        </button>
      </div>
    </div>
  );
}

// ── Markdown-lite renderer ───────────────────────────────────────────
// Lesson content is markdown but pulling in a full parser would be
// overkill for what we need. Handle bold (**), bullet lists, headings,
// tables, and paragraphs — enough for the curriculum content.
function renderInlineMd(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>,
  );
}

function MarkdownBlock({ content }: { content: string }) {
  const blocks = content.split(/\n\n+/);
  return (
    <div className="space-y-4 text-lg leading-relaxed">
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        if (lines.every(l => l.startsWith("- "))) {
          return (
            <ul key={bi} className="list-disc list-inside space-y-1.5 pl-2">
              {lines.map((l, li) => <li key={li}>{renderInlineMd(l.slice(2))}</li>)}
            </ul>
          );
        }
        if (lines.length >= 2 && lines[0].startsWith("|") && lines[1].includes("---")) {
          const headerCells = lines[0].split("|").map(s => s.trim()).filter(Boolean);
          const rows = lines.slice(2).map(r => r.split("|").map(s => s.trim()).filter(Boolean));
          return (
            <table key={bi} className="w-full text-base border border-border rounded-lg overflow-hidden">
              <thead className="bg-secondary/40"><tr>{headerCells.map((h, hi) => <th key={hi} className="px-3 py-2 text-left font-semibold">{renderInlineMd(h)}</th>)}</tr></thead>
              <tbody>{rows.map((r, ri) => <tr key={ri} className="border-t border-border">{r.map((c, ci) => <td key={ci} className="px-3 py-2">{renderInlineMd(c)}</td>)}</tr>)}</tbody>
            </table>
          );
        }
        return <p key={bi}>{renderInlineMd(block)}</p>;
      })}
    </div>
  );
}

// ── Slide kind registry ──────────────────────────────────────────────
// Icon + colour per slide kind. The actual ordered list and per-slide
// titles come from meeting_slides in the DB so admins can reorder
// without touching this file.
type SlideKind =
  | "special_prep"
  | "stretches"
  | "yesterday_kpis"
  | "order_of_production"
  | "local_delivery"
  | "bag_orders"
  | "short_on_pack"
  | "safety_issues"
  | "system_updates"
  | "new_sops"
  | "struggles"
  | "lesson"
  | "gratitude"
  | "custom_markdown";

const SLIDE_KIND_META: Record<SlideKind, { icon: React.ElementType; color: string; fallbackTitle: string }> = {
  special_prep:        { icon: Award,         color: "text-amber-500",   fallbackTitle: "Test Product Prep" },
  stretches:           { icon: Activity,      color: "text-emerald-500", fallbackTitle: "Stretches" },
  yesterday_kpis:      { icon: ChefHat,       color: "text-violet-500",  fallbackTitle: "Yesterday's Numbers" },
  order_of_production: { icon: ClipboardCheck,color: "text-primary",     fallbackTitle: "Order of Production" },
  local_delivery:      { icon: Truck,         color: "text-blue-500",    fallbackTitle: "Local Despatch" },
  bag_orders:          { icon: ShoppingBag,   color: "text-indigo-500",  fallbackTitle: "Bag Orders" },
  short_on_pack:       { icon: AlertCircle,   color: "text-orange-500",  fallbackTitle: "Short on the Pack" },
  safety_issues:       { icon: AlertCircle,   color: "text-red-500",     fallbackTitle: "Safety Issues" },
  system_updates:      { icon: Sparkles,      color: "text-purple-500",  fallbackTitle: "System Updates" },
  new_sops:            { icon: FileText,      color: "text-cyan-500",    fallbackTitle: "New & Updated SOPs" },
  struggles:           { icon: MessageCircle, color: "text-pink-500",    fallbackTitle: "Struggles" },
  lesson:              { icon: BookOpen,      color: "text-purple-500",  fallbackTitle: "Today's Lean Lesson" },
  gratitude:           { icon: Heart,         color: "text-rose-500",    fallbackTitle: "Gratitude" },
  custom_markdown:     { icon: BookOpen,      color: "text-slate-500",   fallbackTitle: "Note" },
};

function metaForKind(kind: string) {
  return SLIDE_KIND_META[kind as SlideKind] ?? SLIDE_KIND_META.custom_markdown;
}

// ── Page ─────────────────────────────────────────────────────────────
type Mode = "setup" | "prep" | "meeting" | "done" | "edit_today" | "edit_tomorrow" | "edit_template" | "edit_curriculum";

export default function MeetingPage() {
  const { state } = useAuth();
  const currentUserName = state.status === "authenticated" ? state.user.name : "";
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<Mode>("setup");
  const [hostName, setHostName] = useState(currentUserName);
  const [slideIndex, setSlideIndex] = useState(0);
  const [tomorrowMeetingId, setTomorrowMeetingId] = useState<number | null>(null);
  // When the host clicks "Preview tomorrow's meeting", we fetch
  // tomorrow's meeting_slides and stash them here. The slideshow's
  // `slides` memo picks them up via override, so the runner uses
  // tomorrow's slide order/titles/content with today's dynamic data
  // (deliveries, plan, KPIs etc) as a stand-in.
  const [previewSlides, setPreviewSlides] = useState<MeetingSlide[] | null>(null);

  useEffect(() => { if (!hostName && currentUserName) setHostName(currentUserName); }, [currentUserName, hostName]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["morning-meeting-dashboard"],
    queryFn: fetchDashboard,
    staleTime: 30_000,
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/morning-meetings/start`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostName, lessonId: data?.lesson?.id ?? null }),
      });
      if (!res.ok) throw new Error("Failed to start meeting");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["morning-meeting-dashboard"] });
      setMode("meeting");
      setSlideIndex(0);
    },
  });

  const endMutation = useMutation({
    mutationFn: async () => {
      const meetingId = data?.meeting?.id;
      if (!meetingId) return;
      await fetch(`${BASE}/api/morning-meetings/${meetingId}/end`, { method: "POST", credentials: "include" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["morning-meeting-dashboard"] });
      setMode("done");
    },
  });

  // The runner's slide list comes from meeting_slides in the DB. If
  // the meeting hasn't been started yet `data.slides` is empty and the
  // user is still on the setup screen, so this is only consulted in
  // meeting mode. When `previewSlides` is set we're previewing
  // tomorrow's meeting, so those override today's slides.
  const slides = useMemo<MeetingSlide[]>(() => previewSlides ?? data?.slides ?? [], [previewSlides, data?.slides]);
  const isPreviewing = previewSlides !== null;
  const slideCount = slides.length;

  const advance = useCallback(() => setSlideIndex(i => Math.min(Math.max(0, slideCount - 1), i + 1)), [slideCount]);
  const retreat = useCallback(() => setSlideIndex(i => Math.max(0, i - 1)), []);

  useEffect(() => {
    if (mode !== "meeting") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); advance(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); retreat(); }
      if (e.key === "Escape") setMode("setup");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, advance, retreat]);

  if (isLoading || !data) {
    return (
      <div className="fixed inset-0 bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isAdmin = state.status === "authenticated" && state.user.role === "admin";

  if (mode === "setup") {
    return <SetupScreen
      data={data}
      hostName={hostName}
      onHostNameChange={setHostName}
      onReadBriefing={() => setMode("prep")}
      onStart={() => startMutation.mutate()}
      starting={startMutation.isPending}
      onExit={() => navigate("/")}
      onEditToday={() => setMode("edit_today")}
      onEditTemplate={() => setMode("edit_template")}
      onEditCurriculum={() => setMode("edit_curriculum")}
      onEditTomorrow={async () => {
        const tomorrow = format(addDays(new Date(), 1), "yyyy-MM-dd");
        try {
          // Idempotent — /schedule clones the template on first call,
          // returns the existing meeting id on subsequent calls.
          const res = await fetch(`${BASE}/api/morning-meetings/schedule`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ meetingDate: tomorrow }),
          });
          if (!res.ok) throw new Error();
          const body = await res.json() as { id: number };
          setTomorrowMeetingId(body.id);
          setMode("edit_tomorrow");
        } catch {
          toast({ title: "Couldn't open tomorrow's meeting", variant: "destructive" });
        }
      }}
      onPreviewTomorrow={async () => {
        const tomorrow = format(addDays(new Date(), 1), "yyyy-MM-dd");
        try {
          const schedRes = await fetch(`${BASE}/api/morning-meetings/schedule`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ meetingDate: tomorrow }),
          });
          if (!schedRes.ok) throw new Error();
          const schedBody = await schedRes.json() as { id: number };
          setTomorrowMeetingId(schedBody.id);
          // Fetch tomorrow's slides and drop straight into the
          // slideshow runner. The slides memo picks them up via the
          // previewSlides override; dynamic data (deliveries, plan
          // etc.) stays as today's snapshot — it'll refresh tomorrow.
          const slidesRes = await fetch(`${BASE}/api/morning-meetings/${schedBody.id}/slides`, { credentials: "include" });
          if (!slidesRes.ok) throw new Error();
          const slidesBody = await slidesRes.json() as MeetingSlide[];
          setPreviewSlides(slidesBody);
          setSlideIndex(0);
          setMode("meeting");
        } catch {
          toast({ title: "Couldn't open tomorrow's meeting", variant: "destructive" });
        }
      }}
      isAdmin={isAdmin}
    />;
  }

  if (mode === "prep") {
    return <PrepMode lesson={data.lesson} onBack={() => setMode("setup")} onDone={() => setMode("setup")} />;
  }

  if (mode === "done") {
    return <DoneScreen data={data} onClose={() => navigate("/")} />;
  }

  if (mode === "edit_today") {
    // Editing today's meeting requires the meeting to exist. Auto-start
    // it (clones the template) if not, so the host can edit a fresh
    // copy without having to click "Start" first.
    if (!data.meeting) {
      return <AutoStartGate hostName={hostName} onStart={() => startMutation.mutate()} starting={startMutation.isPending} />;
    }
    return <SlideEditor
      mode="meeting"
      id={data.meeting.id}
      titleSuffix={format(new Date(data.today + "T00:00:00"), "EEEE d MMMM")}
      onClose={() => { queryClient.invalidateQueries({ queryKey: ["morning-meeting-dashboard"] }); setMode("setup"); }}
    />;
  }

  if (mode === "edit_tomorrow" && tomorrowMeetingId != null) {
    return <SlideEditor
      mode="meeting"
      id={tomorrowMeetingId}
      titleSuffix={`${format(new Date(data.tomorrow + "T00:00:00"), "EEEE d MMMM")} — Tomorrow`}
      onClose={() => { queryClient.invalidateQueries({ queryKey: ["morning-meeting-dashboard"] }); setMode("setup"); }}
    />;
  }


  if (mode === "edit_template") {
    return <SlideEditor
      mode="template"
      id={null /* SlideEditor resolves the default template internally */}
      titleSuffix="Master template"
      onClose={() => { queryClient.invalidateQueries({ queryKey: ["morning-meeting-dashboard"] }); setMode("setup"); }}
    />;
  }

  if (mode === "edit_curriculum") {
    return <CurriculumEditor onClose={() => { queryClient.invalidateQueries({ queryKey: ["morning-meeting-dashboard"] }); setMode("setup"); }} />;
  }

  if (slideCount === 0) {
    // Meeting was started but has no slides — unusual (clone would
    // normally have run), so kick the host back to setup so they can
    // start fresh.
    return (
      <div className="fixed inset-0 bg-background flex items-center justify-center text-center px-6">
        <div>
          <p className="text-muted-foreground mb-4">This meeting has no slides yet.</p>
          <button onClick={() => setMode("setup")} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold">Back to setup</button>
        </div>
      </div>
    );
  }
  const slide = slides[Math.min(slideIndex, slideCount - 1)];
  const meta = metaForKind(slide.kind);
  const SlideIcon = meta.icon;
  const exitMeeting = () => {
    if (isPreviewing) setPreviewSlides(null);
    setMode("setup");
  };
  return (
    <MeetingShell
      slide={slide}
      slides={slides}
      slideIndex={slideIndex}
      slideCount={slideCount}
      meta={meta}
      SlideIcon={SlideIcon}
      isPreviewing={isPreviewing}
      data={data}
      onRefresh={() => refetch()}
      advance={advance}
      retreat={retreat}
      setSlideIndex={setSlideIndex}
      onEnd={() => endMutation.mutate()}
      onExit={exitMeeting}
    />
  );
}

interface MeetingShellProps {
  slide: MeetingSlide;
  slides: MeetingSlide[];
  slideIndex: number;
  slideCount: number;
  meta: { icon: React.ElementType; color: string; fallbackTitle: string };
  SlideIcon: React.ElementType;
  isPreviewing: boolean;
  data: DashboardData;
  onRefresh: () => void;
  advance: () => void;
  retreat: () => void;
  setSlideIndex: (i: number) => void;
  onEnd: () => void;
  onExit: () => void;
}

/** Slideshow chrome: full-screen container, header with title + counter,
 *  progress bar, slide body, and a slim footer with dot pagination only
 *  (Next/Back are now swipe-driven so the team can see slide content
 *  instead of buttons). Also disables pull-to-refresh while mounted so
 *  the host can't accidentally reload the meeting by scrolling. */
function MeetingShell({
  slide, slides, slideIndex, slideCount, meta, SlideIcon, isPreviewing,
  data, onRefresh, advance, retreat, setSlideIndex, onEnd, onExit,
}: MeetingShellProps) {
  // Suppress the global pull-to-refresh — the host has been accidentally
  // reloading mid-meeting by scrolling on the iPad.
  useEffect(() => {
    const prev = document.body.dataset.suppressPullToRefresh ?? "";
    document.body.dataset.suppressPullToRefresh = "1";
    return () => {
      if (prev) document.body.dataset.suppressPullToRefresh = prev;
      else delete document.body.dataset.suppressPullToRefresh;
    };
  }, []);

  // Swipe navigation: horizontal pan > 60px advances/retreats. We start
  // tracking only when the touch begins outside an interactive element
  // so taps on buttons / chips inside slides still work.
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select, [data-no-swipe]")) {
      touchStartRef.current = null;
      return;
    }
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const elapsed = Date.now() - start.t;
    // Mostly-horizontal, finger fast enough, distance over threshold.
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.2 || elapsed > 600) return;
    if (dx < 0) advance(); else retreat();
  };

  return (
    <div
      className="fixed inset-0 bg-background flex flex-col"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {isPreviewing && (
        <div className="bg-purple-500/10 border-b border-purple-500/30 text-purple-700 dark:text-purple-300 px-6 py-2 text-base flex items-center justify-between">
          <span className="font-medium">
            Preview — Tomorrow's meeting ({data.tomorrow ? format(new Date(data.tomorrow + "T00:00:00"), "EEEE d MMMM") : ""})
          </span>
          <button onClick={onExit} className="text-sm underline-offset-2 hover:underline">Exit preview</button>
        </div>
      )}

      {/* Header — title big enough to read from across the room */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-3 min-w-0">
          <SlideIcon className={cn("w-7 h-7 shrink-0", meta.color)} />
          <h1 className="text-2xl font-display font-bold truncate">{slide.title || meta.fallbackTitle}</h1>
        </div>
        <div className="flex items-center gap-4 text-base">
          <span className="text-muted-foreground tabular-nums font-semibold">{slideIndex + 1} / {slideCount}</span>
          {!isPreviewing && (
            <button onClick={onEnd} className="text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5">
              End meeting
            </button>
          )}
          <button onClick={onExit} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-secondary">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${((slideIndex + 1) / slideCount) * 100}%` }}
        />
      </div>

      {/* Slide body — fills the screen vertically. Short slides centre
          so the iPad/TV canvas isn't dominated by whitespace; long
          slides (Order of Production, deliveries) overflow scroll. */}
      <div className="flex-1 overflow-y-auto px-8 py-6 flex flex-col">
        <div className="max-w-6xl mx-auto w-full my-auto">
          <SlideBody slide={slide} data={data} onRefresh={onRefresh} />
        </div>
      </div>

      {/* Footer — compact Back / Next buttons sit either side of the
          dot pagination so a desktop host can click through. On iPad
          the swipe gesture is still the main way to navigate. */}
      <div className="flex items-center justify-center gap-3 px-6 py-3 border-t border-border bg-card">
        <button
          onClick={retreat}
          disabled={slideIndex === 0}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Previous slide"
          data-no-swipe
        >
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-2" data-no-swipe>
          {slides.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setSlideIndex(i)}
              className={cn(
                "h-2 rounded-full transition-all",
                i === slideIndex ? "bg-primary w-8" : i < slideIndex ? "bg-primary/40 w-2.5" : "bg-secondary w-2.5",
              )}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>
        {slideIndex === slideCount - 1 ? (
          <button
            onClick={onEnd}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-base font-semibold bg-emerald-600 text-white hover:bg-emerald-700"
            data-no-swipe
          >
            Finish <CheckCircle2 className="w-5 h-5" />
          </button>
        ) : (
          <button
            onClick={advance}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
            aria-label="Next slide"
            data-no-swipe
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Setup screen ────────────────────────────────────────────────────
function SetupScreen({
  data, hostName, onHostNameChange, onReadBriefing, onStart, starting, onExit,
  onEditToday, onEditTemplate, onEditCurriculum, onEditTomorrow, onPreviewTomorrow, isAdmin,
}: {
  data: DashboardData;
  hostName: string;
  onHostNameChange: (s: string) => void;
  onReadBriefing: () => void;
  onStart: () => void;
  starting: boolean;
  onExit: () => void;
  onEditToday: () => void;
  onEditTemplate: () => void;
  onEditCurriculum: () => void;
  onEditTomorrow: () => void;
  onPreviewTomorrow: () => void;
  isAdmin: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-background overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <button onClick={onExit} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Dashboard
          </button>
          <p className="text-xs text-muted-foreground">{format(new Date(data.today + "T00:00:00"), "EEEE d MMMM yyyy")}</p>
        </div>

        <div className="flex items-center gap-3 mb-2">
          <Sparkles className="w-7 h-7 text-amber-500" />
          <h1 className="text-3xl font-display font-bold">Morning Meeting</h1>
        </div>
        <p className="text-muted-foreground mb-6">Two Second Lean — 10 minutes. Safety, stretches, the plan, today's lesson, gratitude.</p>

        {/* Editor + scheduling row — sits above the host setup so the
            host can see at a glance that today's meeting is editable. */}
        <div className="flex flex-wrap items-center gap-2 mb-8">
          <button
            onClick={onEditToday}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-secondary/40"
          >
            <Edit3 className="w-3.5 h-3.5" />
            Edit today's meeting
          </button>
          <button
            onClick={onPreviewTomorrow}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-secondary/40"
          >
            <Calendar className="w-3.5 h-3.5" />
            Preview tomorrow's meeting
          </button>
          <button
            onClick={onEditTomorrow}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-secondary/40"
          >
            <Edit3 className="w-3.5 h-3.5" />
            Edit tomorrow's meeting
          </button>
          {isAdmin && (
            <>
              <button
                onClick={onEditTemplate}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-secondary/40 text-muted-foreground"
              >
                <Settings className="w-3.5 h-3.5" />
                Edit master template
              </button>
              <button
                onClick={onEditCurriculum}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-secondary/40 text-muted-foreground"
              >
                <BookOpen className="w-3.5 h-3.5" />
                Lean curriculum
              </button>
            </>
          )}
        </div>

        <div className="glass-panel rounded-2xl p-6 mb-6">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 block">Today's host</label>
          <input
            type="text"
            value={hostName}
            onChange={e => onHostNameChange(e.target.value)}
            placeholder="Who's running this meeting?"
            className="w-full text-2xl font-display font-bold bg-transparent border-b border-border focus:border-primary outline-none py-2"
          />
        </div>

        {data.lesson && (
          <div className="glass-panel rounded-2xl p-6 mb-6">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Today's lesson — Week {data.lesson.weekNumber}</p>
                <h2 className="text-xl font-display font-bold">{data.lesson.title}</h2>
                <p className="text-sm text-muted-foreground mt-1">{data.lesson.summary}</p>
              </div>
              <BookOpen className="w-6 h-6 text-purple-500 shrink-0" />
            </div>
            <button
              onClick={onReadBriefing}
              className="mt-2 flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80"
            >
              <BookOpen className="w-4 h-4" />
              Read host briefing (1 min)
            </button>
            <p className="text-xs text-muted-foreground mt-3">
              The briefing walks you through what this concept means, what you'll show the team, and how to deliver it.
              You can host even if you've never heard the word "kaizen."
            </p>
          </div>
        )}

        <button
          onClick={onStart}
          disabled={!hostName.trim() || starting}
          className="w-full px-6 py-4 rounded-2xl bg-primary text-primary-foreground text-lg font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {starting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
          Start meeting
        </button>

        {data.meeting && (
          <p className="text-center text-xs text-muted-foreground mt-3">
            Meeting already started today by {data.meeting.hostName ?? "someone"} at {format(new Date(data.meeting.startedAt), "HH:mm")}
            {data.meeting.endedAt ? ` · ended ${format(new Date(data.meeting.endedAt), "HH:mm")}` : ""}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Prep mode (teach-the-teacher) ───────────────────────────────────
function PrepMode({
  lesson, onBack, onDone,
}: {
  lesson: DashboardData["lesson"];
  onBack: () => void;
  onDone: () => void;
}) {
  const [page, setPage] = useState(0);
  if (!lesson) {
    return (
      <div className="fixed inset-0 bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">No lesson configured for today.</p>
          <button onClick={onBack} className="mt-4 text-primary hover:underline">Back</button>
        </div>
      </div>
    );
  }
  const pages = [
    { title: "What it means", icon: BookOpen, body: lesson.explanationMd },
    { title: "What you'll show the team", icon: Sun, body: lesson.whatToShowMd },
    { title: "How to deliver it", icon: HeartHandshake, body: lesson.deliveryNotesMd },
  ];
  const current = pages[page];
  return (
    <div className="fixed inset-0 bg-background flex flex-col">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <current.icon className="w-5 h-5 text-purple-500" />
          <h1 className="text-lg font-semibold">Host briefing — {lesson.title}</h1>
        </div>
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="h-1 bg-secondary">
        <div className="h-full bg-purple-500 transition-all" style={{ width: `${((page + 1) / pages.length) * 100}%` }} />
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-10">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Step {page + 1} of {pages.length}</p>
          <h2 className="text-3xl font-display font-bold mb-6">{current.title}</h2>
          <MarkdownBlock content={current.body} />
        </div>
      </div>
      <div className="flex items-center justify-between px-6 py-3 border-t border-border bg-card">
        <button
          onClick={() => page > 0 ? setPage(p => p - 1) : onBack()}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-border hover:bg-secondary/50"
        >
          <ChevronLeft className="w-4 h-4" /> {page > 0 ? "Back" : "Cancel"}
        </button>
        {page < pages.length - 1 ? (
          <button onClick={() => setPage(p => p + 1)} className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold bg-purple-500 text-white hover:bg-purple-600">
            Next <ChevronRight className="w-4 h-4" />
          </button>
        ) : (
          <button onClick={onDone} className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700">
            Got it <CheckCircle2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Done screen ─────────────────────────────────────────────────────
function DoneScreen({ data, onClose }: { data: DashboardData; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-background flex items-center justify-center">
      <div className="max-w-2xl text-center px-6">
        <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto mb-6" />
        <h1 className="text-4xl font-display font-bold mb-3">Have a great day</h1>
        <p className="text-lg text-muted-foreground mb-8">
          Thanks {data.meeting?.hostName ?? "for hosting"}. {data.gratitude.length} shout-out{data.gratitude.length === 1 ? "" : "s"}, {data.safetyIssues.length} safety item{data.safetyIssues.length === 1 ? "" : "s"} on the board, {data.struggles.length} struggle{data.struggles.length === 1 ? "" : "s"} to action.
        </p>
        <button onClick={onClose} className="px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90">
          Back to dashboard
        </button>
      </div>
    </div>
  );
}

// ── Slide body switcher ─────────────────────────────────────────────
function SlideBody({ slide, data, onRefresh }: { slide: MeetingSlide; data: DashboardData; onRefresh: () => void }) {
  switch (slide.kind) {
    case "special_prep": return <SpecialPrepSlide data={data} slide={slide} />;
    case "stretches": return <StretchesPanel />;
    case "yesterday_kpis": return <YesterdayKpisSlide data={data} slide={slide} />;
    case "order_of_production": return <OrderOfProductionSlide data={data} slide={slide} />;
    case "local_delivery": return <LocalDeliverySlide data={data} slide={slide} />;
    case "bag_orders": return <BagOrdersSlide data={data} slide={slide} />;
    case "short_on_pack": return <ShortOnPackSlide data={data} slide={slide} />;
    case "safety_issues": return <SafetyIssuesSlide data={data} onRefresh={onRefresh} slide={slide} />;
    case "system_updates": return <SystemUpdatesSlide slide={slide} />;
    case "new_sops": return <NewSopsSlide data={data} slide={slide} />;
    case "struggles": return <StrugglesSlide data={data} onRefresh={onRefresh} slide={slide} />;
    case "lesson":
    case "learning": return <LearningSlide data={data} slide={slide} />;
    case "gratitude": return <GratitudeSlide data={data} onRefresh={onRefresh} slide={slide} />;
    case "custom_markdown": return <CustomMarkdownSlide slide={slide} />;
    default: return <CustomMarkdownSlide slide={slide} />;
  }
}

function CustomMarkdownSlide({ slide }: { slide: MeetingSlide }) {
  const videoUrl = typeof slide.configJson?.videoUrl === "string" ? slide.configJson.videoUrl : null;
  return (
    <div className="space-y-4">
      <SectionTitle>{slide.title}</SectionTitle>
      {slide.contentMd && (
        <div className="glass-panel rounded-2xl p-6"><MarkdownBlock content={slide.contentMd} /></div>
      )}
      {videoUrl && <YouTubeEmbed url={videoUrl} />}
      {!slide.contentMd && !videoUrl && (
        <p className="text-muted-foreground italic">No content yet — open the editor to add some.</p>
      )}
    </div>
  );
}

/** Parse YouTube share URLs (youtu.be, youtube.com/watch?v=, embed,
 *  shorts) to a bare 11-char video ID. Returns null for anything we
 *  can't parse so callers can fall back. */
function youtubeIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (u.hostname.endsWith("youtube.com") || u.hostname.endsWith("youtube-nocookie.com")) {
      if (u.pathname.startsWith("/embed/")) {
        const id = u.pathname.split("/embed/")[1]?.split("/")[0] ?? "";
        return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
      }
      if (u.pathname.startsWith("/shorts/")) {
        const id = u.pathname.split("/shorts/")[1]?.split("/")[0] ?? "";
        return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
      }
      const v = u.searchParams.get("v");
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    }
  } catch {
    // not a URL — fall through
  }
  return null;
}

function YouTubeEmbed({ url }: { url: string }) {
  const id = youtubeIdFromUrl(url);
  if (!id) {
    return (
      <a href={url} target="_blank" rel="noopener" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
        <Play className="w-4 h-4" /> Open video in new tab
      </a>
    );
  }
  return (
    <div className="w-full rounded-2xl overflow-hidden bg-black" style={{ aspectRatio: "16 / 9" }}>
      <iframe
        src={`https://www.youtube.com/embed/${id}?rel=0`}
        title="Video"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="w-full h-full border-0"
      />
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-5xl font-display font-bold mb-4 leading-tight">{children}</h2>;
}
function SectionLead({ children }: { children: React.ReactNode }) {
  return <p className="text-2xl text-muted-foreground mb-6 leading-snug">{children}</p>;
}

function SpecialPrepSlide({ data, slide }: { data: DashboardData; slide: MeetingSlide }) {
  const items = data.tomorrowNonCoreItems ?? [];
  return (
    <div>
      <SectionTitle>{slide.title || "Test Product Prep"}</SectionTitle>
      <SectionLead>
        Tomorrow's non-core items — anything that isn't part of the normal menu needs prep attention today.
      </SectionLead>
      {items.length === 0 ? (
        <div className="glass-panel rounded-2xl p-6 text-muted-foreground">
          No non-core items on tomorrow's plan — standard prep only.
        </div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          {items.map((it, i) => (
            <div
              key={it.recipeId}
              className={cn("flex items-center justify-between px-5 py-3", i > 0 && "border-t border-border/50")}
            >
              <div className="flex items-center gap-3 min-w-0">
                {it.recipeColor && (
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: it.recipeColor }}
                  />
                )}
                <span className="font-medium truncate">{it.recipeName}</span>
                {it.recipeCategory === "Macaroni Cheese" && (
                  <span className="text-[10px] uppercase tracking-wide bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full font-semibold">Mac</span>
                )}
              </div>
              <span className="text-sm font-semibold tabular-nums">
                {it.batchesTarget}{it.recipeCategory === "Macaroni Cheese" ? " packs" : " batches"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Which KPI tiles a slide should render. Template/meeting-level
 *  `configJson.kpis` overrides this; default matches the three the
 *  kitchen actually tracks day-to-day. */
const KPI_CATALOG = {
  builder_rate: { label: "Builder batches/hr", get: (k: DashboardData["yesterdayKpis"]) => k.builderBatchesPerHour != null ? k.builderBatchesPerHour.toFixed(1) : "—", warn: () => false },
  packing_rate: { label: "Packing boxes/hr",   get: (k: DashboardData["yesterdayKpis"]) => k.packingBatchesPerHour != null ? k.packingBatchesPerHour.toFixed(1) : "—", warn: () => false },
  wonkies:      { label: "Wonkies",            get: (k: DashboardData["yesterdayKpis"]) => k.wonkyCount.toString(), warn: (k: DashboardData["yesterdayKpis"]) => k.wonkyCount > 20 },
  batches:      { label: "Batches",            get: (k: DashboardData["yesterdayKpis"]) => k.batchesTarget.toString(), warn: () => false },
  shorts:       { label: "Short on pack",      get: (k: DashboardData["yesterdayKpis"]) => k.shortCount.toString(), warn: (k: DashboardData["yesterdayKpis"]) => k.shortCount > 0 },
  leftover:     { label: "Leftover filling (g)", get: (k: DashboardData["yesterdayKpis"]) => k.leftoverFillingGrams.toString(), warn: () => false },
} as const;
type KpiKey = keyof typeof KPI_CATALOG;
const DEFAULT_KPIS: KpiKey[] = ["builder_rate", "packing_rate", "wonkies"];

function YesterdayKpisSlide({ data, slide }: { data: DashboardData; slide: MeetingSlide }) {
  const k = data.yesterdayKpis;
  const configured = Array.isArray(slide.configJson?.kpis) ? (slide.configJson!.kpis as string[]) : null;
  const kpiKeys: KpiKey[] = (configured ?? DEFAULT_KPIS).filter((key): key is KpiKey => key in KPI_CATALOG);
  return (
    <div>
      <SectionTitle>{slide.title || "Yesterday's Numbers"}</SectionTitle>
      <SectionLead>How did the last shift go?</SectionLead>
      <div className={cn("grid gap-4", kpiKeys.length <= 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-3")}>
        {kpiKeys.map((key) => {
          const def = KPI_CATALOG[key];
          return (
            <KpiTile
              key={key}
              label={def.label}
              value={def.get(k)}
              tone={def.warn(k) ? "warn" : "ok"}
            />
          );
        })}
      </div>
    </div>
  );
}

function KpiTile({ label, value, tone = "ok" }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className={cn("glass-panel rounded-2xl p-6", tone === "warn" && "border-amber-300/60 dark:border-amber-700/40")}>
      <p className="text-base font-semibold uppercase tracking-wide text-muted-foreground mb-2">{label}</p>
      <p className="text-6xl font-display font-bold tabular-nums">{value}</p>
    </div>
  );
}

function OrderOfProductionSlide({ data, slide }: { data: DashboardData; slide: MeetingSlide }) {
  return (
    <div>
      <SectionTitle>{slide.title || "Order of Production"}</SectionTitle>
      <SectionLead>Today's plan — Mac &amp; Cheese first, then through the calzones.</SectionLead>
      {data.todayPlan.items.length === 0 ? (
        <div className="glass-panel rounded-2xl p-6 text-muted-foreground">No plan published for today yet.</div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          {data.todayPlan.items.map((it, i) => (
            <div
              key={it.recipeId}
              className={cn(
                "flex items-stretch gap-4 px-6 py-4",
                i > 0 && "border-t border-border/50",
              )}
            >
              {/* Big colour bar — runs the full height of the row so
                  it's the first thing the eye lands on from across
                  the room. Falls back to a neutral chip if the recipe
                  has no colour set. */}
              <span
                className="w-3 rounded-full shrink-0"
                style={{ backgroundColor: it.recipeColor ?? "hsl(var(--muted))" }}
                aria-hidden
              />
              <div className="flex items-center gap-4 min-w-0 flex-1">
                <span className="text-3xl font-display font-bold tabular-nums text-muted-foreground w-10 shrink-0">{i + 1}</span>
                <span className="text-3xl font-semibold leading-tight truncate">{it.recipeName}</span>
                {it.recipeCategory === "Macaroni Cheese" && (
                  <span className="text-sm uppercase tracking-wide bg-amber-500/10 text-amber-700 dark:text-amber-300 px-3 py-1 rounded-full font-bold shrink-0">Mac</span>
                )}
              </div>
              <span className="text-3xl font-display font-bold tabular-nums whitespace-nowrap self-center">
                {it.batchesTarget}
                <span className="text-base font-medium text-muted-foreground ml-2">
                  {it.recipeCategory === "Macaroni Cheese" ? "packs" : "batches"}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LocalDeliverySlide({ data, slide }: { data: DashboardData; slide: MeetingSlide }) {
  return (
    <div className="space-y-5">
      <SectionTitle>{slide.title || "Local Despatch"}</SectionTitle>
      <SectionLead>Going out and coming in.</SectionLead>

      {/* Static prompt — outbound local despatches via the butcher run.
          No data wired for this yet; the host calls it out verbally. */}
      <div className="glass-panel rounded-2xl p-8 border-2 border-blue-500/30 bg-blue-500/5">
        <p className="text-base font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300 mb-2">Outbound</p>
        <p className="text-4xl font-display font-bold leading-tight">Any local despatches today?</p>
        <p className="text-xl text-muted-foreground mt-2">Orders going out with the butcher.</p>
      </div>

      {/* Inbound — purchase orders arriving today, with their status. */}
      <div>
        <p className="text-base font-semibold uppercase tracking-wide text-muted-foreground mb-3">Deliveries coming in today</p>
        {data.todayDeliveries.length === 0 ? (
          <div className="glass-panel rounded-2xl p-6 text-2xl text-muted-foreground">No deliveries scheduled for today.</div>
        ) : (
          <div className="glass-panel rounded-2xl overflow-hidden">
            {data.todayDeliveries.map((d, i) => (
              <div key={d.id} className={cn("flex items-center justify-between px-6 py-4", i > 0 && "border-t border-border/50")}>
                <span className="text-2xl font-semibold">{d.supplierName}</span>
                <span className={cn(
                  "text-base uppercase tracking-wide px-3 py-1 rounded-full font-semibold",
                  d.status === "received"
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                )}>
                  {d.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BagOrdersSlide({ data, slide }: { data: DashboardData; slide: MeetingSlide }) {
  const bagRows = (data.todayPlan.items ?? [])
    .filter(it => (it.eightPackBagCount ?? 0) > 0);
  const totalBags = bagRows.reduce((s, r) => s + (r.eightPackBagCount ?? 0), 0);

  return (
    <div>
      <SectionTitle>{slide.title || "Bag Orders"}</SectionTitle>
      <SectionLead>8-pack bags on today's production plan.</SectionLead>
      {bagRows.length === 0 ? (
        <div className="glass-panel rounded-2xl p-8 text-center text-muted-foreground">
          <ShoppingBag className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>No 8-pack bags on today's plan.</p>
        </div>
      ) : (
        <>
          <div className="glass-panel rounded-2xl overflow-hidden">
            {bagRows.map((it, i) => (
              <div
                key={it.recipeId}
                className={cn("flex items-stretch gap-4 px-6 py-4", i > 0 && "border-t border-border/50")}
              >
                <span
                  className="w-3 rounded-full shrink-0"
                  style={{ backgroundColor: it.recipeColor ?? "hsl(var(--muted))" }}
                  aria-hidden
                />
                <span className="text-2xl font-semibold flex-1 truncate self-center">{it.recipeName}</span>
                <span className="text-2xl font-display font-bold tabular-nums self-center whitespace-nowrap">
                  {it.eightPackBagCount}
                  <span className="text-base font-medium text-muted-foreground ml-2">
                    {it.eightPackBagCount === 1 ? "bag" : "bags"}
                  </span>
                </span>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground mt-3 text-right">
            <span className="font-semibold text-foreground">{totalBags}</span> total 8-pack bag{totalBags === 1 ? "" : "s"}
          </p>
        </>
      )}
    </div>
  );
}

interface CalcRecipeRow {
  recipeId: number;
  recipeName: string;
  color: string | null;
  isCoreMenu: boolean;
  fridgeStock: number;
  dispatch1Qty: number;
  deficit: number;
}

function ShortOnPackSlide({ data, slide }: { data: DashboardData; slide: MeetingSlide }) {
  // Use the existing /api/production-plans/calculate endpoint as the
  // single source of truth — same numbers the planner page shows for
  // today, including fridge stock, today's despatch demand and the
  // per-recipe deficit. Filter to core recipes only since the user
  // wants the morning standard view.
  const { data: calc, isLoading } = useQuery<{ recipes: CalcRecipeRow[] }>({
    queryKey: ["short-on-pack-today", data.today],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/production-plans/calculate?planDate=${data.today}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 60_000,
  });

  const rows = (calc?.recipes ?? [])
    .filter(r => r.isCoreMenu)
    .map(r => {
      const have = r.fridgeStock;
      const need = r.dispatch1Qty;
      const surplus = have - need; // +ve = surplus, -ve = deficit
      const tone: "ok" | "warn" | "bad" = surplus >= 0 ? "ok" : surplus > -need * 0.1 ? "warn" : "bad";
      return { ...r, have, need, surplus, tone };
    })
    .sort((a, b) => a.surplus - b.surplus); // shortest first

  return (
    <div>
      <SectionTitle>{slide.title || "Short on the Pack"}</SectionTitle>
      <SectionLead>What recipes are we short on for today's pack?</SectionLead>

      {isLoading ? (
        <div className="glass-panel rounded-2xl p-6 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <div className="glass-panel rounded-2xl p-6 text-muted-foreground">No core recipes on today's plan.</div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[1fr_5rem_5rem_5rem] gap-3 px-5 py-2 bg-secondary/30 text-xs uppercase tracking-wide text-muted-foreground font-semibold">
            <span>Recipe</span>
            <span className="text-right">Have</span>
            <span className="text-right">Need</span>
            <span className="text-right">+/−</span>
          </div>
          {rows.map((r, i) => {
            const toneClass =
              r.tone === "ok"   ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/40" :
              r.tone === "warn" ? "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/40" :
                                  "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/50";
            return (
              <div
                key={r.recipeId}
                className={cn(
                  "grid grid-cols-[1fr_5rem_5rem_5rem] gap-3 items-center px-5 py-3 border-l-4",
                  toneClass,
                  i > 0 && "border-t border-border/50",
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: r.color ?? "hsl(var(--muted))" }} aria-hidden />
                  <span className="text-xl font-semibold truncate">{r.recipeName}</span>
                </div>
                <span className="text-xl font-bold tabular-nums text-right">{r.have}</span>
                <span className="text-xl font-bold tabular-nums text-right">{r.need}</span>
                <span className="text-xl font-bold tabular-nums text-right">
                  {r.surplus > 0 ? `+${r.surplus}` : r.surplus}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      {rows.length > 0 && (
        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" /> Enough</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-amber-500 inline-block" /> Tight</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> Short</span>
        </div>
      )}
    </div>
  );
}

function SafetyIssuesSlide({ data, onRefresh, slide }: { data: DashboardData; onRefresh: () => void; slide: MeetingSlide }) {
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<"yellow" | "red">("yellow");
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (!description.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/andon`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "safety", severity, description, station: "morning-meeting", reportContext: "Raised in morning meeting" }),
      });
      if (!res.ok) throw new Error("Failed");
      setDescription("");
      onRefresh();
      toast({ title: "Safety issue logged" });
    } catch {
      toast({ title: "Failed to log", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div>
      <SectionTitle>{slide.title || "Safety Issues"}</SectionTitle>
      <SectionLead>Anyone got a safety concern? Speak up.</SectionLead>
      {data.safetyIssues.length > 0 && (
        <div className="glass-panel rounded-2xl overflow-hidden mb-6">
          <p className="text-base font-semibold uppercase tracking-wide text-muted-foreground px-6 py-3 border-b border-border/50">Open safety items</p>
          {data.safetyIssues.map(s => (
            <div key={s.id} className="px-6 py-4 border-b border-border/50 last:border-0 flex items-start gap-4">
              <span className={cn("w-4 h-4 rounded-full mt-2 shrink-0", s.severity === "red" ? "bg-red-500" : "bg-amber-500")} />
              <p className="text-2xl leading-snug flex-1">{s.description ?? "(no description)"}</p>
            </div>
          ))}
        </div>
      )}
      <div className="glass-panel rounded-2xl p-6">
        <p className="text-base font-semibold uppercase tracking-wide text-muted-foreground mb-3">Log a new safety issue</p>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="What's the concern?"
          className="w-full min-h-[80px] bg-background border border-border rounded-xl p-3 text-base focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setSeverity("yellow")} className={cn("px-3 py-1.5 rounded-lg text-base font-medium border", severity === "yellow" ? "bg-amber-500/20 border-amber-500/50 text-amber-700 dark:text-amber-300" : "border-border")}>Yellow</button>
            <button onClick={() => setSeverity("red")} className={cn("px-3 py-1.5 rounded-lg text-base font-medium border", severity === "red" ? "bg-red-500/20 border-red-500/50 text-red-700 dark:text-red-300" : "border-border")}>Red</button>
          </div>
          <button onClick={submit} disabled={!description.trim() || submitting} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-base font-semibold hover:bg-primary/90 disabled:opacity-50">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Log issue"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface SystemCommit {
  sha: string;
  shortSha: string;
  date: string;
  author: string;
  subject: string;
  body: string;
}

function SystemUpdatesSlide({ slide }: { slide: MeetingSlide }) {
  const [show7Days, setShow7Days] = useState(false);

  const { data, isLoading } = useQuery<{
    available: boolean;
    last24h: SystemCommit[];
    last7Days: SystemCommit[];
    summary: string[] | null;
  }>({
    queryKey: ["system-updates"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/system-updates`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  const last24 = data?.last24h ?? [];
  const summary = data?.summary ?? null;
  const last7 = data?.last7Days ?? [];

  return (
    <div>
      <SectionTitle>{slide.title || "System Updates"}</SectionTitle>
      <SectionLead>What's changed in the planner — auto-summarised from the last 24 hours of deploys.</SectionLead>

      {isLoading ? (
        <div className="glass-panel rounded-2xl p-6 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : !data?.available ? (
        <div className="glass-panel rounded-2xl p-6 text-2xl text-muted-foreground">
          System update feed isn't available in this environment.
        </div>
      ) : last24.length === 0 ? (
        <div className="glass-panel rounded-2xl p-8 text-3xl text-muted-foreground italic text-center">
          No changes shipped in the last 24 hours.
        </div>
      ) : (
        <>
          {/* Primary focus — the plain-English summary. Bullets are
              big and unembellished so the host can read them out
              from across the kitchen. */}
          {summary && summary.length > 0 ? (
            <div className="glass-panel rounded-2xl p-6 border-2 border-primary/30 bg-primary/5">
              <ul className="space-y-3">
                {summary.map((line, i) => (
                  <li key={i} className="flex items-start gap-4 text-2xl leading-snug">
                    <span className="text-primary font-bold shrink-0 mt-1">•</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            // No AI summary available (Claude key missing on this
            // env, or the summariser failed) — fall back to the raw
            // commit subjects so the meeting still has content.
            <div className="glass-panel rounded-2xl overflow-hidden">
              {last24.map((c, i) => (
                <div key={c.sha} className={cn("px-6 py-4 text-2xl leading-snug", i > 0 && "border-t border-border/50")}>
                  {c.subject}
                </div>
              ))}
            </div>
          )}

          {/* Last 7 days — collapsible table for context, never the
              focus. Click the header to expand. */}
          {last7.length > 0 && (
            <div className="mt-6">
              <button
                type="button"
                onClick={() => setShow7Days(s => !s)}
                className="flex items-center gap-2 text-base font-medium text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className={cn("w-4 h-4 transition-transform", show7Days && "rotate-90")} />
                {show7Days ? "Hide" : "Show"} all changes this week ({last7.length})
              </button>
              {show7Days && (
                <div className="glass-panel rounded-xl overflow-hidden mt-2">
                  <table className="w-full text-base">
                    <thead>
                      <tr className="bg-secondary/40 border-b border-border/50">
                        <th className="text-left px-4 py-2 text-sm font-medium text-muted-foreground">When</th>
                        <th className="text-left px-4 py-2 text-sm font-medium text-muted-foreground">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {last7.map((c, i) => (
                        <tr key={c.sha} className={cn(i > 0 && "border-t border-border/50")}>
                          <td className="px-4 py-2 text-sm text-muted-foreground tabular-nums whitespace-nowrap align-top">
                            {format(new Date(c.date), "EEE d MMM HH:mm")}
                          </td>
                          <td className="px-4 py-2">{c.subject}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NewSopsSlide({ data, slide }: { data: DashboardData; slide: MeetingSlide }) {
  const [openSopId, setOpenSopId] = useState<number | null>(null);
  return (
    <div>
      <SectionTitle>{slide.title || "New & Updated SOPs"}</SectionTitle>
      <SectionLead>Touched in the last 7 days, most recent first. Tap to open.</SectionLead>
      {data.recentSops.length === 0 ? (
        <div className="glass-panel rounded-2xl p-6 text-2xl text-muted-foreground">No SOP updates in the last 7 days.</div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          {data.recentSops.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setOpenSopId(s.id)}
              className={cn(
                "w-full flex items-center justify-between px-6 py-4 text-left hover:bg-secondary/40 transition-colors",
                i > 0 && "border-t border-border/50",
              )}
            >
              <span className="text-2xl font-semibold">{s.title}</span>
              <span className="text-base text-muted-foreground tabular-nums">{format(new Date(s.updatedAt), "EEE d MMM")}</span>
            </button>
          ))}
        </div>
      )}
      <StandardsSopsDialog
        open={openSopId !== null}
        onClose={() => setOpenSopId(null)}
        initialSopId={openSopId ?? undefined}
      />
    </div>
  );
}

function StrugglesSlide({ data, onRefresh, slide }: { data: DashboardData; onRefresh: () => void; slide: MeetingSlide }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (!title.trim() || !description.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/improvements`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, station: "morning-meeting", type: "struggle", reportContext: "Raised in morning meeting" }),
      });
      if (!res.ok) throw new Error("Failed");
      setTitle(""); setDescription("");
      onRefresh();
      toast({ title: "Struggle logged" });
    } catch {
      toast({ title: "Failed to log", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div>
      <SectionTitle>{slide.title || "Struggles"}</SectionTitle>
      <SectionLead>What's getting in the way? No blame — just name it. We'll action it from the kaizen board.</SectionLead>
      {data.struggles.length > 0 && (
        <div className="glass-panel rounded-2xl overflow-hidden mb-6">
          <p className="text-base font-semibold uppercase tracking-wide text-muted-foreground px-6 py-3 border-b border-border/50">Open struggles</p>
          {data.struggles.map(s => (
            <div key={s.id} className="px-6 py-4 border-b border-border/50 last:border-0">
              <p className="text-2xl font-semibold leading-tight">{s.title}</p>
              <p className="text-lg text-muted-foreground mt-1 leading-snug">{s.description}</p>
            </div>
          ))}
        </div>
      )}
      <div className="glass-panel rounded-2xl p-6">
        <p className="text-base font-semibold uppercase tracking-wide text-muted-foreground mb-3">Log a new struggle</p>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Short title — what's the problem?"
          className="w-full bg-background border border-border rounded-xl p-3 text-base mb-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="A sentence or two of detail"
          className="w-full min-h-[80px] bg-background border border-border rounded-xl p-3 text-base focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <div className="flex justify-end mt-3">
          <button onClick={submit} disabled={!title.trim() || !description.trim() || submitting} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Log struggle"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LearningSlide({ data, slide }: { data: DashboardData; slide: MeetingSlide }) {
  void slide;
  // Host can override which example shows by picking one from this
  // week's principle (or any active principle if they want to skip
  // around). The change is saved to meeting.exampleId so reloading
  // doesn't reset it.
  const queryClient = useQueryClient();
  const meetingId = data.meeting?.id ?? null;
  const principleId = data.lesson?.principleId ?? null;

  const { data: examples = [] } = useQuery<Array<{ id: number; title: string; summary: string }>>({
    queryKey: ["lesson-alts", principleId],
    queryFn: async () => {
      if (!principleId) return [];
      const res = await fetch(`${BASE}/api/morning-meetings/principles/${principleId}/examples`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
    enabled: !!principleId,
  });

  const setOverride = useMutation({
    mutationFn: async (exampleId: number | null) => {
      if (!meetingId) return;
      await fetch(`${BASE}/api/morning-meetings/${meetingId}/example`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exampleId }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["morning-meeting-dashboard"] });
      toast({ title: "Lesson swapped" });
    },
  });
  if (!data.lesson) {
    return (
      <div>
        <SectionTitle>Today's Lean Lesson</SectionTitle>
        <SectionLead>No lesson configured yet.</SectionLead>
      </div>
    );
  }
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-purple-500 mb-2">
        Lean Lesson — {data.lesson.principleTitle ?? `Week ${data.lesson.weekNumber}`}
      </p>
      <h2 className="text-3xl font-display font-bold mb-2">{data.lesson.title}</h2>
      <p className="text-lg text-muted-foreground mb-6">{data.lesson.summary}</p>
      <div className="glass-panel rounded-2xl p-6">
        <MarkdownBlock content={data.lesson.whatToShowMd} />
      </div>
      {data.lesson.videoUrl && (
        <div className="mt-4">
          <YouTubeEmbed url={data.lesson.videoUrl} />
        </div>
      )}
      {meetingId && examples.length > 1 && (
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <span>Swap to a different example:</span>
          <select
            value={data.lesson.id}
            onChange={e => setOverride.mutate(Number(e.target.value))}
            className="bg-background border border-border rounded-lg px-2 py-1 text-xs"
          >
            {examples.map(ex => (
              <option key={ex.id} value={ex.id}>{ex.title}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

// A small rotating bank of gratitude prompts. The host doesn't log
// anything — the slide is here to slow the room down for ten seconds
// and remind everyone to notice one good thing. A different prompt
// shows each day, picked deterministically from the date so the
// rotation is the same on every device.
const GRATITUDE_PROMPTS: ReadonlyArray<{ emoji: string; line: string; sub: string }> = [
  { emoji: "🌅", line: "Take a breath. Notice one good thing.", sub: "Could be anything — coffee, the light, someone showing up early." },
  { emoji: "💛", line: "Who made yesterday easier?", sub: "Picture the person. We'll say thanks later." },
  { emoji: "🌱", line: "Something is growing here.", sub: "What's better this week than last?" },
  { emoji: "🍞", line: "Be grateful for the work.", sub: "Real hands, real food, real customers." },
  { emoji: "🤝", line: "We get to do this together.", sub: "Look around the room. We're not doing it alone." },
  { emoji: "🌤️", line: "Right now, today, is enough.", sub: "Whatever yesterday was, today is fresh." },
  { emoji: "🥖", line: "Someone, somewhere, will love what we make today.", sub: "That's not nothing." },
  { emoji: "🕯️", line: "A tiny kindness counts.", sub: "Pass one to someone before lunch." },
  { emoji: "🌞", line: "Notice the small wins.", sub: "Yesterday had some — name one." },
  { emoji: "🎈", line: "Celebrate something small.", sub: "Birthdays, milestones, a clean station." },
];

function pickGratitudeForDay(dateIso: string) {
  const seed = dateIso.split("-").reduce((acc, part) => acc * 31 + Number(part), 0);
  return GRATITUDE_PROMPTS[seed % GRATITUDE_PROMPTS.length];
}

function GratitudeSlide({ data, slide }: { data: DashboardData; slide: MeetingSlide; onRefresh: () => void }) {
  void slide;
  const todayIso = data.today || new Date().toISOString().slice(0, 10);
  const prompt = pickGratitudeForDay(todayIso);
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-rose-100 via-amber-50 to-emerald-100 dark:from-rose-900/30 dark:via-amber-900/20 dark:to-emerald-900/30 p-12 min-h-[420px] flex flex-col items-center justify-center text-center gap-6 shadow-inner">
      {/* Soft floating shapes for a touch of motion / warmth */}
      <div className="absolute -top-20 -left-20 w-72 h-72 rounded-full bg-rose-200/40 dark:bg-rose-500/10 blur-3xl" />
      <div className="absolute -bottom-24 -right-16 w-80 h-80 rounded-full bg-amber-200/40 dark:bg-amber-500/10 blur-3xl" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-emerald-200/30 dark:bg-emerald-500/10 blur-3xl" />

      <div className="relative z-10 flex flex-col items-center gap-6">
        <div className="text-8xl leading-none">{prompt.emoji}</div>
        <h2 className="font-display text-4xl md:text-5xl font-bold text-foreground leading-tight max-w-3xl">
          {prompt.line}
        </h2>
        <p className="text-xl text-muted-foreground max-w-xl">{prompt.sub}</p>
        <p className="text-xs uppercase tracking-widest text-muted-foreground mt-4">Gratitude</p>
      </div>
    </div>
  );
}

void Link;
void ArrowRight;

// ── Slide editor (Phase 2) ──────────────────────────────────────────
// Same component edits either a meeting's slide list or the master
// template — the only difference is which API endpoints it points at.

const SLIDE_KIND_CATALOG: Array<{ kind: SlideKind; label: string; description: string }> = [
  { kind: "special_prep",        label: "Test Product Prep",    description: "Tomorrow's non-core items being prepped today" },
  { kind: "stretches",           label: "Stretches",            description: "Daily-random stretches, auto-cycling 10s each" },
  { kind: "yesterday_kpis",      label: "Yesterday's Numbers",  description: "Building rate, packing rate, wonkies" },
  { kind: "order_of_production", label: "Order of Production",  description: "Today's recipe order + batches" },
  { kind: "local_delivery",      label: "Local Despatch",       description: "Any local despatches + today's deliveries in" },
  { kind: "bag_orders",          label: "Bag Orders",           description: "Discussion prompt" },
  { kind: "short_on_pack",       label: "Short on the Pack",    description: "Yesterday's shorts + leftover" },
  { kind: "safety_issues",       label: "Safety Issues",        description: "Open andons + log new" },
  { kind: "system_updates",      label: "System Updates",       description: "Auto-pulls recent commits to the planner" },
  { kind: "new_sops",            label: "New & Updated SOPs",   description: "SOPs touched in last 7 days" },
  { kind: "struggles",           label: "Struggles",            description: "Open struggles + log new" },
  { kind: "lesson",              label: "Lean Lesson",          description: "Today's principle + example" },
  { kind: "gratitude",           label: "Gratitude",            description: "Capture shout-outs" },
  { kind: "custom_markdown",     label: "Custom note",          description: "Freeform markdown slide" },
];

function AutoStartGate({ hostName, onStart, starting }: { hostName: string; onStart: () => void; starting: boolean }) {
  return (
    <div className="fixed inset-0 bg-background flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <p className="text-muted-foreground mb-4">Today's meeting hasn't been started yet.</p>
        <button
          onClick={onStart}
          disabled={!hostName.trim() || starting}
          className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50 inline-flex items-center gap-2"
        >
          {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          Start it so you can edit
        </button>
      </div>
    </div>
  );
}

interface EditorSlide {
  id: number;
  kind: string;
  title: string;
  orderPosition: number;
  contentMd: string | null;
  configJson: Record<string, unknown> | null;
}

function SlideEditor({
  mode, id, titleSuffix, onClose,
}: {
  mode: "meeting" | "template";
  id: number | null;
  titleSuffix: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  // For "template" mode the caller passed id=null because the default
  // template's id isn't known upstream. Resolve it on mount and cache.
  const [templateId, setTemplateId] = useState<number | null>(mode === "template" ? null : id);
  useEffect(() => {
    if (mode !== "template") return;
    fetch(`${BASE}/api/morning-meetings/templates`, { credentials: "include" })
      .then(r => r.json())
      .then((rows: Array<{ id: number; isDefault: boolean }>) => {
        const def = rows.find(r => r.isDefault) ?? rows[0];
        if (def) setTemplateId(def.id);
      });
  }, [mode]);

  const effectiveId = mode === "template" ? templateId : id;
  const queryKey = mode === "template"
    ? ["meeting-template-slides", effectiveId]
    : ["meeting-slides", effectiveId];
  const listUrl = mode === "template"
    ? `${BASE}/api/morning-meetings/templates/${effectiveId}/slides`
    : `${BASE}/api/morning-meetings/${effectiveId}/slides`;

  const { data: slides = [], isLoading } = useQuery<EditorSlide[]>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(listUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load slides");
      return res.json();
    },
    enabled: effectiveId != null,
  });

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);

  const slideUrl = (sid: number) => mode === "template"
    ? `${BASE}/api/morning-meetings/template-slides/${sid}`
    : `${BASE}/api/morning-meetings/slides/${sid}`;
  const reorderUrl = mode === "template"
    ? `${BASE}/api/morning-meetings/templates/${effectiveId}/slides/reorder`
    : `${BASE}/api/morning-meetings/${effectiveId}/slides/reorder`;
  const addUrl = mode === "template"
    ? `${BASE}/api/morning-meetings/templates/${effectiveId}/slides`
    : `${BASE}/api/morning-meetings/${effectiveId}/slides`;

  const reorder = useMutation({
    mutationFn: async (order: Array<{ id: number; orderPosition: number }>) => {
      await fetch(reorderUrl, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const updateSlide = useMutation({
    mutationFn: async ({ sid, patch }: { sid: number; patch: Partial<EditorSlide> }) => {
      await fetch(slideUrl(sid), {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const removeSlide = useMutation({
    mutationFn: async (sid: number) => {
      await fetch(slideUrl(sid), { method: "DELETE", credentials: "include" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const addSlide = useMutation({
    mutationFn: async (input: { kind: string; title: string }) => {
      await fetch(addUrl, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setShowCatalog(false);
    },
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = slides.map(s => s.id);
    const oldIdx = ids.indexOf(Number(active.id));
    const newIdx = ids.indexOf(Number(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(slides, oldIdx, newIdx);
    reorder.mutate(reordered.map((s, i) => ({ id: s.id, orderPosition: i })));
  };

  if (effectiveId == null || isLoading) {
    return (
      <div className="fixed inset-0 bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-background overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-2">
          <button onClick={onClose} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Back to meeting
          </button>
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {mode === "template" ? "Master template" : "Today's meeting"}
          </span>
        </div>
        <h1 className="text-2xl font-display font-bold mb-1 flex items-center gap-2">
          {mode === "template" ? <Settings className="w-5 h-5 text-muted-foreground" /> : <Edit3 className="w-5 h-5 text-primary" />}
          Edit slides
        </h1>
        <p className="text-sm text-muted-foreground mb-6">{titleSuffix}</p>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={slides.map(s => s.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {slides.map(s => (
                <SortableSlideRow
                  key={s.id}
                  slide={s}
                  expanded={expandedId === s.id}
                  onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)}
                  onSave={(patch) => updateSlide.mutate({ sid: s.id, patch })}
                  onRemove={() => {
                    if (confirm(`Remove "${s.title}" from this list?`)) removeSlide.mutate(s.id);
                  }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {/* Add slide */}
        <div className="mt-4">
          {!showCatalog ? (
            <button
              onClick={() => setShowCatalog(true)}
              className="w-full px-4 py-3 rounded-xl border-2 border-dashed border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/30 flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" /> Add a slide
            </button>
          ) : (
            <div className="glass-panel rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold">Pick a slide type</p>
                <button onClick={() => setShowCatalog(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SLIDE_KIND_CATALOG.map(c => (
                  <button
                    key={c.kind}
                    onClick={() => addSlide.mutate({ kind: c.kind, title: c.label })}
                    disabled={addSlide.isPending}
                    className="text-left px-4 py-3 rounded-xl border border-border hover:border-primary hover:bg-secondary/30 transition-colors disabled:opacity-50"
                  >
                    <p className="font-medium text-sm">{c.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <button onClick={onClose} className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 inline-flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> Done
          </button>
        </div>
      </div>
    </div>
  );
}

function SortableSlideRow({
  slide, expanded, onToggle, onSave, onRemove,
}: {
  slide: EditorSlide;
  expanded: boolean;
  onToggle: () => void;
  onSave: (patch: Partial<EditorSlide>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  const meta = SLIDE_KIND_META[slide.kind as SlideKind] ?? SLIDE_KIND_META.custom_markdown;
  const SlideIcon = meta.icon;

  const [title, setTitle] = useState(slide.title);
  const [contentMd, setContentMd] = useState(slide.contentMd ?? "");
  useEffect(() => { setTitle(slide.title); setContentMd(slide.contentMd ?? ""); }, [slide.id, slide.title, slide.contentMd]);
  const dirty = title !== slide.title || contentMd !== (slide.contentMd ?? "");

  // KPI selector for yesterday_kpis slide
  const cfgKpis = slide.kind === "yesterday_kpis"
    ? (Array.isArray(slide.configJson?.kpis) ? slide.configJson!.kpis as string[] : DEFAULT_KPIS as string[])
    : null;
  const toggleKpi = (key: string) => {
    if (!cfgKpis) return;
    const next = cfgKpis.includes(key) ? cfgKpis.filter(k => k !== key) : [...cfgKpis, key];
    onSave({ configJson: { ...(slide.configJson ?? {}), kpis: next } });
  };

  // YouTube URL is a per-slide config knob for the freeform / discussion
  // slide kinds — paste a URL and it embeds inline at the bottom.
  const initialVideoUrl = typeof slide.configJson?.videoUrl === "string" ? slide.configJson.videoUrl : "";
  const [videoUrl, setVideoUrl] = useState(initialVideoUrl);
  useEffect(() => { setVideoUrl(initialVideoUrl); }, [slide.id, initialVideoUrl]);
  const videoSupported = slide.kind === "custom_markdown" || slide.kind === "bag_orders" || slide.kind === "short_on_pack" || slide.kind === "special_prep";
  const videoDirty = videoSupported && videoUrl !== initialVideoUrl;
  const anyDirty = dirty || videoDirty;

  return (
    <div ref={setNodeRef} style={style} className="border border-border rounded-xl bg-card">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          {...attributes}
          {...listeners}
          className="p-1.5 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing touch-none"
          aria-label="Drag to reorder"
        >
          <GripVertical className="w-4 h-4" />
        </button>
        <SlideIcon className={cn("w-4 h-4 shrink-0", meta.color)} />
        <button onClick={onToggle} className="flex-1 text-left min-w-0">
          <p className="text-sm font-medium truncate">{slide.title}</p>
          <p className="text-xs text-muted-foreground">{meta.fallbackTitle === slide.title ? "" : meta.fallbackTitle}</p>
        </button>
        <button
          onClick={onRemove}
          className="p-1.5 text-muted-foreground hover:text-destructive"
          aria-label="Remove slide"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 block">Title shown to the team</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full bg-background border border-border rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          {videoSupported && (
            <>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 block">Note / discussion prompt (markdown, optional)</label>
                <textarea
                  value={contentMd}
                  onChange={e => setContentMd(e.target.value)}
                  className="w-full min-h-[100px] bg-background border border-border rounded-lg p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 block">YouTube URL (optional)</label>
                <input
                  value={videoUrl}
                  onChange={e => setVideoUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=… or https://youtu.be/…"
                  className="w-full bg-background border border-border rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                {videoUrl && (
                  <div className="mt-2">
                    <YouTubeEmbed url={videoUrl} />
                  </div>
                )}
              </div>
            </>
          )}
          {slide.kind === "yesterday_kpis" && cfgKpis && (
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 block">KPI tiles to show</label>
              <div className="flex flex-wrap gap-2">
                {Object.entries(KPI_CATALOG).map(([key, def]) => {
                  const on = cfgKpis.includes(key);
                  return (
                    <button
                      key={key}
                      onClick={() => toggleKpi(key)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-medium border",
                        on ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {def.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => { setTitle(slide.title); setContentMd(slide.contentMd ?? ""); setVideoUrl(initialVideoUrl); }}
              disabled={!anyDirty}
              className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              Reset
            </button>
            <button
              onClick={() => {
                const patch: Partial<EditorSlide> = { title, contentMd: contentMd || null };
                if (videoSupported) {
                  const nextCfg: Record<string, unknown> = { ...(slide.configJson ?? {}) };
                  if (videoUrl.trim()) nextCfg.videoUrl = videoUrl.trim();
                  else delete nextCfg.videoUrl;
                  patch.configJson = nextCfg;
                }
                onSave(patch);
              }}
              disabled={!anyDirty}
              className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" /> Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Curriculum admin (Phase 3) ──────────────────────────────────────
// Lists every principle (weekly theme) and lets the admin add/edit
// examples under each one. The Morning Meeting's auto-rotation picks
// the right principle for this week and the right example for today's
// weekday from these tables.

interface PrincipleRow {
  id: number;
  weekPosition: number;
  title: string;
  summary: string;
  isActive: boolean;
}
interface ExampleRow {
  id: number;
  principleId: number;
  orderPosition: number;
  title: string;
  summary: string;
  explanationMd: string;
  whatToShowMd: string;
  deliveryNotesMd: string;
  videoUrl: string | null;
  isActive: boolean;
}

function CurriculumEditor({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSummary, setNewSummary] = useState("");

  const { data: principles = [], isLoading } = useQuery<PrincipleRow[]>({
    queryKey: ["lean-principles"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/morning-meetings/principles`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load principles");
      return res.json();
    },
  });

  const addPrinciple = useMutation({
    mutationFn: async () => {
      await fetch(`${BASE}/api/morning-meetings/principles`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle, summary: newSummary }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lean-principles"] });
      setNewTitle(""); setNewSummary(""); setShowAdd(false);
      toast({ title: "Principle added" });
    },
  });

  return (
    <div className="fixed inset-0 bg-background overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-2">
          <button onClick={onClose} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Back to meeting
          </button>
        </div>
        <h1 className="text-2xl font-display font-bold mb-1 flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-purple-500" />
          Lean Curriculum
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          Weekly themes rotate through the year. Each theme has multiple daily examples — the Morning Meeting auto-picks today's based on weekday so the team gets a different angle on the same principle Mon-Fri.
        </p>

        {isLoading ? (
          <div className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground inline" /></div>
        ) : (
          <div className="space-y-2">
            {principles.map(p => (
              <PrincipleCard
                key={p.id}
                principle={p}
                expanded={expandedId === p.id}
                onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
              />
            ))}
          </div>
        )}

        <div className="mt-4">
          {showAdd ? (
            <div className="glass-panel rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold">Add a new principle</p>
                <button onClick={() => setShowAdd(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>
              <input
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="Title (e.g. Leave it better than you found it)"
                className="w-full bg-background border border-border rounded-lg p-2.5 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <input
                value={newSummary}
                onChange={e => setNewSummary(e.target.value)}
                placeholder="One-line summary"
                className="w-full bg-background border border-border rounded-lg p-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <div className="flex justify-end">
                <button
                  onClick={() => addPrinciple.mutate()}
                  disabled={!newTitle.trim() || !newSummary.trim() || addPrinciple.isPending}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {addPrinciple.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Add
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAdd(true)}
              className="w-full px-4 py-3 rounded-xl border-2 border-dashed border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/30 flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" /> Add a new principle
            </button>
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <button onClick={onClose} className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 inline-flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> Done
          </button>
        </div>
      </div>
    </div>
  );
}

function PrincipleCard({ principle, expanded, onToggle }: { principle: PrincipleRow; expanded: boolean; onToggle: () => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(principle.title);
  const [summary, setSummary] = useState(principle.summary);
  useEffect(() => { setTitle(principle.title); setSummary(principle.summary); }, [principle.id, principle.title, principle.summary]);

  const { data: examples = [], isLoading } = useQuery<ExampleRow[]>({
    queryKey: ["lean-examples", principle.id],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/morning-meetings/principles/${principle.id}/examples`, { credentials: "include" });
      if (!res.ok) throw new Error();
      return res.json();
    },
    enabled: expanded,
  });

  const saveSummary = useMutation({
    mutationFn: async () => {
      await fetch(`${BASE}/api/morning-meetings/principles/${principle.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, summary }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lean-principles"] });
      setEditing(false);
      toast({ title: "Principle saved" });
    },
  });

  const togglePrincipleActive = useMutation({
    mutationFn: async () => {
      await fetch(`${BASE}/api/morning-meetings/principles/${principle.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !principle.isActive }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lean-principles"] }),
  });

  const [showAddExample, setShowAddExample] = useState(false);
  const [exTitle, setExTitle] = useState("");
  const [exSummary, setExSummary] = useState("");
  const [exWhatToShow, setExWhatToShow] = useState("");
  const addExample = useMutation({
    mutationFn: async () => {
      await fetch(`${BASE}/api/morning-meetings/principles/${principle.id}/examples`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: exTitle,
          summary: exSummary,
          explanationMd: "",
          whatToShowMd: exWhatToShow,
          deliveryNotesMd: "",
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lean-examples", principle.id] });
      setExTitle(""); setExSummary(""); setExWhatToShow(""); setShowAddExample(false);
      toast({ title: "Example added" });
    },
  });

  return (
    <div className="border border-border rounded-xl bg-card">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/30">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xs font-semibold text-muted-foreground tabular-nums w-12 shrink-0">Wk {principle.weekPosition}</span>
          <div className="text-left min-w-0">
            <p className={cn("font-medium truncate", !principle.isActive && "line-through text-muted-foreground")}>{principle.title}</p>
            <p className="text-xs text-muted-foreground truncate">{principle.summary}</p>
          </div>
        </div>
        <span className="text-xs text-muted-foreground shrink-0 ml-3">
          {expanded ? "Hide" : `${examples.length || "?"} examples`}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          {editing ? (
            <div className="space-y-2">
              <input value={title} onChange={e => setTitle(e.target.value)} className="w-full bg-background border border-border rounded-lg p-2 text-sm" />
              <input value={summary} onChange={e => setSummary(e.target.value)} className="w-full bg-background border border-border rounded-lg p-2 text-sm" />
              <div className="flex justify-end gap-2">
                <button onClick={() => { setEditing(false); setTitle(principle.title); setSummary(principle.summary); }} className="text-sm text-muted-foreground hover:text-foreground">Cancel</button>
                <button onClick={() => saveSummary.mutate()} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5">
                  <Save className="w-3.5 h-3.5" /> Save
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between text-xs">
              <button onClick={() => setEditing(true)} className="text-primary hover:underline">Edit principle</button>
              <button onClick={() => togglePrincipleActive.mutate()} className="text-muted-foreground hover:text-foreground">
                {principle.isActive ? "Deactivate" : "Re-activate"}
              </button>
            </div>
          )}

          {/* Examples */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Examples</p>
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            ) : examples.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No examples yet — add one below.</p>
            ) : (
              <div className="space-y-1.5">
                {examples.map(ex => (
                  <ExampleRowEdit key={ex.id} example={ex} principleId={principle.id} />
                ))}
              </div>
            )}
          </div>

          {showAddExample ? (
            <div className="mt-2 border border-border rounded-xl p-3 space-y-2">
              <input value={exTitle} onChange={e => setExTitle(e.target.value)} placeholder="Title (e.g. Sweep — daily reset of your station)" className="w-full bg-background border border-border rounded-lg p-2 text-sm" />
              <input value={exSummary} onChange={e => setExSummary(e.target.value)} placeholder="One-line summary" className="w-full bg-background border border-border rounded-lg p-2 text-sm" />
              <textarea value={exWhatToShow} onChange={e => setExWhatToShow(e.target.value)} placeholder="What the team will see (markdown)" className="w-full bg-background border border-border rounded-lg p-2 text-sm min-h-[80px] font-mono" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowAddExample(false)} className="text-sm text-muted-foreground hover:text-foreground">Cancel</button>
                <button
                  onClick={() => addExample.mutate()}
                  disabled={!exTitle.trim() || !exSummary.trim()}
                  className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" /> Add example
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowAddExample(true)} className="text-xs text-primary hover:underline flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add example
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ExampleRowEdit({ example, principleId }: { example: ExampleRow; principleId: number }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(example.title);
  const [summary, setSummary] = useState(example.summary);
  const [explanation, setExplanation] = useState(example.explanationMd);
  const [whatToShow, setWhatToShow] = useState(example.whatToShowMd);
  const [deliveryNotes, setDeliveryNotes] = useState(example.deliveryNotesMd);
  const [videoUrl, setVideoUrl] = useState(example.videoUrl ?? "");
  useEffect(() => {
    setTitle(example.title); setSummary(example.summary);
    setExplanation(example.explanationMd); setWhatToShow(example.whatToShowMd);
    setDeliveryNotes(example.deliveryNotesMd); setVideoUrl(example.videoUrl ?? "");
  }, [example.id, example.title, example.summary, example.explanationMd, example.whatToShowMd, example.deliveryNotesMd, example.videoUrl]);

  const save = useMutation({
    mutationFn: async () => {
      await fetch(`${BASE}/api/morning-meetings/examples/${example.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, summary, explanationMd: explanation, whatToShowMd: whatToShow, deliveryNotesMd: deliveryNotes, videoUrl: videoUrl.trim() || null }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lean-examples", principleId] });
      setOpen(false);
      toast({ title: "Example saved" });
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      await fetch(`${BASE}/api/morning-meetings/examples/${example.id}`, { method: "DELETE", credentials: "include" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lean-examples", principleId] }),
  });

  return (
    <div className="border border-border rounded-lg">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-secondary/20">
        <span className="text-sm font-medium">{example.title}</span>
        <span className="text-xs text-muted-foreground">{open ? "Hide" : "Edit"}</span>
      </button>
      {open && (
        <div className="border-t border-border p-3 space-y-2">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" className="w-full bg-background border border-border rounded-lg p-2 text-sm" />
          <input value={summary} onChange={e => setSummary(e.target.value)} placeholder="Summary" className="w-full bg-background border border-border rounded-lg p-2 text-sm" />
          <div>
            <input
              value={videoUrl}
              onChange={e => setVideoUrl(e.target.value)}
              placeholder="YouTube URL (optional) — https://www.youtube.com/watch?v=… or https://youtu.be/…"
              className="w-full bg-background border border-border rounded-lg p-2 text-sm"
            />
            {videoUrl && <div className="mt-2"><YouTubeEmbed url={videoUrl} /></div>}
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Host briefing (Markdown — optional)</summary>
            <div className="mt-2 space-y-2">
              <textarea value={explanation} onChange={e => setExplanation(e.target.value)} placeholder="What it means (Markdown)" className="w-full bg-background border border-border rounded-lg p-2 text-xs min-h-[80px] font-mono" />
              <textarea value={whatToShow} onChange={e => setWhatToShow(e.target.value)} placeholder="What you'll show the team (Markdown)" className="w-full bg-background border border-border rounded-lg p-2 text-xs min-h-[80px] font-mono" />
              <textarea value={deliveryNotes} onChange={e => setDeliveryNotes(e.target.value)} placeholder="How to deliver (talking points)" className="w-full bg-background border border-border rounded-lg p-2 text-xs min-h-[80px] font-mono" />
            </div>
          </details>
          <div className="flex items-center justify-between">
            <button onClick={() => { if (confirm("Delete this example?")) remove.mutate(); }} className="text-xs text-destructive hover:underline">Delete</button>
            <button onClick={() => save.mutate()} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5">
              <Save className="w-3.5 h-3.5" /> Save example
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
