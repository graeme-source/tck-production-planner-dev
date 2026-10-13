/**
 * The message box at the bottom of a chat: type, @ to tag someone (a
 * searchable list pops up), optional "must be confirmed", Send.
 *
 * Nothing typed is lost: the draft is kept per chat while the app is open
 * (close the panel, come back, it's still there), and a send that fails
 * keeps the text and says so in red until it goes.
 *
 * Photos and videos (2026-10-13): the paperclip offers Take photo, Record
 * video and Choose from library (several at once). Each starts uploading
 * straight away with its own progress (media-drafts.ts); the text becomes
 * the caption and is optional. Send waits for the uploads; one that failed
 * keeps its Try again and the caption stays put.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Loader2, X, Reply, ShieldAlert, Pencil, Paperclip, Camera, Video, Images } from "lucide-react";
import { activeMentionQuery, encodeMentions, decodeMentions, MAX_BODY_LENGTH, type NamedPerson } from "@workspace/messages";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { UserAvatar } from "@/components/user-avatar";
import type { Person } from "./messages-api";
import { useDraftMedia, addDraftMedia, retryDraftMedia, removeDraftMedia, clearDraftMedia, settleDraftMedia } from "./media-drafts";
import { DraftMediaTray } from "./message-media";

// Drafts survive closing the panel (module-level: lives as long as the tab).
const drafts = new Map<string, { text: string; picked: NamedPerson[] }>();

export interface ComposeTarget {
  replyTo: { id: number; senderName: string | null; preview: string } | null;
  editing: { id: number; body: string } | null;
}

export function ComposeBox({
  draftKey, people, nameOf, target, onClearTarget, showAckToggle, defaultAck, onSend, onSaveEdit,
}: {
  draftKey: string;
  people: Person[];
  nameOf: (id: number) => string | undefined;
  target: ComposeTarget;
  onClearTarget: () => void;
  showAckToggle: boolean;
  defaultAck: boolean;
  onSend: (body: string, requiresAck: boolean, attachmentIds: number[]) => Promise<void>;
  onSaveEdit: (id: number, body: string) => Promise<void>;
}) {
  const saved = drafts.get(draftKey);
  const [text, setText] = useState(saved?.text ?? "");
  const [picked, setPicked] = useState<NamedPerson[]>(saved?.picked ?? []);
  const [caret, setCaret] = useState(0);
  const [requiresAck, setRequiresAck] = useState(defaultAck);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const media = useDraftMedia(draftKey);
  const hasMedia = media.length > 0 && !target.editing;

  const addPicked = (files: FileList | null) => {
    setAttachOpen(false);
    if (!files || files.length === 0) return;
    setError(null);
    const note = addDraftMedia(draftKey, [...files]);
    if (note) toast({ title: "Some were left out", description: note });
  };

  // A different chat: load its draft.
  useEffect(() => {
    const d = drafts.get(draftKey);
    setText(d?.text ?? "");
    setPicked(d?.picked ?? []);
    setRequiresAck(defaultAck);
    setError(null);
  }, [draftKey, defaultAck]);

  // Editing: put the message (mentions as @Name) in the box.
  const editingId = target.editing?.id ?? null;
  useEffect(() => {
    if (!target.editing) return;
    const ids = [...target.editing.body.matchAll(/<@(\d+)>/g)].map(m => Number(m[1]));
    setPicked(ids.map(id => ({ id, name: nameOf(id) ?? "someone" })));
    setText(decodeMentions(target.editing.body, nameOf));
    ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  useEffect(() => {
    if (target.replyTo) ref.current?.focus();
  }, [target.replyTo]);

  // Keep the draft (not while editing — that text isn't a draft).
  useEffect(() => {
    if (target.editing) return;
    if (text) drafts.set(draftKey, { text, picked });
    else drafts.delete(draftKey);
  }, [draftKey, text, picked, target.editing]);

  // Auto-grow up to ~6 lines.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [text]);

  // The @-list closes once a picked name is complete ("@Grant Macleod ").
  const rawMention = activeMentionQuery(text, caret);
  const mention = rawMention && !picked.some(p => rawMention.query.startsWith(`${p.name} `)) ? rawMention : null;
  const matches = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.trim().toLowerCase();
    return people.filter(p => !q || p.name.toLowerCase().includes(q)).slice(0, 6);
  }, [mention, people]);

  const pick = (p: Person) => {
    if (!mention) return;
    const before = text.slice(0, mention.start);
    const after = text.slice(caret);
    const insert = `@${p.name} `;
    const next = before + insert + after;
    setText(next);
    setPicked(prev => (prev.some(x => x.id === p.id) ? prev : [...prev, { id: p.id, name: p.name }]));
    const pos = before.length + insert.length;
    setCaret(pos);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  };

  const submit = async () => {
    const trimmed = text.trim();
    if ((!trimmed && !hasMedia) || sending) return;
    if (target.editing && !trimmed) return;
    const body = trimmed ? encodeMentions(trimmed, picked) : "";
    setSending(true);
    setError(null);
    try {
      if (target.editing) await onSaveEdit(target.editing.id, body);
      else {
        let ids: number[] = [];
        if (hasMedia) {
          const still = media.filter(m => m.status === "uploading").length;
          if (still) setPhase(`Uploading ${still} ${still === 1 ? "file" : "files"}…`);
          const settled = await settleDraftMedia(draftKey);
          setPhase(null);
          if (settled.problem) { setError(settled.problem); return; }
          ids = settled.ids;
        }
        await onSend(body, showAckToggle && !target.replyTo ? requiresAck : false, ids);
        clearDraftMedia(draftKey);
      }
      setText("");
      setPicked([]);
      drafts.delete(draftKey);
      onClearTarget();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Not sent — check the connection and tap Send again");
    } finally {
      setSending(false);
      setPhase(null);
    }
  };

  return (
    <div className="border-t border-border bg-card p-3 space-y-2 flex-shrink-0">
      {(target.replyTo || target.editing) && (
        <div className="flex items-start gap-2 rounded-xl bg-secondary/60 border-l-4 border-primary px-3 py-2">
          {target.editing ? <Pencil className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" /> : <Reply className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />}
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold">{target.editing ? "Editing your message" : `Replying to ${target.replyTo?.senderName ?? "someone"}`}</p>
            {target.replyTo && <p className="text-muted-foreground truncate">{target.replyTo.preview}</p>}
          </div>
          <button
            onClick={() => { onClearTarget(); if (target.editing) { setText(""); setPicked([]); } }}
            className="p-1.5 rounded-lg hover:bg-secondary"
            aria-label={target.editing ? "Stop editing" : "Cancel reply"}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {mention && matches.length > 0 && (
        <div className="rounded-xl border border-border bg-popover shadow-lg overflow-hidden max-h-56 overflow-y-auto">
          <p className="px-3 pt-2 pb-1 text-xs font-semibold text-muted-foreground">Tag someone — they'll get it even if they're not in this chat</p>
          {matches.map(p => (
            <button
              key={p.id}
              onMouseDown={e => e.preventDefault()}
              onClick={() => pick(p)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-secondary/60"
            >
              <UserAvatar name={p.name} avatarUrl={p.avatarUrl} size="sm" />
              <span className="font-medium">{p.name}</span>
            </button>
          ))}
        </div>
      )}

      {showAckToggle && !target.replyTo && !target.editing && (
        <button
          type="button"
          onClick={() => setRequiresAck(v => !v)}
          className={cn(
            "w-full text-left rounded-xl border-2 px-3 py-2 flex items-center gap-2.5 text-sm transition-colors",
            requiresAck ? "border-red-500 bg-red-500/10" : "border-border bg-background hover:bg-secondary/50",
          )}
        >
          <ShieldAlert className={cn("w-4 h-4 flex-shrink-0", requiresAck ? "text-red-600" : "text-muted-foreground")} />
          <span className="flex-1">
            <span className="font-semibold">Must be confirmed — {requiresAck ? "ON" : "OFF"}</span>
            <span className="text-muted-foreground"> · {requiresAck ? "a station's screen locks until someone there taps \"I understand\"" : "tap to make them confirm"}</span>
          </span>
        </button>
      )}

      {!target.editing && (
        <DraftMediaTray
          items={media}
          onRetry={id => { setError(null); retryDraftMedia(draftKey, id); }}
          onRemove={id => { setError(null); removeDraftMedia(draftKey, id); }}
        />
      )}

      {attachOpen && !target.editing && (
        <div className="grid grid-cols-3 gap-2">
          <label className="h-16 rounded-xl border-2 border-border bg-background hover:bg-secondary/60 flex flex-col items-center justify-center gap-1 text-sm font-semibold cursor-pointer">
            <Camera className="w-5 h-5 text-primary" /> Take photo
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { addPicked(e.target.files); e.target.value = ""; }} />
          </label>
          <label className="h-16 rounded-xl border-2 border-border bg-background hover:bg-secondary/60 flex flex-col items-center justify-center gap-1 text-sm font-semibold cursor-pointer">
            <Video className="w-5 h-5 text-primary" /> Record video
            <input type="file" accept="video/*" capture="environment" className="hidden" onChange={e => { addPicked(e.target.files); e.target.value = ""; }} />
          </label>
          <label className="h-16 rounded-xl border-2 border-border bg-background hover:bg-secondary/60 flex flex-col items-center justify-center gap-1 text-sm font-semibold cursor-pointer text-center leading-tight px-1">
            <Images className="w-5 h-5 text-primary" /> Choose from library
            <input type="file" accept="image/*,video/*" multiple className="hidden" onChange={e => { addPicked(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
      )}

      <div className="flex items-end gap-2">
        {!target.editing && (
          <button
            type="button"
            onClick={() => setAttachOpen(o => !o)}
            className={cn("h-12 w-12 rounded-2xl border flex items-center justify-center flex-shrink-0", attachOpen ? "bg-primary/15 text-primary border-primary" : "border-border bg-background hover:bg-secondary")}
            aria-label="Add a photo or video"
            aria-expanded={attachOpen}
          >
            <Paperclip className="w-5 h-5" />
          </button>
        )}
        <textarea
          ref={ref}
          value={text}
          onChange={e => { setText(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); setError(null); }}
          onSelect={e => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey && matches.length === 0) { e.preventDefault(); void submit(); }
          }}
          placeholder={hasMedia ? "Add a caption (optional)" : "Type a message — @ to tag someone"}
          rows={1}
          maxLength={MAX_BODY_LENGTH}
          className="flex-1 min-h-[48px] resize-none px-4 py-3 bg-background border border-border rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <button
          onClick={() => void submit()}
          disabled={sending || (!text.trim() && !hasMedia)}
          className="h-12 px-5 rounded-2xl bg-primary text-primary-foreground font-bold flex items-center gap-2 disabled:opacity-50 flex-shrink-0"
        >
          {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          <span className="hidden sm:inline">{target.editing ? "Save" : "Send"}</span>
        </button>
      </div>
      {phase && <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-4 h-4 animate-spin" /> {phase}</p>}
      {error && (
        <p className="text-sm font-semibold text-red-600" role="alert">Not sent: {error}. Your message is still here{hasMedia ? ", with its photos and videos" : ""} — tap Send to try again.</p>
      )}
    </div>
  );
}
