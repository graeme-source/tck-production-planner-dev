/**
 * The Messages panel — a WhatsApp-style team chat (Graeme, 2026-10-07).
 *
 * Left: the chat list (Everyone, each station, people) newest first with
 * unread counts. Right: the open chat — bubbles (mine right, others left),
 * reply quotes, @mention chips, "Seen", "Got it" for must-confirm messages,
 * older messages loading as you scroll up. On a phone the two take turns.
 *
 * Standing modal rule: X to close, card capped at 92dvh with internal
 * scrolling, sized for iPad 10.2" landscape first. Portaled to <body> by
 * the button so no sticky header's stacking context can trap it.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  X, MessageCircle, ChevronLeft, Users, Megaphone, Plus, Reply, Pencil, Trash2, ShieldAlert,
  CheckCheck, Check, Loader2, Search,
} from "lucide-react";
import {
  conversationTitle, normaliseAudience, conversationKey, parseConversationKey, defaultRequiresAck,
  canEditMessage, canDeleteMessage, previewText, isDirect, type Audience, type Viewer,
} from "@workspace/messages";
import { cn } from "@/lib/utils";
import { feedTimestamp } from "@/lib/feed-time";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { UserAvatar } from "@/components/user-avatar";
import { STATIONS } from "@/pages/station/shared/constants";
import { buildChatList, readStatus, stationAckState, personAckCount, startsGroup, type ChatListEntry } from "@/lib/team-chat-view";
import {
  useConversations, useChat, usePeople, useSendMessage, useMarkRead, useAckMessage, useEditMessage,
  useDeleteMessage, stationLabel, type ApiMessage, type Person,
} from "./messages-api";
import { MessageBody } from "./message-body";
import { ComposeBox, type ComposeTarget } from "./compose-box";

const LONDON_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
const LONDON_DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" });
const knownStation = (k: string) => STATIONS.some(s => s.key === k);

function ChatIcon({ audience, name, avatarUrl }: { audience: Audience; name: string; avatarUrl?: string | null }) {
  if (audience.everyone) {
    return <div className="w-11 h-11 rounded-full bg-primary/15 text-primary flex items-center justify-center flex-shrink-0"><Megaphone className="w-5 h-5" /></div>;
  }
  if (audience.stations.length === 1 && audience.userIds.length === 0) {
    const s = STATIONS.find(x => x.key === audience.stations[0]);
    const Icon = s?.icon ?? Users;
    return <div className="w-11 h-11 rounded-full bg-secondary flex items-center justify-center flex-shrink-0"><Icon className={cn("w-5 h-5", s?.color)} /></div>;
  }
  if (isDirect(audience) && audience.userIds.length === 2) return <UserAvatar name={name} avatarUrl={avatarUrl} size="md" className="w-11 h-11" />;
  return <div className="w-11 h-11 rounded-full bg-secondary flex items-center justify-center flex-shrink-0"><Users className="w-5 h-5 text-muted-foreground" /></div>;
}

function audienceSubtitle(a: Audience, myId: number, nameOf: (id: number) => string | undefined): string {
  if (a.everyone) return "Everyone in the team sees this chat";
  const stations = a.stations.map(stationLabel);
  const others = a.userIds.filter(id => id !== myId).map(id => nameOf(id) ?? "someone");
  if (stations.length && others.length) return `Shows on the ${stations.join(" & ")} screen${stations.length > 1 ? "s" : ""} and goes to ${others.join(", ")}`;
  if (stations.length) return `Shows on the ${stations.join(" & ")} screen${stations.length > 1 ? "s" : ""} until someone there taps Got it`;
  return `Only you and ${others.join(", ")} can see this chat`;
}

export function MessagesPanel({ at, initialKey, onClose }: { at: string[]; initialKey: string | null; onClose: () => void }) {
  const { state } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const [selected, setSelected] = useState<string | null>(initialKey);
  const [picking, setPicking] = useState(false);
  const conversations = useConversations(at, true);
  const peopleQ = usePeople();
  const people = useMemo(() => peopleQ.data?.people ?? [], [peopleQ.data]);

  useEffect(() => { if (initialKey) { setSelected(initialKey); setPicking(false); } }, [initialKey]);

  // Escape closes, like every other dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const names = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of people) m.set(p.id, p.name);
    for (const [id, n] of Object.entries(conversations.data?.names ?? {})) m.set(Number(id), n);
    return m;
  }, [people, conversations.data]);
  const nameOf = (id: number) => names.get(id);

  if (!user) return null;
  const me = conversations.data?.me;
  const viewer: Viewer = { userId: user.id, role: user.role, stations: me?.stations ?? at };
  const list = buildChatList(conversations.data?.conversations ?? [], {
    seesEveryone: me?.seesEveryone ?? true,
    screenStations: at,
    knownStation,
  });

  const showList = !selected && !picking;

  return (
    <div className="fixed inset-0 z-[150] bg-black/60 flex items-center justify-center p-2 md:p-6" onClick={onClose}>
      <div
        className="bg-card border-2 border-border rounded-2xl shadow-2xl w-full max-w-5xl h-[92dvh] max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Messages"
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
          <MessageCircle className="w-6 h-6 text-primary flex-shrink-0" />
          <h2 className="font-display font-bold text-xl flex-1">Messages</h2>
          <button onClick={onClose} className="p-2.5 rounded-xl hover:bg-secondary" aria-label="Close messages">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Chat list */}
          <div className={cn("w-full md:w-[340px] md:flex-shrink-0 md:border-r border-border flex-col min-h-0", showList ? "flex" : "hidden md:flex")}>
            <div className="p-3 flex-shrink-0">
              <button
                onClick={() => { setPicking(true); setSelected(null); }}
                className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-bold flex items-center justify-center gap-2"
              >
                <Plus className="w-5 h-5" /> New message
              </button>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {conversations.isLoading && <p className="p-4 text-sm text-muted-foreground">Loading chats…</p>}
              {conversations.isError && (
                <p className="p-4 text-sm text-red-600">Couldn't load your chats. <button className="underline font-semibold" onClick={() => conversations.refetch()}>Try again</button></p>
              )}
              {list.map(c => (
                <ChatRow
                  key={c.key}
                  chat={c}
                  active={selected === c.key}
                  myId={user.id}
                  nameOf={nameOf}
                  people={people}
                  onOpen={() => { setSelected(c.key); setPicking(false); }}
                />
              ))}
            </div>
          </div>

          {/* Chat / new message */}
          <div className={cn("flex-1 min-w-0 flex-col min-h-0", showList ? "hidden md:flex" : "flex")}>
            {picking ? (
              <NewMessagePicker
                myId={user.id}
                canMessageEveryone={me?.canMessageEveryone ?? false}
                people={people}
                onBack={() => setPicking(false)}
                onChoose={key => { setPicking(false); setSelected(key); }}
              />
            ) : selected ? (
              <ChatView
                key={selected}
                convKey={selected}
                at={at}
                viewer={viewer}
                people={people}
                nameOf={nameOf}
                extraNames={names}
                onBack={() => setSelected(null)}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-muted-foreground gap-3">
                <MessageCircle className="w-12 h-12 opacity-40" />
                <p className="text-lg font-semibold text-foreground">Pick a chat, or start a new message</p>
                <p className="text-sm max-w-sm">Message a station, one or more people, or everyone. Type @ in a message to tag someone.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatRow({ chat, active, myId, nameOf, people, onOpen }: {
  chat: ChatListEntry; active: boolean; myId: number; nameOf: (id: number) => string | undefined; people: Person[]; onOpen: () => void;
}) {
  const title = conversationTitle(chat.audience, myId, stationLabel, nameOf);
  const other = chat.audience.userIds.find(id => id !== myId);
  const last = chat.lastMessage;
  const preview = !last
    ? "No messages yet"
    : last.deleted
      ? "Message deleted"
      : `${last.senderUserId === myId ? "You" : (last.senderName ?? "Someone").split(" ")[0]}: ${previewText(last.body ?? "", nameOf, 70)}`;
  return (
    <button
      onClick={onOpen}
      className={cn("w-full flex items-center gap-3 px-3 py-3 text-left border-b border-border/60 transition-colors", active ? "bg-primary/10" : "hover:bg-secondary/50")}
    >
      <ChatIcon audience={chat.audience} name={title} avatarUrl={people.find(p => p.id === other)?.avatarUrl} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cn("truncate flex-1", chat.unread ? "font-bold" : "font-semibold")}>{title}</span>
          {last && <span className={cn("text-xs flex-shrink-0", chat.unread ? "text-primary font-semibold" : "text-muted-foreground")}>{feedTimestamp(last.createdAt)}</span>}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={cn("text-sm truncate flex-1", chat.unread ? "text-foreground" : "text-muted-foreground")}>{preview}</span>
          {chat.pendingAck && <ShieldAlert className="w-4 h-4 text-red-600 flex-shrink-0" aria-label="Needs confirming" />}
          {chat.unread > 0 && (
            <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center flex-shrink-0">{chat.unread}</span>
          )}
        </div>
      </div>
    </button>
  );
}

// ── New message: choose who it's for ────────────────────────────────────────

function NewMessagePicker({ myId, canMessageEveryone, people, onBack, onChoose }: {
  myId: number; canMessageEveryone: boolean; people: Person[]; onBack: () => void; onChoose: (key: string) => void;
}) {
  const [everyone, setEveryone] = useState(false);
  const [stations, setStations] = useState<string[]>([]);
  const [userIds, setUserIds] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter(y => y !== x) : [...xs, x]);
  const others = people.filter(p => p.id !== myId);
  const shown = others.filter(p => p.name.toLowerCase().includes(search.trim().toLowerCase()));
  const nothing = !everyone && stations.length === 0 && userIds.length === 0;

  const go = () => {
    const a = normaliseAudience({ everyone, stations, userIds }, myId);
    onChoose(conversationKey(a));
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-3 py-3 border-b border-border flex-shrink-0">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-secondary" aria-label="Back to chats"><ChevronLeft className="w-5 h-5" /></button>
        <h3 className="font-bold text-lg flex-1">Who's it for?</h3>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-5">
        {canMessageEveryone && (
          <button
            onClick={() => { setEveryone(v => !v); setStations([]); setUserIds([]); }}
            className={cn("w-full rounded-2xl border-2 p-4 flex items-center gap-3 text-left", everyone ? "border-primary bg-primary/10" : "border-border hover:bg-secondary/50")}
          >
            <Megaphone className="w-6 h-6 text-primary" />
            <span className="flex-1">
              <span className="block font-bold text-base">Everyone</span>
              <span className="block text-sm text-muted-foreground">An announcement to the whole team</span>
            </span>
            {everyone && <Check className="w-6 h-6 text-primary" />}
          </button>
        )}

        <div className={cn(everyone && "opacity-40 pointer-events-none")}>
          <p className="text-sm font-semibold mb-2">Stations — shows on that station's screen</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {STATIONS.map(s => {
              const on = stations.includes(s.key);
              const Icon = s.icon;
              return (
                <button
                  key={s.key}
                  onClick={() => setStations(xs => toggle(xs, s.key))}
                  className={cn("h-14 rounded-xl border-2 px-3 flex items-center gap-2 text-left font-semibold", on ? "border-primary bg-primary/10" : "border-border hover:bg-secondary/50")}
                >
                  <Icon className={cn("w-5 h-5 flex-shrink-0", s.color)} />
                  <span className="truncate flex-1">{s.label}</span>
                  {on && <Check className="w-5 h-5 text-primary flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className={cn(everyone && "opacity-40 pointer-events-none")}>
          <p className="text-sm font-semibold mb-2">People — only they (and you) see it</p>
          <div className="relative mb-2">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search for someone"
              className="w-full h-12 pl-9 pr-3 bg-background border border-border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          {userIds.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {userIds.map(id => (
                <button key={id} onClick={() => setUserIds(xs => xs.filter(x => x !== id))} className="h-9 pl-3 pr-2 rounded-full bg-primary/15 text-primary font-semibold text-sm flex items-center gap-1">
                  {people.find(p => p.id === id)?.name ?? "Someone"} <X className="w-4 h-4" />
                </button>
              ))}
            </div>
          )}
          <div className="rounded-xl border border-border divide-y divide-border/60 max-h-72 overflow-y-auto">
            {shown.map(p => {
              const on = userIds.includes(p.id);
              return (
                <button key={p.id} onClick={() => setUserIds(xs => toggle(xs, p.id))} className={cn("w-full flex items-center gap-3 px-3 py-2.5 text-left", on ? "bg-primary/10" : "hover:bg-secondary/50")}>
                  <UserAvatar name={p.name} avatarUrl={p.avatarUrl} size="sm" />
                  <span className="flex-1 font-medium">{p.name}</span>
                  {on && <Check className="w-5 h-5 text-primary" />}
                </button>
              );
            })}
            {shown.length === 0 && <p className="p-3 text-sm text-muted-foreground">Nobody matches "{search}".</p>}
          </div>
        </div>
      </div>
      <div className="p-3 border-t border-border flex-shrink-0">
        <button onClick={go} disabled={nothing} className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-50">
          {nothing ? "Choose stations, people or Everyone" : "Next — write the message"}
        </button>
      </div>
    </div>
  );
}

// ── One chat ────────────────────────────────────────────────────────────────

function ChatView({ convKey, at, viewer, people, nameOf, extraNames, onBack }: {
  convKey: string; at: string[]; viewer: Viewer; people: Person[];
  nameOf: (id: number) => string | undefined; extraNames: Map<number, string>; onBack: () => void;
}) {
  const chat = useChat(convKey, at);
  const send = useSendMessage(at);
  const markRead = useMarkRead(at);
  const ack = useAckMessage(at);
  const edit = useEditMessage();
  const del = useDeleteMessage();
  const [target, setTarget] = useState<ComposeTarget>({ replyTo: null, editing: null });
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const audience: Audience = chat.data?.pages[0]?.audience ?? parseConversationKey(convKey) ?? { everyone: false, stations: [], userIds: [] };
  const pageNames = useMemo(() => {
    const m = new Map(extraNames);
    for (const p of chat.data?.pages ?? []) for (const [id, n] of Object.entries(p.names)) m.set(Number(id), n);
    return m;
  }, [chat.data, extraNames]);
  const nameOfAll = (id: number) => pageNames.get(id) ?? nameOf(id);
  const messages: ApiMessage[] = useMemo(
    () => (chat.data?.pages ?? []).slice().reverse().flatMap(p => p.messages),
    [chat.data],
  );
  const title = conversationTitle(audience, viewer.userId, stationLabel, nameOfAll);
  const lastId = messages[messages.length - 1]?.id ?? 0;
  const firstId = messages[0]?.id ?? 0;

  // Keep the bottom in view as messages arrive (if you were already there),
  // and hold your place when older ones load above.
  const nearBottom = useRef(true);
  const prevHeight = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prevHeight.current != null) {
      el.scrollTop = el.scrollHeight - prevHeight.current + el.scrollTop;
      prevHeight.current = null;
    }
  }, [firstId]);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const mineLast = messages[messages.length - 1]?.senderUserId === viewer.userId;
    if (nearBottom.current || mineLast) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 80 && chat.hasNextPage && !chat.isFetchingNextPage) {
      prevHeight.current = el.scrollHeight;
      void chat.fetchNextPage();
    }
  };

  // Seen: mark read up to the newest message someone else sent.
  const markedUpTo = useRef(0);
  useEffect(() => {
    const newestOthers = [...messages].reverse().find(m => m.senderUserId !== viewer.userId)?.id ?? 0;
    if (newestOthers > markedUpTo.current && document.visibilityState === "visible") {
      markedUpTo.current = newestOthers;
      markRead.mutate({ key: convKey, upToId: newestOthers });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId, convKey]);

  const doSend = async (body: string, requiresAck: boolean) => {
    await send.mutateAsync({ conversationKey: convKey, body, parentId: target.replyTo?.id, requiresAck });
    nearBottom.current = true;
  };
  const doEdit = async (id: number, body: string) => { await edit.mutateAsync({ id, body }); };

  const now = new Date();

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border flex-shrink-0">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-secondary md:hidden" aria-label="Back to chats"><ChevronLeft className="w-5 h-5" /></button>
        <ChatIcon audience={audience} name={title} avatarUrl={people.find(p => p.id === audience.userIds.find(id => id !== viewer.userId))?.avatarUrl} />
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-lg truncate">{title}</h3>
          <p className="text-xs text-muted-foreground truncate">{audienceSubtitle(audience, viewer.userId, nameOfAll)}</p>
        </div>
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto overscroll-contain px-3 md:px-5 py-4 space-y-1 bg-secondary/20">
        {chat.isFetchingNextPage && <p className="text-center text-xs text-muted-foreground py-2"><Loader2 className="w-4 h-4 inline animate-spin" /> Loading older messages…</p>}
        {chat.hasNextPage && !chat.isFetchingNextPage && (
          <div className="text-center py-2"><button onClick={() => { prevHeight.current = scrollRef.current?.scrollHeight ?? null; void chat.fetchNextPage(); }} className="text-sm font-semibold text-primary">Load older messages</button></div>
        )}
        {chat.isLoading && <p className="text-center text-sm text-muted-foreground py-8">Loading…</p>}
        {chat.isError && <p className="text-center text-sm text-red-600 py-8">Couldn't load this chat. <button className="underline font-semibold" onClick={() => chat.refetch()}>Try again</button></p>}
        {!chat.isLoading && !chat.isError && messages.length === 0 && (
          <p className="text-center text-muted-foreground py-10">No messages here yet — say hello.</p>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || LONDON_DAY.format(new Date(prev.createdAt)) !== LONDON_DAY.format(new Date(m.createdAt));
          return (
            <div key={m.id}>
              {newDay && (
                <div className="flex justify-center my-3">
                  <span className="text-xs font-semibold text-muted-foreground bg-card border border-border rounded-full px-3 py-1">{LONDON_DAY.format(new Date(m.createdAt))}</span>
                </div>
              )}
              <Bubble
                m={m}
                audience={audience}
                viewer={viewer}
                groupStart={newDay || startsGroup(prev, m)}
                nameOf={nameOfAll}
                canEdit={canEditMessage({ senderUserId: m.senderUserId, createdAt: m.createdAt, deleted: m.deleted }, viewer, now)}
                canDelete={canDeleteMessage({ senderUserId: m.senderUserId, createdAt: m.createdAt, deleted: m.deleted }, viewer, now)}
                confirmingDelete={confirmDelete === m.id}
                acking={ack.isPending && ack.variables?.id === m.id}
                onReply={() => setTarget({ editing: null, replyTo: { id: m.id, senderName: m.senderName, preview: previewText(m.body ?? "", nameOfAll, 80) } })}
                onEdit={() => setTarget({ replyTo: null, editing: { id: m.id, body: m.body ?? "" } })}
                onDelete={() => setConfirmDelete(m.id)}
                onCancelDelete={() => setConfirmDelete(null)}
                onConfirmDelete={async () => {
                  try { await del.mutateAsync(m.id); setConfirmDelete(null); }
                  catch (err) { toast({ title: "Couldn't delete", description: err instanceof Error ? err.message : "Try again", variant: "destructive" }); }
                }}
                onAck={async () => {
                  try { await ack.mutateAsync({ id: m.id }); }
                  catch (err) { toast({ title: "Couldn't confirm", description: err instanceof Error ? err.message : "Try again", variant: "destructive" }); }
                }}
              />
            </div>
          );
        })}
      </div>

      <ComposeBox
        draftKey={convKey}
        people={people}
        nameOf={nameOfAll}
        target={target}
        onClearTarget={() => setTarget({ replyTo: null, editing: null })}
        showAckToggle
        defaultAck={defaultRequiresAck(audience)}
        onSend={doSend}
        onSaveEdit={doEdit}
      />
    </div>
  );
}

function Bubble({
  m, audience, viewer, groupStart, nameOf, canEdit, canDelete, confirmingDelete, acking,
  onReply, onEdit, onDelete, onCancelDelete, onConfirmDelete, onAck,
}: {
  m: ApiMessage; audience: Audience; viewer: Viewer; groupStart: boolean; nameOf: (id: number) => string | undefined;
  canEdit: boolean; canDelete: boolean; confirmingDelete: boolean; acking: boolean;
  onReply: () => void; onEdit: () => void; onDelete: () => void; onCancelDelete: () => void; onConfirmDelete: () => void; onAck: () => void;
}) {
  const mine = m.senderUserId === viewer.userId;
  const time = LONDON_TIME.format(new Date(m.createdAt));
  const stationAcks = m.requiresAck ? stationAckState(m, audience) : null;
  const peopleAcked = personAckCount(m);

  return (
    <div className={cn("flex group", mine ? "justify-end" : "justify-start", groupStart ? "mt-3" : "mt-0.5")}>
      {!mine && (
        <div className="w-9 mr-2 flex-shrink-0">
          {groupStart && <UserAvatar name={m.senderName ?? "?"} avatarUrl={m.senderAvatarUrl} size="md" />}
        </div>
      )}
      <div className={cn("max-w-[78%] md:max-w-[70%] flex flex-col", mine ? "items-end" : "items-start")}>
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2 shadow-sm",
            m.deleted ? "bg-card border border-dashed border-border text-muted-foreground italic"
              : mine ? "bg-primary text-primary-foreground rounded-br-md" : "bg-card border border-border rounded-bl-md",
            m.requiresAck && !m.deleted && "ring-2 ring-red-500/70",
          )}
        >
          {!mine && groupStart && <p className="text-xs font-bold text-primary mb-0.5">{m.senderName ?? "Someone"}</p>}
          {m.parentId != null && !m.deleted && (
            <div className={cn("rounded-lg border-l-4 px-2.5 py-1.5 mb-1.5 text-sm", mine ? "bg-black/15 border-white/70" : "bg-secondary/70 border-primary")}>
              {m.parent ? (
                <>
                  <p className="font-semibold text-xs">{m.parent.senderName ?? "Someone"}</p>
                  <p className="line-clamp-2 opacity-90">{m.parent.deleted ? "Message deleted" : previewText(m.parent.body ?? "", nameOf, 140)}</p>
                </>
              ) : (
                <p className="opacity-80 text-xs">Replying to a message</p>
              )}
            </div>
          )}
          {m.requiresAck && !m.deleted && (
            <p className={cn("text-xs font-bold flex items-center gap-1 mb-0.5", mine ? "text-white" : "text-red-600")}>
              <ShieldAlert className="w-3.5 h-3.5" /> Must be confirmed
            </p>
          )}
          {m.deleted ? <p>This message was deleted</p> : <MessageBody body={m.body ?? ""} nameOf={nameOf} onDark={mine} className="text-base" />}
          <p className={cn("text-[11px] mt-1 flex items-center gap-1 justify-end", mine ? "text-primary-foreground/80" : "text-muted-foreground")}>
            {m.editedAt && !m.deleted && <span>edited ·</span>}
            <span>{time}</span>
            {mine && !m.deleted && (
              <span className="flex items-center gap-0.5" title={m.readers.map(r => r.name).join(", ") || "Not seen yet"}>
                · {readStatus(m, audience, viewer.userId).startsWith("Seen") ? <CheckCheck className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                {readStatus(m, audience, viewer.userId)}
              </span>
            )}
          </p>
        </div>

        {/* Confirmations */}
        {stationAcks && !m.deleted && (stationAcks.confirmed.length > 0 || stationAcks.waiting.length > 0) && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {stationAcks.confirmed.map(c => (
              <span key={c.station} className="text-xs rounded-full px-2 py-0.5 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-semibold">
                ✓ {stationLabel(c.station)}{c.byName ? ` — ${c.byName.split(" ")[0]}` : ""} {LONDON_TIME.format(new Date(c.at))}
              </span>
            ))}
            {stationAcks.waiting.map(s => (
              <span key={s} className="text-xs rounded-full px-2 py-0.5 bg-amber-500/15 text-amber-700 dark:text-amber-300 font-semibold">Waiting: {stationLabel(s)}</span>
            ))}
          </div>
        )}
        {m.requiresAck && !m.deleted && peopleAcked > 0 && (
          <span className="mt-1 text-xs text-emerald-700 dark:text-emerald-300 font-semibold">✓ Confirmed by {peopleAcked} {peopleAcked === 1 ? "person" : "people"}</span>
        )}
        {m.myPendingAcks.length > 0 && (
          <button
            onClick={onAck}
            disabled={acking}
            className="mt-1.5 h-11 px-4 rounded-xl bg-red-600 text-white font-bold text-sm flex items-center gap-2 disabled:opacity-60"
          >
            {acking && <Loader2 className="w-4 h-4 animate-spin" />} Got it — I'll action this
          </button>
        )}

        {/* Actions: always visible on touch screens, quiet until hover elsewhere. */}
        {!m.deleted && (
          confirmingDelete ? (
            <div className="mt-1 flex items-center gap-2 text-sm">
              <span className="font-semibold">Delete this message?</span>
              <button onClick={onConfirmDelete} className="h-9 px-3 rounded-lg bg-red-600 text-white font-semibold">Delete</button>
              <button onClick={onCancelDelete} className="h-9 px-3 rounded-lg border border-border font-semibold">Keep</button>
            </div>
          ) : (
            <div className="mt-0.5 flex items-center gap-1 opacity-70 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <button onClick={onReply} className="h-8 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1 hover:bg-secondary"><Reply className="w-3.5 h-3.5" /> Reply</button>
              {canEdit && <button onClick={onEdit} className="h-8 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1 hover:bg-secondary"><Pencil className="w-3.5 h-3.5" /> Edit</button>}
              {canDelete && <button onClick={onDelete} className="h-8 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1 hover:bg-secondary text-red-600"><Trash2 className="w-3.5 h-3.5" /> Delete</button>}
            </div>
          )
        )}
      </div>
    </div>
  );
}
