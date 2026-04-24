import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, Mic, MicOff, Bot, User as UserIcon, CheckCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVoiceInput } from "@/hooks/use-voice-input";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Role = "user" | "assistant";

interface ToolResult {
  tool: string;
  success: boolean;
  summary: string;
}

interface Message {
  id: number;
  role: Role;
  content: string;
  toolResults?: ToolResult[];
}

interface ChatResponse {
  reply: string;
  toolResults?: ToolResult[];
  error?: string;
}

interface AiChatTabProps {
  station?: string;
}

export function AiChatTab({ station }: AiChatTabProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 0,
      role: "assistant",
      content:
        "Hi! I can answer questions about TCK Planner, report issues on the floor, or help with anything else. Tap the mic to speak, or type below.",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nextIdRef = useRef(1);
  const inputRef = useRef<string>("");

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  const voice = useVoiceInput({
    onTranscript: setInput,
    mode: "append",
    getCurrentValue: () => inputRef.current,
  });

  useEffect(() => {
    if (voice.error) setError(voice.error);
  }, [voice.error]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    const userMsg: Message = { id: nextIdRef.current++, role: "user", content: trimmed };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setSending(true);
    setError(null);

    try {
      const res = await fetch(`${BASE}/api/ai/chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map(m => ({ role: m.role, content: m.content })),
          station: station ?? null,
        }),
      });

      const data: ChatResponse = await res.json().catch(() => ({ reply: "", error: "Invalid response" }));

      if (!res.ok || data.error) {
        setError(data.error ?? `Chat failed (${res.status})`);
      } else {
        setMessages(prev => [
          ...prev,
          {
            id: nextIdRef.current++,
            role: "assistant",
            content: data.reply,
            toolResults: data.toolResults?.length ? data.toolResults : undefined,
          },
        ]);
      }
    } catch (err) {
      console.warn("[AiChatTab] chat failed:", err);
      setError("Network error. Please try again.");
    }

    setSending(false);
  }, [messages, sending, station]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send(input);
  };

  return (
    <div className="flex flex-col h-[min(500px,70vh)]">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-4"
      >
        {messages.map(msg => (
          <div
            key={msg.id}
            className={cn(
              "flex gap-2",
              msg.role === "user" ? "justify-end" : "justify-start",
            )}
          >
            {msg.role === "assistant" && (
              <div className="w-7 h-7 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-blue-600" />
              </div>
            )}
            <div
              className={cn(
                "max-w-[78%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap",
                msg.role === "user"
                  ? "bg-blue-500 text-white rounded-br-md"
                  : "bg-secondary text-foreground rounded-bl-md",
              )}
            >
              {msg.content}
              {msg.toolResults?.map((t, i) => (
                <div
                  key={i}
                  className={cn(
                    "mt-2 flex items-center gap-1.5 text-xs font-medium rounded-lg px-2 py-1",
                    t.success
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "bg-destructive/10 text-destructive",
                  )}
                >
                  {t.success
                    ? <CheckCircle className="w-3.5 h-3.5" />
                    : <AlertTriangle className="w-3.5 h-3.5" />}
                  {t.summary}
                </div>
              ))}
            </div>
            {msg.role === "user" && (
              <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                <UserIcon className="w-4 h-4 text-muted-foreground" />
              </div>
            )}
          </div>
        ))}
        {sending && (
          <div className="flex gap-2 justify-start">
            <div className="w-7 h-7 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
              <Bot className="w-4 h-4 text-blue-600" />
            </div>
            <div className="bg-secondary rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
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
        className="flex items-end gap-2 p-3 border-t border-border bg-background"
      >
        {voice.supported && (
          <button
            type="button"
            onClick={voice.toggle}
            disabled={sending}
            className={cn(
              "flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-colors disabled:opacity-40",
              voice.listening
                ? "bg-red-500 text-white hover:bg-red-600 animate-pulse"
                : "bg-secondary text-muted-foreground hover:text-foreground",
            )}
            aria-label={voice.listening ? "Stop recording" : "Start voice input"}
          >
            {voice.listening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>
        )}
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder={voice.listening ? "Listening..." : "Ask a question or report an issue..."}
          rows={1}
          className="flex-1 resize-none px-3 py-2 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 max-h-24"
          disabled={sending}
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-40 transition-colors"
          aria-label="Send message"
        >
          {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
        </button>
      </form>
    </div>
  );
}
