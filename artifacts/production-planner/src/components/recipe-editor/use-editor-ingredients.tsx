import { useEffect, useState, type ReactNode } from "react";
import { QuickAddIngredientDialog } from "@/components/quick-add-ingredient";
import type { EditorIngredientOption } from "./types";

/** The ingredient list an editor picks from, plus "+ create new ingredient"
 *  from the picker: the new ingredient joins the list straight away and is
 *  put on the row it was created from. Keeps in step with the page's list
 *  (e.g. after a declaration fix refetches it) without dropping one just
 *  created that the list hasn't caught up with yet. */
export function useEditorIngredients<T extends EditorIngredientOption>(
  initial: T[],
  fromCreated: (created: { id: number; name: string; unit: string }) => T,
  putOnRow: (index: number, id: number) => void,
): { options: T[]; openQuickAdd: (index: number) => void; quickAddDialog: ReactNode } {
  const [options, setOptions] = useState<T[]>(initial);
  useEffect(() => {
    setOptions(prev => {
      const ids = new Set(initial.map(i => i.id));
      return [...initial, ...prev.filter(p => !ids.has(p.id))];
    });
  }, [initial]);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<number | null>(null);
  const quickAddDialog = (
    <QuickAddIngredientDialog
      open={open}
      onOpenChange={setOpen}
      onCreated={created => {
        setOptions(prev => [...prev, fromCreated(created)]);
        if (target !== null) putOnRow(target, created.id);
        setTarget(null);
      }}
    />
  );
  return { options, openQuickAdd: (index) => { setTarget(index); setOpen(true); }, quickAddDialog };
}
