/**
 * Labels → QUID words (Automatic QUID, Graeme 2026-10-10). Objectives A, D.
 *
 * The list the recipe-name reader uses: which words tick a percentage
 * automatically, which are only asked about, which are made-up names to
 * ignore, and which words in a LINE's name stop it ever being ticked
 * (dough, seasoning…). Admins edit; each change saves at once. New words
 * apply when a recipe is next saved — "Check every recipe" shows what they
 * would change everywhere now (dry run), and "Apply" writes it.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Check, Loader2, Play, Plus, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { useDeleteQuidTerm, useQuidBackfill, useQuidTerms, useSaveQuidTerm, type QuidTermMode, type QuidTermRow } from "@/components/recipe-quid/api";

const GROUPS: Array<{ mode: QuidTermMode; title: string; help: string; tone: string }> = [
  { mode: "auto", title: "Ticked automatically", help: "In a recipe's name, these show a percentage on the matching lines. “→” shows what is looked for in the lines; a category takes every matching line.", tone: "border-emerald-300 dark:border-emerald-800" },
  { mode: "suggest", title: "Asked as a question", help: "Flavour words that may or may not be an ingredient (BBQ, Honey). The recipe asks “Should it show a percentage?”.", tone: "border-amber-300 dark:border-amber-800" },
  { mode: "ignore", title: "Ignored in names", help: "Made-up names and filler words — never looked for (Carnizone, The, Calzone).", tone: "border-border" },
  { mode: "guard", title: "Never ticked automatically", help: "A line whose name has one of these words is never ticked on its own — “Chicken Seasoning Mix” is not the chicken.", tone: "border-rose-300 dark:border-rose-800" },
];

const splitList = (s: string) => s.split(",").map(x => x.trim()).filter(Boolean);

export default function QuidWordsPage() {
  const { state } = useAuth();
  const isAdmin = state.status === "authenticated" && state.user.role === "admin";
  const { data, isLoading, error } = useQuidTerms();
  const save = useSaveQuidTerm();
  const del = useDeleteQuidTerm();
  const backfill = useQuidBackfill();

  const [editing, setEditing] = useState<QuidTermRow | null>(null);
  const [phrase, setPhrase] = useState("");
  const [mode, setMode] = useState<QuidTermMode>("auto");
  const [targets, setTargets] = useState("");
  const [categories, setCategories] = useState("");
  const [confirmApply, setConfirmApply] = useState(false);

  const byMode = useMemo(() => {
    const m = new Map<QuidTermMode, QuidTermRow[]>();
    for (const t of data?.terms ?? []) m.set(t.mode, [...(m.get(t.mode) ?? []), t]);
    return m;
  }, [data]);

  const startEdit = (t: QuidTermRow) => {
    setEditing(t); setPhrase(t.phrase); setMode(t.mode); setTargets(t.targets.join(", ")); setCategories(t.categories.join(", "));
  };
  const reset = () => { setEditing(null); setPhrase(""); setMode("auto"); setTargets(""); setCategories(""); };
  const submit = () => {
    const cats = splitList(categories);
    save.mutate(
      { id: editing?.id, term: { phrase, mode, targets: splitList(targets), categories: cats, isCategory: cats.length > 0 } },
      { onSuccess: reset },
    );
  };

  return (
    <div className="space-y-5 max-w-5xl">
      <Link href="/labels" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="w-4 h-4" /> Labels</Link>
      <PageHeader
        title="QUID words"
        description="How a recipe's name decides which ingredients show a percentage on the label. A person's tick on a recipe always wins over this list."
      />

      <div className="flex items-center gap-2 text-sm min-h-[1.5rem]">
        {save.isPending || del.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
          : save.error || del.error ? <span className="text-destructive font-semibold">Not saved — {((save.error ?? del.error) as Error).message}</span>
          : save.isSuccess || del.isSuccess ? <span className="text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1"><Check className="w-4 h-4" /> Saved</span>
          : null}
      </div>

      {isAdmin && (
        <div className="rounded-2xl border-2 border-border bg-card p-4 space-y-3">
          <p className="font-bold">{editing ? `Change “${editing.phrase}”` : "Add a word"}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm space-y-1">
              <span className="font-medium">Word or phrase</span>
              <input value={phrase} onChange={e => setPhrase(e.target.value)} placeholder="e.g. cinnamon" className="w-full h-11 px-3 rounded-xl border border-border bg-background" />
            </label>
            <label className="text-sm space-y-1">
              <span className="font-medium">What it does</span>
              <select value={mode} onChange={e => setMode(e.target.value as QuidTermMode)} className="w-full h-11 px-3 rounded-xl border border-border bg-background">
                {GROUPS.map(g => <option key={g.mode} value={g.mode}>{g.title}</option>)}
              </select>
            </label>
            {(mode === "auto" || mode === "suggest") && (
              <>
                <label className="text-sm space-y-1">
                  <span className="font-medium">Look for in the lines <span className="text-muted-foreground font-normal">(optional, commas; blank = the word itself; “@cheese” = everything cheese looks for)</span></span>
                  <input value={targets} onChange={e => setTargets(e.target.value)} placeholder="e.g. beef, @cheese" className="w-full h-11 px-3 rounded-xl border border-border bg-background" />
                </label>
                <label className="text-sm space-y-1">
                  <span className="font-medium">Whole ingredient categories <span className="text-muted-foreground font-normal">(optional — makes it a category)</span></span>
                  <input value={categories} onChange={e => setCategories(e.target.value)} placeholder="e.g. vegetable" className="w-full h-11 px-3 rounded-xl border border-border bg-background" />
                </label>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={!phrase.trim() || save.isPending} onClick={submit} className="h-11 px-5 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-50 inline-flex items-center gap-2">
              {editing ? <Check className="w-5 h-5" /> : <Plus className="w-5 h-5" />} {editing ? "Save change" : "Add"}
            </button>
            {editing && <button type="button" onClick={reset} className="h-11 px-5 rounded-xl border-2 border-border font-bold">Cancel</button>}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Loading…</div>
      ) : error ? (
        <p className="text-destructive">Couldn't load the list — {(error as Error).message}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {GROUPS.map(g => (
            <section key={g.mode} className={cn("rounded-2xl border-2 bg-card p-4 space-y-2", g.tone)}>
              <h2 className="text-lg font-bold">{g.title}</h2>
              <p className="text-sm text-muted-foreground">{g.help}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                {(byMode.get(g.mode) ?? []).map(t => (
                  <span key={t.id} className={cn("inline-flex items-center gap-1 rounded-full border border-border pl-3 pr-1 h-9 text-sm", editing?.id === t.id && "border-primary")}>
                    <button type="button" disabled={!isAdmin} onClick={() => startEdit(t)} className="font-medium disabled:cursor-default">
                      {t.phrase}
                      {t.targets.length > 0 && <span className="text-muted-foreground"> → {t.targets.join(", ")}</span>}
                      {t.categories.length > 0 && <span className="text-muted-foreground"> (+ all {t.categories.join(", ")})</span>}
                    </button>
                    {isAdmin ? (
                      <button type="button" aria-label={`Remove ${t.phrase}`} onClick={() => del.mutate(t.id)} className="w-7 h-7 rounded-full hover:bg-secondary inline-flex items-center justify-center text-muted-foreground">
                        <X className="w-4 h-4" />
                      </button>
                    ) : <span className="w-2" />}
                  </span>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {isAdmin && (
        <div className="rounded-2xl border-2 border-border bg-card p-4 space-y-3">
          <p className="font-bold">Check every recipe</p>
          <p className="text-sm text-muted-foreground">Words apply to a recipe when it's next saved. This shows what the list would change on every recipe now — nothing is written until you press Apply, and every label it changes then shows “Update needed”.</p>
          <div className="flex gap-2 flex-wrap">
            <button type="button" disabled={backfill.isPending} onClick={() => { setConfirmApply(false); backfill.mutate(false); }} className="h-11 px-5 rounded-xl border-2 border-border font-bold inline-flex items-center gap-2 disabled:opacity-50">
              {backfill.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />} Check (writes nothing)
            </button>
            {backfill.data && !backfill.data.applied && (
              confirmApply ? (
                <>
                  <button type="button" onClick={() => backfill.mutate(true)} className="h-11 px-5 rounded-xl bg-primary text-primary-foreground font-bold">Yes, apply to every recipe</button>
                  <button type="button" onClick={() => setConfirmApply(false)} className="h-11 px-5 rounded-xl border-2 border-border font-bold">Cancel</button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmApply(true)} className="h-11 px-5 rounded-xl bg-primary text-primary-foreground font-bold">Apply…</button>
              )
            )}
          </div>
          {backfill.error && <p className="text-destructive text-sm">{(backfill.error as Error).message}</p>}
          {backfill.data && (
            <pre className="text-xs whitespace-pre-wrap break-words max-h-[60dvh] overflow-y-auto rounded-xl bg-secondary/50 p-3">{backfill.data.text}</pre>
          )}
        </div>
      )}
    </div>
  );
}
