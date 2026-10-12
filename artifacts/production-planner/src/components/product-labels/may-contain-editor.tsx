/**
 * The shared "may contain" statement printed on every ingredient deck and
 * label. Moved from the old Product Hub (12 Oct 2026). Objective F.
 */
import { useState, useEffect } from "react";
import { Loader2, Settings2, Check } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function MayContainEditor() {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/api/app-settings/may_contain_statement`, { credentials: "include" })
      .then(r => r.json())
      .then(d => { setValue(d.value ?? ""); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`${BASE}/api/app-settings/may_contain_statement`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ value }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      void e;
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Settings2 className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Global "May Contain" Statement</h3>
      </div>
      <p className="text-xs text-muted-foreground">This statement appears on all ingredient decks. It is typically required for allergen cross-contamination disclosures.</p>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={2}
        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
        placeholder="e.g. May also contain traces of nuts, peanuts, egg, soya..."
      />
      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : saved ? "Saved!" : "Save"}
        </button>
        {saved && <span className="text-xs text-green-600 flex items-center gap-1"><Check className="w-3 h-3" /> Updated</span>}
      </div>
    </div>
  );
}
