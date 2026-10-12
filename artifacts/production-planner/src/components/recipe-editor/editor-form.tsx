/**
 * The layout every recipe-type editor form shares (final products and
 * sub-recipes): the kind's own detail fields, then the lines (ingredients
 * and sub-recipes, components/recipe-editor/line-rows), anything that reads
 * the lines (declared weights, yield check), notes, and the pinned save bar.
 * The slots are filled by each page; the order and look are the same.
 */
import type { ReactNode } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { EditorSaveBar } from "./editor-dialog";

export function EditorForm({
  onSubmit, details, beforeLines, lines, afterLines, notes, beforeSave, save,
}: {
  onSubmit: (e?: React.BaseSyntheticEvent) => void;
  /** The kind's own fields (name, yields, flags, pricing…). */
  details: ReactNode;
  /** Live read-outs shown above the lines (e.g. declared weights). */
  beforeLines?: ReactNode;
  /** <LineRows> blocks, in order. */
  lines: ReactNode[];
  /** Read-outs that check the lines (e.g. the yield sanity check). */
  afterLines?: ReactNode;
  notes: UseFormRegisterReturn;
  /** Kind-specific prompts right above the save bar (e.g. start as a draft). */
  beforeSave?: ReactNode;
  save: Parameters<typeof EditorSaveBar>[0];
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-5 mt-4">
      {details}
      {beforeLines}
      <div className="border-t border-border pt-4">
        {lines.map((block, i) => (
          <div key={i}>
            {i > 0 && <div className="border-t border-dashed border-border/60 my-3" />}
            {block}
          </div>
        ))}
      </div>
      {afterLines}
      <NotesField register={notes} />
      {beforeSave}
      <EditorSaveBar {...save} />
    </form>
  );
}

export function NotesField({ register }: { register: UseFormRegisterReturn }) {
  return (
    <div>
      <label className="text-sm font-medium mb-1 block">Notes (optional)</label>
      <textarea
        {...register}
        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[60px] resize-none"
        placeholder="Allergens, method notes, anything the team should know…"
      />
    </div>
  );
}
