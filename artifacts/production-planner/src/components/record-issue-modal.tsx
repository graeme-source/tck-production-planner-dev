// "Record Issue" — the other half of the quick-actions dock (Graeme,
// 2026-08-28). Same shape as Record Improvement: one question that actually
// changes what happens, then the details.
//
//   Factory issue → something physical on the floor. Goes to the team.
//   System issue  → this app misbehaving on the iPad. Goes to whoever fixes
//                   the software. They're different people, which is the
//                   whole reason for asking.
//
// Safety is a separate toggle rather than a category, because a safety
// problem can be either kind, and it's the flag that decides how loudly it
// gets escalated.
//
// An issue can also be an improvement opportunity — a safety problem gets
// fixed by improving something — so the last step offers that in one tap
// rather than making anyone re-type it in the other modal.

import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Factory, Tablet, ShieldAlert, Camera, Image as ImageIcon, Loader2, X, ArrowRight, Lightbulb, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { summariseUploadFailures, type UploadAttempt } from "@/lib/upload-failures";
import { DictateButton } from "@/components/dictate-button";
import { releaseDictation } from "@/hooks/use-voice-input";
import { JaneCheckPanel, runJaneCheck, reportCheckResult, type JaneAnswer, type JaneTurn } from "@/components/jane-report-check";
import { JaneTalkThrough, describeWithBrief, nextTalkStep, saveTalkThrough, useJaneLiveAvailable, useTalkThroughAvailable, type TalkStep } from "@/components/jane-talk-through";
import { JaneLiveReportChat } from "@/components/jane-live-report-chat";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Area = "factory" | "system";

export function RecordIssueModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [area, setArea] = useState<Area | null>(null);
  const [description, setDescription] = useState("");
  const [isSafety, setIsSafety] = useState(false);
  const [alsoImprovement, setAlsoImprovement] = useState(false);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  // AI Jane looks first on app reports (Graeme, 2026-11-04): already reported,
  // already possible, or new. She can never stop a report being filed.
  const [, navigate] = useLocation();
  const [chat, setChat] = useState<JaneTurn[]>([]);
  const [answer, setAnswer] = useState<JaneAnswer | null>(null);
  const [checkId, setCheckId] = useState<number | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const deviceRef = useRef<HTMLInputElement>(null);
  // …then, when it's new, a few questions so it's built right first time
  // (Graeme, 2026-11-19). Off for anyone without the grant or the switch.
  const talkAvailable = useTalkThroughAvailable(open);
  const [talk, setTalk] = useState<TalkStep | null>(null);
  const [talkChat, setTalkChat] = useState<JaneTurn[]>([]);
  // Every report starts as a chat with Jane (Graeme, 20 Nov 2026): she tries
  // to sort it first, and writes the report from the chat when she can't.
  // Safety skips her. Off with the talk-through switch → the form as before.
  const liveAvailable = useJaneLiveAvailable(open);
  const [liveChat, setLiveChat] = useState<JaneTurn[] | null>(null);
  const [skipJane, setSkipJane] = useState(false);

  if (!open) return null;

  const reset = () => {
    setArea(null); setDescription(""); setIsSafety(false); setAlsoImprovement(false);
    setFiles([]); setBusy(false); setChat([]); setAnswer(null); setCheckId(null);
    setTalk(null); setTalkChat([]); setLiveChat(null); setSkipJane(false);
  };
  const close = () => { reset(); onClose(); };

  /** Ask Jane; a real answer shows, anything else files the report. */
  const askJane = async (turns: JaneTurn[]) => {
    setBusy(true);
    setChat(turns);
    const { answer: reply, checkId: id } = await runJaneCheck(turns);
    if (!reply || reply.outcome === "new") { await talkOrFile(id, turns); return; }
    setChat([...turns, { role: "assistant", text: reply.message }]);
    setAnswer(reply);
    setCheckId(id);
    setBusy(false);
  };

  /** A new app report: Jane's questions if this person has them, else file it. */
  const talkOrFile = async (fromCheck: number | null, turns: JaneTurn[]) => {
    if (!talkAvailable) { await submit(fromCheck); return; }
    setBusy(true);
    setAnswer(null);
    setCheckId(fromCheck);
    const step = await nextTalkStep("issue", turns);
    if (!step) { await submit(fromCheck); return; }
    setTalkChat([...turns, { role: "assistant", text: step.message }]);
    setTalk(step);
    setBusy(false);
  };

  const answerTalk = async (text: string) => {
    const turns: JaneTurn[] = [...talkChat, { role: "user", text }];
    setBusy(true);
    setTalkChat(turns);
    const step = await nextTalkStep("issue", turns);
    if (!step) { await submit(checkId, { transcript: turns, brief: null }); return; }
    setTalkChat([...turns, { role: "assistant", text: step.message }]);
    setTalk(step);
    setBusy(false);
  };

  /** "Just send it": no more questions; anything they answered still goes. */
  const sendTalkAsIs = async () => {
    setBusy(true);
    const done = await nextTalkStep("issue", talkChat, { finish: true });
    await submit(checkId, { transcript: talkChat, brief: done?.kind === "brief" ? done.brief : null });
  };

  const report = () => {
    // Already talked through with Jane: her write-up is the report.
    if (liveChat) { void submit(null, { transcript: liveChat, brief: null }); return; }
    // Safety never waits, and factory problems go straight to the team.
    if (area === "system" && !isSafety) void askJane([{ role: "user", text: description.trim() }]);
    else void submit(null);
  };
  const inJaneChat = area !== null && liveAvailable && !liveChat && !skipJane;

  const submit = async (fromCheck: number | null, talked?: { transcript: JaneTurn[]; brief: string | null }) => {
    if (!description.trim() || !area) return;
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/andon`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Safety is its own category in the existing andon model; otherwise
          // a factory problem is equipment and a system one is 'other'.
          category: isSafety ? "safety" : area === "factory" ? "equipment" : "other",
          // Safety issues shout; everything else is a normal report.
          severity: isSafety ? "red" : "yellow",
          description: talked ? describeWithBrief(description, talked.brief) : description.trim(),
          station: area === "system" ? "App / iPad" : "general",
          area,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't report it");
      const issue = await res.json();
      if (fromCheck != null) void reportCheckResult(fromCheck, "reported", issue.id);
      if (talked) void saveTalkThrough({ kind: "issue", andonIssueId: issue.id, original: description.trim(), transcript: talked.transcript, brief: talked.brief });

      let improvementId: number | null = null;
      if (alsoImprovement) {
        const tagged = await fetch(`${BASE}/api/andon/${issue.id}/tag-improvement`, {
          method: "POST", credentials: "include",
        });
        if (tagged.ok) improvementId = (await tagged.json()).improvementId ?? null;
      }

      // Everything attaches to the issue itself — that's the report's
      // evidence. When it's also logged as an improvement, the first shot
      // doubles as the improvement's "before" so both views are complete.
      // Every upload's answer is checked — a failed one used to vanish
      // without a word (same silent loss that cost improvement 33 its
      // "before" video, 2026-08-27).
      const attempts: UploadAttempt[] = [];
      for (const [i, file] of files.entries()) {
        const form = new FormData();
        form.append("file", file);
        const up = await fetch(`${BASE}/api/andon/${issue.id}/attachments`, {
          method: "POST", credentials: "include", body: form,
        }).catch(() => null);
        attempts.push({
          label: files.length === 1 ? "your photo" : `photo ${i + 1}`,
          ok: Boolean(up?.ok),
          error: up && !up.ok ? ((await up.json().catch(() => ({}))) as { error?: string }).error : undefined,
        });
        if (i === 0 && improvementId) {
          const impForm = new FormData();
          impForm.append("file", file);
          impForm.append("phase", "before");
          const impUp = await fetch(`${BASE}/api/improvements/${improvementId}/attachments`, {
            method: "POST", credentials: "include", body: impForm,
          }).catch(() => null);
          attempts.push({
            label: "the improvement's BEFORE shot",
            ok: Boolean(impUp?.ok),
            error: impUp && !impUp.ok ? ((await impUp.json().catch(() => ({}))) as { error?: string }).error : undefined,
          });
        }
      }
      const uploadFailure = summariseUploadFailures(attempts, "the report");

      queryClient.invalidateQueries({ queryKey: ["andon"] });
      queryClient.invalidateQueries({ queryKey: ["improvements"] });
      if (uploadFailure) {
        toast({
          title: isSafety ? "Safety issue reported — but a photo was lost" : "Reported — but a photo was lost",
          description: uploadFailure,
          variant: "destructive",
        });
      } else {
        toast({
          title: isSafety ? "Safety issue reported" : "Issue reported",
          description: improvementId
            ? "It's also logged as an improvement to work on."
            : area === "system" ? "Sent to whoever looks after the app." : "Sent to the team.",
        });
      }
      close();
    } catch (e) {
      toast({ title: "Couldn't report it", description: (e as Error).message, variant: "destructive" });
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[150] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={close}>
      <div
        className={cn("bg-background w-full rounded-t-3xl sm:rounded-3xl p-5 space-y-4 max-h-[92dvh] overflow-y-auto", inJaneChat ? "sm:max-w-2xl" : "sm:max-w-lg")}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-bold">{area === null ? "Report an issue" : area === "system" ? "App or iPad problem" : "Factory problem"}</h2>
          <button onClick={close} className="w-11 h-11 rounded-2xl bg-secondary flex items-center justify-center" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {inJaneChat ? (
          <JaneLiveReportChat
            area={area!}
            onSorted={() => { toast({ title: "Glad that's sorted", description: "Nothing's been reported." }); close(); }}
            onWriteReport={(draft, transcript) => { setDescription(draft); setLiveChat(transcript); }}
            onSafety={() => { setIsSafety(true); setSkipJane(true); }}
            onOpenPath={path => { close(); navigate(path); }}
          />
        ) : talk ? (
          <JaneTalkThrough
            key={talkChat.length}
            chat={talkChat}
            step={talk}
            busy={busy}
            onAnswer={text => void answerTalk(text)}
            onSendAsIs={() => void sendTalkAsIs()}
            onSend={brief => void submit(checkId, { transcript: talkChat, brief })}
          />
        ) : answer ? (
          <JaneCheckPanel
            chat={chat}
            answer={answer}
            busy={busy}
            onReply={text => { setAnswer(null); void askJane([...chat, { role: "user", text }]); }}
            // "Just report it" skips the questions; "that's not it" is still new.
            onReportAnyway={() => void (answer.outcome === "ask" ? submit(checkId) : talkOrFile(checkId, [{ role: "user", text: description.trim() }]))}
            onShowMe={() => { if (checkId != null) void reportCheckResult(checkId, "resolved"); const path = answer.path; close(); if (path) navigate(path); }}
            onKeepPosted={() => {
              if (checkId != null) void reportCheckResult(checkId, "followed");
              toast({ title: "You'll be kept posted", description: "We'll tell you when it's fixed. You don't need to report it again." });
              close();
            }}
          />
        ) : area === null ? (
          <div className="space-y-3">
            <button
              onClick={() => setArea("factory")}
              className="w-full rounded-2xl border-2 border-border bg-card p-5 text-left hover:border-primary active:scale-[0.99] transition-all"
            >
              <div className="flex items-center gap-3">
                <Factory className="w-8 h-8 text-primary flex-shrink-0" />
                <div>
                  <p className="text-xl font-bold">Something in the factory</p>
                  <p className="text-base text-muted-foreground mt-0.5">Equipment, a mess, something unsafe, something broken.</p>
                </div>
              </div>
            </button>

            <button
              onClick={() => setArea("system")}
              className="w-full rounded-2xl border-2 border-border bg-card p-5 text-left hover:border-blue-500 active:scale-[0.99] transition-all"
            >
              <div className="flex items-center gap-3">
                <Tablet className="w-8 h-8 text-blue-500 flex-shrink-0" />
                <div>
                  <p className="text-xl font-bold">Something in the app</p>
                  <p className="text-base text-muted-foreground mt-0.5">The iPad, this software — wrong numbers, a button that won't work.</p>
                </div>
              </div>
            </button>
          </div>
        ) : (
          <>
            <div>
              <label className="text-lg font-bold mb-2 block">{liveChat ? "Jane's write-up — change anything that's wrong" : "What's wrong?"}</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={liveChat ? 7 : 3}
                autoFocus
                placeholder={area === "system" ? "What were you doing, and what happened?" : "What's the problem, and where?"}
                className="w-full px-4 py-3 rounded-2xl border-2 border-border bg-card text-lg focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
              />
              {/* Saying it is quicker than typing it on an iPad mid-shift
                  (Graeme, 2026-10-12). Same dictate-and-tidy as improvements. */}
              <DictateButton value={description} onChange={setDescription} context="note" size="lg" className="mt-3" />
            </div>

            <button
              onClick={() => setIsSafety(s => !s)}
              className={cn(
                "w-full h-16 rounded-2xl border-2 text-lg font-bold flex items-center justify-center gap-3 transition-colors",
                isSafety
                  ? "border-destructive bg-destructive/10 text-destructive"
                  : "border-border hover:bg-secondary/50",
              )}
            >
              <ShieldAlert className="w-6 h-6" />
              {isSafety ? "Safety issue — flagged" : "Is this a safety issue?"}
            </button>

            <button
              onClick={() => setAlsoImprovement(v => !v)}
              className={cn(
                "w-full h-16 rounded-2xl border-2 text-lg font-bold flex items-center justify-center gap-3 transition-colors",
                alsoImprovement
                  ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300"
                  : "border-border hover:bg-secondary/50",
              )}
            >
              {alsoImprovement ? <CheckCircle2 className="w-6 h-6" /> : <Lightbulb className="w-6 h-6" />}
              {alsoImprovement ? "Also an improvement to make" : "Could this be an improvement?"}
            </button>

            {/* Evidence — always offered, not only for improvements. A photo
                of the problem, a screenshot of the app misbehaving, a short
                clip: whatever shows it (Graeme, 2026-08-28). Camera for
                what's in front of you; the device picker for screenshots
                already taken. */}
            <input
              ref={cameraRef}
              type="file"
              accept="image/*,video/*"
              capture="environment"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) setFiles(f => [...f, file]);
              }}
            />
            <input
              ref={deviceRef}
              type="file"
              accept="image/*,video/*"
              multiple
              className="hidden"
              onChange={e => {
                const picked = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (picked.length) setFiles(f => [...f, ...picked]);
              }}
            />
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => { releaseDictation(); cameraRef.current?.click(); }}
                className="h-16 rounded-2xl border-2 border-dashed border-border text-base font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 transition-colors"
              >
                <Camera className="w-5 h-5" /> Take photo / video
              </button>
              <button
                onClick={() => { releaseDictation(); deviceRef.current?.click(); }}
                className="h-16 rounded-2xl border-2 border-dashed border-border text-base font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 transition-colors"
              >
                <ImageIcon className="w-5 h-5" /> Add from device
              </button>
            </div>
            {area === "system" && files.length === 0 && (
              <p className="text-sm text-muted-foreground text-center -mt-1">
                A screenshot of what went wrong helps enormously.
              </p>
            )}
            {files.length > 0 && (
              <div className="space-y-2">
                {files.map((f, i) => (
                  <div key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-2xl border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                    <span className="flex-1 text-base font-bold truncate">{f.name || (f.type.startsWith("video") ? "Video" : "Photo")}</span>
                    <button
                      onClick={() => setFiles(cur => cur.filter((_, j) => j !== i))}
                      className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0"
                      aria-label="Remove"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={() => { setArea(null); setLiveChat(null); setSkipJane(false); setIsSafety(false); }}
                className="h-14 rounded-2xl border-2 border-border text-lg font-bold hover:bg-secondary/50 transition-colors sm:order-1"
              >
                Back
              </button>
              <button
                onClick={report}
                disabled={!description.trim() || busy}
                className="h-16 sm:h-14 rounded-2xl bg-primary text-primary-foreground text-xl sm:text-lg font-bold flex items-center justify-center gap-3 disabled:opacity-50 active:scale-[0.99] transition-all shadow-lg shadow-primary/20 sm:order-2"
              >
                {busy ? <Loader2 className="w-6 h-6 animate-spin" /> : <ArrowRight className="w-6 h-6" />}
                {busy && area === "system" && chat.length > 0 ? "Jane's checking…" : "Report it"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
