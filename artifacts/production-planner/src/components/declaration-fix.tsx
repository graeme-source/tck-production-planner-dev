/**
 * Ingredient-declaration problems you can fix where you see them
 * (Graeme, 2026-10-12: "Can these checks link through to how I can fix
 * them?"). Every ingredient a deck check names is a button; it opens THAT
 * ingredient's full edit dialog — the same one Inventory uses — with the
 * Label Declaration field showing and focused. Saving re-runs every check
 * that depends on it (label page, recipe deck, Product Labels deck tab, sub-recipe
 * page) without a reload.
 *
 * A bare component list is wrapped under the ingredient's name by the
 * server on save, so for "needs its compound name" the fix is: open, Save.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil } from "lucide-react";
import {
  getGetIngredientQueryKey, getListIngredientsQueryKey, useGetIngredient, useListSuppliers, useUpdateIngredient,
  type Ingredient,
} from "@workspace/api-client-react";
import type { DeclarationIssue } from "@workspace/allergens";
import { IngredientFormDialog } from "@/components/ingredient-form-dialog";
import { buildIngredientPayload, type IngredientFormValues } from "@/lib/ingredient-form";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { DECLARATION_DEPENDENT_KEYS, issueGroups } from "@/lib/declaration-fix";

export type { DeclarationIssue };

/** One ingredient's edit dialog, loaded by id. Closes itself on a plain
 *  save; when the save wrapped the declaration it stays open on the saved
 *  record so you can see exactly what will print. */
export function EditIngredientDialog({ ingredientId, onClose, onSaved }: { ingredientId: number; onClose: () => void; onSaved?: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: suppliers } = useListSuppliers();
  const { data: loaded, isLoading, error } = useGetIngredient(ingredientId, { query: { queryKey: getGetIngredientQueryKey(ingredientId), staleTime: 0 } });
  const update = useUpdateIngredient();
  const [saved, setSaved] = useState<{ row: Ingredient; version: number } | null>(null);
  const item = saved?.row ?? loaded ?? null;

  const refreshChecks = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getListIngredientsQueryKey() }),
      qc.invalidateQueries({ queryKey: getGetIngredientQueryKey(ingredientId) }),
      ...DECLARATION_DEPENDENT_KEYS.map(queryKey => qc.invalidateQueries({ queryKey })),
    ]);
    onSaved?.();
  };

  const handleSave = (data: IngredientFormValues) => {
    update.mutate({ id: ingredientId, data: buildIngredientPayload(data) }, {
      onSuccess: row => {
        void refreshChecks();
        const wrapped = (row as Ingredient & { labelDeclarationWrapped?: boolean }).labelDeclarationWrapped === true;
        if (wrapped) {
          setSaved(s => ({ row, version: (s?.version ?? 0) + 1 }));
          toast({ title: `Saved ${row.name}`, description: "Wrapped under its name for the label." });
        } else {
          toast({ title: `Saved ${row.name}`, description: "The label checks have been re-run." });
          onClose();
        }
      },
      onError: (e: unknown) => {
        toast({ title: "Not saved", description: e instanceof Error ? e.message : "Couldn't save the ingredient — try again.", variant: "destructive" });
      },
    });
  };

  if (isLoading || error || !item) {
    return (
      <div className="fixed inset-0 z-[210] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-card rounded-2xl border-2 border-border p-6 flex items-center gap-3" onClick={e => e.stopPropagation()}>
          {error ? <p className="text-destructive font-semibold">Couldn't load that ingredient.</p> : <><Loader2 className="w-5 h-5 animate-spin" /> Opening…</>}
          <button onClick={onClose} className="ml-3 h-11 px-4 rounded-xl border-2 border-border font-semibold">Close</button>
        </div>
      </div>
    );
  }

  return (
    <IngredientFormDialog
      key={saved?.version ?? 0}
      open
      onClose={onClose}
      editingItem={item}
      defaultMode={(item as Ingredient & { perishable?: boolean }).perishable === false ? "supply" : "ingredient"}
      suppliers={suppliers ?? []}
      onSave={handleSave}
      focusDeclaration
      declarationNotice={saved ? `Saved — wrapped under its name for the label: ${(saved.row as Ingredient & { labelDeclaration?: string | null }).labelDeclaration ?? ""}` : null}
    />
  );
}

/** Each named ingredient as a button that opens its edit dialog. */
export function DeclarationFixButtons({ issues, onFixed, className, tone = "amber" }: {
  issues: DeclarationIssue[];
  /** Called after a save, for screens that still fetch outside React Query. */
  onFixed?: () => void;
  className?: string;
  tone?: "amber" | "rose";
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  if (issues.length === 0) return null;
  const btn = tone === "rose"
    ? "border-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/40"
    : "border-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40";
  return (
    <div className={cn("space-y-2", className)}>
      {issueGroups(issues).map(g => (
        <div key={g.kind} className="space-y-1.5">
          <p className="font-semibold">{g.title} <span className="font-normal opacity-80">— {g.help}</span></p>
          <div className="flex flex-wrap gap-2">
            {g.items.map(i => (
              <button
                key={i.ingredientId}
                type="button"
                onClick={() => setOpenId(i.ingredientId)}
                className={cn("min-h-11 px-3 py-2 rounded-xl border-2 bg-card text-foreground text-sm font-semibold inline-flex items-center gap-2", btn)}
                title={g.kind === "missing" ? `Open ${i.name} to add its label declaration` : `Open ${i.name} and save to wrap its declaration`}
              >
                <Pencil className="w-4 h-4 shrink-0" /> {i.name}
              </button>
            ))}
          </div>
        </div>
      ))}
      {openId != null && <EditIngredientDialog ingredientId={openId} onClose={() => setOpenId(null)} onSaved={onFixed} />}
    </div>
  );
}
