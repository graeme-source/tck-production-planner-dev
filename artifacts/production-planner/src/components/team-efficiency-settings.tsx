/**
 * Team efficiency settings — founder only (Objective I). Every field
 * autosaves on blur/Enter with a visible Saving / Saved / Not saved state.
 * The server refuses these writes for anyone but the founder.
 */
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { parsePercentInput, percentInputValue } from "@/lib/team-efficiency-view";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface EffSettings {
  standard: { ratio: number; setOn: string | null };
  despatchShare: number;
  discountRates: Record<string, number>;
  eightPackFactor: number;
  categories: string[];
}

type SaveState = "idle" | "saving" | "saved" | "error";

function useSaveSetting(key: string) {
  const qc = useQueryClient();
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: async (value: unknown) => {
      const res = await fetch(`${BASE}/api/team-efficiency/settings/${key}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || `Save failed (${res.status})`);
      return body;
    },
    onMutate: () => { setState("saving"); setError(null); },
    onSuccess: () => {
      setState("saved");
      void qc.invalidateQueries({ queryKey: ["team-efficiency"] });
      setTimeout(() => setState(s => (s === "saved" ? "idle" : s)), 1800);
    },
    onError: (err: Error) => { setState("error"); setError(err.message); },
  });
  return {
    state, error,
    save: (v: unknown) => m.mutate(v),
    fail: (msg: string) => { setState("error"); setError(msg); },
    reset: () => { setState("idle"); setError(null); },
  };
}

function SaveBadge({ state }: { state: SaveState }) {
  if (state === "saving") return <span className="flex items-center gap-1 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Saving</span>;
  if (state === "saved") return <span className="flex items-center gap-1 text-sm font-medium text-emerald-600"><Check className="w-4 h-4" /> Saved</span>;
  if (state === "error") return <span className="flex items-center gap-1 text-sm font-medium text-destructive"><AlertTriangle className="w-4 h-4" /> Not saved</span>;
  return null;
}

const inputCls = (bad: boolean) => cn(
  "w-28 px-3 py-2.5 rounded-xl border-2 bg-background text-lg text-right tabular-nums",
  bad ? "border-destructive" : "border-border",
);

function StandardField({ standard }: { standard: EffSettings["standard"] }) {
  const s = useSaveSetting("standard");
  const [ratio, setRatio] = useState(String(standard.ratio));
  const [setOn, setSetOn] = useState(standard.setOn ?? "");
  useEffect(() => { if (s.state === "idle") { setRatio(String(standard.ratio)); setSetOn(standard.setOn ?? ""); } }, [standard, s.state]);

  const commit = (nextRatio: string, nextSetOn: string) => {
    const r = Number(nextRatio);
    if (!Number.isFinite(r) || r <= 0 || r >= 100) { s.fail("R has to be a number above zero"); return; }
    let date = nextSetOn;
    // A new standard is "set" today unless the founder says otherwise.
    if (r !== standard.ratio && nextSetOn === (standard.setOn ?? "")) {
      date = new Date().toISOString().slice(0, 10);
      setSetOn(date);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { s.fail("Pick the date it was set"); return; }
    if (r === standard.ratio && date === standard.setOn) { s.reset(); return; }
    s.save({ ratio: r, setOn: date });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-base font-semibold">Standard (100%) <SaveBadge state={s.state} /></div>
      <p className="text-sm text-muted-foreground">Value credited per £1 of labour that counts as 100%. It stays fixed until you change it — it does not roll.</p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">R =</span>
          <input
            type="number" step="0.01" min="0" value={ratio} className={inputCls(s.state === "error")}
            onChange={e => { setRatio(e.target.value); s.reset(); }}
            onBlur={() => commit(ratio, setOn)}
            onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">set on</span>
          <input
            type="date" value={setOn} className="px-3 py-2.5 rounded-xl border-2 border-border bg-background text-base"
            onChange={e => { setSetOn(e.target.value); s.reset(); }}
            onBlur={() => commit(ratio, setOn)}
          />
        </label>
      </div>
      {s.error && <p className="text-sm text-destructive">{s.error}</p>}
    </div>
  );
}

function PercentField({ label, hint, value, maxPct, onSave, state, error, onEdit }: {
  label: string; hint?: string; value: number; maxPct: number;
  onSave: (rate: number) => void; state: SaveState; error: string | null; onEdit: () => void;
}) {
  const [draft, setDraft] = useState(percentInputValue(value));
  useEffect(() => { if (state === "idle") setDraft(percentInputValue(value)); }, [value, state]);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-base font-semibold">{label} <SaveBadge state={state} /></div>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      <div className="flex items-center gap-2">
        <input
          inputMode="decimal" value={draft} className={inputCls(state === "error")}
          onChange={e => { setDraft(e.target.value); onEdit(); }}
          onBlur={() => {
            const rate = parsePercentInput(draft, maxPct);
            if (rate == null) { onSave(Number.NaN); return; }
            if (Math.abs(rate - value) < 1e-9) return;
            onSave(rate);
          }}
          onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
        />
        <span className="text-muted-foreground">%</span>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function DespatchShareField({ value }: { value: number }) {
  const s = useSaveSetting("despatch_share");
  return (
    <PercentField
      label="Credit given on despatch"
      hint="The rest of each day's credit comes from good packs into the fridge."
      value={value} maxPct={50} state={s.state} error={s.error} onEdit={s.reset}
      onSave={r => (Number.isNaN(r) ? s.fail("Between 0 and 50%") : s.save(r))}
    />
  );
}

/** Discount rates save as one object, so each field writes on top of the
 *  latest rates any sibling field saved — not the page's last fetch, which
 *  would undo a neighbour saved a moment ago. */
function DiscountField({ category, ratesRef }: { category: string; ratesRef: MutableRefObject<Record<string, number>> }) {
  const s = useSaveSetting("discount_rates");
  return (
    <PercentField
      label={category} value={ratesRef.current[category] ?? 0} maxPct={95}
      state={s.state} error={s.error} onEdit={s.reset}
      onSave={r => {
        if (Number.isNaN(r)) { s.fail("Between 0 and 95%"); return; }
        ratesRef.current = { ...ratesRef.current, [category]: r };
        s.save(ratesRef.current);
      }}
    />
  );
}

export function TeamEfficiencySettings({ settings }: { settings: EffSettings }) {
  const cats = [...new Set([...settings.categories, ...Object.keys(settings.discountRates)])].sort();
  const ratesRef = useRef(settings.discountRates);
  useEffect(() => { ratesRef.current = { ...ratesRef.current, ...settings.discountRates }; }, [settings.discountRates]);
  return (
    <section className="rounded-3xl border border-border bg-card p-5 sm:p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="w-5 h-5 text-muted-foreground" />
        <h2 className="text-xl font-bold">Settings</h2>
        <span className="text-sm text-muted-foreground">(only you see these)</span>
      </div>
      <StandardField standard={settings.standard} />
      <DespatchShareField value={settings.despatchShare} />
      <div className="space-y-3">
        <div>
          <h3 className="text-base font-semibold">Discount by line</h3>
          <p className="text-sm text-muted-foreground">A fixed rate per line for the £ figures. Because it's fixed, it doesn't move the percentage.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {cats.map(c => <DiscountField key={c} category={c} ratesRef={ratesRef} />)}
        </div>
      </div>
    </section>
  );
}
