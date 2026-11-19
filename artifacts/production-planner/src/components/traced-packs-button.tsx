/**
 * "Opened a new pack?" on the stations (traceability stage 1, Graeme,
 * 19 Nov 2026: "label photo in prep, when a pack is opened" — "I don't want
 * to make the prep team's life a lot harder"). Objectives B and D.
 *
 * One button. Tap it when you open a new pack of a traced ingredient, tap
 * the ingredient, photograph the label. The AI reads the batch code and
 * use-by; you can fix either (saves as you go). "New pack, same batch"
 * skips the photo when it's the same batch as the last pack.
 *
 * Shown only to people granted "Photograph opened packs" in Team & Access,
 * or to everyone once the Traceability page's Everyone switch is on.
 * Server: routes/traceability.ts.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, CheckCircle2, Copy, Loader2, PackageOpen, X } from "lucide-react";
import { format } from "date-fns";
import { toast } from "@/hooks/use-toast";
import { labelNeededToday } from "@/lib/traced-label";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface LotOpen {
  id: number;
  ingredientId: number;
  batchCode: string | null;
  useBy: string | null;
  readBy: string | null;
  openedAt: string;
  openedByName: string | null;
  hasPhoto: boolean;
}

interface TracedItem {
  id: number;
  name: string;
  supplierName: string | null;
  current: (Omit<LotOpen, "readBy"> & { readBy?: string | null }) | null;
}

const ITEMS_KEY = ["traceability-items"];

async function errorText(res: Response, fallback: string): Promise<string> {
  return (await res.json().catch(() => ({}))).error ?? fallback;
}

export function useCanPhotographPacks(): boolean {
  const { data } = useQuery<{ canPhotograph: boolean }>({
    queryKey: ["traceability-me"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/traceability/me`, { credentials: "include" });
      return res.ok ? res.json() : { canPhotograph: false };
    },
  });
  return !!data?.canPhotograph;
}

export function TracedPacksButton({ station }: { station: string }) {
  const can = useCanPhotographPacks();
  const [open, setOpen] = useState(false);
  if (!can) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="mb-3 w-full min-h-14 rounded-2xl border-2 border-border bg-card px-4 flex items-center gap-3 text-left hover:bg-secondary/40">
        <PackageOpen className="w-6 h-6 text-primary shrink-0" />
        <span className="text-base font-bold">Opened a new pack?</span>
        <span className="text-sm text-muted-foreground">Photo the label</span>
      </button>
      {open && <TracedPacksModal station={station} onClose={() => setOpen(false)} />}
    </>
  );
}

function TracedPacksModal({ station, onClose }: { station: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<TracedItem | null>(null);
  const [result, setResult] = useState<LotOpen | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { data: items, isLoading } = useQuery<TracedItem[]>({
    queryKey: ITEMS_KEY,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/traceability/items`, { credentials: "include" });
      if (!res.ok) throw new Error(await errorText(res, "Couldn't load the items"));
      return res.json();
    },
  });

  const done = (row: LotOpen) => {
    setResult(row);
    void queryClient.invalidateQueries({ queryKey: ITEMS_KEY });
  };

  const upload = useMutation({
    mutationFn: async ({ item, file }: { item: TracedItem; file: File }) => {
      const form = new FormData();
      form.append("photo", file);
      form.append("station", station);
      const res = await fetch(`${BASE}/api/traceability/items/${item.id}/photo`, { method: "POST", credentials: "include", body: form });
      if (!res.ok) throw new Error(await errorText(res, "The photo didn't save"));
      return res.json() as Promise<LotOpen>;
    },
    onSuccess: done,
    onError: e => toast({ title: "The photo didn't save", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  const same = useMutation({
    mutationFn: async (item: TracedItem) => {
      const res = await fetch(`${BASE}/api/traceability/items/${item.id}/same`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ station }),
      });
      if (!res.ok) throw new Error(await errorText(res, "That didn't save"));
      return res.json() as Promise<LotOpen>;
    },
    onSuccess: done,
    onError: e => toast({ title: "That didn't save", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  const takePhoto = (item: TracedItem) => {
    setPicked(item);
    fileRef.current?.click();
  };

  const title = result ? `${picked?.name ?? "Pack"} — saved` : "Which pack did you open?";

  return (
    <div className="fixed inset-0 z-[150] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className="bg-background w-full sm:max-w-2xl lg:max-w-3xl rounded-t-3xl sm:rounded-3xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3 border-b border-border shrink-0">
          <h2 className="text-xl sm:text-2xl font-bold leading-tight flex items-center gap-2 min-w-0">
            <PackageOpen className="w-6 h-6 text-primary shrink-0" /><span>{title}</span>
          </h2>
          <button onClick={onClose} className="w-11 h-11 rounded-2xl bg-secondary flex items-center justify-center shrink-0" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file && picked) upload.mutate({ item: picked, file });
          }} />

        <div className="overflow-y-auto p-5">
          {result ? (
            <LotResult row={result} onDone={onClose} onAnother={() => { setResult(null); setPicked(null); }} />
          ) : upload.isPending || same.isPending ? (
            <div className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin" />
              <p className="text-base">{upload.isPending ? `Reading the ${picked?.name ?? ""} label…` : "Saving…"}</p>
            </div>
          ) : isLoading ? (
            <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : !items?.length ? (
            <p className="text-base text-muted-foreground py-8 text-center">No ingredients are traced yet.</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {items.map(item => (
                <div key={item.id} className="rounded-2xl border-2 border-border bg-card p-4 flex flex-col gap-3">
                  <div>
                    <p className="text-lg font-bold leading-tight">{item.name}</p>
                    {item.supplierName && <p className="text-sm text-muted-foreground">{item.supplierName}</p>}
                    <p className="text-sm mt-1">
                      {item.current
                        ? <>In use: <span className="font-semibold">{item.current.batchCode ?? "code not read"}</span>{item.current.useBy ? ` · use by ${format(new Date(`${item.current.useBy}T00:00:00`), "d MMM")}` : ""} <span className="text-muted-foreground">· opened {format(new Date(item.current.openedAt), "EEE d MMM")}</span></>
                        : <span className="text-muted-foreground">No pack recorded yet</span>}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 mt-auto">
                    <button type="button" onClick={() => takePhoto(item)}
                      className="min-h-14 rounded-2xl bg-primary text-primary-foreground text-base font-bold inline-flex items-center justify-center gap-2">
                      <Camera className="w-5 h-5" /> Photo the label
                    </button>
                    {item.current && (
                      <button type="button" onClick={() => { setPicked(item); same.mutate(item); }}
                        className="min-h-12 rounded-2xl border-2 border-border text-sm font-semibold inline-flex items-center justify-center gap-2">
                        <Copy className="w-4 h-4" /> New pack, same batch
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** What was read off the label, to check and fix. Saves as you go. */
export function LotResult({ row, onDone, onAnother }: { row: LotOpen; onDone?: () => void; onAnother?: () => void }) {
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState(row);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const save = async (body: { batchCode?: string | null; useBy?: string | null }) => {
    setState("saving");
    try {
      const res = await fetch(`${BASE}/api/traceability/opens/${row.id}`, {
        method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await errorText(res, "That didn't save"));
      setCurrent(await res.json());
      setState("saved");
      // The batch shown as "in use" on the prep screens follows the fix.
      void queryClient.invalidateQueries({ queryKey: ITEMS_KEY });
    } catch (e) {
      setState("error");
      toast({ title: "That didn't save", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const inputCls = "mt-1 block w-full min-h-12 px-3 py-2.5 bg-background border border-border rounded-xl text-base font-normal normal-case";
  const labelCls = "text-xs font-semibold text-muted-foreground uppercase tracking-wide block";
  const nothingRead = !current.batchCode && !current.useBy;

  return (
    <div className="space-y-4">
      <div className="flex gap-4 items-start">
        {current.hasPhoto && (
          <img src={`${BASE}/api/traceability/opens/${row.id}/photo`} alt="The label"
            className="w-28 h-28 sm:w-36 sm:h-36 object-cover rounded-xl border border-border shrink-0" />
        )}
        <p className="text-base flex items-start gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          {nothingRead
            ? "Saved. The code couldn't be read — type it in if you can see it."
            : current.readBy === "copied" ? "Saved as the same batch as last time." : "Saved. Check the code and date match the label."}
        </p>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className={`${labelCls} sm:col-span-2`}>
          Batch / lot code
          <input defaultValue={current.batchCode ?? ""} placeholder="e.g. L23456" className={inputCls}
            onBlur={e => { const v = e.target.value.trim(); if (v !== (current.batchCode ?? "")) void save({ batchCode: v || null }); }} />
        </label>
        <label className={labelCls}>
          Use-by
          <input type="date" defaultValue={current.useBy ?? ""} className={inputCls}
            onBlur={e => { const v = e.target.value; if (v !== (current.useBy ?? "")) void save({ useBy: v || null }); }} />
        </label>
      </div>
      <p className="text-sm text-muted-foreground min-h-5">
        {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Not saved — try again" : ""}
      </p>
      {(onDone || onAnother) && (
        <div className="flex flex-col sm:flex-row gap-2">
          {onAnother && (
            <button type="button" onClick={onAnother} className="min-h-14 px-5 rounded-2xl border-2 border-border text-base font-semibold">
              Another pack
            </button>
          )}
          {onDone && (
            <button type="button" onClick={onDone} className="flex-1 min-h-14 rounded-2xl bg-primary text-primary-foreground text-base font-bold">
              Done
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The traced ingredients and who's asked for labels, for a prep screen
 * (Graeme, 2026-11-19). Off for everyone without "Photograph opened packs":
 * they prep exactly as before.
 */
export function useTracedLabels() {
  const can = useCanPhotographPacks();
  const { data: items } = useQuery<TracedItem[]>({
    queryKey: ITEMS_KEY,
    enabled: can,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/traceability/items`, { credentials: "include" });
      if (!res.ok) throw new Error(await errorText(res, "Couldn't load the items"));
      return res.json();
    },
  });
  const itemFor = (ingredientId: number) => (can ? items?.find(i => i.id === ingredientId) : undefined);
  return {
    can,
    itemFor,
    /** True while ticking this ingredient's tins should wait for its label. */
    waitsForLabel: (ingredientId: number) => can && labelNeededToday(itemFor(ingredientId)),
  };
}

/**
 * Step 1 of prepping a traced ingredient: get the pack out, photo the label.
 * The tins below wait until it's done (once a day); after that it shows the
 * batch in use and lets them record another pack if they open one.
 */
export function TracedLabelStep({ ingredientId, ingredientName, station }: { ingredientId: number; ingredientName: string; station: string }) {
  const queryClient = useQueryClient();
  const { itemFor, waitsForLabel } = useTracedLabels();
  const item = itemFor(ingredientId);
  const [result, setResult] = useState<LotOpen | null>(null);
  const [another, setAnother] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // A different ingredient opened in the same panel starts fresh.
  useEffect(() => { setResult(null); setAnother(false); }, [ingredientId]);

  const done = (row: LotOpen) => {
    setResult(row);
    setAnother(false);
    void queryClient.invalidateQueries({ queryKey: ITEMS_KEY });
  };
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("photo", file);
      form.append("station", station);
      const res = await fetch(`${BASE}/api/traceability/items/${ingredientId}/photo`, { method: "POST", credentials: "include", body: form });
      if (!res.ok) throw new Error(await errorText(res, "The photo didn't save"));
      return res.json() as Promise<LotOpen>;
    },
    onSuccess: done,
    onError: e => toast({ title: "The photo didn't save", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });
  const same = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/traceability/items/${ingredientId}/same`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ station }),
      });
      if (!res.ok) throw new Error(await errorText(res, "That didn't save"));
      return res.json() as Promise<LotOpen>;
    },
    onSuccess: done,
    onError: e => toast({ title: "That didn't save", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  if (!item) return null;
  const needed = waitsForLabel(ingredientId);
  const busy = upload.isPending || same.isPending;
  const cur = item.current;

  if (result) {
    return (
      <div className="mb-4 rounded-2xl border-2 border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20 p-4">
        <LotResult row={result} onDone={() => setResult(null)} />
      </div>
    );
  }

  if (!needed && !another) {
    return (
      <div className="mb-4 rounded-2xl border border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20 px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
        <span className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>Label done · batch <span className="font-semibold">{cur?.batchCode ?? "not read"}</span>{cur?.openedByName ? ` · ${cur.openedByName}` : ""}</span>
        </span>
        <button type="button" onClick={() => setAnother(true)} className="min-h-11 px-3 rounded-xl border border-border bg-card text-sm font-semibold inline-flex items-center gap-1.5">
          <PackageOpen className="w-4 h-4" /> Opened another pack?
        </button>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-2xl border-2 border-primary bg-primary/5 p-4 space-y-3">
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) upload.mutate(file); }} />
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-full bg-primary text-primary-foreground font-bold flex items-center justify-center shrink-0">1</span>
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight">Get out the {ingredientName} and photo the label</p>
          <p className="text-sm text-muted-foreground mt-0.5">
            {needed ? "So we know which batch went in. The tins unlock once it's done." : "Photo the new pack's label."}
          </p>
        </div>
      </div>
      {busy ? (
        <p className="flex items-center gap-2 text-base text-muted-foreground py-3"><Loader2 className="w-5 h-5 animate-spin" /> {upload.isPending ? "Reading the label…" : "Saving…"}</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-2">
          <button type="button" onClick={() => fileRef.current?.click()}
            className="min-h-14 rounded-2xl bg-primary text-primary-foreground text-base font-bold inline-flex items-center justify-center gap-2">
            <Camera className="w-5 h-5" /> Photo the label
          </button>
          {cur && (
            <button type="button" onClick={() => same.mutate()}
              className="min-h-14 rounded-2xl border-2 border-border bg-card text-sm font-semibold inline-flex items-center justify-center gap-2 px-3 text-left">
              <Copy className="w-4 h-4 shrink-0" />
              <span>Same batch as before{cur.batchCode ? ` (${cur.batchCode})` : ""}</span>
            </button>
          )}
        </div>
      )}
      {another && !needed && (
        <button type="button" onClick={() => setAnother(false)} className="text-sm text-muted-foreground underline">Cancel</button>
      )}
    </div>
  );
}
