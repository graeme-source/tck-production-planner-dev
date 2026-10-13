/**
 * New list / list settings. A new list is created with one button (it
 * doesn't exist until then); an existing one autosaves every change with the
 * save state in the header. Archive, never delete — the ticks are history.
 * Modal rules: X / backdrop / Escape close, 92dvh cap, internal scroll.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAutosave } from "@/hooks/use-autosave";
import { useModalScrollKeeper } from "@/hooks/use-modal-scroll";
import { SaveChip } from "@/components/save-chip";
import {
  TEAM_LISTS_KEY, useCreateList, useTeamListPeople, useUpdateList,
  type ListInput, type TeamListSummary,
} from "./team-lists-api";

export const LIST_COLOURS = ["#7cb342", "#2563eb", "#f97316", "#db2777", "#7c3aed", "#0d9488", "#64748b"];

const inputCls = "w-full h-12 rounded-xl border-2 border-border bg-background px-3 text-base focus:outline-none focus:border-primary";

type Existing = Pick<TeamListSummary, "id" | "name" | "description" | "emoji" | "color" | "memberIds" | "archived">;

export function ListSettingsModal({ list, onClose, onCreated }: {
  list: Existing | null;
  onClose: () => void;
  onCreated?: (id: number) => void;
}) {
  useModalScrollKeeper();
  const qc = useQueryClient();
  const [form, setForm] = useState<ListInput>(() => ({
    name: list?.name ?? "",
    description: list?.description ?? null,
    emoji: list?.emoji ?? null,
    color: list?.color ?? LIST_COLOURS[0],
    memberIds: list?.memberIds ?? [],
  }));
  const people = useTeamListPeople(true);
  const create = useCreateList();
  const update = useUpdateList();
  // One save at a time, in order (see item-edit-modal.tsx).
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const auto = useAutosave<ListInput>(v => {
    const next = queue.current.catch(() => undefined).then(() => update.mutateAsync({ id: list!.id, data: v }));
    queue.current = next;
    return next;
  });

  useEffect(() => () => { void queue.current.catch(() => undefined).then(() => qc.invalidateQueries({ queryKey: TEAM_LISTS_KEY })); }, [qc]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") void close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function change(patch: Partial<ListInput>, now = false) {
    const next = { ...form, ...patch };
    setForm(next);
    if (!list) return;
    auto.schedule(next);
    if (now) void auto.flush();
  }

  async function close() {
    if (list) {
      if (form.name.trim() === "") auto.schedule({ ...form, name: list.name });
      const ok = await auto.flush();
      if (!ok && !window.confirm("The last change didn't save. Close anyway? (It will be tried once more.)")) return;
    } else if (form.name.trim() && !window.confirm("Close without creating this list?")) {
      return;
    }
    onClose();
  }

  function submit() {
    create.mutate({ ...form, name: form.name.trim() }, { onSuccess: row => { onClose(); onCreated?.(row.id); } });
  }

  async function setArchived(archived: boolean) {
    if (!list) return;
    if (archived && !window.confirm(`Archive "${list.name}"? It leaves the dashboard; its history is kept and you can restore it from All lists.`)) return;
    await auto.flush();
    update.mutate({ id: list.id, data: { archived } }, { onSuccess: () => onClose() });
  }

  const members = new Set(form.memberIds);
  const toggleMember = (id: number) => {
    const next = members.has(id) ? form.memberIds.filter(m => m !== id) : [...form.memberIds, id];
    change({ memberIds: next }, true);
  };

  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-2 sm:p-4" onClick={() => void close()}>
      <div role="dialog" aria-modal="true" aria-label={list ? "List settings" : "New list"}
        className="bg-background border-2 border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <h2 className="font-display text-xl font-bold flex-1">{list ? "List settings" : "New team list"}</h2>
          {list && <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />}
          <button type="button" onClick={() => void close()} className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0" aria-label="Close">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5 space-y-5">
          <div className="grid grid-cols-[88px_1fr] gap-3">
            <label className="space-y-1.5">
              <span className="text-sm font-semibold">Emoji</span>
              <input value={form.emoji ?? ""} onChange={e => change({ emoji: e.target.value.slice(0, 8) || null })} onBlur={() => void auto.flush()}
                className={cn(inputCls, "text-center text-2xl")} placeholder="📋" aria-label="Emoji" />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-semibold">Name</span>
              <input value={form.name} onChange={e => change({ name: e.target.value })} onBlur={() => { if (form.name.trim()) void auto.flush(); }}
                className={inputCls} placeholder="e.g. Production planner" maxLength={120} aria-label="List name" />
            </label>
          </div>

          <label className="block space-y-1.5">
            <span className="text-sm font-semibold">What it's for</span>
            <textarea value={form.description ?? ""} onChange={e => change({ description: e.target.value || null })} onBlur={() => void auto.flush()}
              rows={2} className="w-full rounded-xl border-2 border-border bg-background p-3 text-base focus:outline-none focus:border-primary"
              placeholder="The daily planning routine — about 30 minutes" />
          </label>

          <div className="space-y-1.5">
            <span className="text-sm font-semibold">Colour</span>
            <div className="flex gap-2 flex-wrap">
              {LIST_COLOURS.map(c => (
                <button key={c} type="button" onClick={() => change({ color: c }, true)} aria-label={`Colour ${c}`} aria-pressed={form.color === c}
                  className={cn("w-12 h-12 rounded-xl border-4", form.color === c ? "border-foreground" : "border-transparent")} style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-semibold">Who can open it</span>
            <p className="text-sm text-muted-foreground">
              {form.memberIds.length === 0
                ? "Every manager and admin (nobody picked). Pick people to keep it to them — admins can always open it."
                : "Only the people picked, plus admins."}
            </p>
            {people.isLoading && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>}
            <div className="flex flex-wrap gap-2">
              {(people.data ?? []).map(p => (
                <button key={p.id} type="button" onClick={() => toggleMember(p.id)} aria-pressed={members.has(p.id)}
                  className={cn("min-h-[44px] px-4 rounded-full border-2 text-sm font-semibold",
                    members.has(p.id) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-secondary/60")}>
                  {p.name}{p.role === "admin" ? " (admin)" : ""}
                </button>
              ))}
            </div>
          </div>

          {list && (
            <div className="pt-3 border-t border-border">
              {list.archived ? (
                <button type="button" onClick={() => void setArchived(false)} disabled={update.isPending}
                  className="min-h-[48px] px-4 rounded-xl border-2 border-border font-semibold inline-flex items-center gap-2 hover:bg-secondary/60">
                  <ArchiveRestore className="w-5 h-5" /> Restore this list
                </button>
              ) : (
                <button type="button" onClick={() => void setArchived(true)} disabled={update.isPending}
                  className="min-h-[48px] px-4 rounded-xl border-2 border-amber-300 text-amber-800 dark:text-amber-300 font-semibold inline-flex items-center gap-2 hover:bg-amber-50 dark:hover:bg-amber-950/30">
                  <Archive className="w-5 h-5" /> Archive this list
                </button>
              )}
              {update.error && <p className="text-sm text-red-600 mt-2">{(update.error as Error).message}</p>}
            </div>
          )}
        </div>

        {!list && (
          <div className="px-5 py-4 border-t border-border space-y-2">
            {create.error && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
            <button type="button" onClick={submit} disabled={!form.name.trim() || create.isPending}
              className="w-full min-h-[56px] rounded-2xl bg-primary text-primary-foreground text-lg font-bold disabled:opacity-50 inline-flex items-center justify-center gap-2">
              {create.isPending && <Loader2 className="w-5 h-5 animate-spin" />} Create list
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
