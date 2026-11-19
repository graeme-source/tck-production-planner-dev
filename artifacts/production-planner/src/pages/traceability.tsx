/**
 * Traceability (managers) — traceability stage 1, Graeme, 19 Nov 2026.
 * Objectives B and D.
 *
 * - Look up a code: one of our pack codes (the production day's number on
 *   the label, e.g. 26323) shows the supplier batches that could be in it;
 *   a supplier's batch code shows the pack codes it could be in.
 * - The packs opened in the last fortnight, with their label photos.
 * - Who the station button is on for, and which ingredients are traced.
 *
 * Server: routes/traceability.ts; the in-use rule: api-server lib/traceability.ts.
 */
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { format } from "date-fns";
import { AlertTriangle, Loader2, PackageOpen, Search, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Switch } from "@/components/ui/switch";
import { LotResult, type LotOpen } from "@/components/traced-packs-button";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Lot = LotOpen & { ingredientName: string; inUseUntil?: string | null; station?: string | null };
type Lookup =
  | { kind: "pack"; found: false; q: string }
  | { kind: "pack"; found: true; q: string; planDate: string; windowStart: string; windowEnd: string; lots: Lot[]; notRecorded: string[] }
  | { kind: "supplier"; found: false; q: string }
  | { kind: "supplier"; found: true; q: string; results: Array<Lot & { packCodes: Array<{ planDate: string; batchNumber: number | null }> }> };

interface Settings { everyone: boolean; tracedIds: number[]; ingredients: Array<{ id: number; name: string }> }

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(`${BASE}${url}`, { credentials: "include" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Couldn't load");
  return res.json();
}

const day = (iso: string) => format(new Date(`${iso.slice(0, 10)}T12:00:00`), "EEE d MMM yyyy");
const when = (iso: string) => format(new Date(iso), "EEE d MMM, HH:mm");

export default function TraceabilityPage() {
  return (
    <div className="w-full space-y-8 pb-16">
      <PageHeader title="Traceability" description="Which supplier batches went into which packs" />
      <LookupSection />
      <RecentSection />
      <SettingsSection />
    </div>
  );
}

function LotCard({ lot, extra }: { lot: Lot; extra?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-border bg-card p-4 flex gap-4">
      {lot.hasPhoto ? (
        <a href={`${BASE}/api/traceability/opens/${lot.id}/photo`} target="_blank" rel="noreferrer" className="shrink-0">
          <img src={`${BASE}/api/traceability/opens/${lot.id}/photo`} alt={`${lot.ingredientName} label`} className="w-24 h-24 object-cover rounded-xl border border-border" />
        </a>
      ) : (
        <div className="w-24 h-24 rounded-xl border border-dashed border-border flex items-center justify-center text-xs text-muted-foreground text-center shrink-0">
          {lot.readBy === "copied" ? "Same batch as before" : "No photo"}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-lg font-bold leading-tight">{lot.ingredientName}</p>
        <p className="text-base">
          Batch <span className="font-semibold">{lot.batchCode ?? "not read"}</span>
          {lot.useBy ? ` · use by ${day(lot.useBy)}` : ""}
        </p>
        <p className="text-sm text-muted-foreground">
          Opened {when(lot.openedAt)}{lot.openedByName ? ` by ${lot.openedByName}` : ""}
          {lot.inUseUntil !== undefined && (lot.inUseUntil ? ` · in use until ${when(lot.inUseUntil)}` : " · still in use")}
        </p>
        {extra}
      </div>
    </div>
  );
}

function LookupSection() {
  const [text, setText] = useState("");
  const [q, setQ] = useState<string | null>(null);
  const { data, isFetching, error } = useQuery<Lookup>({
    queryKey: ["traceability-lookup", q],
    enabled: !!q,
    queryFn: () => getJson(`/api/traceability/lookup?q=${encodeURIComponent(q!)}`),
  });

  const submit = (e: FormEvent) => { e.preventDefault(); if (text.trim()) setQ(text.trim()); };

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-bold">Look up a code</h2>
      <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2">
        <input value={text} onChange={e => setText(e.target.value)} placeholder="A pack code like 26323, or a supplier's batch code"
          className="flex-1 min-h-14 px-4 bg-background border-2 border-border rounded-2xl text-base" />
        <button type="submit" disabled={!text.trim()}
          className="min-h-14 px-6 rounded-2xl bg-primary text-primary-foreground text-base font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60">
          {isFetching ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />} Look up
        </button>
      </form>

      {error && <p className="text-destructive">{error instanceof Error ? error.message : String(error)}</p>}

      {data?.kind === "pack" && !data.found && <p className="text-base">No production day has pack code {data.q}.</p>}
      {data?.kind === "pack" && data.found && (
        <div className="space-y-3">
          <p className="text-base">
            Pack code <span className="font-bold">{data.q}</span> was made on <span className="font-bold">{day(data.planDate)}</span>.
            These batches were in use while it was prepped and made ({when(data.windowStart)} to {when(data.windowEnd)}):
          </p>
          {data.lots.length === 0 && <p className="text-muted-foreground">No packs were recorded as opened for that day.</p>}
          <div className="grid lg:grid-cols-2 gap-3">
            {data.lots.map(l => <LotCard key={l.id} lot={l} />)}
          </div>
          {data.notRecorded.length > 0 && (
            <p className="text-sm flex items-start gap-2 text-amber-800 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              No pack recorded for: {data.notRecorded.join(", ")}. Either it wasn't used that day, or the photo was missed.
            </p>
          )}
        </div>
      )}

      {data?.kind === "supplier" && !data.found && <p className="text-base">No opened pack has a batch code matching “{data.q}”.</p>}
      {data?.kind === "supplier" && data.found && (
        <div className="space-y-3">
          <p className="text-base">Batches matching “{data.q}”, and the pack codes they could be in:</p>
          <div className="grid lg:grid-cols-2 gap-3">
            {data.results.map(r => (
              <LotCard key={r.id} lot={r} extra={
                <div className="flex flex-wrap gap-2 mt-2">
                  {r.packCodes.length === 0
                    ? <span className="text-sm text-muted-foreground">No production day in that time.</span>
                    : r.packCodes.map(p => (
                      <span key={p.planDate} className="rounded-full bg-secondary px-3 py-1 text-sm font-semibold">
                        {p.batchNumber ?? "—"} · {format(new Date(`${p.planDate}T12:00:00`), "EEE d MMM")}
                      </span>
                    ))}
                </div>
              } />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function RecentSection() {
  const { data, isLoading } = useQuery<Lot[]>({ queryKey: ["traceability-recent"], queryFn: () => getJson("/api/traceability/recent") });
  const [openId, setOpenId] = useState<number | null>(null);
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-bold">Packs opened in the last two weeks</h2>
      {isLoading ? <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        : !data?.length ? <p className="text-muted-foreground">None yet.</p>
        : (
          <div className="grid lg:grid-cols-2 gap-3">
            {data.map(l => (
              <div key={l.id}>
                <LotCard lot={l} extra={
                  <button type="button" onClick={() => setOpenId(openId === l.id ? null : l.id)} className="mt-2 text-sm font-semibold text-primary">
                    {openId === l.id ? "Close" : "Correct the code or date"}
                  </button>
                } />
                {openId === l.id && <div className="mt-2 rounded-2xl border border-border p-4"><LotResult row={l} /></div>}
              </div>
            ))}
          </div>
        )}
    </section>
  );
}

function SettingsSection() {
  const queryClient = useQueryClient();
  const { data } = useQuery<Settings>({ queryKey: ["traceability-settings"], queryFn: () => getJson("/api/traceability/settings") });
  const [adding, setAdding] = useState("");

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["traceability-settings"] });
    void queryClient.invalidateQueries({ queryKey: ["traceability-items"] });
    void queryClient.invalidateQueries({ queryKey: ["traceability-me"] });
  };

  const send = useMutation({
    mutationFn: async ({ url, method, body }: { url: string; method: string; body: unknown }) => {
      const res = await fetch(`${BASE}${url}`, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "That didn't save");
    },
    onSuccess: refresh,
    onError: e => toast({ title: "That didn't save", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  if (!data) return null;
  const traced = new Set(data.tracedIds);
  const tracedList = data.ingredients.filter(i => traced.has(i.id));
  const matches = adding.trim().length >= 2
    ? data.ingredients.filter(i => !traced.has(i.id) && i.name.toLowerCase().includes(adding.trim().toLowerCase())).slice(0, 8)
    : [];

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border-2 border-border bg-card p-5 space-y-2">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><PackageOpen className="w-5 h-5" /> On for everyone</h2>
            <p className="text-sm text-muted-foreground">
              {data.everyone
                ? "Every station shows “Opened a new pack?”."
                : <>Off: only people given “Photograph opened packs” in <Link href="/settings?section=team" className="text-primary font-semibold underline">Team &amp; Access</Link> see the button (you always do).</>}
            </p>
          </div>
          <Switch checked={data.everyone} disabled={send.isPending}
            onCheckedChange={v => send.mutate({ url: "/api/traceability/settings", method: "PATCH", body: { everyone: v } })} />
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-xl font-bold">Traced ingredients ({tracedList.length})</h2>
        <div className="flex flex-wrap gap-2">
          {tracedList.map(i => (
            <span key={i.id} className="inline-flex items-center gap-1 rounded-full bg-secondary pl-4 pr-1 py-1 text-base font-semibold">
              {i.name}
              <button type="button" aria-label={`Stop tracing ${i.name}`} disabled={send.isPending}
                onClick={() => send.mutate({ url: `/api/traceability/traced/${i.id}`, method: "PUT", body: { traced: false } })}
                className="w-9 h-9 rounded-full hover:bg-background flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </span>
          ))}
        </div>
        <div className="max-w-xl">
          <input value={adding} onChange={e => setAdding(e.target.value)} placeholder="Add an ingredient — type its name"
            className="w-full min-h-12 px-4 bg-background border-2 border-border rounded-2xl text-base" />
          {matches.length > 0 && (
            <div className="mt-2 rounded-2xl border border-border divide-y divide-border overflow-hidden">
              {matches.map(i => (
                <button key={i.id} type="button" disabled={send.isPending}
                  onClick={() => { send.mutate({ url: `/api/traceability/traced/${i.id}`, method: "PUT", body: { traced: true } }); setAdding(""); }}
                  className="w-full text-left px-4 min-h-12 hover:bg-secondary/40 text-base">
                  {i.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
