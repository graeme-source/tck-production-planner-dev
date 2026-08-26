/**
 * Stock gate settings — the Next-Day Delivery Stock Gate panel.
 *
 * Lives here rather than in pages/settings.tsx because the charter forbids
 * adding code to that file; a section touched by a change moves out as part
 * of it. Settings are stock_gate_* rows in app_settings, read live by the
 * poller each cycle, so a change here takes effect on the next cycle with no
 * deploy.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import { Switch } from "@/components/ui/switch";

export function StockGateSection() {
  type GateSettings = {
    enabled: boolean; dryRun: boolean; thresholdPacks: number; releasePacks: number;
    autoRelease: boolean; tag: string; intervalMinutes: number; zapietLocationId: string;
    lookaheadEnabled: boolean; lookaheadTag: string;
    lookaheadThresholdPacks: number; lookaheadReleasePacks: number;
  };
  const [settings, setSettings] = useState<GateSettings | null>(null);
  const [zapietKeyConfigured, setZapietKeyConfigured] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  // Text-input drafts so typing doesn't fire a save per keystroke.
  const [drafts, setDrafts] = useState<{
    thresholdPacks: string; releasePacks: string; tag: string; intervalMinutes: string;
    lookaheadThresholdPacks: string; lookaheadReleasePacks: string; lookaheadTag: string;
  } | null>(null);
  // Products the gate CAN cover (core menu / fridge-held) with per-recipe
  // opt-out. Frozen lines stay excluded until their stock recording is
  // reliable; re-including one is a tick here, not a deploy.
  const [scope, setScope] = useState<Array<{ recipeId: number; name: string; excluded: boolean }> | null>(null);
  const loadScope = () => {
    fetch("/api/stock-gating/scope", { credentials: "include" })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (Array.isArray(d)) setScope(d); })
      .catch(() => {});
  };
  useEffect(loadScope, []);
  async function toggleScope(recipeId: number) {
    if (!scope) return;
    const next = scope.map(r => (r.recipeId === recipeId ? { ...r, excluded: !r.excluded } : r));
    setScope(next);
    await save({ excludedRecipeIds: next.filter(r => r.excluded).map(r => r.recipeId).join(",") });
    loadScope();
  }

  useEffect(() => {
    fetch("/api/stock-gating/status", { credentials: "include" })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d?.settings) return;
        setSettings(d.settings);
        setZapietKeyConfigured(Boolean(d.zapietKeyConfigured));
        setDrafts({
          thresholdPacks: String(d.settings.thresholdPacks),
          releasePacks: String(d.settings.releasePacks),
          tag: d.settings.tag,
          intervalMinutes: String(d.settings.intervalMinutes),
          lookaheadThresholdPacks: String(d.settings.lookaheadThresholdPacks),
          lookaheadReleasePacks: String(d.settings.lookaheadReleasePacks),
          lookaheadTag: d.settings.lookaheadTag,
        });
      })
      .catch(() => {});
  }, []);

  async function save(patch: Record<string, string | boolean | number>) {
    setSaving(true);
    setSavedMsg(null);
    try {
      const res = await fetch("/api/stock-gating/config", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("Failed to save");
      const data = (await res.json()) as { settings: GateSettings };
      setSettings(data.settings);
      setDrafts({
        thresholdPacks: String(data.settings.thresholdPacks),
        releasePacks: String(data.settings.releasePacks),
        tag: data.settings.tag,
        intervalMinutes: String(data.settings.intervalMinutes),
        lookaheadThresholdPacks: String(data.settings.lookaheadThresholdPacks),
        lookaheadReleasePacks: String(data.settings.lookaheadReleasePacks),
        lookaheadTag: data.settings.lookaheadTag,
      });
      setSavedMsg("Saved");
      setTimeout(() => setSavedMsg(null), 2000);
    } catch {
      setSavedMsg("Error saving");
    } finally {
      setSaving(false);
    }
  }

  if (!settings || !drafts) return null;

  const numberField = (
    label: string,
    field: "thresholdPacks" | "releasePacks" | "intervalMinutes" | "lookaheadThresholdPacks" | "lookaheadReleasePacks",
    hint: string,
  ) => (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="min-w-0">
        <span className="font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <input
        type="number"
        min={field === "intervalMinutes" ? 1 : 0}
        value={drafts[field]}
        onChange={e => setDrafts(prev => prev ? { ...prev, [field]: e.target.value } : prev)}
        onBlur={() => { if (drafts[field] !== "" && Number(drafts[field]) !== settings[field]) save({ [field]: Number(drafts[field]) }); }}
        className="w-20 px-2 py-1.5 border border-border rounded-lg text-sm bg-background text-right"
      />
    </label>
  );

  const toggleRow = (
    label: string, field: "enabled" | "dryRun" | "autoRelease" | "lookaheadEnabled", hint: string,
  ) => (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="min-w-0">
        <span className="font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <Switch
        checked={settings[field]}
        onCheckedChange={(v: boolean) => save({ [field]: v })}
        disabled={saving}
        aria-label={label}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-primary" /> Next-Day Delivery Stock Gate
          {saving && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
          {savedMsg && <span className="text-xs text-emerald-600 font-medium">{savedMsg}</span>}
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Watches the fridge-vs-despatch surplus per product (fridge + still to wrap − today's
          remaining despatch). At the threshold it tags the Shopify product so the Zapiet
          preparation-time rule removes tomorrow from the date picker; the tag comes off when
          stock recovers. Needs the Zapiet rule set up once: tag → 2-day preparation time.
        </p>
        {!zapietKeyConfigured && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> ZAPIET_API_KEY isn't set on the server — holds still work, but can't be verified against Zapiet.
          </p>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        {toggleRow("Stock gate active", "enabled", "Master switch — nothing is checked or tagged while this is off.")}
        {toggleRow("Dry run", "dryRun", "Record what would be held, but never write the Shopify tag. Turn off once the Zapiet rule is confirmed.")}
        {numberField("Hold at surplus ≤", "thresholdPacks", "Packs of headroom left when the product gets held.")}
        {toggleRow("Auto-release", "autoRelease", "Take the tag off automatically once the surplus recovers past the release level.")}
        {numberField("Release at surplus ≥", "releasePacks", "Set comfortably above the hold level so the gate doesn't flap.")}
        {numberField("Check every (minutes)", "intervalMinutes", "How often the surplus is recomputed.")}
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0">
            <span className="font-medium">Shopify tag</span>
            <span className="block text-xs text-muted-foreground">Must exactly match the tag on the Zapiet preparation-time rule (case-sensitive).</span>
          </span>
          <input
            type="text"
            value={drafts.tag}
            onChange={e => setDrafts(prev => prev ? { ...prev, tag: e.target.value } : prev)}
            onBlur={() => { const t = drafts.tag.trim(); if (t && t !== settings.tag) save({ tag: t }); }}
            className="w-44 px-2 py-1.5 border border-border rounded-lg text-sm bg-background font-mono"
          />
        </label>
        {/* ── The look-ahead horizon ───────────────────────────────────
            The settings above defend TODAY's despatch, which only ever
            catches a shortfall on the day it lands. This second horizon
            watches the NEXT despatch day, so an evening sales spike for a
            delivery two days out is caught while there is still time to
            change production (Graeme, 2026-08-26). */}
        <div className="pt-3 border-t border-border space-y-4">
          <div>
            <p className="text-sm font-medium">Look ahead one more despatch day</p>
            <p className="text-xs text-muted-foreground">
              Also checks the next despatch day — the one delivered the day after tomorrow —
              using stock plus what's planned for that day, less what that day owes. Despatch
              days skip weekends and non-despatch dates, so on a Friday this watches Monday.
              Its tag needs a Zapiet rule one day longer than the tag above, which removes
              both days from the picker.
            </p>
          </div>
          {toggleRow("Look-ahead active", "lookaheadEnabled", "Off by default. The gate above keeps working either way.")}
          {numberField("Hold at surplus \u2264", "lookaheadThresholdPacks", "Headroom left on the next despatch day when the product gets held.")}
          {numberField("Release at surplus \u2265", "lookaheadReleasePacks", "Set above the hold level so the gate doesn't flap.")}
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0">
              <span className="font-medium">Look-ahead Shopify tag</span>
              <span className="block text-xs text-muted-foreground">
                Must match a Zapiet preparation-time rule ONE DAY LONGER than the tag above
                (case-sensitive). A product only ever carries one of the two tags.
              </span>
            </span>
            <input
              type="text"
              value={drafts.lookaheadTag}
              onChange={e => setDrafts(prev => prev ? { ...prev, lookaheadTag: e.target.value } : prev)}
              onBlur={() => { const t = drafts.lookaheadTag.trim(); if (t && t !== settings.lookaheadTag) save({ lookaheadTag: t }); }}
              className="w-44 px-2 py-1.5 border border-border rounded-lg text-sm bg-background font-mono"
            />
          </label>
        </div>

        <div className="pt-2 border-t border-border">
          <p className="text-sm font-medium">Products the gate watches</p>
          <p className="text-xs text-muted-foreground mb-2">
            Core-menu and fridge-held products only. Untick anything whose stock the
            system can't yet track reliably (frozen kanban lines) — tick it back when
            its recording is trustworthy.
          </p>
          {!scope ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
              {scope.map(r => (
                <label key={r.recipeId} className="flex items-center gap-2 text-sm py-0.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!r.excluded}
                    onChange={() => toggleScope(r.recipeId)}
                    disabled={saving}
                  />
                  <span className={r.excluded ? "text-muted-foreground line-through decoration-border" : ""}>{r.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
