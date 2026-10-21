/**
 * The calendar's default phase colour (Graeme, 2026-10-21): "I want to be
 * able to change the DEFAULT colour of the phases … from a COLOUR PICKER."
 * Objective I.
 *
 * Phases with no colour of their own are drawn in it. Out of the way but
 * easy to find: a "Default colour" button on the calendar's key line opens
 * this panel in place (not a modal). Autosaves with a visible save state;
 * anyone with Sales & Marketing may change it (server-checked).
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict, parseISO } from "date-fns";
import { Palette, X } from "lucide-react";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { cn } from "@/lib/utils";
import { putCalendarSettings, setCachedSettings, useCalendarSettings } from "./api";
import { ColourPicker } from "./colour-picker";
import { PHASE_CLS, firstName, phaseVars } from "./constants";

export function DefaultColourButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const def = useCalendarSettings().data?.defaultPhaseColour ?? null;
  return (
    <button type="button" onClick={onToggle} aria-expanded={open}
      className={cn("inline-flex items-center gap-1.5 rounded-full border-2 px-3 min-h-9 text-sm font-semibold hover:bg-secondary/50",
        open ? "border-foreground" : "border-border")}>
      <span style={phaseVars(def)} className={cn("w-4 h-4 rounded-full border", PHASE_CLS.stripe)} />
      <Palette className="w-4 h-4 text-muted-foreground" /> Default colour
    </button>
  );
}

export function DefaultColourPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const q = useCalendarSettings();
  const server = q.data?.defaultPhaseColour ?? null;
  const [value, setValue] = useState<string | null>(server);
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (!touched) setValue(server); }, [server, touched]);

  const auto = useAutosave<string>(async v => {
    const s = await putCalendarSettings({ defaultPhaseColour: v });
    setCachedSettings(qc, s);
  }, 400);

  const pick = (v: string | null, now: boolean) => {
    if (v == null) return; // the default always has a colour
    setValue(v);
    setTouched(true);
    // The calendar behind repaints straight away; the save follows.
    if (q.data) setCachedSettings(qc, { ...q.data, defaultPhaseColour: v });
    auto.schedule(v);
    if (now) void auto.flush();
  };

  return (
    <div className="rounded-2xl border-2 border-border bg-background p-4 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="text-base font-bold flex-1">Default phase colour</h3>
        <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />
        <button type="button" onClick={() => { void auto.flush(); onClose(); }} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close default colour">
          <X className="w-5 h-5" />
        </button>
      </div>
      <p className="text-sm text-muted-foreground">
        For phases without their own colour.
        {q.data?.updatedBy && q.data.updatedAt && (
          <> Last changed by {firstName(q.data.updatedBy)} {formatDistanceToNowStrict(parseISO(q.data.updatedAt))} ago.</>
        )}
      </p>
      <ColourPicker value={value} calendarDefault={value} allowDefault={false} onPick={pick} disabled={!q.data} previewLabel="A phase" />
    </div>
  );
}
