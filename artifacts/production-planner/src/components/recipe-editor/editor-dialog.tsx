/**
 * The shell both recipe editors open in — Final Products (recipes) and
 * Sub-Recipes, create and edit (Graeme, 2026-10-12). Objective F.
 * Also the to-do pop-up (components/todo-lists.tsx, 2026-10-13), which
 * draws its own footer with <PinnedFooter>.
 *
 *   • The card is capped at 92dvh; the body scrolls INSIDE it, so the save
 *     bar pinned to the bottom is always in view (iPad portrait and
 *     landscape, phone).
 *   • The form puts its save button into that bar with <EditorSaveBar>
 *     (rendered through a portal), so the form keeps its own labels, dirty
 *     state and submit, and anything below the form in the body — QUID,
 *     Shopify links, barcodes, the ingredient deck — scrolls under the bar.
 *   • Closing with unsaved changes (X, Escape, tapping outside) asks:
 *     Save / Discard / Keep editing. Nothing ever traps the person: Discard
 *     always closes, and the X is always there.
 *
 * "Unsaved changes" means the FORM's values differ from what it loaded
 * (lib/editor-dirty). Panels that save themselves (QUID, Shopify links,
 * label design, prep time) are not part of the form and never count.
 */
import { useState, type ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";
import { PinnedBody, PinnedFooter } from "@/components/ui/pinned-save-bar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export function EditorDialog({
  open, onClose, title, dirty, onSaveRequest, entityLabel, widthClassName, noAutoFocus, onCloseAutoFocus, fullHeight, children,
}: {
  /** Always the full 92dvh, so a tabbed editor doesn't jump in size (and
   *  its tab bar move) when a shorter tab is opened. */
  fullHeight?: boolean;
  open: boolean;
  /** Really close (after any unsaved-changes question). */
  onClose: () => void;
  title: ReactNode;
  /** The form has changes that aren't saved yet. */
  dirty: boolean;
  /** Ask the form to save (the guard's "Save changes"). */
  onSaveRequest: () => void;
  /** "recipe" / "sub-recipe" — for the guard's wording. */
  entityLabel: string;
  widthClassName?: string;
  /** Don't put the cursor in the first field on open (an iPad would throw
   *  up its keyboard over a pop-up that's mostly opened to be read). */
  noAutoFocus?: boolean;
  /** Where the cursor goes once it has closed (default: back to whatever opened it). */
  onCloseAutoFocus?: (e: Event) => void;
  children: ReactNode;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  function handleOpenChange(v: boolean) {
    if (v) return;
    if (dirty) setConfirmOpen(true);
    else onClose();
  }

  return (
    <>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="bg-card border-border rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>You have unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              Your changes to this {entityLabel} aren't saved yet. What would you like to do?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel className="sm:mr-auto min-h-11">Keep editing</AlertDialogCancel>
            <button
              type="button"
              onClick={() => { setConfirmOpen(false); onClose(); }}
              className="inline-flex min-h-11 items-center justify-center rounded-md text-sm font-medium px-4 py-2 border border-destructive text-destructive hover:bg-destructive/10 transition-colors"
            >
              Discard changes
            </button>
            <AlertDialogAction
              onClick={() => { setConfirmOpen(false); onSaveRequest(); }}
              className="min-h-11 bg-[#7cb342] text-white hover:bg-[#6a9c37]"
            >
              Save changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          onOpenAutoFocus={noAutoFocus ? e => e.preventDefault() : undefined}
          onCloseAutoFocus={onCloseAutoFocus}
          className={cn(
            "p-0 gap-0 flex flex-col w-[calc(100vw-1rem)] max-h-[92dvh] overflow-hidden bg-card border-border rounded-2xl",
            fullHeight && "h-[92dvh]",
            "[&>button:last-child]:p-2 [&>button:last-child]:right-3 [&>button:last-child]:top-3 [&>button:last-child>svg]:h-5 [&>button:last-child>svg]:w-5",
            widthClassName ?? "sm:max-w-[min(96vw,1100px)]",
          )}
        >
          <DialogHeader className="px-5 sm:px-6 pt-5 pb-3 pr-14 border-b border-border/60 shrink-0">
            <DialogTitle className="font-display text-xl flex items-center gap-2 flex-wrap">{title}</DialogTitle>
          </DialogHeader>
          <PinnedBody bodyClassName="px-5 sm:px-6 pb-6" bodyTestId="editor-body"
            footerClassName="px-5 sm:px-6 py-3" footerTestId="editor-footer">
            {children}
          </PinnedBody>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The editor's save button, drawn in the pinned footer of <EditorDialog>.
 *  Edit: grey "No changes" (disabled) until something changes, then brand
 *  green "Save changes" with an "Unsaved changes" note. Create: always
 *  available (a duplicate starts filled in), green. */
export function EditorSaveBar({
  mode, dirty, saving, label, onSave, notice,
}: {
  mode: "edit" | "create";
  dirty: boolean;
  saving: boolean;
  /** Button text when there is something to save. */
  label: string;
  onSave: () => void;
  /** Optional line above the button (e.g. "this save puts it on the menu"). */
  notice?: ReactNode;
}) {
  const enabled = mode === "create" || dirty;
  const bar = (
    <div className="flex flex-col gap-2" data-testid="editor-save-bar" data-dirty={dirty ? "true" : "false"}>
      {notice}
      {dirty && (
        <p className="text-sm font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5" role="status">
          <span className="w-2 h-2 rounded-full bg-amber-500" aria-hidden /> Unsaved changes
        </p>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={!enabled || saving}
        className={cn(
          "w-full min-h-12 rounded-xl font-semibold text-base flex items-center justify-center gap-2 transition-colors",
          enabled
            ? "bg-[#7cb342] text-white hover:bg-[#6a9c37] disabled:opacity-60"
            : "bg-muted text-muted-foreground cursor-not-allowed",
        )}
      >
        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
        {saving ? "Saving…" : enabled ? label : <><Check className="w-4 h-4" /> No changes</>}
      </button>
    </div>
  );
  return <PinnedFooter fallback="sticky">{bar}</PinnedFooter>;
}
