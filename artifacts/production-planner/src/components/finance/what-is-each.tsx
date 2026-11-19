/**
 * "What is each one?" (Graeme, 18 Nov 2026) — asked right AFTER invoices or
 * receipts go up, one row each, because four sent at once can be four
 * different things. Each row: the category dropdown (named as the QuickBooks
 * accounts) and a note box for anything not in the list. Both save the moment
 * they change; a row with no category stays amber so it's obvious.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { CategorySelect } from "@/components/finance/category-select";

export type TagPatch = { categoryId?: number | null; note?: string | null };

function Row({ id, name, save, narrow, allowAdd }: { id: number; name: string; save: (id: number, patch: TagPatch) => Promise<unknown>; narrow: boolean; allowAdd: boolean }) {
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const m = useMutation({ mutationFn: (patch: TagPatch) => save(id, patch) });
  const state = m.isPending ? "Saving…" : m.isError ? `Not saved — ${(m.error as Error).message}` : m.isSuccess ? "Saved" : "";
  const saveNote = () => { if (note.trim() !== savedNote) { setSavedNote(note.trim()); m.mutate({ note: note.trim() || null }); } };
  return (
    <div className={cn("rounded-2xl border-2 p-3 space-y-2", categoryId == null ? "border-amber-300 bg-amber-50/50 dark:bg-amber-950/20" : "border-border bg-card")}>
      <div className="flex items-center gap-2 min-w-0">
        {categoryId != null ? <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" /> : <FileText className="h-5 w-5 text-amber-700 shrink-0" />}
        <span className="font-semibold break-words min-w-0">{name}</span>
        <span className={cn("ml-auto text-xs shrink-0", m.isError ? "text-destructive" : "text-muted-foreground")}>{state}</span>
      </div>
      <div className={cn("grid gap-2", !narrow && "sm:grid-cols-2")}>
        <CategorySelect value={categoryId} required size="lg" className="h-12 text-base" allowAdd={allowAdd}
          onChange={(v) => { setCategoryId(v); m.mutate({ categoryId: v }); }} />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={saveNote}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          maxLength={500}
          placeholder="Not in the list, or anything else? Type it here"
          aria-label={`Note on ${name}`}
          className="w-full h-12 px-3 rounded-xl border-2 border-border bg-background text-base focus:outline-none focus:border-primary"
        />
      </div>
    </div>
  );
}

export function WhatIsEach({ items, save, className, narrow = false, allowAdd = false }: {
  items: Array<{ id: number; name: string }>;
  save: (id: number, patch: TagPatch) => Promise<unknown>;
  className?: string;
  /** In a narrow box (Quick actions): the note goes under the dropdown. */
  narrow?: boolean;
  /** Finance users can add a category from the dropdown. */
  allowAdd?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className={cn("space-y-2", className)}>
      <div className="text-lg font-bold">{items.length === 1 ? "What is this item?" : `What is each one? (${items.length})`}</div>
      {items.map((it) => <Row key={it.id} id={it.id} name={it.name} save={save} narrow={narrow} allowAdd={allowAdd} />)}
    </div>
  );
}
