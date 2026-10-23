// Edit an improvement's title and description — for whoever logged it, or a
// manager (#309, Graeme 2026-10-22: "every author able to edit their own
// improvement completely, but not other people's"). The server applies the
// same rule (canEditImprovement in @workspace/db); a refusal or failure shows
// the server's reason, never silence.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Check, X, AlertCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function ImprovementEditText({ id, title, description }: {
  id: number; title: string; description: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftDescription, setDraftDescription] = useState(description);

  const save = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/improvements/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: draftTitle.trim(), description: draftDescription.trim() || draftTitle.trim() }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d?.error || `Couldn't save (HTTP ${r.status})`);
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["improvements"] });
      setOpen(false);
      toast({ title: "Saved", description: "Your changes are on the improvement." });
    },
    onError: (e: Error) => toast({ title: "Couldn't save your changes", description: e.message, variant: "destructive" }),
  });

  if (!open) {
    return (
      <button
        onClick={() => { setDraftTitle(title); setDraftDescription(description); save.reset(); setOpen(true); }}
        className="w-full h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 transition-colors"
      >
        <Pencil className="w-5 h-5" /> Edit title and description
      </button>
    );
  }

  const dirty = draftTitle.trim() !== title || draftDescription.trim() !== description;
  return (
    <div className="rounded-2xl border-2 border-primary/50 bg-card p-4 space-y-3">
      <label className="block">
        <span className="text-base font-bold">Title</span>
        <input
          value={draftTitle}
          onChange={e => setDraftTitle(e.target.value)}
          className="mt-1 w-full h-14 px-4 rounded-2xl border-2 border-border bg-background text-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </label>
      <label className="block">
        <span className="text-base font-bold">What changed</span>
        <textarea
          value={draftDescription}
          onChange={e => setDraftDescription(e.target.value)}
          rows={4}
          className="mt-1 w-full px-4 py-3 rounded-2xl border-2 border-border bg-background text-lg focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
        />
      </label>
      {/* Visible save state: unsaved / saving / the server's reason. */}
      <p className={save.isError ? "text-base font-semibold text-destructive flex items-center gap-1.5" : "text-sm text-muted-foreground"}>
        {save.isError
          ? <><AlertCircle className="w-4 h-4 flex-shrink-0" /> Not saved: {save.error.message}</>
          : save.isPending ? "Saving…" : dirty ? "Unsaved changes" : "No changes yet"}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          onClick={() => save.mutate()}
          disabled={!draftTitle.trim() || !dirty || save.isPending}
          className="h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {save.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />} Save changes
        </button>
        <button
          onClick={() => setOpen(false)}
          disabled={save.isPending}
          className="h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 disabled:opacity-50"
        >
          <X className="w-5 h-5" /> Cancel
        </button>
      </div>
    </div>
  );
}
