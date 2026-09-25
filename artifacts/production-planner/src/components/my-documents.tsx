/**
 * "My Documents" — the Employee Hub section where someone reads the
 * documents a manager filed on their record AND chose to share with them
 * (letters, certificates…), read-only. Notes never come down to them.
 *
 * Privacy posture (the 2026-09-04 to-do leak rule): the server's /mine
 * endpoint takes no user parameter — it can only answer for the session —
 * and the query is keyed by the signed-in user's id, so a PIN switch on a
 * shared iPad never shows a frame of the previous person's documents.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FileText, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { PeopleModal } from "@/components/people-modal";
import { InlineDocument } from "@/components/inline-document";
import { kindLabel, type MyDocumentRow } from "@/lib/person-documents";
import { fmtDay } from "@/lib/people-api";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function myFileUrl(id: number, download = false): string {
  return `${BASE}/api/person-documents/mine/${id}/file${download ? "?download=1" : ""}`;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export function MyDocumentsSection() {
  const { state } = useAuth();
  const meId = state.status === "authenticated" ? state.user.id : null;
  const [open, setOpen] = useState<MyDocumentRow | null>(null);

  const { data, isLoading, error } = useQuery<MyDocumentRow[]>({
    queryKey: ["person-documents", "mine", meId],
    queryFn: () => fetch(`${BASE}/api/person-documents/mine`, { credentials: "include" }).then(r => jsonOrThrow<MyDocumentRow[]>(r)),
    enabled: meId !== null,
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (error) return <p className="text-base text-destructive py-4">Couldn't load your documents: {error instanceof Error ? error.message : "try again"}</p>;

  const docs = data ?? [];
  if (docs.length === 0) {
    return <p className="text-base text-muted-foreground py-6 text-center">Nothing has been shared with you yet.</p>;
  }

  return (
    <div className="space-y-3">
      {docs.map(d => (
        <button key={d.id} onClick={() => setOpen(d)}
          className="w-full text-left bg-card border-2 border-border rounded-2xl p-4 flex items-center gap-4 hover:border-primary/50 transition-colors">
          <FileText className="w-8 h-8 text-primary flex-shrink-0" />
          <span className="flex-1 min-w-0">
            <span className="block text-lg font-bold truncate">{d.title}</span>
            <span className="block text-base text-muted-foreground">{fmtDay(d.documentDate, true)}</span>
          </span>
          <span className="shrink-0 text-sm font-bold px-2.5 py-1 rounded-lg bg-secondary">{kindLabel(d.kind)}</span>
          <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
        </button>
      ))}
      {open && (
        <PeopleModal title={open.title} onClose={() => setOpen(null)} wide>
          <div className="space-y-3">
            <p className="text-base text-muted-foreground">{kindLabel(open.kind)} · {fmtDay(open.documentDate, true)} · kept on your record.</p>
            <InlineDocument src={myFileUrl(open.id)} downloadSrc={myFileUrl(open.id, true)} mime={open.mime} title={open.title} />
          </div>
        </PeopleModal>
      )}
    </div>
  );
}
