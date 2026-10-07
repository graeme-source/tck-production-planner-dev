/**
 * Team messages — data hooks for the Messages button, panel and station
 * banner (Graeme, 2026-10-07). Server: /api/messages (routes/messages.ts);
 * rules shared with it: @workspace/messages.
 *
 * `at` is the station screen the app is showing (["packing"] on Order
 * Packing Live, ["main_prep","prep"] on Main Prep). It's how a shared
 * station iPad shows that station's messages to whoever is signed in there.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Audience } from "@workspace/messages";
import { STATIONS } from "@/pages/station/shared/constants";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface ApiMessage {
  id: number;
  conversationKey: string;
  audience: Audience;
  parentId: number | null;
  parent: { id: number; senderName: string | null; body: string | null; deleted: boolean } | null;
  senderUserId: number | null;
  senderName: string | null;
  senderAvatarUrl: string | null;
  body: string | null;
  deleted: boolean;
  editedAt: string | null;
  createdAt: string;
  requiresAck: boolean;
  mentionIds: number[];
  readers: Array<{ id: number; name: string }>;
  acks: Array<{ target: string; byName: string | null; at: string }>;
  myPendingAcks: string[];
}

export interface ConversationSummary {
  key: string;
  audience: Audience;
  lastMessage: { id: number; senderUserId: number | null; senderName: string | null; body: string | null; deleted: boolean; createdAt: string } | null;
  unread: number;
  pendingAck: boolean;
}

export interface ConversationsResponse {
  conversations: ConversationSummary[];
  names: Record<number, string>;
  me: { userId: number; stations: string[]; canMessageEveryone: boolean; seesEveryone: boolean };
}

export interface ChatPage { messages: ApiMessage[]; hasMore: boolean; audience: Audience; names: Record<number, string> }

export interface Person { id: number; name: string; avatarUrl: string | null }

/** Sub-sections of Prep are the Prep station too — a message to Prep shows
 *  on Main Prep, Bases & Sauces and Raw Meat Prep. */
export function messageStationKeys(stationType: string): string[] {
  return stationType === "main_prep" || stationType === "prep_bases" || stationType === "prep_meat"
    ? [stationType, "prep"]
    : [stationType];
}

const EXTRA_LABELS: Record<string, string> = { main_prep: "Main Prep", prep_bases: "Bases & Sauces", prep_meat: "Raw Meat Prep" };

export function stationLabel(key: string): string {
  return STATIONS.find(s => s.key === key)?.label ?? EXTRA_LABELS[key] ?? key.replace(/_/g, " ");
}

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed (${r.status})`);
  }
  return r.json() as Promise<T>;
}

const atParam = (at: string[]) => (at.length ? `at=${encodeURIComponent(at.join(","))}` : "");

export const messagesKeys = {
  all: ["team-messages"] as const,
  unread: (at: string[]) => ["team-messages", "unread", at.join(",")] as const,
  conversations: (at: string[]) => ["team-messages", "conversations", at.join(",")] as const,
  chat: (key: string, at: string[]) => ["team-messages", "chat", key, at.join(",")] as const,
  banner: (station: string) => ["team-messages", "banner", station] as const,
  people: ["team-messages", "people"] as const,
};

/** The badge. Every 60 s, faster (15 s) while the panel is open. */
export function useMessagesUnread(at: string[], fast: boolean) {
  return useQuery<{ unread: number; pendingAcks: number }>({
    queryKey: messagesKeys.unread(at),
    queryFn: async () => jsonOrThrow(await fetch(`${BASE}/api/messages/unread?${atParam(at)}`, { credentials: "include" })),
    refetchInterval: fast ? 15_000 : 60_000,
    staleTime: 10_000,
  });
}

export function useConversations(at: string[], enabled: boolean) {
  return useQuery<ConversationsResponse>({
    queryKey: messagesKeys.conversations(at),
    queryFn: async () => jsonOrThrow(await fetch(`${BASE}/api/messages/conversations?${atParam(at)}`, { credentials: "include" })),
    enabled,
    refetchInterval: enabled ? 20_000 : false,
  });
}

/** One chat, newest 20 first; fetchNextPage loads the 20 before those. */
export function useChat(key: string | null, at: string[]) {
  return useInfiniteQuery<ChatPage>({
    queryKey: messagesKeys.chat(key ?? "", at),
    enabled: !!key,
    initialPageParam: null as number | null,
    queryFn: async ({ pageParam }) => {
      const qs = [atParam(at), pageParam ? `before=${pageParam}` : "", "limit=20"].filter(Boolean).join("&");
      return jsonOrThrow(await fetch(`${BASE}/api/messages/conversations/${encodeURIComponent(key!)}/messages?${qs}`, { credentials: "include" }));
    },
    getNextPageParam: last => (last.hasMore && last.messages[0] ? last.messages[0].id : undefined),
    refetchInterval: 15_000,
  });
}

export function usePeople(enabled = true) {
  return useQuery<{ people: Person[] }>({
    queryKey: messagesKeys.people,
    queryFn: async () => jsonOrThrow(await fetch(`${BASE}/api/messages/people`, { credentials: "include" })),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useStationBanner(station: string) {
  return useQuery<{ messages: ApiMessage[] }>({
    queryKey: messagesKeys.banner(station),
    queryFn: async () => jsonOrThrow(await fetch(`${BASE}/api/messages/station-banner?station=${encodeURIComponent(station)}`, { credentials: "include" })),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

function useInvalidateMessages() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: messagesKeys.all });
}

export interface SendArgs { conversationKey: string; body: string; parentId?: number; requiresAck?: boolean }

export function useSendMessage(at: string[]) {
  const invalidate = useInvalidateMessages();
  return useMutation({
    mutationFn: async (args: SendArgs) =>
      jsonOrThrow<{ message: ApiMessage; conversationKey: string }>(await fetch(`${BASE}/api/messages`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...args, at }),
      })),
    onSuccess: () => { void invalidate(); },
  });
}

export function useMarkRead(at: string[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, upToId }: { key: string; upToId: number }) =>
      jsonOrThrow(await fetch(`${BASE}/api/messages/conversations/${encodeURIComponent(key)}/read`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upToId, at }),
      })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["team-messages", "unread"] });
      void qc.invalidateQueries({ queryKey: ["team-messages", "conversations"] });
    },
  });
}

export function useAckMessage(at: string[]) {
  const invalidate = useInvalidateMessages();
  return useMutation({
    mutationFn: async ({ id, targets }: { id: number; targets?: string[] }) =>
      jsonOrThrow(await fetch(`${BASE}/api/messages/${id}/ack`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ at, targets }),
      })),
    onSuccess: () => { void invalidate(); },
  });
}

export function useEditMessage() {
  const invalidate = useInvalidateMessages();
  return useMutation({
    mutationFn: async ({ id, body }: { id: number; body: string }) =>
      jsonOrThrow(await fetch(`${BASE}/api/messages/${id}`, {
        method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      })),
    onSuccess: () => { void invalidate(); },
  });
}

export function useDeleteMessage() {
  const invalidate = useInvalidateMessages();
  return useMutation({
    mutationFn: async (id: number) =>
      jsonOrThrow(await fetch(`${BASE}/api/messages/${id}`, { method: "DELETE", credentials: "include" })),
    onSuccess: () => { void invalidate(); },
  });
}

/** Open the Messages panel from anywhere (a station banner's "Reply"). */
export const OPEN_MESSAGES_EVENT = "tck:open-messages";
export function openMessages(conversationKey?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_MESSAGES_EVENT, { detail: { conversationKey } }));
}
