/**
 * "ROAS targets" — the founder's editor for the At a Glance ROAS cards'
 * targets and the thresholds behind the colours and the "What to do" line
 * (Objective I). Every field autosaves (~0.8s after typing, or on leaving
 * the field) with a visible Saving / Saved / Couldn't save chip.
 *
 * Also holds the "Google Ads spend" card (google-ads-link.tsx): the key and
 * script that send Google Ads' daily spend in.
 *
 * Only rendered for the founder (canEdit); the server refuses anyone else.
 * Closable (X / backdrop), max-h-[92dvh] with internal scrolling.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Target, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import type { AdEfficiencySettings } from "@/lib/ad-efficiency";
import { useAdEfficiencySettings, useSaveAdEfficiencySettings } from "./api";
import { GoogleAdsLinkSection } from "./google-ads-link";

type Field = keyof AdEfficiencySettings;

interface FieldSpec {
  field: Field;
  label: string;
  hint: string;
  unit: "%" | "£";
  min: number;
  max: number;
}

const GROUPS: Array<{ title: string; fields: FieldSpec[] }> = [
  {
    title: "Targets",
    fields: [
      { field: "ncRoas7dTargetPct", label: "New customer ROAS — last 7 days", hint: "The number you steer ad spend by.", unit: "%", min: 1, max: 10000 },
      { field: "ncRoasMtdTargetPct", label: "New customer ROAS — this month", hint: "Month so far, complete days.", unit: "%", min: 1, max: 10000 },
      { field: "totalRoas30dTargetPct", label: "ROAS on total sales — last 30 days", hint: "All sales ÷ ad spend.", unit: "%", min: 1, max: 10000 },
    ],
  },
  {
    title: "Colours",
    fields: [
      { field: "amberWidthPct", label: "Yellow band", hint: "How far under target is still yellow (10 = yellow from 90% to 100% of target, red below).", unit: "%", min: 0, max: 50 },
    ],
  },
  {
    title: "What to do",
    fields: [
      { field: "holdBandPct", label: "Hold band", hint: "Within this much of the 7-day target, hold spend steady. Above it: raise. Below it: trim.", unit: "%", min: 0, max: 50 },
      { field: "raiseSpendMinPct", label: "Suggested raise — from", hint: "Smallest spend increase suggested when you're beating target.", unit: "%", min: 0.1, max: 200 },
      { field: "raiseSpendMaxPct", label: "Suggested raise — to", hint: "Largest spend increase suggested.", unit: "%", min: 0.1, max: 200 },
      { field: "smallSampleSpend", label: "Too little spend to judge", hint: "Below this much ad spend over 7 days, the advice is softened.", unit: "£", min: 0, max: 1000000 },
    ],
  },
];

export function RoasTargetsButton() {
  const { data } = useAdEfficiencySettings();
  const [open, setOpen] = useState(false);
  if (!data?.canEdit) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl border-2 border-border bg-card hover:bg-secondary/60"
      >
        <Target className="w-4 h-4 text-primary" /> ROAS targets
      </button>
      {open && <RoasTargetsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function RoasTargetsDialog({ onClose }: { onClose: () => void }) {
  const { data } = useAdEfficiencySettings();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!data) return null;

  return createPortal(
    <div className="fixed inset-0 z-[130] bg-black/70 flex items-center justify-center p-3 md:p-8" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="roas-targets-title"
        className="bg-card border-2 border-border rounded-2xl shadow-2xl w-full max-w-xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <Target className="w-6 h-6 text-primary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <h2 id="roas-targets-title" className="font-display font-bold text-xl leading-tight">ROAS targets</h2>
            <p className="text-sm text-muted-foreground">Each change saves on its own as you type.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close">
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {GROUPS.map((g) => (
            <section key={g.title} className="space-y-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{g.title}</h3>
              {g.fields.map((spec) => (
                <SettingField key={spec.field} spec={spec} value={data.settings[spec.field]} />
              ))}
            </section>
          ))}
          {data.updatedByName && (
            <p className="text-xs text-muted-foreground">Last changed by {data.updatedByName}.</p>
          )}
          <section className="space-y-4 border-t border-border pt-5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Google Ads spend</h3>
            <GoogleAdsLinkSection />
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SettingField({ spec, value }: { spec: FieldSpec; value: number }) {
  const save = useSaveAdEfficiencySettings();
  const auto = useAutosave<number>((v) => save.mutateAsync({ [spec.field]: v }));
  const [text, setText] = useState(String(value));
  const [invalid, setInvalid] = useState<string | null>(null);
  // Follow the saved value while nothing is being typed here.
  useEffect(() => { if (auto.state === "idle" || auto.state === "saved") setText(String(value)); }, [value, auto.state]);

  const onChange = (next: string) => {
    setText(next);
    const n = Number(next.replace(/[£%,\s]/g, ""));
    if (next.trim() === "" || !Number.isFinite(n) || n < spec.min || n > spec.max) {
      setInvalid(`Type a number from ${spec.min} to ${spec.max.toLocaleString("en-GB")}`);
      auto.discard("idle");
      return;
    }
    setInvalid(null);
    if (n === value) { auto.discard("idle"); return; }
    auto.schedule(n);
  };

  const id = `roas-setting-${spec.field}`;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <label htmlFor={id} className="text-base font-semibold">{spec.label}</label>
        <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />
      </div>
      <div className="flex items-center gap-2">
        {spec.unit === "£" && <span className="text-lg text-muted-foreground">£</span>}
        <input
          id={id}
          inputMode="decimal"
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => void auto.flush()}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          className={cn(
            "w-32 px-3 py-2.5 rounded-xl border-2 bg-background text-lg text-right tabular-nums",
            invalid || auto.state === "error" ? "border-destructive" : "border-border",
          )}
        />
        {spec.unit === "%" && <span className="text-lg text-muted-foreground">%</span>}
      </div>
      {invalid
        ? <p className="text-sm text-destructive">{invalid}</p>
        : <p className="text-sm text-muted-foreground">{spec.hint}</p>}
    </div>
  );
}
