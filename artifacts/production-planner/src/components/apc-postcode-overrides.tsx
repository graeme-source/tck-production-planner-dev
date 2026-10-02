/**
 * What APC customer service told us about postcode restrictions (Graeme,
 * 2026-10-02) — the hooks, and the list shown under the APC contact on the
 * Contacts page. Permanent answers stay until cleared; temporary ones lapse
 * by themselves after the server's window (14 days). Clearing: managers,
 * or whoever recorded it.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Undo2, MapPinOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type OverrideService = "saturday" | "weekday";
export type OverrideKind = "temporary" | "permanent";

export interface ApcPostcodeOverride {
  id: number;
  outward: string;
  service: OverrideService;
  kind: OverrideKind;
  depot: string | null;
  note: string | null;
  recordedByName: string | null;
  recordedAt: string;
  recordedOn: string;
  expiresOn: string | null;
  label: string;
  canClear: boolean;
}

export const OVERRIDES_KEY = ["apc-postcode-overrides"] as const;

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export function useApcPostcodeOverrides() {
  return useQuery<{ temporaryDays: number; overrides: ApcPostcodeOverride[] }>({
    queryKey: OVERRIDES_KEY,
    queryFn: async () => json(await fetch(`${BASE}/api/apc-postcode-overrides`, { credentials: "include" })),
  });
}

export function useRecordApcOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { outward: string; service: OverrideService; kind: OverrideKind; depot?: string | null; note?: string | null }) =>
      json<{ ok: true; id: number; label: string }>(await fetch(`${BASE}/api/apc-postcode-overrides`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })),
    onSuccess: () => qc.invalidateQueries({ queryKey: OVERRIDES_KEY }),
  });
}

export function useClearApcOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) =>
      json<{ ok: true }>(await fetch(`${BASE}/api/apc-postcode-overrides/${id}/clear`, { method: "POST", credentials: "include" })),
    onSuccess: () => qc.invalidateQueries({ queryKey: OVERRIDES_KEY }),
  });
}

export function ApcPostcodeOverridesList({ className }: { className?: string }) {
  const { data, isLoading, error } = useApcPostcodeOverrides();
  const clear = useClearApcOverride();
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const list = data?.overrides ?? [];

  return (
    <div className={cn("rounded-xl border border-border bg-secondary/30 p-3 space-y-2", className)}>
      <p className="text-sm font-semibold flex items-center gap-2">
        <MapPinOff className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
        Postcode restrictions APC have told us about
      </p>
      {isLoading && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>}
      {error && <p className="text-sm text-red-700 dark:text-red-300">Couldn't load — {(error as Error).message}</p>}
      {!isLoading && !error && list.length === 0 && (
        <p className="text-sm text-muted-foreground">
          None right now. When APC refuse a booking their postcode table says they do, the failure card asks you to call them and record the answer here.
        </p>
      )}
      {list.map(o => (
        <div key={o.id} className={cn(
          "rounded-lg border px-3 py-2 text-sm flex flex-wrap items-center gap-2",
          o.kind === "permanent"
            ? "border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30"
            : "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30",
        )}>
          <span className="font-bold font-mono">{o.outward}</span>
          {o.depot && <span className="text-muted-foreground">depot {o.depot}</span>}
          <span className="flex-1 min-w-[12rem]">
            {o.label}
            {o.kind === "permanent" && o.recordedByName ? ` (recorded by ${o.recordedByName})` : ""}
            {o.expiresOn ? ` · lapses ${o.expiresOn}` : ""}
            {o.note ? <span className="block text-xs text-muted-foreground">{o.note}</span> : null}
          </span>
          {o.canClear && (confirmId === o.id ? (
            <span className="flex items-center gap-2">
              <button
                onClick={() => clear.mutate(o.id, {
                  onSuccess: () => { setConfirmId(null); toast({ title: `${o.outward} restriction cleared` }); },
                  onError: (err) => toast({ title: "Couldn't clear", description: (err as Error).message, variant: "destructive" }),
                })}
                disabled={clear.isPending}
                className="h-10 px-3 rounded-lg bg-foreground text-background text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {clear.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />} Yes, clear it
              </button>
              <button onClick={() => setConfirmId(null)} className="h-10 px-3 rounded-lg border border-border text-sm">Keep</button>
            </span>
          ) : (
            <button onClick={() => setConfirmId(o.id)} className="h-10 px-3 rounded-lg border border-border bg-background text-sm font-medium inline-flex items-center gap-1.5 hover:bg-secondary/60">
              <Undo2 className="w-4 h-4" /> Clear
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
