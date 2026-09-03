// The Improvement Centre — the team's screen.
//
// The old version of this page had no way to log an improvement on it: you
// submitted from the floating Report button's tabbed modal and viewed them
// here, which is why nobody could work out how to use it. This page now
// carries the whole loop, in the big-button idiom of the to-do lists:
//
//     Log it  →  add a photo/video  →  "I've done this"  →  a manager approves
//
// One action visible at a time, in words that say what happens next. The
// rules (what stage something is in, whether it can be marked done, whether
// this viewer can approve) all come from the server already decided — the
// screen never re-derives them, so it can't disagree with the API.
//
// The manager's table lives behind a toggle at the bottom, out of the way of
// the people who just want to log what they did.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Loader2, Camera, CheckCircle2, Clock, ThumbsUp, RotateCcw,
  Trophy, ChevronLeft, X, AlertCircle, Settings2, Clapperboard, Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/contexts/auth-context";
import { ImprovementsTab } from "@/pages/reports";
import { ImprovementAttachments } from "@/components/improvement-attachments";
import { cn } from "@/lib/utils";
import { ImprovementFeedMedia } from "@/components/improvement-feed-media";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Something went wrong (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

type Stage = "todo" | "waiting" | "approved" | "sent_back";

type Improvement = {
  id: number;
  title: string;
  description: string;
  station: string;
  stage: Stage;
  stageLabel: string;
  mediaCount: number;
  isMine: boolean;
  canMarkDone: boolean;
  markDoneBlocker: string | null;
  canReview: boolean;
  submittedByName: string | null;
  creditedToName: string | null;
  approvedByName: string | null;
  reviewNote: string | null;
  createdAt: string;
  voteCount: number;
  votedByMe: boolean;
  subjectTitle: string | null;
  subjectConfirmed: boolean;
  /** Attachment metadata for the feed — rendered inline like a social
   *  feed post (Graeme, 2026-08-28). */
  media?: Array<{ id: number; kind: "image" | "video"; phase: "before" | "after" | "stitched" | null }>;
};

// Feed media rendering lives in components/improvement-feed-media.tsx —
// shared with the meeting's Recent Improvements slide so both tell the
// story the same way (stitched clip first, before/after pair otherwise).

type ScoreRow = { userId: number | null; name: string; count: number; signedOff: number; lastAt: string | null };

/** A done improvement's chip carries the doer's name — "To do" on finished
 *  work read as nonsense (Graeme, 2026-09-02). */
function stageChipText(item: Pick<Improvement, "stage" | "stageLabel" | "creditedToName" | "submittedByName">): string {
  const who = item.creditedToName || item.submittedByName;
  if (!who) return item.stageLabel;
  if (item.stage === "waiting") return `Done — ${who}`;
  if (item.stage === "approved") return `${who} ✓`;
  return item.stageLabel;
}

const STAGE_STYLE: Record<Stage, string> = {
  todo: "bg-secondary text-foreground",
  waiting: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  sent_back: "bg-destructive/10 text-destructive",
};

export default function Improvements() {
  const { state } = useAuth();
  const userRole = state.status === "authenticated" ? state.user.role : "viewer";
  const currentUserName = state.status === "authenticated" ? state.user.name : null;
  const isManager = userRole === "admin" || userRole === "manager";

  const [logging, setLogging] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);

  const { data: items = [], isLoading } = useQuery<Improvement[]>({
    queryKey: ["improvements"],
    queryFn: () => api<Improvement[]>("/improvements"),
  });

  if (openId != null) {
    return (
      <ImprovementDetail
        id={openId}
        onBack={() => setOpenId(null)}
        isManager={isManager}
        isAdmin={userRole === "admin"}
      />
    );
  }

  if (logging) {
    return <LogImprovement onDone={id => { setLogging(false); setOpenId(id); }} onCancel={() => setLogging(false)} />;
  }

  const waiting = items.filter(i => i.stage === "waiting");
  const mine = items.filter(i => i.isMine && i.stage !== "approved");
  const todo = items.filter(i => i.stage === "todo" && !i.isMine);
  const approved = items.filter(i => i.stage === "approved").slice(0, 8);

  return (
    <div className="max-w-3xl mx-auto pb-24 space-y-6">
      <PageHeader
        title="Improvements"
        description="Made something better? Log it, show it, get it signed off."
      />

      <button
        onClick={() => setLogging(true)}
        className="w-full h-16 rounded-2xl bg-primary text-primary-foreground text-xl font-bold flex items-center justify-center gap-3 hover:opacity-90 active:scale-[0.99] transition-all shadow-lg shadow-primary/20"
      >
        <Plus className="w-6 h-6" /> Log an improvement
      </button>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-3 text-lg">
          <Loader2 className="w-6 h-6 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {isManager && waiting.length > 0 && (
            <Section title={`Waiting for you to check (${waiting.length})`} icon={<Clock className="w-5 h-5 text-amber-500" />}>
              {waiting.map(i => <Card key={i.id} item={i} onOpen={() => setOpenId(i.id)} />)}
            </Section>
          )}

          <Section title="Yours" icon={<Camera className="w-5 h-5 text-primary" />} empty="Nothing on the go. Log one above.">
            {mine.map(i => <Card key={i.id} item={i} onOpen={() => setOpenId(i.id)} />)}
          </Section>

          {todo.length > 0 && (
            <Section title="Up for grabs" icon={<AlertCircle className="w-5 h-5 text-muted-foreground" />}>
              {todo.slice(0, 10).map(i => <Card key={i.id} item={i} onOpen={() => setOpenId(i.id)} />)}
            </Section>
          )}

          {approved.length > 0 && (
            <Section title="Recently approved" icon={<CheckCircle2 className="w-5 h-5 text-emerald-500" />}>
              {approved.map(i => <Card key={i.id} item={i} onOpen={() => setOpenId(i.id)} />)}
            </Section>
          )}

          <Scoreboard />

          {/* The feed invites scrolling — meet the reader at the bottom of
              it with the same call to action as the top. */}
          <button
            onClick={() => setLogging(true)}
            className="w-full h-16 rounded-2xl bg-primary text-primary-foreground text-xl font-bold flex items-center justify-center gap-3 hover:opacity-90 active:scale-[0.99] transition-all shadow-lg shadow-primary/20"
          >
            <Plus className="w-6 h-6" /> Log an improvement
          </button>
        </>
      )}

      {isManager && (
        <div className="pt-4 border-t border-border">
          <button
            onClick={() => setShowAdmin(s => !s)}
            className="w-full h-12 rounded-2xl border-2 border-border text-base font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 transition-colors text-muted-foreground"
          >
            <Settings2 className="w-4 h-4" /> {showAdmin ? "Hide" : "Show"} the full management table
          </button>
          {showAdmin && (
            <div className="mt-4">
              <ImprovementsTab userRole={userRole} currentUserName={currentUserName} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, icon, children, empty }: {
  title: string; icon: React.ReactNode; children: React.ReactNode; empty?: string;
}) {
  const isEmpty = Array.isArray(children) && children.length === 0;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold flex items-center gap-2">{icon} {title}</h2>
      {isEmpty
        ? empty ? <p className="text-lg text-muted-foreground">{empty}</p> : null
        : <div className="space-y-3">{children}</div>}
    </section>
  );
}

function Card({ item, onOpen }: { item: Improvement; onOpen: () => void }) {
  // A feed post, not a button: the header and metadata open the item, but
  // videos play right here in the feed — nesting a player inside a button
  // would fight every tap (Graeme, 2026-08-28: "like a WhatsApp group").
  return (
    <div className="w-full text-left rounded-2xl border-2 border-border bg-card hover:border-primary/50 transition-all p-4 shadow-sm">
      <button onClick={onOpen} className="w-full text-left">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xl font-bold leading-snug break-words flex-1">{item.title}</p>
        <span className={cn("text-xs px-2.5 py-1 rounded-lg font-bold whitespace-nowrap", STAGE_STYLE[item.stage])}>
          {stageChipText(item)}
        </span>
      </div>
      <div className="flex items-center gap-3 mt-2 text-base text-muted-foreground flex-wrap">
        {item.mediaCount > 0 && (
          <span className="flex items-center gap-1.5"><Camera className="w-4 h-4" /> {item.mediaCount}</span>
        )}
        {item.voteCount > 0 && (
          <span className="flex items-center gap-1.5 font-semibold text-foreground">
            <ThumbsUp className="w-4 h-4" /> {item.voteCount}
          </span>
        )}
        {item.creditedToName && <span>{item.creditedToName}</span>}
        {item.subjectTitle && (
          <span className="text-sm px-2 py-0.5 rounded-lg bg-secondary font-semibold">
            {item.subjectTitle}{item.subjectConfirmed ? "" : "?"}
          </span>
        )}
        {item.stage === "todo" && item.mediaCount === 0 && (
          <span className="text-amber-600 font-semibold">Needs a photo</span>
        )}
      </div>
      </button>
      <ImprovementFeedMedia media={item.media} onOpen={onOpen} />
    </div>
  );
}

// ─── Logging one ──────────────────────────────────────────────────────────────

/**
 * One screen, one decision. The toggle at the top is what keeps this to a
 * single step: if you've already done the improvement, this same submit puts
 * it straight in front of a manager instead of making you find it again and
 * press a second button.
 */
function LogImprovement({ onDone, onCancel }: { onDone: (id: number) => void; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [alreadyDone, setAlreadyDone] = useState(true);

  const create = useMutation({
    mutationFn: () => api<{ id: number }>("/improvements", {
      method: "POST",
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim() || title.trim(),
        station: "general",
        // "It needs doing" leaves it unassigned, so it shows up for grabs
        // instead of landing on the reporter's own list.
        claim: alreadyDone,
      }),
    }),
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["improvements"] });
      onDone(row.id);
    },
    onError: (e: Error) => toast({ title: "Couldn't save it", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="max-w-3xl mx-auto pb-24 space-y-5">
      <button onClick={onCancel} className="flex items-center gap-2 px-4 h-14 rounded-2xl bg-secondary hover:bg-secondary/70 text-lg font-bold transition-colors">
        <ChevronLeft className="w-5 h-5" /> Back
      </button>

      <h1 className="text-3xl font-bold">Log an improvement</h1>

      <div className="grid grid-cols-2 gap-3">
        {[
          { done: true, label: "I've done it", hint: "You made something better" },
          { done: false, label: "It needs doing", hint: "An idea or a problem" },
        ].map(opt => (
          <button
            key={String(opt.done)}
            onClick={() => setAlreadyDone(opt.done)}
            className={cn(
              "rounded-2xl border-2 p-4 text-left transition-all",
              alreadyDone === opt.done ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40",
            )}
          >
            <p className="text-lg font-bold">{opt.label}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{opt.hint}</p>
          </button>
        ))}
      </div>

      <div>
        <label className="text-lg font-bold mb-2 block">What is it?</label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Moved the tape gun to the wrapping bench"
          className="w-full h-16 px-4 rounded-2xl border-2 border-border bg-card text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div>
        <label className="text-lg font-bold mb-2 block">Anything to add? <span className="font-normal text-muted-foreground">(optional)</span></label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={3}
          placeholder="What was wrong before, and what's better now"
          className="w-full px-4 py-3 rounded-2xl border-2 border-border bg-card text-lg focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
        />
      </div>

      <div className="rounded-2xl bg-secondary/40 p-4">
        <p className="text-base font-semibold">
          {alreadyDone
            ? "Next: add your photo or video, then send it for approval."
            : "Next: add a photo of the problem if you can."}
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          An improvement only counts once it's got a picture or a clip.
        </p>
      </div>

      <button
        onClick={() => create.mutate()}
        disabled={!title.trim() || create.isPending}
        className="w-full h-16 rounded-2xl bg-primary text-primary-foreground text-xl font-bold flex items-center justify-center gap-3 disabled:opacity-50 active:scale-[0.99] transition-all shadow-lg shadow-primary/20"
      >
        {create.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : <Camera className="w-6 h-6" />}
        {alreadyDone ? "Save & add photo" : "Save it"}
      </button>
    </div>
  );
}

// ─── One improvement ──────────────────────────────────────────────────────────

function ImprovementDetail({ id, onBack, isManager, isAdmin }: {
  id: number; onBack: () => void; isManager: boolean; isAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const [sendBackNote, setSendBackNote] = useState("");
  const [sendingBack, setSendingBack] = useState(false);
  // Delete asks first, in place, the same two-step shape as "send back"
  // above — no separate dialog to learn, and no single tap that destroys
  // someone's photos.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const { data: items = [], isLoading } = useQuery<Improvement[]>({
    queryKey: ["improvements"],
    queryFn: () => api<Improvement[]>("/improvements"),
  });
  const item = items.find(i => i.id === id);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["improvements"] });

  const stitch = useMutation({
    mutationFn: () => api<{ bytes: number }>(`/improvements/${id}/stitch`, { method: "POST" }),
    onSuccess: () => {
      refresh();
      toast({ title: "Clip ready", description: "Before and after, one after the other." });
    },
    onError: (e: Error) => toast({ title: "Couldn't make the clip", description: e.message, variant: "destructive" }),
  });

  const vote = useMutation({
    mutationFn: () => api(`/improvements/${id}/vote`, { method: "POST" }),
    onSuccess: refresh,
    onError: (e: Error) => toast({ title: "Couldn't save your vote", description: e.message, variant: "destructive" }),
  });

  const markDone = useMutation({
    mutationFn: () => api(`/improvements/${id}/done`, { method: "POST" }),
    onSuccess: () => {
      refresh();
      toast({ title: "Sent for approval", description: "A manager will check it and sign it off." });
    },
    onError: (e: Error) => toast({ title: "Not yet", description: e.message, variant: "destructive" }),
  });

  // Deleting takes the improvement, its photos and videos, its comments and
  // its votes. Nothing in the app brings them back, so the button is
  // admin-only and asks first (Graeme, 2026-09-03 — a suggestion whose
  // problem had been designed out entirely, so it was never going to happen).
  const remove = useMutation({
    mutationFn: () => api<{ id: number; title: string }>(`/improvements/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["improvements"] });
      queryClient.invalidateQueries({ queryKey: ["improvement-scoreboard"] });
      toast({ title: "Deleted", description: "It's gone from the board." });
      onBack();
    },
    onError: (e: Error) => toast({ title: "Couldn't delete it", description: e.message, variant: "destructive" }),
  });

  const review = useMutation({
    mutationFn: (v: { approve: boolean; note?: string }) =>
      api(`/improvements/${id}/review`, { method: "POST", body: JSON.stringify(v) }),
    onSuccess: (_r, v) => {
      refresh();
      setSendingBack(false);
      setSendBackNote("");
      toast({
        title: v.approve ? "Approved" : "Sent back",
        description: v.approve ? "It counts towards their total now." : "They'll see your note.",
      });
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-16 text-muted-foreground gap-3 text-lg"><Loader2 className="w-6 h-6 animate-spin" /> Loading…</div>;
  }
  if (!item) {
    return <div className="p-5 rounded-2xl bg-destructive/10 text-destructive text-lg font-semibold">This one's gone — it may have been deleted.</div>;
  }

  return (
    <div className="max-w-3xl mx-auto pb-24 space-y-5">
      <button onClick={onBack} className="flex items-center gap-2 px-4 h-14 rounded-2xl bg-secondary hover:bg-secondary/70 text-lg font-bold transition-colors">
        <ChevronLeft className="w-5 h-5" /> Back
      </button>

      <div>
        <span className={cn("text-sm px-3 py-1.5 rounded-lg font-bold inline-block mb-3", STAGE_STYLE[item.stage])}>
          {stageChipText(item)}
        </span>
        <h1 className="text-3xl font-bold leading-snug break-words">{item.title}</h1>
        {item.description && item.description !== item.title && (
          <p className="text-xl leading-relaxed mt-3 whitespace-pre-wrap">{item.description}</p>
        )}
        <p className="text-base text-muted-foreground mt-3">
          Logged by {item.submittedByName ?? "someone"}
          {item.creditedToName && item.creditedToName !== item.submittedByName && ` · credited to ${item.creditedToName}`}
        </p>
      </div>

      {item.stage === "sent_back" && item.reviewNote && (
        <div className="rounded-2xl border-2 border-destructive/40 bg-destructive/5 p-4">
          <p className="text-base font-bold text-destructive flex items-center gap-2">
            <RotateCcw className="w-4 h-4" /> {item.approvedByName ?? "A manager"} wants another look
          </p>
          <p className="text-lg mt-1.5 whitespace-pre-wrap">{item.reviewNote}</p>
        </div>
      )}

      {/* Before and after, side by side — the shape of the evidence, and the
          way an idea logged weeks ago becomes a finished improvement: come
          back, add the after shot, say what changed. */}
      <div className={cn(
        "rounded-2xl p-4 border-2",
        item.mediaCount === 0 ? "border-amber-400 bg-amber-50 dark:bg-amber-950/20" : "border-border bg-card",
      )}>
        <p className="text-lg font-bold mb-1">
          {item.mediaCount === 0 ? "Add a photo or a video" : "Before & after"}
        </p>
        <p className="text-base text-muted-foreground mb-4">
          {item.mediaCount === 0
            ? "This is what makes an improvement count. A photo is fine — a short clip is better."
            : "A photo is fine. A short clip is better."}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-base font-bold mb-2">Before</p>
            <ImprovementAttachments improvementId={id} editable phase="before" thumbSize="w-24 h-24" />
          </div>
          <div>
            <p className="text-base font-bold mb-2">After</p>
            <ImprovementAttachments improvementId={id} editable phase="after" thumbSize="w-24 h-24" />
          </div>
        </div>

        {/* One clip of the whole story, for the morning meeting and for
            anyone reviewing it — the two halves joined, each labelled. */}
        <div className="mt-4 pt-4 border-t border-border">
          <button
            onClick={() => stitch.mutate()}
            disabled={stitch.isPending}
            className="w-full h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 transition-colors disabled:opacity-50"
          >
            {stitch.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Clapperboard className="w-5 h-5" />}
            {stitch.isPending ? "Joining them together…" : "Make one before & after clip"}
          </button>
          <div className="mt-3">
            <ImprovementAttachments improvementId={id} phase="stitched" thumbSize="w-full h-40" />
          </div>
        </div>
      </div>

      {/* The one action the person needs. */}
      {item.stage !== "approved" && item.stage !== "waiting" && (
        <div>
          <button
            onClick={() => markDone.mutate()}
            disabled={!item.canMarkDone || markDone.isPending}
            className="w-full h-16 rounded-2xl bg-primary text-primary-foreground text-xl font-bold flex items-center justify-center gap-3 disabled:opacity-50 active:scale-[0.99] transition-all shadow-lg shadow-primary/20"
          >
            {markDone.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : <CheckCircle2 className="w-6 h-6" />}
            I've done this — send for approval
          </button>
          {item.markDoneBlocker && (
            <p className="text-base text-amber-600 font-semibold mt-2 text-center">{item.markDoneBlocker}</p>
          )}
        </div>
      )}

      {/* Backing an idea someone else raised. Only while it's still to do —
          once it's done, voting on it means nothing. */}
      {item.stage === "todo" && (
        <button
          onClick={() => vote.mutate()}
          disabled={vote.isPending}
          className={cn(
            "w-full h-16 rounded-2xl border-2 text-xl font-bold flex items-center justify-center gap-3 transition-colors disabled:opacity-50",
            item.votedByMe
              ? "border-primary bg-primary/10 text-primary"
              : "border-border hover:bg-secondary/50",
          )}
        >
          {vote.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : <ThumbsUp className="w-6 h-6" />}
          {item.votedByMe
            ? `You're one of ${item.voteCount} — tap to take it back`
            : item.voteCount > 0
              ? `${item.voteCount} ${item.voteCount === 1 ? "person wants" : "people want"} this — add your vote`
              : "This affects me too"}
        </button>
      )}

      {item.stage === "waiting" && !item.canReview && (
        <div className="rounded-2xl bg-amber-500/10 p-5 text-center">
          <Clock className="w-8 h-8 mx-auto text-amber-500 mb-2" />
          <p className="text-xl font-bold">Waiting for a manager to check it</p>
          <p className="text-base text-muted-foreground mt-1">Nothing else for you to do.</p>
        </div>
      )}

      {item.stage === "approved" && (
        <div className="rounded-2xl bg-emerald-500/10 p-5 text-center">
          <Trophy className="w-8 h-8 mx-auto text-emerald-500 mb-2" />
          <p className="text-xl font-bold">Approved{item.creditedToName ? ` — nice one, ${item.creditedToName}` : ""}</p>
          {item.approvedByName && <p className="text-base text-muted-foreground mt-1">Signed off by {item.approvedByName}</p>}
        </div>
      )}

      {/* Manager review — only ever shown on something actually waiting. */}
      {item.canReview && (
        <div className="space-y-3 pt-2 border-t-2 border-border">
          <p className="text-lg font-bold">Your call</p>
          {!sendingBack ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                onClick={() => review.mutate({ approve: true })}
                disabled={review.isPending}
                className="h-16 rounded-2xl bg-emerald-600 text-white text-xl font-bold flex items-center justify-center gap-3 disabled:opacity-50 active:scale-[0.99] transition-all"
              >
                {review.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : <ThumbsUp className="w-6 h-6" />} Approve
              </button>
              <button
                onClick={() => setSendingBack(true)}
                className="h-16 rounded-2xl border-2 border-border text-xl font-bold flex items-center justify-center gap-3 hover:bg-secondary/50 transition-colors"
              >
                <RotateCcw className="w-6 h-6" /> Send back
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <textarea
                value={sendBackNote}
                onChange={e => setSendBackNote(e.target.value)}
                rows={3}
                autoFocus
                placeholder="What needs another look?"
                className="w-full px-4 py-3 rounded-2xl border-2 border-border bg-card text-lg focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  onClick={() => review.mutate({ approve: false, note: sendBackNote.trim() })}
                  disabled={!sendBackNote.trim() || review.isPending}
                  className="h-14 rounded-2xl bg-destructive text-destructive-foreground text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {review.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <RotateCcw className="w-5 h-5" />} Send it back
                </button>
                <button
                  onClick={() => { setSendingBack(false); setSendBackNote(""); }}
                  className="h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50"
                >
                  <X className="w-5 h-5" /> Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Delete — last on the page, quiet until asked for. Some suggestions
          stop being relevant: the problem gets designed out, or the same
          thing gets logged twice. Admin only, and never a single tap. */}
      {isAdmin && (
        <div className="pt-6 mt-2 border-t-2 border-border">
          {!confirmingDelete ? (
            <button
              onClick={() => setConfirmingDelete(true)}
              className="h-14 px-5 rounded-2xl border-2 border-destructive/40 text-destructive text-lg font-bold flex items-center justify-center gap-2 hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="w-5 h-5" /> Delete this improvement
            </button>
          ) : (
            <div className="rounded-2xl border-2 border-destructive bg-destructive/5 p-4 space-y-3">
              <p className="text-lg font-bold text-destructive">Delete "{item.title}"?</p>
              <p className="text-base">
                The improvement goes, and so do
                {item.mediaCount > 0
                  ? ` its ${item.mediaCount} ${item.mediaCount === 1 ? "photo or video" : "photos and videos"},`
                  : " any photos or videos,"}
                {" "}its comments and its votes. Nothing here can bring them back.
              </p>
              {item.stage === "approved" && (
                <p className="text-base font-semibold">
                  It's approved, so it stops counting towards
                  {item.creditedToName ? ` ${item.creditedToName}'s` : " anyone's"} total.
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                If it came from a reported issue, that issue stays — it just
                stops being linked to an improvement.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  onClick={() => remove.mutate()}
                  disabled={remove.isPending}
                  className="h-14 rounded-2xl bg-destructive text-destructive-foreground text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {remove.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />} Yes, delete it
                </button>
                <button
                  onClick={() => setConfirmingDelete(false)}
                  disabled={remove.isPending}
                  className="h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 disabled:opacity-50"
                >
                  <X className="w-5 h-5" /> Keep it
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Who's improving ──────────────────────────────────────────────────────────

function Scoreboard() {
  const { data = [] } = useQuery<ScoreRow[]>({
    queryKey: ["improvement-scoreboard"],
    queryFn: () => api<ScoreRow[]>("/improvements/scoreboard"),
  });
  if (data.length === 0) return null;

  // Anything completed before sign-off existed was retro-credited so the
  // tallies started from real history — but nobody approved it, so the
  // heading says "completed" and the legacy portion is named rather than
  // quietly counted as approvals.
  const legacy = data.reduce((n, r) => n + (r.count - r.signedOff), 0);

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold flex items-center gap-2">
        <Trophy className="w-5 h-5 text-amber-500" /> Improvements completed
      </h2>
      {legacy > 0 && (
        <p className="text-base text-muted-foreground -mt-1">
          Includes {legacy} completed before sign-off existed — those were never
          approved by anyone. New ones only count once a manager signs them off.
        </p>
      )}
      <div className="rounded-2xl border-2 border-border bg-card overflow-hidden">
        {data.map((row, i) => (
          <div
            key={row.userId ?? row.name}
            className={cn("flex items-center justify-between gap-3 px-4 py-3.5", i > 0 && "border-t border-border")}
          >
            <span className="text-lg font-bold">{row.name}</span>
            <span className="text-2xl font-bold tabular-nums">{row.count}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
