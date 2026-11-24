/**
 * Artwork kept against a supply (Graeme, 24 Nov 2026: "we have to send
 * artwork with the order … I'd actually like to store that artwork in our
 * system against this item"). Print-ready files stay exactly as uploaded —
 * no resizing or compression — so what comes back is what the printer needs.
 * Uploads go one file at a time (several can be picked at once), each with
 * its own progress. Server: routes/ingredient-artwork.ts.
 */
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Loader2, Trash2, Upload, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const ACCEPT = ".pdf,.ai,.eps,.svg,.png,.jpg,.jpeg,.tif,.tiff,.psd,.indd,.zip";
const MAX_MB = 150;
const OK_EXT = /\.(pdf|ai|eps|svg|png|jpe?g|tiff?|psd|indd|zip)$/i;

interface ArtworkFile { id: number; fileName: string; mime: string; sizeBytes: number; uploadedAt: string; uploadedByName: string | null }

const mb = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function uploadOne(ingredientId: number, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/api/ingredient-artwork/item/${ingredientId}`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { resolve(); return; }
      let msg = `Upload failed (${xhr.status})`;
      try { msg = (JSON.parse(xhr.responseText) as { error?: string }).error ?? msg; } catch { /* keep */ }
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error("Upload failed — check the connection and try again"));
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
}

export function IngredientArtworkPanel({ ingredientId }: { ingredientId: number }) {
  const qc = useQueryClient();
  const key = ["ingredient-artwork", ingredientId];
  const { data, isLoading } = useQuery<ArtworkFile[]>({
    queryKey: key,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/ingredient-artwork/item/${ingredientId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return ((await res.json()) as { files: ArtworkFile[] }).files;
    },
  });
  const input = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState<Array<{ name: string; pct: number; error?: string }>>([]);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function pick(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const problem = (f: File) =>
      !OK_EXT.test(f.name) ? "Not an artwork file — use PDF, AI, EPS, SVG, PNG, JPG, TIFF, PSD, INDD or ZIP"
      : f.size > MAX_MB * 1024 * 1024 ? `Over ${MAX_MB} MB` : undefined;
    setUploading(list.map(f => ({ name: f.name, pct: 0, error: problem(f) })));
    let done = 0;
    for (let i = 0; i < list.length; i++) {
      const f = list[i]!;
      if (problem(f)) continue;
      try {
        await uploadOne(ingredientId, f, pct => setUploading(u => u.map((x, j) => (j === i ? { ...x, pct } : x))));
        done++;
        setUploading(u => u.map((x, j) => (j === i ? { ...x, pct: 100 } : x)));
      } catch (e) {
        setUploading(u => u.map((x, j) => (j === i ? { ...x, error: (e as Error).message } : x)));
      }
    }
    await qc.invalidateQueries({ queryKey: key });
    if (done > 0) toast({ title: `${done} artwork file${done === 1 ? "" : "s"} saved`, description: "Stored exactly as uploaded." });
    setUploading(u => u.filter(x => x.error));
    if (input.current) input.current.value = "";
  }

  async function remove(id: number) {
    setDeleting(true);
    try {
      const res = await fetch(`${BASE}/api/ingredient-artwork/file/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await qc.invalidateQueries({ queryKey: key });
      setConfirmDelete(null);
    } catch (e) {
      toast({ title: "Couldn't delete it", description: (e as Error).message, variant: "destructive" });
    } finally { setDeleting(false); }
  }

  const files = data ?? [];
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Print-ready files to send with the order — kept exactly as uploaded, full quality. PDF, AI, EPS, SVG, PNG, JPG, TIFF, PSD, INDD or ZIP, up to {MAX_MB} MB each.
      </p>
      {isLoading ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>
      ) : files.length === 0 && uploading.length === 0 ? (
        <p className="text-sm text-muted-foreground">No artwork yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {files.map(f => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <FileText className="w-5 h-5 text-primary shrink-0" />
              <div className="min-w-0 flex-1">
                <a href={`${BASE}/api/ingredient-artwork/file/${f.id}`} target="_blank" rel="noopener noreferrer"
                  className="text-sm font-medium underline decoration-dotted underline-offset-2 break-all">{f.fileName}</a>
                <p className="text-xs text-muted-foreground">{mb(f.sizeBytes)} · {when(f.uploadedAt)}{f.uploadedByName ? ` · ${f.uploadedByName}` : ""}</p>
              </div>
              {confirmDelete === f.id ? (
                <span className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Delete for good?</span>
                  <button type="button" onClick={() => void remove(f.id)} disabled={deleting}
                    className="h-9 px-3 rounded-lg bg-destructive text-destructive-foreground text-sm font-semibold flex items-center gap-1 disabled:opacity-50">
                    {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Delete
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(null)} aria-label="Keep it"
                    className="h-9 w-9 rounded-lg border border-border flex items-center justify-center"><X className="w-4 h-4" /></button>
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <a href={`${BASE}/api/ingredient-artwork/file/${f.id}?download=1`} aria-label={`Download ${f.fileName}`} title="Download"
                    className="h-9 w-9 rounded-lg border border-border flex items-center justify-center hover:bg-secondary"><Download className="w-4 h-4" /></a>
                  <button type="button" onClick={() => setConfirmDelete(f.id)} aria-label={`Delete ${f.fileName}`} title="Delete"
                    className="h-9 w-9 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive"><Trash2 className="w-4 h-4" /></button>
                </span>
              )}
            </li>
          ))}
          {uploading.map((u, i) => (
            <li key={`up-${i}`} className="px-3 py-2.5">
              <div className="flex items-center gap-2 text-sm">
                {u.error ? <X className="w-4 h-4 text-destructive shrink-0" /> : <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />}
                <span className="min-w-0 flex-1 break-words">{u.name}</span>
                {!u.error && <span className="text-xs text-muted-foreground shrink-0">{u.pct}%</span>}
                {u.error && (
                  <button type="button" onClick={() => setUploading(list => list.filter(x => x !== u))} aria-label="Dismiss"
                    className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
                )}
              </div>
              {u.error && <p className="text-xs text-destructive mt-1 ml-6">{u.error}</p>}
              {!u.error && <div className="mt-1.5 h-1.5 rounded-full bg-secondary overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${u.pct}%` }} /></div>}
            </li>
          ))}
        </ul>
      )}
      <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={e => void pick(e.target.files)} />
      <button type="button" onClick={() => input.current?.click()} disabled={uploading.some(u => !u.error && u.pct < 100)}
        className="w-full h-11 rounded-lg border-2 border-dashed border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/30 flex items-center justify-center gap-1.5 disabled:opacity-50">
        <Upload className="w-4 h-4" /> Add artwork files
      </button>
    </div>
  );
}
