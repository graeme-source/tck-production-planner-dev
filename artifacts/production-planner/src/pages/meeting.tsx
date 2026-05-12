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
import { useEffect, useMemo, useState, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, X, Play, Pause, RotateCcw,
  Sparkles, ChefHat, Truck, ShoppingBag, AlertCircle, FileText, MessageCircle,
  HeartHandshake, Activity, BookOpen, Award, Loader2, ClipboardCheck, Sun,
  CheckCircle2, Heart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface DashboardData {
  today: string;
  yesterday: string;
  special: { id: number; name: string } | null;
  todayPlan: {
    id: number | null;
    items: Array<{ recipeId: number; recipeName: string; batchesTarget: number; recipeCategory: string | null }>;
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
  } | null;
  meeting: { id: number; hostName: string | null; startedAt: string; endedAt: string | null; lessonId: number | null } | null;
  gratitude: Array<{ id: number; fromName: string; toName: string | null; content: string }>;
}

async function fetchDashboard(): Promise<DashboardData> {
  const res = await fetch(`${BASE}/api/morning-meetings/dashboard`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Stretches slide ──────────────────────────────────────────────────
// Three 60-second stretches. The slide auto-cycles between them when
// the timer hits zero, so the host doesn't have to babysit it.
const STRETCHES = [
  { name: "Neck rolls", description: "Slow circles, both directions. Drop the shoulders." },
  { name: "Shoulder + back stretch", description: "Reach overhead, then fold forward gently." },
  { name: "Wrist + finger stretch", description: "Roll wrists, splay fingers, shake them out." },
];

function StretchesPanel() {
  const [index, setIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) {
          if (index < STRETCHES.length - 1) {
            setIndex(i => i + 1);
            return 60;
          }
          setRunning(false);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, index]);
  const current = STRETCHES[index];
  return (
    <div className="flex flex-col items-center gap-6 max-w-2xl mx-auto">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{index + 1} of {STRETCHES.length}</div>
      <h2 className="text-4xl font-display font-bold text-center">{current.name}</h2>
      <p className="text-xl text-muted-foreground text-center max-w-md">{current.description}</p>
      <div className="text-7xl font-display font-bold tabular-nums">{secondsLeft}s</div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => setRunning(r => !r)}
          className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center gap-2 hover:bg-primary/90"
        >
          {running ? <><Pause className="w-4 h-4" /> Pause</> : <><Play className="w-4 h-4" /> Start</>}
        </button>
        <button
          onClick={() => { setSecondsLeft(60); setRunning(false); }}
          className="px-4 py-2.5 rounded-xl border border-border text-muted-foreground hover:text-foreground flex items-center gap-2"
        >
          <RotateCcw className="w-4 h-4" /> Reset
        </button>
        {index < STRETCHES.length - 1 && (
          <button
            onClick={() => { setIndex(i => i + 1); setSecondsLeft(60); setRunning(false); }}
            className="px-4 py-2.5 rounded-xl border border-border text-muted-foreground hover:text-foreground flex items-center gap-2"
          >
            Next stretch <ChevronRight className="w-4 h-4" />
          </button>
        )}
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

// ── Slide types & registry ───────────────────────────────────────────
type SlideKey =
  | "special_prep"
  | "stretches"
  | "yesterday_kpis"
  | "order_of_production"
  | "local_delivery"
  | "bag_orders"
  | "short_on_pack"
  | "safety_issues"
  | "new_sops"
  | "struggles"
  | "learning"
  | "gratitude";

interface SlideMeta {
  key: SlideKey;
  title: string;
  icon: React.ElementType;
  color: string;
}

const SLIDE_ORDER: SlideMeta[] = [
  { key: "special_prep",       title: "Special Prep",         icon: Award,        color: "text-amber-500" },
  { key: "stretches",          title: "Stretches",            icon: Activity,     color: "text-emerald-500" },
  { key: "yesterday_kpis",     title: "Yesterday's Numbers",  icon: ChefHat,      color: "text-violet-500" },
  { key: "order_of_production",title: "Order of Production",  icon: ClipboardCheck,color: "text-primary" },
  { key: "local_delivery",     title: "Local Delivery",       icon: Truck,        color: "text-blue-500" },
  { key: "bag_orders",         title: "Bag Orders",           icon: ShoppingBag,  color: "text-indigo-500" },
  { key: "short_on_pack",      title: "Short on the Pack",    icon: AlertCircle,  color: "text-orange-500" },
  { key: "safety_issues",      title: "Safety Issues",        icon: AlertCircle,  color: "text-red-500" },
  { key: "new_sops",           title: "New & Updated SOPs",   icon: FileText,     color: "text-cyan-500" },
  { key: "struggles",          title: "Struggles",            icon: MessageCircle,color: "text-pink-500" },
  { key: "learning",           title: "Today's Lean Lesson",  icon: BookOpen,     color: "text-purple-500" },
  { key: "gratitude",          title: "Gratitude",            icon: Heart,        color: "text-rose-500" },
];

// ── Page ─────────────────────────────────────────────────────────────
type Mode = "setup" | "prep" | "meeting" | "done";

export default function MeetingPage() {
  const { state } = useAuth();
  const currentUserName = state.status === "authenticated" ? state.user.name : "";
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<Mode>("setup");
  const [hostName, setHostName] = useState(currentUserName);
  const [slideIndex, setSlideIndex] = useState(0);

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

  const advance = useCallback(() => setSlideIndex(i => Math.min(SLIDE_ORDER.length - 1, i + 1)), []);
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

  if (mode === "setup") {
    return <SetupScreen
      data={data}
      hostName={hostName}
      onHostNameChange={setHostName}
      onReadBriefing={() => setMode("prep")}
      onStart={() => startMutation.mutate()}
      starting={startMutation.isPending}
      onExit={() => navigate("/")}
    />;
  }

  if (mode === "prep") {
    return <PrepMode lesson={data.lesson} onBack={() => setMode("setup")} onDone={() => setMode("setup")} />;
  }

  if (mode === "done") {
    return <DoneScreen data={data} onClose={() => navigate("/")} />;
  }

  const slide = SLIDE_ORDER[slideIndex];
  return (
    <div className="fixed inset-0 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-3 min-w-0">
          <slide.icon className={cn("w-5 h-5", slide.color)} />
          <h1 className="text-lg font-semibold truncate">{slide.title}</h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground tabular-nums">{slideIndex + 1} / {SLIDE_ORDER.length}</span>
          <button onClick={() => endMutation.mutate()} className="text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5">
            End meeting
          </button>
          <button onClick={() => setMode("setup")} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-secondary">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${((slideIndex + 1) / SLIDE_ORDER.length) * 100}%` }}
        />
      </div>

      {/* Slide body */}
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-4xl mx-auto">
          <SlideBody slide={slide} data={data} onRefresh={() => refetch()} />
        </div>
      </div>

      {/* Footer nav */}
      <div className="flex items-center justify-between px-6 py-3 border-t border-border bg-card">
        <button
          onClick={retreat}
          disabled={slideIndex === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-border disabled:opacity-30 disabled:cursor-not-allowed hover:bg-secondary/50"
        >
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-1">
          {SLIDE_ORDER.map((s, i) => (
            <button
              key={s.key}
              onClick={() => setSlideIndex(i)}
              className={cn(
                "w-2 h-2 rounded-full transition-all",
                i === slideIndex ? "bg-primary w-6" : i < slideIndex ? "bg-primary/40" : "bg-secondary",
              )}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>
        {slideIndex < SLIDE_ORDER.length - 1 ? (
          <button
            onClick={advance}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={() => endMutation.mutate()}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Finish <CheckCircle2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Setup screen ────────────────────────────────────────────────────
function SetupScreen({
  data, hostName, onHostNameChange, onReadBriefing, onStart, starting, onExit,
}: {
  data: DashboardData;
  hostName: string;
  onHostNameChange: (s: string) => void;
  onReadBriefing: () => void;
  onStart: () => void;
  starting: boolean;
  onExit: () => void;
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
        <p className="text-muted-foreground mb-8">Two Second Lean — 10 minutes. Safety, stretches, the plan, today's lesson, gratitude.</p>

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
function SlideBody({ slide, data, onRefresh }: { slide: SlideMeta; data: DashboardData; onRefresh: () => void }) {
  switch (slide.key) {
    case "special_prep": return <SpecialPrepSlide data={data} />;
    case "stretches": return <StretchesPanel />;
    case "yesterday_kpis": return <YesterdayKpisSlide data={data} />;
    case "order_of_production": return <OrderOfProductionSlide data={data} />;
    case "local_delivery": return <LocalDeliverySlide data={data} />;
    case "bag_orders": return <BagOrdersSlide />;
    case "short_on_pack": return <ShortOnPackSlide data={data} />;
    case "safety_issues": return <SafetyIssuesSlide data={data} onRefresh={onRefresh} />;
    case "new_sops": return <NewSopsSlide data={data} />;
    case "struggles": return <StrugglesSlide data={data} onRefresh={onRefresh} />;
    case "learning": return <LearningSlide data={data} />;
    case "gratitude": return <GratitudeSlide data={data} onRefresh={onRefresh} />;
  }
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-3xl font-display font-bold mb-4">{children}</h2>;
}
function SectionLead({ children }: { children: React.ReactNode }) {
  return <p className="text-lg text-muted-foreground mb-6">{children}</p>;
}

function SpecialPrepSlide({ data }: { data: DashboardData }) {
  return (
    <div>
      <SectionTitle>Special Prep</SectionTitle>
      <SectionLead>What's on top of the usual today?</SectionLead>
      <div className="glass-panel p-6 rounded-2xl">
        {data.special ? (
          <>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Current special</p>
            <h3 className="text-2xl font-display font-bold">{data.special.name}</h3>
          </>
        ) : (
          <p className="text-muted-foreground">No special configured. Talk through any one-off prep needed today.</p>
        )}
      </div>
    </div>
  );
}

function YesterdayKpisSlide({ data }: { data: DashboardData }) {
  const k = data.yesterdayKpis;
  return (
    <div>
      <SectionTitle>Yesterday's Numbers</SectionTitle>
      <SectionLead>How did the last shift go?</SectionLead>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <KpiTile label="Batches" value={k.batchesTarget.toString()} />
        <KpiTile label="Wonkies" value={k.wonkyCount.toString()} tone={k.wonkyCount > 20 ? "warn" : "ok"} />
        <KpiTile label="Builder batches/hr" value={k.builderBatchesPerHour != null ? k.builderBatchesPerHour.toFixed(1) : "—"} />
        <KpiTile label="Packing batches/hr" value={k.packingBatchesPerHour != null ? k.packingBatchesPerHour.toFixed(1) : "—"} />
        <KpiTile label="Short on pack" value={k.shortCount.toString()} tone={k.shortCount > 0 ? "warn" : "ok"} />
        <KpiTile label="Leftover filling (g)" value={k.leftoverFillingGrams.toString()} />
      </div>
    </div>
  );
}

function KpiTile({ label, value, tone = "ok" }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className={cn("glass-panel rounded-2xl p-5", tone === "warn" && "border-amber-300/60 dark:border-amber-700/40")}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{label}</p>
      <p className="text-3xl font-display font-bold tabular-nums">{value}</p>
    </div>
  );
}

function OrderOfProductionSlide({ data }: { data: DashboardData }) {
  return (
    <div>
      <SectionTitle>Order of Production</SectionTitle>
      <SectionLead>Today's plan — Mac &amp; Cheese first, then through the calzones.</SectionLead>
      {data.todayPlan.items.length === 0 ? (
        <div className="glass-panel rounded-2xl p-6 text-muted-foreground">No plan published for today yet.</div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          {data.todayPlan.items.map((it, i) => (
            <div key={it.recipeId} className={cn("flex items-center justify-between px-5 py-3", i > 0 && "border-t border-border/50")}>
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xs text-muted-foreground tabular-nums w-6">{i + 1}</span>
                <span className="font-medium truncate">{it.recipeName}</span>
                {it.recipeCategory === "Macaroni Cheese" && <span className="text-[10px] uppercase tracking-wide bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full font-semibold">Mac</span>}
              </div>
              <span className="text-sm font-semibold tabular-nums">{it.batchesTarget}{it.recipeCategory === "Macaroni Cheese" ? " packs" : " batches"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LocalDeliverySlide({ data }: { data: DashboardData }) {
  return (
    <div>
      <SectionTitle>Local Delivery</SectionTitle>
      <SectionLead>Anyone coming to the door today?</SectionLead>
      {data.todayDeliveries.length === 0 ? (
        <div className="glass-panel rounded-2xl p-6 text-muted-foreground">No deliveries scheduled for today.</div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          {data.todayDeliveries.map((d, i) => (
            <div key={d.id} className={cn("flex items-center justify-between px-5 py-3", i > 0 && "border-t border-border/50")}>
              <span className="font-medium">{d.supplierName}</span>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">{d.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BagOrdersSlide() {
  return (
    <div>
      <SectionTitle>Bag Orders</SectionTitle>
      <SectionLead>Anything special for bag customers today? Anyone missing from the dispatch list?</SectionLead>
      <div className="glass-panel rounded-2xl p-8 text-center text-muted-foreground">
        <ShoppingBag className="w-12 h-12 mx-auto mb-3 opacity-40" />
        <p>Quick verbal check — host calls out any unusual bag orders or customer notes.</p>
      </div>
    </div>
  );
}

function ShortOnPackSlide({ data }: { data: DashboardData }) {
  const k = data.yesterdayKpis;
  return (
    <div>
      <SectionTitle>Short on the Pack</SectionTitle>
      <SectionLead>What didn't we have enough of yesterday? Where did we leave filling?</SectionLead>
      <div className="grid grid-cols-2 gap-4">
        <KpiTile label="Shorts yesterday" value={k.shortCount.toString()} tone={k.shortCount > 0 ? "warn" : "ok"} />
        <KpiTile label="Leftover filling" value={`${k.leftoverFillingGrams}g`} tone={k.leftoverFillingGrams > 500 ? "warn" : "ok"} />
      </div>
    </div>
  );
}

function SafetyIssuesSlide({ data, onRefresh }: { data: DashboardData; onRefresh: () => void }) {
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
      <SectionTitle>Safety Issues</SectionTitle>
      <SectionLead>Anyone got a safety concern? Speak up.</SectionLead>
      {data.safetyIssues.length > 0 && (
        <div className="glass-panel rounded-2xl overflow-hidden mb-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-5 py-3 border-b border-border/50">Open safety items</p>
          {data.safetyIssues.map(s => (
            <div key={s.id} className="px-5 py-3 border-b border-border/50 last:border-0 flex items-start gap-3">
              <span className={cn("w-2 h-2 rounded-full mt-2 shrink-0", s.severity === "red" ? "bg-red-500" : "bg-amber-500")} />
              <p className="text-sm flex-1">{s.description ?? "(no description)"}</p>
            </div>
          ))}
        </div>
      )}
      <div className="glass-panel rounded-2xl p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Log a new safety issue</p>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="What's the concern?"
          className="w-full min-h-[80px] bg-background border border-border rounded-xl p-3 text-base focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setSeverity("yellow")} className={cn("px-3 py-1.5 rounded-lg text-xs font-medium border", severity === "yellow" ? "bg-amber-500/20 border-amber-500/50 text-amber-700 dark:text-amber-300" : "border-border")}>Yellow</button>
            <button onClick={() => setSeverity("red")} className={cn("px-3 py-1.5 rounded-lg text-xs font-medium border", severity === "red" ? "bg-red-500/20 border-red-500/50 text-red-700 dark:text-red-300" : "border-border")}>Red</button>
          </div>
          <button onClick={submit} disabled={!description.trim() || submitting} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Log issue"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewSopsSlide({ data }: { data: DashboardData }) {
  return (
    <div>
      <SectionTitle>New &amp; Updated SOPs</SectionTitle>
      <SectionLead>Anything changed in the last week that everyone should know about?</SectionLead>
      {data.recentSops.length === 0 ? (
        <div className="glass-panel rounded-2xl p-6 text-muted-foreground">No SOP updates in the last 7 days.</div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          {data.recentSops.map((s, i) => (
            <div key={s.id} className={cn("flex items-center justify-between px-5 py-3", i > 0 && "border-t border-border/50")}>
              <span className="font-medium">{s.title}</span>
              <span className="text-xs text-muted-foreground">{format(new Date(s.updatedAt), "EEE d MMM")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StrugglesSlide({ data, onRefresh }: { data: DashboardData; onRefresh: () => void }) {
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
      <SectionTitle>Struggles</SectionTitle>
      <SectionLead>What's getting in the way? No blame — just name it. We'll action it from the kaizen board.</SectionLead>
      {data.struggles.length > 0 && (
        <div className="glass-panel rounded-2xl overflow-hidden mb-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-5 py-3 border-b border-border/50">Open struggles</p>
          {data.struggles.map(s => (
            <div key={s.id} className="px-5 py-3 border-b border-border/50 last:border-0">
              <p className="font-medium text-sm">{s.title}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.description}</p>
            </div>
          ))}
        </div>
      )}
      <div className="glass-panel rounded-2xl p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Log a new struggle</p>
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

function LearningSlide({ data }: { data: DashboardData }) {
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
      <p className="text-xs font-semibold uppercase tracking-wide text-purple-500 mb-2">Lean Lesson — Week {data.lesson.weekNumber}</p>
      <h2 className="text-3xl font-display font-bold mb-2">{data.lesson.title}</h2>
      <p className="text-lg text-muted-foreground mb-6">{data.lesson.summary}</p>
      <div className="glass-panel rounded-2xl p-6">
        <MarkdownBlock content={data.lesson.whatToShowMd} />
      </div>
      {data.lesson.videoUrl && (
        <a href={data.lesson.videoUrl} target="_blank" rel="noopener" className="mt-4 inline-flex items-center gap-2 text-sm text-primary hover:underline">
          <Play className="w-4 h-4" /> Watch the related video
        </a>
      )}
    </div>
  );
}

function GratitudeSlide({ data, onRefresh }: { data: DashboardData; onRefresh: () => void }) {
  const { state } = useAuth();
  const defaultFrom = state.status === "authenticated" ? state.user.name : "";
  const [fromName, setFromName] = useState(defaultFrom);
  const [toName, setToName] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const meetingId = data.meeting?.id;
  const submit = async () => {
    if (!meetingId || !fromName.trim() || !content.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/morning-meetings/${meetingId}/gratitude`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromName, toName: toName.trim() || undefined, content }),
      });
      if (!res.ok) throw new Error("Failed");
      setContent(""); setToName("");
      onRefresh();
      toast({ title: "Shout-out added" });
    } catch {
      toast({ title: "Failed to add", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div>
      <SectionTitle>Gratitude</SectionTitle>
      <SectionLead>Finish strong. Who helped you out? What went well?</SectionLead>
      {data.gratitude.length > 0 && (
        <div className="glass-panel rounded-2xl overflow-hidden mb-4">
          {data.gratitude.map(g => (
            <div key={g.id} className="px-5 py-3 border-b border-border/50 last:border-0 flex items-start gap-3">
              <Heart className="w-4 h-4 text-rose-500 mt-1 shrink-0" />
              <div>
                <p className="text-sm">
                  <span className="font-semibold">{g.fromName}</span>
                  {g.toName ? <> → <span className="font-semibold">{g.toName}</span></> : null}
                </p>
                <p className="text-sm text-muted-foreground">{g.content}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {meetingId ? (
        <div className="glass-panel rounded-2xl p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Add a shout-out</p>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input value={fromName} onChange={e => setFromName(e.target.value)} placeholder="From" className="bg-background border border-border rounded-xl p-3 text-base focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <input value={toName} onChange={e => setToName(e.target.value)} placeholder="To (optional)" className="bg-background border border-border rounded-xl p-3 text-base focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Thanks for…"
            className="w-full min-h-[80px] bg-background border border-border rounded-xl p-3 text-base focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <div className="flex justify-end mt-3">
            <button onClick={submit} disabled={!fromName.trim() || !content.trim() || submitting} className="px-4 py-2 rounded-xl bg-rose-500 text-white text-sm font-semibold hover:bg-rose-600 disabled:opacity-50">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add shout-out"}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground italic">Meeting not started yet — go back to setup and hit Start.</p>
      )}
    </div>
  );
}

void Link;
void ArrowRight;
