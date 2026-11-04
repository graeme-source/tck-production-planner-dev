/**
 * "Supplier notes" on an order (Graeme, 2026-11-04): the notes field from the
 * supplier's record. Managers and admins can edit it here; it saves as they
 * type. Objective C.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { StickyNote } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SaveChip } from "@/components/save-chip";
import { useAutosave } from "@/hooks/use-autosave";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function SupplierNotesDialog({ supplier, canEdit, onClose }: {
  supplier: { id: number; name: string; notes: string | null };
  canEdit: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState(supplier.notes ?? "");
  const auto = useAutosave(async (value: string) => {
    const res = await fetch(`${BASE}/api/suppliers/${supplier.id}/notes`, {
      method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: value }),
    });
    if (!res.ok) throw new Error("Couldn't save the notes");
    void queryClient.invalidateQueries({ queryKey: ["suppliers-directory"] });
  });

  return (
    <Dialog open onOpenChange={o => { if (!o) { void auto.flush(); onClose(); } }}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-xl max-h-[92dvh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl pr-8 break-words">
            <StickyNote className="w-5 h-5 shrink-0" /> {supplier.name}
          </DialogTitle>
        </DialogHeader>
        {canEdit ? (
          <div className="space-y-2">
            <textarea value={notes} rows={9} aria-label="Supplier notes" placeholder="No notes yet"
              onChange={e => { setNotes(e.target.value); auto.schedule(e.target.value); }}
              onBlur={() => void auto.flush()}
              className="w-full rounded-xl border-2 border-border bg-card px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-primary/40" />
            <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words text-base">{notes || "No notes yet."}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
