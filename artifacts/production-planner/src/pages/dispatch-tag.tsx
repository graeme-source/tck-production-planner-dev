import { useState, useRef, useEffect } from "react";
import { PageHeader } from "@/components/page-header";
import { Tag, CheckCircle2, XCircle, Loader2, RotateCcw } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface TagResult {
  orderName: string;
  customerName: string | null;
  alreadyTagged: boolean;
  success: boolean;
  error?: string;
}

export default function DispatchTag() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<TagResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const orderName = input.trim();
    if (!orderName) return;

    setLoading(true);
    setInput("");

    try {
      const res = await fetch(`${BASE}/api/fulfilment/tag-dispatch`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderName }),
      });
      const data = await res.json();

      if (!res.ok) {
        setHistory(prev => [{
          orderName,
          customerName: null,
          alreadyTagged: false,
          success: false,
          error: data.error ?? "Unknown error",
        }, ...prev]);
      } else {
        const customer = data.order?.customer;
        const customerName = customer
          ? `${customer.first_name ?? ""} ${customer.last_name ?? ""}`.trim() || null
          : null;
        setHistory(prev => [{
          orderName: data.order?.name ?? orderName,
          customerName,
          alreadyTagged: data.alreadyTagged,
          success: true,
        }, ...prev]);
      }
    } catch {
      setHistory(prev => [{
        orderName,
        customerName: null,
        alreadyTagged: false,
        success: false,
        error: "Network error — check connection",
      }, ...prev]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <PageHeader
        title="Dispatch Tagging"
        description="Scan or type an order number to approve it for packing."
      />

      <form onSubmit={handleSubmit} className="glass-panel rounded-2xl border border-border p-6 space-y-4">
        <label className="block text-sm font-medium text-muted-foreground">
          Order number (e.g. #1234)
        </label>
        <div className="flex gap-3">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="#1234"
            disabled={loading}
            className="flex-1 bg-background border border-border rounded-xl px-4 py-3 text-lg font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="flex items-center gap-2 px-5 py-3 bg-primary text-primary-foreground rounded-xl font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {loading
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : <Tag className="w-5 h-5" />}
            Tag
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Tagged orders will appear in the Order Packing queue. Orders without this tag cannot be packed.
        </p>
      </form>

      {history.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Session history
            </h2>
            <button
              onClick={() => setHistory([])}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <RotateCcw className="w-3 h-3" /> Clear
            </button>
          </div>

          <div className="space-y-2">
            {history.map((r, i) => (
              <div
                key={i}
                className={`flex items-start gap-3 p-4 rounded-xl border transition-all ${
                  r.success
                    ? r.alreadyTagged
                      ? "border-border bg-secondary/30"
                      : "border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20"
                    : "border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20"
                }`}
              >
                {r.success
                  ? <CheckCircle2 className={`w-5 h-5 flex-shrink-0 mt-0.5 ${r.alreadyTagged ? "text-muted-foreground" : "text-green-500"}`} />
                  : <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-500" />}

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono font-bold text-sm">{r.orderName}</span>
                    {r.customerName && (
                      <span className="text-xs text-muted-foreground truncate">— {r.customerName}</span>
                    )}
                  </div>
                  <p className={`text-xs mt-0.5 ${r.success ? (r.alreadyTagged ? "text-muted-foreground" : "text-green-700 dark:text-green-300") : "text-red-700 dark:text-red-300"}`}>
                    {r.success
                      ? r.alreadyTagged
                        ? "Already tagged — no change needed"
                        : "Dispatch tag added — ready to pack"
                      : r.error}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {history.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Tag className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No orders tagged this session yet.</p>
          <p className="text-xs mt-1">Scan or type an order number above to get started.</p>
        </div>
      )}
    </div>
  );
}
