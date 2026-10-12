import { useEffect, useMemo, useState } from "react";
import type { FieldValues, UseFormWatch } from "react-hook-form";
import { formIsDirty } from "@/lib/editor-dirty";

/** Live "unsaved changes" for a react-hook-form form: its current values
 *  against the values it was opened with (captured once), via
 *  lib/editor-dirty. Unlike formState.isDirty this also sees edits made with
 *  setValue (the g/kg quantity boxes, pickers) and goes back to clean when
 *  an edit is undone. Reports changes to `onChange` (the dialog's guard). */
export function useFormDirty<T extends FieldValues>(
  watch: UseFormWatch<T>,
  defaultValues: T,
  ignore: readonly string[] = [],
  onChange?: (dirty: boolean) => void,
): boolean {
  const [baseline] = useState(() => structuredCloneSafe(defaultValues));
  const current = watch();
  const dirty = useMemo(
    () => formIsDirty(baseline as Record<string, unknown>, current as Record<string, unknown>, ignore),
    // `current` is a fresh object from watch() whenever any field changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseline, JSON.stringify(current), ignore.join("|")],
  );
  useEffect(() => { onChange?.(dirty); }, [dirty, onChange]);
  return dirty;
}

function structuredCloneSafe<T>(v: T): T {
  try { return structuredClone(v); } catch { return JSON.parse(JSON.stringify(v)) as T; }
}
