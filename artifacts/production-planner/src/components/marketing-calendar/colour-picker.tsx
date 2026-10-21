/**
 * Phase colour picker (Graeme, 2026-10-21): "I want to do it from a COLOUR
 * PICKER rather than just a few options." Objective I.
 *
 * The eight pastels stay as one-tap quick picks; "Any colour" is the native
 * colour picker (styled as a big swatch) with a hex box beside it, and a
 * preview of how a phase reads in that colour. Used by the phase modal (a
 * phase's own colour — with a "Calendar default" choice) and by the
 * calendar's Default colour panel. The parent saves: `onPick(value, now)` —
 * `now` for a deliberate tap, otherwise it's a drag in the picker or typing,
 * which the parent's autosave debounces.
 */
import { useEffect, useState, type CSSProperties } from "react";
import { Check } from "lucide-react";
import { PHASE_COLOURS, PHASE_COLOUR_KEYS, isHexColour, phaseColour } from "@workspace/marketing-calendar";
import { cn } from "@/lib/utils";
import { PHASE_CLS, phaseVars } from "./constants";

export function ColourPicker({ value, calendarDefault, allowDefault, onPick, disabled, previewLabel = "How it looks" }: {
  /** Stored value: palette key or hex; null = the calendar default (only when allowDefault). */
  value: string | null;
  /** The calendar's default colour, for the "Calendar default" chip and null values. */
  calendarDefault: string | null;
  allowDefault: boolean;
  onPick: (value: string | null, now: boolean) => void;
  disabled?: boolean;
  previewLabel?: string;
}) {
  const shown = phaseColour(value, calendarDefault);
  const [hexText, setHexText] = useState(shown.hex.toUpperCase());
  const [hexFocused, setHexFocused] = useState(false);
  // Follow outside changes (a quick pick, someone else's edit) unless typing.
  useEffect(() => { if (!hexFocused) setHexText(shown.hex.toUpperCase()); }, [shown.hex, hexFocused]);
  const hexInvalid = hexText.trim() !== "" && !isHexColour(normaliseTyped(hexText));
  const isCustom = value != null && isHexColour(value);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Quick colours">
        {allowDefault && (
          <Chip
            chosen={value == null}
            disabled={disabled}
            style={phaseVars(null, calendarDefault)}
            onClick={() => onPick(null, true)}
            label="Calendar default"
          />
        )}
        {PHASE_COLOUR_KEYS.map(k => (
          <Chip
            key={k}
            chosen={value === k}
            disabled={disabled}
            style={phaseVars(k)}
            onClick={() => onPick(k, true)}
            label={PHASE_COLOURS[k].label}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className={cn("flex items-center gap-2 text-sm font-semibold", disabled && "opacity-60")}>
          <span className="relative inline-flex">
            <input
              type="color"
              value={shown.hex}
              disabled={disabled}
              onChange={e => onPick(e.target.value.toLowerCase(), false)}
              aria-label="Pick any colour"
              className={cn(
                "w-14 h-11 rounded-xl border-2 cursor-pointer bg-transparent p-0.5 appearance-none",
                "[&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-lg [&::-moz-color-swatch]:border-none [&::-moz-color-swatch]:rounded-lg",
                isCustom ? "border-foreground" : "border-border",
              )}
            />
          </span>
          Any colour
        </label>
        <input
          value={hexText}
          disabled={disabled}
          onFocus={() => setHexFocused(true)}
          onBlur={() => { setHexFocused(false); if (hexInvalid || !hexText.trim()) setHexText(shown.hex.toUpperCase()); }}
          onChange={e => {
            setHexText(e.target.value);
            const v = normaliseTyped(e.target.value);
            if (isHexColour(v)) onPick(v.toLowerCase(), false);
          }}
          maxLength={7}
          spellCheck={false}
          aria-label="Colour code"
          aria-invalid={hexInvalid}
          className={cn("w-28 px-3 py-2 rounded-xl border-2 bg-background font-mono text-base uppercase focus:outline-none",
            hexInvalid ? "border-destructive" : "border-border focus:border-primary")}
        />
        <span style={phaseVars(value, calendarDefault)}
          className={cn("inline-flex items-center rounded-lg border-2 px-3 py-1.5 text-sm font-semibold", PHASE_CLS.fill)}>
          {previewLabel}
        </span>
      </div>
      {hexInvalid && <p className="text-sm text-destructive">Use a colour code like #2E86C1.</p>}
    </div>
  );
}

/** "2e86c1" or "#2e86c1 " → "#2e86c1". */
function normaliseTyped(s: string): string {
  const t = s.trim();
  return t.startsWith("#") ? t : `#${t}`;
}

function Chip({ chosen, disabled, style, onClick, label }: {
  chosen: boolean; disabled?: boolean; style: CSSProperties; onClick: () => void; label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={chosen}
      disabled={disabled}
      onClick={onClick}
      style={style}
      className={cn(
        "min-h-11 pl-2 pr-3.5 py-1.5 rounded-full border-2 text-sm font-semibold flex items-center gap-2 transition-shadow disabled:opacity-60",
        PHASE_CLS.fill,
        chosen ? "ring-2 ring-offset-2 ring-offset-card ring-foreground" : "hover:brightness-95",
      )}
    >
      <span className={cn("w-6 h-6 rounded-full flex items-center justify-center", PHASE_CLS.stripe)}>
        {chosen && <Check className={cn("w-4 h-4", PHASE_CLS.text)} strokeWidth={3} />}
      </span>
      {label}
    </button>
  );
}
