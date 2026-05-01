import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, Bot, User as UserIcon, Plus, BookOpen, X, Save, MessagesSquare, Trash2, ChefHat, Wrench, Paperclip, ImageIcon, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export const ASSISTANT_NAME = "Caz";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Role = "user" | "assistant";

type ImageBlock = { type: "image"; source: { type: "base64"; media_type: string; data: string } };
type TextBlock = { type: "text"; text: string };
type ContentBlock = TextBlock | ImageBlock;
type MessageContent = string | ContentBlock[];

interface Message {
  id: number;
  role: Role;
  content: MessageContent;
}

interface PendingImage {
  id: string;
  mediaType: string;
  base64: string;
  previewUrl: string;
  bytes: number;
  name: string;
}

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES_PER_MESSAGE = 10;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function getMessageText(content: MessageContent): string {
  if (typeof content === "string") return content;
  return content.find((b): b is TextBlock => b.type === "text")?.text ?? "";
}

function getMessageImages(content: MessageContent): ImageBlock[] {
  if (typeof content === "string") return [];
  return content.filter((b): b is ImageBlock => b.type === "image");
}

interface ToolEvent {
  name: string;
  status: "running" | "ok" | "error" | "proposal_sent";
}

interface MemoryProposal {
  id: string;
  newContent: string;
  reason: string;
}

interface RecipeDraftLine {
  ingredientId?: number;
  subRecipeId?: number;
  quantity: number;
  isTopping?: boolean;
  quid?: boolean;
  includeInFillingMix?: boolean;
}

interface RecipeDraft {
  name: string;
  description?: string;
  category?: string;
  notes?: string;
  servings?: number;
  servingUnit?: string;
  portionsPerBatch?: number;
  packSize?: number;
  rrp?: number;
  packagingCost?: number;
  labourCost?: number;
  fillWeightGrams?: number;
  baseType?: string;
  baseWeightGrams?: number;
  shelfLifeDays?: number;
  isCoreMenu?: boolean;
  isCurrentSpecial?: boolean;
  ingredients?: RecipeDraftLine[];
  subRecipes?: RecipeDraftLine[];
  rationale?: string;
}

interface RecipeDraftProposal {
  id: string;
  draft: RecipeDraft;
}

interface ThreadSummary {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

interface ThreadDetail extends ThreadSummary {
  messages: Array<{ id: number; role: Role; content: MessageContent; createdAt: string }>;
}

const WELCOME_TEXT =
  "Hey, I'm Caz. Ask me anything — design a recipe, look up costs, sanity-check a margin, or just talk through an idea. I'll remember important things across sessions and can propose recipe drafts for you to Save.";

function welcomeMessage(): Message {
  return { id: 0, role: "assistant", content: WELCOME_TEXT };
}

interface FoundersAssistantProps {
  open: boolean;
  onClose: () => void;
}

export function FoundersAssistant({ open, onClose }: FoundersAssistantProps) {
  const [messages, setMessages] = useState<Message[]>([welcomeMessage()]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);

  const [memory, setMemory] = useState<string>("");
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState<string>("");
  const [memorySaving, setMemorySaving] = useState(false);

  const [proposal, setProposal] = useState<MemoryProposal | null>(null);
  const [proposalDraft, setProposalDraft] = useState<string>("");

  const [recipeProposal, setRecipeProposal] = useState<RecipeDraftProposal | null>(null);
  const [recipeDraft, setRecipeDraft] = useState<RecipeDraft | null>(null);
  const [recipeSaving, setRecipeSaving] = useState(false);

  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [threadsView, setThreadsView] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);

  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [dragActive, setDragActive] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const nextIdRef = useRef(1);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    for (const f of list) {
      if (!ALLOWED_IMAGE_TYPES.has(f.type)) {
        setError(`"${f.name}" is not a supported image (jpeg/png/webp/gif).`);
        continue;
      }
      if (f.size > MAX_IMAGE_BYTES) {
        setError(`"${f.name}" is too large (max 5MB).`);
        continue;
      }
      setPendingImages(prev => {
        if (prev.length >= MAX_IMAGES_PER_MESSAGE) {
          setError(`Max ${MAX_IMAGES_PER_MESSAGE} images per message.`);
          return prev;
        }
        return prev;
      });
      try {
        const base64 = await fileToBase64(f);
        const previewUrl = URL.createObjectURL(f);
        setPendingImages(prev => prev.length >= MAX_IMAGES_PER_MESSAGE ? prev : [...prev, {
          id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
          mediaType: f.type,
          base64,
          previewUrl,
          bytes: f.size,
          name: f.name,
        }]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to read image");
      }
    }
  }, []);

  const removePendingImage = useCallback((id: string) => {
    setPendingImages(prev => {
      const found = prev.find(p => p.id === id);
      if (found) URL.revokeObjectURL(found.previewUrl);
      return prev.filter(p => p.id !== id);
    });
  }, []);

  const clearPendingImages = useCallback(() => {
    setPendingImages(prev => {
      prev.forEach(p => URL.revokeObjectURL(p.previewUrl));
      return [];
    });
  }, []);

  useEffect(() => {
    return () => {
      pendingImages.forEach(p => URL.revokeObjectURL(p.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMemory = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/recipe-designer/memory`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setMemory(data.value ?? "");
    } catch { /* ignore */ }
  }, []);

  const loadThreads = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/recipe-designer/threads`, { credentials: "include" });
      if (!res.ok) return;
      setThreads(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadMemory(); }, [loadMemory]);
  useEffect(() => { loadThreads(); }, [loadThreads]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streaming, toolEvents]);

  const saveMemory = useCallback(async (value: string): Promise<boolean> => {
    setMemorySaving(true);
    try {
      const res = await fetch(`${BASE}/api/recipe-designer/memory`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      setMemory(value);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save memory");
      return false;
    } finally {
      setMemorySaving(false);
    }
  }, []);

  const ensureThread = useCallback(async (): Promise<number> => {
    if (activeThreadId) return activeThreadId;
    const res = await fetch(`${BASE}/api/recipe-designer/threads`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error("Failed to create conversation");
    const t = await res.json();
    setActiveThreadId(t.id);
    setThreads(prev => [{ ...t }, ...prev]);
    return t.id;
  }, [activeThreadId]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if ((!trimmed && pendingImages.length === 0) || streaming) return;

    let threadId: number;
    try { threadId = await ensureThread(); } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start conversation");
      return;
    }

    let userContent: MessageContent;
    if (pendingImages.length === 0) {
      userContent = trimmed;
    } else {
      const blocks: ContentBlock[] = pendingImages.map(p => ({
        type: "image" as const,
        source: { type: "base64" as const, media_type: p.mediaType, data: p.base64 },
      }));
      if (trimmed) blocks.push({ type: "text", text: trimmed });
      userContent = blocks;
    }

    const userMsg: Message = { id: nextIdRef.current++, role: "user", content: userContent };
    const history = [...messages, userMsg];
    const assistantId = nextIdRef.current++;
    setMessages([...history, { id: assistantId, role: "assistant", content: "" }]);
    setInput("");
    clearPendingImages();
    setStreaming(true);
    setError(null);
    setToolEvents([]);

    try {
      const res = await fetch(`${BASE}/api/recipe-designer/chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map(m => ({ role: m.role, content: m.content })),
          threadId,
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const raw of events) {
          if (!raw.trim()) continue;
          let event = "message";
          let data = "";
          for (const line of raw.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if (!data) continue;
          let parsed: unknown;
          try { parsed = JSON.parse(data); } catch { continue; }

          if (event === "delta") {
            const text = (parsed as { text?: string }).text ?? "";
            setMessages(prev => prev.map(m => {
              if (m.id !== assistantId) return m;
              const current = typeof m.content === "string" ? m.content : "";
              return { ...m, content: current + text };
            }));
          } else if (event === "tool_call") {
            const t = parsed as ToolEvent;
            setToolEvents(prev => [...prev, t]);
          } else if (event === "memory_proposal") {
            const p = parsed as MemoryProposal;
            setProposal(p);
            setProposalDraft(p.newContent);
          } else if (event === "recipe_draft_proposal") {
            const p = parsed as RecipeDraftProposal;
            setRecipeProposal(p);
            setRecipeDraft({ ...p.draft });
          } else if (event === "error") {
            const errMsg = (parsed as { error?: string }).error ?? "Stream error";
            throw new Error(errMsg);
          }
        }
      }
      loadThreads();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setError(msg);
      setMessages(prev => prev.filter(m => m.id !== assistantId || (typeof m.content === "string" ? m.content : m.content.length > 0)));
    } finally {
      setStreaming(false);
    }
  }, [messages, streaming, ensureThread, loadThreads, pendingImages, clearPendingImages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send(input);
  };

  const newConversation = () => {
    if (streaming) return;
    setMessages([welcomeMessage()]);
    setActiveThreadId(null);
    setError(null);
    setToolEvents([]);
  };

  const loadThread = useCallback(async (id: number) => {
    if (streaming) return;
    try {
      const res = await fetch(`${BASE}/api/recipe-designer/threads/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      const detail: ThreadDetail = await res.json();
      const msgs: Message[] = detail.messages.length === 0
        ? [welcomeMessage()]
        : detail.messages.map(m => ({ id: nextIdRef.current++, role: m.role, content: m.content as MessageContent }));
      setMessages(msgs);
      setActiveThreadId(id);
      setError(null);
      setToolEvents([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversation");
    }
  }, [streaming]);

  const deleteThread = useCallback(async (id: number) => {
    if (!confirm("Delete this conversation?")) return;
    try {
      const res = await fetch(`${BASE}/api/recipe-designer/threads/${id}`, {
        method: "DELETE", credentials: "include",
      });
      if (!res.ok) throw new Error("Delete failed");
      setThreads(prev => prev.filter(t => t.id !== id));
      if (activeThreadId === id) {
        setActiveThreadId(null);
        setMessages([welcomeMessage()]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }, [activeThreadId]);

  const openMemoryDrawer = () => { setMemoryDraft(memory); setMemoryOpen(true); };
  const acceptProposal = async () => {
    if (!proposal) return;
    const ok = await saveMemory(proposalDraft);
    if (ok) setProposal(null);
  };

  const saveRecipeDraft = async () => {
    if (!recipeDraft) return;
    setRecipeSaving(true);
    setError(null);
    try {
      const body = {
        name: recipeDraft.name,
        description: recipeDraft.description ?? null,
        category: recipeDraft.category ?? null,
        notes: recipeDraft.notes ?? null,
        servings: recipeDraft.servings ?? recipeDraft.portionsPerBatch ?? 10,
        servingUnit: recipeDraft.servingUnit ?? "portion",
        packSize: recipeDraft.packSize ?? 1,
        rrp: recipeDraft.rrp ?? 0,
        packagingCost: recipeDraft.packagingCost ?? 0,
        labourCost: recipeDraft.labourCost ?? 0,
        portionsPerBatch: recipeDraft.portionsPerBatch ?? 10,
        shelfLifeDays: recipeDraft.shelfLifeDays ?? null,
        fillWeightGrams: recipeDraft.fillWeightGrams ?? null,
        baseType: recipeDraft.baseType ?? null,
        baseWeightGrams: recipeDraft.baseWeightGrams ?? null,
        isCoreMenu: recipeDraft.isCoreMenu ?? false,
        isCurrentSpecial: recipeDraft.isCurrentSpecial ?? false,
        ingredients: (recipeDraft.ingredients ?? [])
          .filter(l => l.ingredientId)
          .map(l => ({
            ingredientId: l.ingredientId!,
            quantity: l.quantity,
            isTopping: l.isTopping ?? false,
            quid: l.quid ?? false,
            includeInFillingMix: l.includeInFillingMix ?? false,
          })),
        subRecipes: (recipeDraft.subRecipes ?? [])
          .filter(l => l.subRecipeId)
          .map(l => ({
            subRecipeId: l.subRecipeId!,
            quantity: l.quantity,
            isTopping: l.isTopping ?? false,
            includeInFillingMix: l.includeInFillingMix ?? false,
          })),
      };
      const res = await fetch(`${BASE}/api/recipes`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Save failed (${res.status})`);
      }
      const created = await res.json();
      setRecipeProposal(null);
      setRecipeDraft(null);
      setMessages(prev => [...prev, {
        id: nextIdRef.current++,
        role: "assistant",
        content: `✓ Saved recipe "${created.name}" (id ${created.id}).`,
      }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save recipe");
    } finally {
      setRecipeSaving(false);
    }
  };

  const updateDraftField = <K extends keyof RecipeDraft>(key: K, value: RecipeDraft[K]) => {
    setRecipeDraft(prev => prev ? { ...prev, [key]: value } : prev);
  };

  if (!open) return null;

  const activeThread = threads.find(t => t.id === activeThreadId);

  return (
    <div className="fixed inset-0 z-40 flex justify-end pointer-events-none">
      <div
        className="pointer-events-auto bg-background border-l border-border shadow-2xl flex flex-col h-full w-full sm:w-[460px] md:w-[500px]"
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-background">
          <div className="flex items-center gap-2 min-w-0">
            {threadsView ? (
              <button
                type="button"
                onClick={() => setThreadsView(false)}
                className="p-1.5 hover:bg-secondary rounded"
                aria-label="Back to chat"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            ) : (
              <div className="w-7 h-7 rounded-full bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-orange-600" />
              </div>
            )}
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">
                {threadsView ? "Conversations" : (activeThread?.title ?? `${ASSISTANT_NAME} · TCK assistant`)}
              </div>
              {!threadsView && (
                <div className="text-[11px] text-muted-foreground">{ASSISTANT_NAME}</div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {!threadsView && (
              <>
                <button
                  type="button"
                  onClick={() => setThreadsView(true)}
                  className="p-1.5 hover:bg-secondary rounded"
                  aria-label="Conversations"
                  title="Conversations"
                >
                  <MessagesSquare className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={openMemoryDrawer}
                  className="p-1.5 hover:bg-secondary rounded"
                  aria-label="Memory"
                  title="Memory"
                >
                  <BookOpen className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={newConversation}
                  disabled={streaming}
                  className="p-1.5 hover:bg-secondary rounded disabled:opacity-40"
                  aria-label="New conversation"
                  title="New conversation"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 hover:bg-secondary rounded"
              aria-label="Close"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {threadsView && (
          <div className="flex-1 overflow-y-auto p-2">
            <button
              type="button"
              onClick={() => { newConversation(); setThreadsView(false); }}
              disabled={streaming}
              className="w-full m-1 flex items-center justify-center gap-1.5 px-2 py-2 text-sm rounded border border-border bg-background hover:bg-secondary disabled:opacity-40 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              New conversation
            </button>
            {threads.length === 0 ? (
              <p className="text-xs text-muted-foreground p-3">No conversations yet. Start typing to begin one.</p>
            ) : threads.map(t => (
              <div
                key={t.id}
                className={cn(
                  "group flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer text-sm",
                  t.id === activeThreadId ? "bg-secondary" : "hover:bg-secondary/60",
                )}
              >
                <button
                  type="button"
                  onClick={() => { loadThread(t.id); setThreadsView(false); }}
                  className="flex-1 text-left truncate"
                  title={t.title}
                >
                  <span className="block truncate">{t.title}</span>
                  <span className="block text-[10px] text-muted-foreground">{t.messageCount} msgs · {new Date(t.updatedAt).toLocaleDateString()}</span>
                </button>
                <button
                  type="button"
                  onClick={() => deleteThread(t.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive flex-shrink-0"
                  aria-label="Delete conversation"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      <div className={cn("flex flex-col flex-1 min-w-0", threadsView && "hidden")}>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map(msg => {
          const text = getMessageText(msg.content);
          const images = getMessageImages(msg.content);
          const empty = !text && images.length === 0;
          return (
            <div key={msg.id} className={cn("flex gap-2", msg.role === "user" ? "justify-end" : "justify-start")}>
              {msg.role === "assistant" && (
                <div className="w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-orange-600" />
                </div>
              )}
              <div className={cn(
                "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                msg.role === "user" ? "bg-blue-500 text-white rounded-br-md" : "bg-secondary text-foreground rounded-bl-md",
              )}>
                {images.length > 0 && (
                  <div className={cn(
                    "grid gap-1.5 mb-1.5",
                    images.length === 1 ? "grid-cols-1" : "grid-cols-2",
                  )}>
                    {images.map((img, i) => (
                      <img
                        key={i}
                        src={`data:${img.source.media_type};base64,${img.source.data}`}
                        alt=""
                        className="rounded-lg max-h-64 object-cover w-full"
                      />
                    ))}
                  </div>
                )}
                {text && <div className="whitespace-pre-wrap">{text}</div>}
                {empty && streaming && msg.role === "assistant" && (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                )}
              </div>
              {msg.role === "user" && (
                <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                  <UserIcon className="w-4 h-4 text-muted-foreground" />
                </div>
              )}
            </div>
          );
        })}
        {streaming && toolEvents.length > 0 && (
          <div className="flex gap-2 justify-start text-xs text-muted-foreground">
            <Wrench className="w-3.5 h-3.5 mt-0.5" />
            <div className="flex flex-wrap gap-1">
              {toolEvents.map((t, i) => (
                <span key={i} className={cn(
                  "px-1.5 py-0.5 rounded",
                  t.status === "running" ? "bg-blue-500/10 text-blue-700" :
                  t.status === "ok" ? "bg-emerald-500/10 text-emerald-700" :
                  t.status === "proposal_sent" ? "bg-orange-500/10 text-orange-700" :
                  "bg-destructive/10 text-destructive",
                )}>
                  {t.name}{t.status === "running" ? "…" : ""}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mx-4 mb-2 px-3 py-2 text-xs text-destructive bg-destructive/10 rounded-lg">
          {error}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        onDragEnter={e => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
        onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setDragActive(false); }}
        onDrop={e => {
          e.preventDefault(); e.stopPropagation(); setDragActive(false);
          if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col gap-2 p-3 border-t border-border bg-background relative",
          dragActive && "ring-2 ring-primary/40 ring-inset",
        )}
      >
        {dragActive && (
          <div className="absolute inset-0 bg-primary/5 backdrop-blur-[1px] flex items-center justify-center pointer-events-none rounded-t-md z-10">
            <div className="text-sm font-medium text-primary flex items-center gap-2">
              <ImageIcon className="w-4 h-4" /> Drop images to attach
            </div>
          </div>
        )}
        {pendingImages.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {pendingImages.map(img => (
              <div key={img.id} className="relative w-16 h-16 rounded-lg overflow-hidden border border-border bg-secondary">
                <img src={img.previewUrl} alt={img.name} className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePendingImage(img.id)}
                  className="absolute top-0 right-0 w-5 h-5 bg-black/60 text-white rounded-bl-md flex items-center justify-center hover:bg-black/80"
                  aria-label="Remove image"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={e => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={streaming || pendingImages.length >= MAX_IMAGES_PER_MESSAGE}
            className="flex-shrink-0 w-11 h-11 rounded-xl border border-border bg-background flex items-center justify-center hover:bg-secondary disabled:opacity-40 transition-colors"
            aria-label="Attach image"
            title="Attach image (or drag & drop)"
          >
            <Paperclip className="w-5 h-5" />
          </button>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            onPaste={e => {
              const files = Array.from(e.clipboardData?.files ?? []);
              const images = files.filter(f => ALLOWED_IMAGE_TYPES.has(f.type));
              if (images.length) {
                e.preventDefault();
                addFiles(images);
              }
            }}
            placeholder="Describe a recipe, drop in a photo, or paste an image… (Shift+Enter for new line)"
            rows={2}
            className="flex-1 resize-none px-3 py-2 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 max-h-40"
            disabled={streaming}
          />
          <button
            type="submit"
            disabled={streaming || (!input.trim() && pendingImages.length === 0)}
            className="flex-shrink-0 w-11 h-11 rounded-xl bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-40 transition-colors"
            aria-label="Send message"
          >
            {streaming ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
      </form>

      </div>
      </div>

      {/* ── Memory drawer ───────────────────────────────────────────────── */}
      {memoryOpen && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/30" onClick={() => setMemoryOpen(false)}>
          <div className="w-full sm:w-[480px] bg-background border-l border-border flex flex-col h-full shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <BookOpen className="w-4 h-4" /> Recipe Designer Memory
              </h2>
              <button onClick={() => setMemoryOpen(false)} className="p-1 hover:bg-secondary rounded">
                <X className="w-4 h-4" />
              </button>
            </div>
            <textarea
              value={memoryDraft}
              onChange={e => setMemoryDraft(e.target.value)}
              className="flex-1 m-4 p-3 border border-border rounded-lg text-xs font-mono bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
              spellCheck={false}
            />
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
              <button type="button" onClick={() => setMemoryOpen(false)} className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-secondary">Cancel</button>
              <button
                type="button"
                disabled={memorySaving || memoryDraft === memory}
                onClick={async () => {
                  const ok = await saveMemory(memoryDraft);
                  if (ok) setMemoryOpen(false);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
              >
                {memorySaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Memory proposal modal ───────────────────────────────────────── */}
      {proposal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-background rounded-2xl shadow-xl border border-border w-full max-w-2xl max-h-[85dvh] flex flex-col">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-orange-600" />
                Memory update proposed
              </h2>
              {proposal.reason && <p className="text-xs text-muted-foreground mt-1">{proposal.reason}</p>}
            </div>
            <div className="flex-1 overflow-hidden p-4">
              <p className="text-xs text-muted-foreground mb-2">Edit before saving if you want, then click Save.</p>
              <textarea
                value={proposalDraft}
                onChange={e => setProposalDraft(e.target.value)}
                className="w-full h-[50dvh] p-3 border border-border rounded-lg text-xs font-mono bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                spellCheck={false}
              />
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
              <button type="button" onClick={() => setProposal(null)} className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-secondary">Discard</button>
              <button
                type="button"
                disabled={memorySaving}
                onClick={acceptProposal}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
              >
                {memorySaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save to memory
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Recipe draft modal ──────────────────────────────────────────── */}
      {recipeProposal && recipeDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-background rounded-2xl shadow-xl border border-border w-full max-w-3xl max-h-[90dvh] flex flex-col">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <ChefHat className="w-4 h-4 text-orange-600" />
                Recipe draft proposed
              </h2>
              {recipeDraft.rationale && <p className="text-xs text-muted-foreground mt-1">{recipeDraft.rationale}</p>}
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Name">
                  <input value={recipeDraft.name ?? ""} onChange={e => updateDraftField("name", e.target.value)} className={inputCls} />
                </Field>
                <Field label="Category">
                  <input value={recipeDraft.category ?? ""} onChange={e => updateDraftField("category", e.target.value)} className={inputCls} placeholder="Calzone / Macaroni Cheese" />
                </Field>
                <Field label="RRP per pack (£)">
                  <input type="number" step="0.01" value={recipeDraft.rrp ?? 0} onChange={e => updateDraftField("rrp", parseFloat(e.target.value))} className={inputCls} />
                </Field>
                <Field label="Pack size (portions)">
                  <input type="number" step="1" value={recipeDraft.packSize ?? 2} onChange={e => updateDraftField("packSize", parseFloat(e.target.value))} className={inputCls} />
                </Field>
                <Field label="Portions per batch">
                  <input type="number" step="1" value={recipeDraft.portionsPerBatch ?? 10} onChange={e => updateDraftField("portionsPerBatch", parseInt(e.target.value))} className={inputCls} />
                </Field>
                <Field label="Packaging cost (£)">
                  <input type="number" step="0.01" value={recipeDraft.packagingCost ?? 0} onChange={e => updateDraftField("packagingCost", parseFloat(e.target.value))} className={inputCls} />
                </Field>
                <Field label="Filling weight (g/portion)">
                  <input type="number" step="1" value={recipeDraft.fillWeightGrams ?? 0} onChange={e => updateDraftField("fillWeightGrams", parseFloat(e.target.value))} className={inputCls} />
                </Field>
                <Field label="Dough weight (g/portion)">
                  <input type="number" step="1" value={recipeDraft.baseWeightGrams ?? 115} onChange={e => updateDraftField("baseWeightGrams", parseFloat(e.target.value))} className={inputCls} />
                </Field>
                <Field label="Shelf life (days)">
                  <input type="number" step="1" value={recipeDraft.shelfLifeDays ?? 13} onChange={e => updateDraftField("shelfLifeDays", parseInt(e.target.value))} className={inputCls} />
                </Field>
              </div>

              <div>
                <h3 className="text-xs font-semibold text-muted-foreground mb-1">Ingredient lines ({recipeDraft.ingredients?.length ?? 0})</h3>
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-secondary/50">
                      <tr>
                        <th className="text-left px-2 py-1">Ingredient ID</th>
                        <th className="text-left px-2 py-1">Quantity</th>
                        <th className="text-left px-2 py-1">Topping</th>
                        <th className="text-left px-2 py-1">QUID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(recipeDraft.ingredients ?? []).map((l, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="px-2 py-1">{l.ingredientId}</td>
                          <td className="px-2 py-1">{l.quantity}</td>
                          <td className="px-2 py-1">{l.isTopping ? "✓" : ""}</td>
                          <td className="px-2 py-1">{l.quid ? "✓" : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {(recipeDraft.subRecipes?.length ?? 0) > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground mb-1">Sub-recipe lines</h3>
                  <div className="border border-border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-secondary/50">
                        <tr>
                          <th className="text-left px-2 py-1">Sub-Recipe ID</th>
                          <th className="text-left px-2 py-1">Quantity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(recipeDraft.subRecipes ?? []).map((l, i) => (
                          <tr key={i} className="border-t border-border">
                            <td className="px-2 py-1">{l.subRecipeId}</td>
                            <td className="px-2 py-1">{l.quantity}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground">
                Ingredient and sub-recipe lines aren't editable here yet — ask the assistant in chat to revise lines if needed, then it'll repropose.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
              <button type="button" onClick={() => { setRecipeProposal(null); setRecipeDraft(null); }} className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-secondary">Discard</button>
              <button
                type="button"
                disabled={recipeSaving || !recipeDraft.name}
                onClick={saveRecipeDraft}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
              >
                {recipeSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save recipe to DB
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full px-2 py-1 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-muted-foreground mb-0.5">{label}</span>
      {children}
    </label>
  );
}
