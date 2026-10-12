/**
 * "Letters for you" — the Employee Hub's view of letters sent to the
 * signed-in person from their employment record (Graeme, 2026-10-12). Open
 * one to read it (the PDF, through /api/person-documents/mine), then tap
 * "I've read and understood this letter" — when is recorded and shown to
 * whoever sent it. Session only: the server takes no user parameter.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileText, Loader2, Mail } from "lucide-react";
import { fmtDayIso } from "@workspace/people-reviews";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "@/hooks/use-toast";
import { PeopleModal } from "@/components/people-modal";
import { InlineDocument } from "@/components/inline-document";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface MyLetter {
  id: number;
  title: string;
  documentId: number | null;
  sentAt: string;
  sentByName: string | null;
  readAt: string | null;
  acknowledgedAt: string | null;
}

async function post(path: string) {
  const res = await fetch(`${BASE}/api/people-letters${path}`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Couldn't save (${res.status})`);
  return data;
}

export function MyLettersSection() {
  const { state } = useAuth();
  const meId = state.status === "authenticated" ? state.user.id : null;
  const qc = useQueryClient();
  const key = ["people-letters", "mine", meId];
  const { data } = useQuery<MyLetter[]>({
    queryKey: key,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/people-letters/mine`, { credentials: "include" });
      if (!r.ok) throw new Error("Couldn't load your letters");
      return r.json();
    },
    enabled: meId !== null,
  });
  const [open, setOpen] = useState<MyLetter | null>(null);
  const [busy, setBusy] = useState(false);

  if (!data || data.length === 0) return null;
  const waiting = data.filter(l => !l.acknowledgedAt).length;

  const openLetter = (l: MyLetter) => {
    setOpen(l);
    if (!l.readAt) post(`/mine/${l.id}/read`).then(() => qc.invalidateQueries({ queryKey: key }))
      .catch(err => console.warn("[my-letters] read mark failed:", err));
  };

  return (
    <section className="space-y-3 mb-6">
      <h3 className="text-xl font-bold flex items-center gap-2"><Mail className="w-5 h-5 text-primary" /> Letters for you{waiting > 0 ? ` — ${waiting} to read` : ""}</h3>
      {data.map(l => (
        <button key={l.id} type="button" onClick={() => openLetter(l)}
          className="w-full text-left rounded-3xl border-2 bg-card p-4 flex items-center gap-4 hover:border-primary/50 border-border">
          {l.acknowledgedAt ? <CheckCircle2 className="w-7 h-7 text-emerald-600 shrink-0" /> : <FileText className="w-7 h-7 text-primary shrink-0" />}
          <span className="flex-1 min-w-0">
            <span className="block text-lg font-bold">{l.title}</span>
            <span className="block text-base text-muted-foreground">
              {fmtDayIso(l.sentAt)}{l.acknowledgedAt ? ` · you confirmed you'd read it ${fmtDayIso(l.acknowledgedAt)}` : " · please read it and confirm"}
            </span>
          </span>
        </button>
      ))}
      {open && (
        <PeopleModal title={open.title} onClose={() => setOpen(null)} wide>
          <div className="space-y-4">
            {open.documentId != null && (
              <InlineDocument src={`${BASE}/api/person-documents/mine/${open.documentId}/file`}
                downloadSrc={`${BASE}/api/person-documents/mine/${open.documentId}/file?download=1`} mime="application/pdf" title={open.title} />
            )}
            {open.acknowledgedAt ? (
              <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-6 h-6" /> You confirmed you'd read this on {fmtDayIso(open.acknowledgedAt)}.
              </p>
            ) : (
              <button type="button" disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await post(`/mine/${open.id}/acknowledge`);
                    setOpen({ ...open, acknowledgedAt: r.acknowledgedAt ?? new Date().toISOString() });
                    void qc.invalidateQueries({ queryKey: key });
                  } catch (e) {
                    toast({ title: "Couldn't save that", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
                  } finally { setBusy(false); }
                }}
                className="w-full h-16 rounded-2xl bg-primary text-primary-foreground text-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                {busy ? <Loader2 className="w-6 h-6 animate-spin" /> : <CheckCircle2 className="w-6 h-6" />} I've read and understood this letter
              </button>
            )}
            <p className="text-sm text-muted-foreground">If you have questions about it, talk to {open.sentByName ?? "your manager"}.</p>
          </div>
        </PeopleModal>
      )}
    </section>
  );
}
