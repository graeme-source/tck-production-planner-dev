// /scan — where a QR code scanned by a phone's own camera app lands.
//
// A native camera app turns a URL into a tappable link but shows raw JSON as
// unhelpful text, which is why deep-link QR codes have to be URLs. Someone
// points their phone at a kanban card, taps the notification, and this page
// pulls the kanban and says so — no app to open, no menu to find.
//
// Auth is the ordinary session: AuthGate sends anyone not logged in to the
// login screen, and this URL is where they come back to, so the pull still
// happens after they sign in.

import { useEffect, useRef, useState } from "react";
import { useSearch, useLocation, useRoute } from "wouter";
import { Loader2, CheckCircle2, XCircle, ScanLine, ArrowRight } from "lucide-react";
import { parseKanbanQr } from "@/lib/kanban-qr";
import { KanbanPullConfirm, type KanbanPreview } from "@/components/kanban-pull-confirm";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Result =
  | { state: "working" }
  // Scanning only asks the question. Nothing is ordered until the person
  // confirms — a code scanned by accident, or a card knocked past a camera,
  // must never spend money on its own.
  | { state: "confirm"; preview: KanbanPreview; target: { type: string; id: number } }
  | { state: "done"; name: string; alreadyQueued: boolean }
  | { state: "failed"; message: string };

export default function ScanPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const [, pathParams] = useRoute("/scan/:type/:id");
  const [result, setResult] = useState<Result>({ state: "working" });
  const [pulling, setPulling] = useState(false);
  // A scan must fire exactly once: React re-runs effects in development and
  // pulling a kanban twice would order it twice.
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const target = pathParams
      ? parseKanbanQr(`/scan/${pathParams.type}/${pathParams.id}`)
      : parseKanbanQr(`?${search}`);

    if (!target) {
      setResult({ state: "failed", message: "That code doesn't look like a kanban card." });
      return;
    }

    fetch(`${BASE}/api/kanbans/scan/preview`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(target),
    })
      .then(async res => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setResult({ state: "failed", message: body.error ?? "Couldn't read that kanban card." });
          return;
        }
        setResult({ state: "confirm", preview: body, target });
      })
      .catch(() => setResult({ state: "failed", message: "No connection — try again in a moment." }));
  }, [search, pathParams]);

  const confirmPull = () => {
    if (result.state !== "confirm") return;
    const { preview, target } = result;
    setPulling(true);
    fetch(`${BASE}/api/kanbans/scan`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(target),
    })
      .then(async res => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setResult({ state: "failed", message: body.error ?? "Couldn't pull that kanban." });
          return;
        }
        setResult({
          state: "done",
          name: body.ingredientName ?? preview.ingredientName,
          alreadyQueued: !!body.alreadyQueued,
        });
      })
      .catch(() => setResult({ state: "failed", message: "No connection — try again in a moment." }))
      .finally(() => setPulling(false));
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-5">
      <div className="w-full max-w-md space-y-6 text-center">
        {result.state === "working" && (
          <>
            <Loader2 className="w-16 h-16 animate-spin text-primary mx-auto" />
            <p className="text-2xl font-bold">Reading the card…</p>
          </>
        )}

        {result.state === "confirm" && (
          <div className="text-left">
            <KanbanPullConfirm
              preview={result.preview}
              busy={pulling}
              onConfirm={confirmPull}
              onCancel={() => setLocation("/orders")}
            />
          </div>
        )}

        {result.state === "done" && (
          <>
            <CheckCircle2 className="w-20 h-20 text-emerald-500 mx-auto" />
            <div>
              <p className="text-3xl font-bold">{result.name}</p>
              <p className="text-xl text-muted-foreground mt-2">
                {result.alreadyQueued ? "Was already on today's order." : "Added to today's order."}
              </p>
            </div>
          </>
        )}

        {result.state === "failed" && (
          <>
            <XCircle className="w-20 h-20 text-destructive mx-auto" />
            <p className="text-2xl font-bold">{result.message}</p>
          </>
        )}

        {result.state !== "working" && (
          <div className="space-y-3 pt-2">
            <button
              onClick={() => { fired.current = false; setResult({ state: "working" }); setLocation("/orders"); }}
              className="w-full h-16 rounded-2xl bg-primary text-primary-foreground text-xl font-bold flex items-center justify-center gap-3 active:scale-[0.99] transition-all"
            >
              <ArrowRight className="w-6 h-6" /> See today's order
            </button>
            <p className="text-base text-muted-foreground flex items-center justify-center gap-2">
              <ScanLine className="w-4 h-4" /> Scan the next card straight from your camera.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
