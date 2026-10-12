/**
 * The recipe form's colour pickers: the primary colour (as before) and the
 * optional second colour (migration 0185), with a live preview of how the
 * pair is drawn on the stations and plans. Both use the same native colour
 * picker. Part of the recipe form, so they save with Save changes like
 * every other field there. Objectives A and F.
 */
import type { UseFormRegisterReturn } from "react-hook-form";
import { RecipeSwatch } from "@/components/recipe-swatch";
import { recipeColourStyle } from "@/lib/recipe-colour-style";

// Starting point when someone adds a second colour; they pick the real one next.
const DEFAULT_SECOND = "#f59e0b";

export function RecipeColourFields({
  color, secondaryColor, registerColor, registerSecondary, onClearColor, onSetSecondary,
}: {
  color: string;
  secondaryColor: string;
  registerColor: UseFormRegisterReturn;
  registerSecondary: UseFormRegisterReturn;
  onClearColor: () => void;
  onSetSecondary: (v: string) => void;
}) {
  const hasPrimary = color.trim() !== "";
  const hasSecond = secondaryColor.trim() !== "";
  return (
    <div className="flex items-center gap-3 flex-wrap" data-testid="recipe-colour-fields">
      <div className="flex items-center gap-2">
        <label htmlFor="recipeColor" className="text-sm font-medium">Colour</label>
        <input type="color" id="recipeColor" {...registerColor} className="w-10 h-10 rounded-lg border border-border cursor-pointer p-0.5" />
        {hasPrimary && (
          <button type="button" onClick={onClearColor} className="text-xs text-muted-foreground hover:text-foreground min-h-9 px-1">Clear</button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="recipeSecondaryColor" className="text-sm font-medium">Second colour</label>
        {hasSecond ? (
          <>
            <input type="color" id="recipeSecondaryColor" {...registerSecondary} className="w-10 h-10 rounded-lg border border-border cursor-pointer p-0.5" />
            <button type="button" onClick={() => onSetSecondary("")} className="text-xs text-muted-foreground hover:text-foreground min-h-9 px-1">None</button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => onSetSecondary(DEFAULT_SECOND)}
            className="min-h-10 px-3 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/40"
          >
            None · add
          </button>
        )}
      </div>
      {hasPrimary && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-label="Colour preview">
          <RecipeSwatch color={color} secondaryColor={secondaryColor || null} className="w-6 h-6 rounded-full border border-border" />
          <RecipeSwatch color={color} secondaryColor={secondaryColor || null} shape="band" className="w-2 h-8 rounded-sm" />
          <span className="font-semibold text-sm" style={recipeColourStyle(color, secondaryColor || null, "text")}>Recipe name</span>
        </div>
      )}
    </div>
  );
}
