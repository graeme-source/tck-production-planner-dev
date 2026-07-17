import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, Layers } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface ExtraDoughRow {
  id: number;
  label: string;
  ballCount: number;
  ballWeightG: number;
}

// One batch of dough: 10 portions × 115g.
const BATCH_WEIGHT_KG = 1.15;

// The weight field accepts either unit without a picker: anything under 20 is
// read as kg (no dough ball is lighter than 20g or heavier than 20kg), so the
// default "1.15" means 1.15 kg and a typed "130" means 130 g.
function parseWeightG(input: string): number | null {
  const v = Number(input);
  if (!Number.isFinite(v) || v <= 0) return null;
  return v < 20 ? Math.round(v * 1000) : Math.round(v);
}

function fmtWeight(g: number): string {
  return g >= 1000 ? `${(g / 1000).toFixed(g % 1000 === 0 ? 1 : 2)} kg` : `${g} g`;
}

/**
 * Adds ad-hoc extra/test dough to a production plan — e.g. a batch for a
 * recipe trial. Defaults to one 1.15kg batch ball; any count × weight can be
 * entered. Backed by /api/production-plans/:id/extra-dough. The dough shows
 * on the dough station's balling view and is included in the mixing totals.
 * Used from the plan detail page AND the dough station (where planId is the
 * plan being prepped, i.e. the next day's plan).
 */
export function AddDoughToPlanDialog({
  planId, open, onClose, onChanged,
}: {
  planId: number;
  open: boolean;
  onClose: () => void;
  /** Called after a successful add or remove — e.g. to refetch dough data. */
  onChanged?: () => void;
}) {
  const [entries, setEntries] = useState<ExtraDoughRow[]>([]);
  const [label, setLabel] = useState("Test dough");
  const [balls, setBalls] = useState("1");
  const [weight, setWeight] = useState(String(BATCH_WEIGHT_KG));
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const loadEntries = useCallback(() => {
    fetch(`/api/production-plans/${planId}/extra-dough`, { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(rows => setEntries(rows))
      .catch(() => setEntries([]));
  }, [planId]);

  useEffect(() => { if (open) loadEntries(); }, [open, loadEntries]);

  const ballCount = Number(balls);
  const ballWeightG = parseWeightG(weight);
  const valid = Number.isInteger(ballCount) && ballCount >= 1 && ballWeightG !== null;
  const totalG = valid ? ballCount * (ballWeightG as number) : 0;
  // Which unit the current input is being read as — shown inside the field.
  const weightUnit = (() => {
    const v = Number(weight);
    return Number.isFinite(v) && v >= 20 ? "g" : "kg";
  })();

  const handleAdd = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/production-plans/${planId}/extra-dough`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, ballCount, ballWeightG }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Couldn't add dough", description: body.error ?? "Failed to add.", variant: "destructive" });
        return;
      }
      toast({
        title: `Added ${label}`,
        description: `${ballCount} ball${ballCount === 1 ? "" : "s"} × ${fmtWeight(ballWeightG as number)} added to the balling list.`,
      });
      setBalls("1");
      setWeight(String(BATCH_WEIGHT_KG));
      setLabel("Test dough");
      loadEntries();
      onChanged?.();
    } catch (err) {
      toast({ title: "Add failed", description: err instanceof Error ? err.message : "Network error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/production-plans/${planId}/extra-dough/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({ title: "Couldn't remove", description: body.error ?? "Failed to remove.", variant: "destructive" });
        return;
      }
      loadEntries();
      onChanged?.();
    } catch (err) {
      toast({ title: "Remove failed", description: err instanceof Error ? err.message : "Network error", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Layers className="w-6 h-6 text-primary" /> Add dough to this production
          </DialogTitle>
          <DialogDescription className="text-base">
            E.g. test dough for a recipe trial.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <label className="text-base font-medium">Label</label>
            <input
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              className="mt-1.5 w-full px-4 py-3 border border-border rounded-xl text-lg bg-background"
              placeholder="Test dough"
            />
          </div>

          <div className="flex gap-4">
            <div>
              <label className="text-base font-medium">Number of balls</label>
              <input
                type="number" min="1" step="1"
                value={balls}
                onChange={e => setBalls(e.target.value)}
                className="mt-1.5 block w-36 px-4 py-3 border border-border rounded-xl text-xl text-right tabular-nums"
              />
            </div>
            <div>
              <label className="text-base font-medium">Weight per ball</label>
              <div className="relative mt-1.5 w-40">
                <input
                  type="number" min="0" step="any"
                  value={weight}
                  onChange={e => setWeight(e.target.value)}
                  className="block w-full pl-4 pr-12 py-3 border border-border rounded-xl text-xl text-right tabular-nums"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-lg font-medium text-muted-foreground pointer-events-none">
                  {weightUnit}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground">Under 20 = kg, otherwise grams</p>
            </div>
          </div>

          <p className="text-lg text-muted-foreground">
            {valid
              ? <>= <span className="font-semibold text-foreground">{ballCount} × {fmtWeight(ballWeightG as number)}</span> — {fmtWeight(totalG)} total dough</>
              : "Enter a ball count and weight"}
          </p>

          {entries.length > 0 && (
            <div className="border border-border rounded-xl divide-y divide-border/60">
              <p className="px-4 py-2.5 text-sm font-medium text-muted-foreground">Already on this plan</p>
              {entries.map(e => (
                <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="text-lg flex-1">
                    <span className="font-medium">{e.label}</span>
                    <span className="text-muted-foreground"> — {e.ballCount} × {fmtWeight(e.ballWeightG)}</span>
                  </span>
                  <button
                    onClick={() => handleDelete(e.id)}
                    disabled={deletingId === e.id}
                    className="p-2.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    title="Remove"
                  >
                    {deletingId === e.id ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onClose} className="px-5 py-3 text-lg border border-border rounded-xl hover:bg-secondary">
              Close
            </button>
            <button
              onClick={handleAdd}
              disabled={saving || !valid}
              className="px-5 py-3 text-lg bg-primary text-primary-foreground rounded-xl font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
              Add dough
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
