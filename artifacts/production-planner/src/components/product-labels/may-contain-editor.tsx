/**
 * The shared "may contain" statement printed on every ingredient deck and
 * label. Moved from the old Product Hub to Labels → Label design & type
 * (12 Oct 2026). Objective F.
 *
 * The move also fixed two silent failures (charter rule 5): a failed load
 * used to leave an empty box whose Save would blank the statement on every
 * label, and a refused save still said "Saved!".
 */
import { useState, useEffect } from "react";
import { AlertTriangle, Loader2, Settings2, Check } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function MayContainEditor() {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${BASE}/api/app-settings/may_contain_statement`, { credentials: "include" })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { setValue(d.value ?? ""); })
      .catch(e => setLoadError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${BASE}/api/app-settings/may_contain_statement`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border-2 border-border bg-card p-5 space-y-4">
      <h2 className="text-xl font-bold flex items-center gap-2"><Settings2 className="w-5 h-5 text-primary" /> “May contain” statement</h2>
      <p className="text-sm text-muted-foreground">One statement for every ingredient deck and label — the allergen cross-contamination warning.</p>
      {loading ? (
        <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : loadError ? (
        <p className="text-sm text-destructive flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Couldn't load the statement ({loadError}). Reload the page to try again — it can't be edited until it loads.</p>
      ) : (
        <>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 bg-background border-2 border-border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
            placeholder="e.g. May also contain traces of nuts, peanuts, egg, soya..."
          />
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={save}
              disabled={saving}
              className="h-11 px-5 bg-primary text-primary-foreground rounded-xl text-base font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : saved ? "Saved!" : "Save"}
            </button>
            {saved && <span className="text-sm text-green-600 flex items-center gap-1"><Check className="w-4 h-4" /> Updated</span>}
            {saveError && <span className="text-sm text-destructive flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Not saved — {saveError}. Press Save to try again.</span>}
          </div>
        </>
      )}
    </section>
  );
}
