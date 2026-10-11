/**
 * "Google Ads spend" — the founder's card in Numbers → ROAS targets for the
 * Google Ads Script that sends daily spend in (Graeme, 2026-10-11).
 * Objective I: every ROAS on Numbers then divides by Meta + Google.
 *
 * Make a key (shown once), copy the ready-to-paste script (this app's
 * address and the key already in it), five plain steps, and "Last
 * received" so he can see it's working. Server: routes/google-ads-link.ts.
 * Words and script filling: lib/google-ads-link.ts (pure, tested).
 */
import { useMemo, useState } from "react";
import { AlertCircle, Check, Copy, KeyRound, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fillScript, linkHealth, type LinkTone } from "@/lib/google-ads-link";
import { shortDay } from "@/lib/ad-efficiency";
import { useGoogleAdsLink, useMakeGoogleAdsKey, useTurnOffGoogleAds } from "./api";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const TONE_CLASS: Record<LinkTone, string> = {
  good: "bg-[#7cb342]/15 text-[#558b2f] border-[#7cb342]/40",
  stale: "bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300",
  waiting: "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300",
  off: "bg-secondary text-muted-foreground border-border",
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2500);
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all"
    >
      {state === "copied" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy — select it and copy" : label}
    </button>
  );
}

export function GoogleAdsLinkSection() {
  const { data, error, isLoading } = useGoogleAdsLink();
  const make = useMakeGoogleAdsKey();
  const turnOff = useTurnOffGoogleAds();
  /** The key, only in this page's memory, only right after making it. */
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"new" | "off" | null>(null);

  const ingestUrl = `${window.location.origin}${BASE}${data?.ingestPath ?? "/api/ad-spend/google-ads"}`;
  const script = useMemo(
    () => (data ? fillScript(data.script, data.placeholders, ingestUrl, freshKey) : ""),
    [data, ingestUrl, freshKey],
  );

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading Google Ads link…</p>;
  if (error || !data) {
    return <p className="text-sm text-destructive">Couldn't load the Google Ads link — {(error as Error | null)?.message ?? "try again"}.</p>;
  }

  const health = linkHealth(data, Date.now());
  const makeKey = () => {
    setConfirm(null);
    make.mutate(undefined, { onSuccess: (r) => setFreshKey(r.key) });
  };

  return (
    <div className="space-y-4">
      <div className={cn("rounded-2xl border-2 p-4 space-y-1", TONE_CLASS[health.tone])}>
        <p className="text-lg font-display font-bold leading-tight">{health.headline}</p>
        {health.detail && <p className="text-sm">{health.detail}</p>}
        {data.firstDate && (
          <p className="text-sm">Counted in every ROAS on Numbers from {shortDay(data.firstDate)}.</p>
        )}
      </div>

      {data.timeZoneWarning && (
        <p className="text-sm text-amber-700 dark:text-amber-400 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{data.timeZoneWarning}</span>
        </p>
      )}

      {/* The key */}
      <div className="rounded-2xl border-2 border-border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-primary" />
          <p className="font-semibold">Connection key</p>
        </div>
        {freshKey ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
              This is the only time the key is shown. It's already in the script below — copy the script now.
            </p>
            <code className="block break-all rounded-xl bg-secondary/60 px-3 py-2 text-sm">{freshKey}</code>
          </div>
        ) : data.hasKey ? (
          <p className="text-sm text-muted-foreground">
            Key ending <span className="font-mono">…{data.keyHint}</span>
            {data.keyCreatedAt && <>, made {shortDay(data.keyCreatedAt.slice(0, 10))}</>}
            {data.keyCreatedByName && <> by {data.keyCreatedByName}</>}. Keys are only shown once — make a new one if you need to paste the script again.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No key yet. The script needs one to send spend here.</p>
        )}

        {confirm ? (
          <div className="rounded-xl bg-secondary/50 p-3 space-y-2">
            <p className="text-sm">
              {confirm === "new"
                ? "The old key stops working straight away. You'll need to paste the new script into Google Ads."
                : "Google Ads' sends will be refused until you make a new key. Spend already received stays."}
            </p>
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={confirm === "new" ? makeKey : () => { setConfirm(null); setFreshKey(null); turnOff.mutate(); }}
                className={cn("text-sm font-semibold px-4 py-2 rounded-xl text-white", confirm === "new" ? "bg-primary" : "bg-rose-600")}
              >
                {confirm === "new" ? "Yes, make a new key" : "Yes, turn it off"}
              </button>
              <button type="button" onClick={() => setConfirm(null)} className="text-sm font-semibold px-4 py-2 rounded-xl border-2 border-border">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              disabled={make.isPending}
              onClick={() => (data.hasKey ? setConfirm("new") : makeKey())}
              className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl border-2 border-border bg-card hover:bg-secondary/60 disabled:opacity-60"
            >
              {make.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {data.hasKey ? "Make a new key" : "Make a key"}
            </button>
            {data.hasKey && (
              <button
                type="button"
                disabled={turnOff.isPending}
                onClick={() => setConfirm("off")}
                className="text-sm font-semibold px-4 py-2.5 rounded-xl border-2 border-border text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-60"
              >
                Turn off
              </button>
            )}
          </div>
        )}
        {(make.error || turnOff.error) && (
          <p className="text-sm text-destructive">{((make.error ?? turnOff.error) as Error).message}</p>
        )}
      </div>

      {/* The steps */}
      <ol className="space-y-2 text-sm list-decimal pl-5">
        <li><span className="font-semibold">Copy the script</span> (button below){freshKey
          ? " — your new key is already in it."
          : data.hasKey
            ? ". Keys are only shown once, so make a new key first if you're pasting it again."
            : ". Make a key first so it's filled in."}</li>
        <li>In Google Ads go to <span className="font-semibold">Tools → Bulk actions → Scripts</span>, tap <span className="font-semibold">+</span> for a new script, clear what's there and <span className="font-semibold">paste</span>.</li>
        <li>Tap <span className="font-semibold">Authorise</span> and allow it with your Google account. It only reads your spend and sends it here.</li>
        <li>Tap <span className="font-semibold">Preview</span>. The log should end with <span className="font-mono whitespace-nowrap">200 {"{"}"ok":true…</span> and the box above turns green. Then <span className="font-semibold">Save</span>.</li>
        <li>Set <span className="font-semibold">Frequency</span> to <span className="font-semibold">Daily</span> (or Hourly for fresher figures). Done — each run sends the last 8 days, so late changes in Google are picked up.</li>
      </ol>
      <p className="text-sm text-muted-foreground">
        To fill past days: change <span className="font-mono whitespace-nowrap">DAYS = 8</span> to <span className="font-mono whitespace-nowrap">DAYS = 30</span>, tap Run once, then set it back to 8.
      </p>

      <div className="space-y-2">
        <CopyButton text={script} label="Copy script" />
        <pre className="max-h-64 overflow-auto rounded-xl bg-secondary/60 p-3 text-xs leading-relaxed whitespace-pre">{script}</pre>
      </div>
    </div>
  );
}
