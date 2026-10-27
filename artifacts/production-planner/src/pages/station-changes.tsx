/**
 * Station changes — where System Updates are tagged with the station(s)
 * they affect and given a walkthrough (Graeme, 27 Oct 2026; objectives E,
 * F and H). /station-changes, for the people who manage System Updates
 * (Settings → Feature flags & updates); the API enforces the same.
 *
 * Area chips and the Published switch save on tap; text and walkthroughs
 * save with a button that shows Saving / Saved / the error. How to write a
 * walkthrough: docs/STATION_TUTORIALS.md.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, Check, Loader2, PlayCircle, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { parseTutorial, sortAreaKeys, type ChangeArea, type Tutorial, type TutorialStep } from "@workspace/station-changes";
import { PageHeader } from "@/components/page-header";
import { TutorialOverlay } from "@/components/tutorial/tutorial-overlay";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface AdminEntry {
  id: number;
  title: string;
  body: string;
  bullets: string[];
  areas: string[];
  createdAt: string;
  hasImage: boolean;
  published: boolean;
  slug: string | null;
  tutorial: Tutorial | null;
  tutorialRaw: unknown;
}

interface AdminData { areas: ChangeArea[]; entries: AdminEntry[] }

const ADMIN_KEY = ["station-changes-admin"] as const;

async function send(path: string, method: string, body: unknown): Promise<{ id?: number; areas?: string[] }> {
  const res = await fetch(`${BASE}/api/station-changes${path}`, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Couldn't save (${res.status})`);
  return json;
}

const KIND_LABEL: Record<ChangeArea["kind"], string> = {
  station: "Stations (shown on the station and in the meeting)",
  planning: "Planning (shown in the meeting)",
  office: "Office (never shown to the team)",
};

export default function StationChangesPage() {
  const q = useQuery<AdminData>({
    queryKey: ADMIN_KEY,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/station-changes/admin`, { credentials: "include" });
      if (res.status === 403) throw new Error("Only people who manage System Updates (Settings → Feature flags & updates) can open this page.");
      if (!res.ok) throw new Error(`Couldn't load the changes (${res.status})`);
      return res.json();
    },
  });
  const [filter, setFilter] = useState<"all" | "untagged">("all");
  const entries = useMemo(
    () => (q.data?.entries ?? []).filter(e => filter === "all" || e.areas.length === 0),
    [q.data, filter],
  );
  const untagged = (q.data?.entries ?? []).filter(e => e.areas.length === 0).length;

  return (
    <div className="space-y-6 pb-16">
      <PageHeader
        title="Station changes"
        description="Tag each update with the station it affects, and add a walkthrough so the team learns it on the station."
      />

      {q.isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : q.isError ? (
        <div className="rounded-2xl border-2 border-destructive/40 bg-destructive/5 p-6 text-lg font-semibold text-destructive">{(q.error as Error).message}</div>
      ) : (
        <>
          <NewChangeCard areas={q.data!.areas} />

          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-2xl font-display font-bold mr-auto">Last 120 days</h2>
            {(["all", "untagged"] as const).map(f => (
              <button key={f} type="button" onClick={() => setFilter(f)}
                className={cn("h-11 px-4 rounded-xl border-2 font-semibold", filter === f ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-secondary")}>
                {f === "all" ? "All" : `Untagged (${untagged})`}
              </button>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {entries.map(e => <EntryCard key={e.id} entry={e} areas={q.data!.areas} />)}
            {entries.length === 0 && <p className="text-lg text-muted-foreground">Nothing here.</p>}
          </div>
        </>
      )}
    </div>
  );
}

function SaveState({ m }: { m: { isPending: boolean; isSuccess: boolean; isError: boolean; error: unknown } }) {
  if (m.isPending) return <span className="inline-flex items-center gap-1 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Saving…</span>;
  if (m.isError) return <span className="inline-flex items-center gap-1 text-sm font-semibold text-destructive"><AlertTriangle className="w-4 h-4" /> {(m.error as Error).message}</span>;
  if (m.isSuccess) return <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-600"><Check className="w-4 h-4" /> Saved</span>;
  return null;
}

/** Area chips grouped by kind; tap to toggle. */
function AreaPicker({ areas, value, onChange, disabled }: {
  areas: ChangeArea[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const kinds: ChangeArea["kind"][] = ["station", "planning", "office"];
  return (
    <div className="space-y-2">
      {kinds.map(kind => {
        const list = areas.filter(a => a.kind === kind);
        if (list.length === 0) return null;
        return (
          <div key={kind}>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">{KIND_LABEL[kind]}</p>
            <div className="flex flex-wrap gap-2">
              {list.map(a => {
                const on = value.includes(a.key);
                return (
                  <button key={a.key} type="button" disabled={disabled}
                    onClick={() => onChange(sortAreaKeys(on ? value.filter(k => k !== a.key) : [...value, a.key], areas))}
                    className={cn("min-h-11 px-3 rounded-xl border-2 text-sm font-semibold disabled:opacity-50",
                      on ? (kind === "office" ? "bg-slate-600 text-white border-slate-600" : "bg-primary text-primary-foreground border-primary")
                        : "border-border hover:bg-secondary")}>
                    {a.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const blankStep = (): TutorialStep => ({ target: null, title: "", body: "", hiddenNote: null });

/** Edits a walkthrough's steps as data. Validation is the same rule the API
 *  and the station screen use (parseTutorial). */
function TutorialEditor({ steps, onChange }: { steps: TutorialStep[]; onChange: (s: TutorialStep[]) => void }) {
  const set = (i: number, patch: Partial<TutorialStep>) => onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="space-y-3">
      {steps.map((s, i) => (
        <div key={i} className="rounded-xl border border-border p-3 space-y-2 bg-secondary/20">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-muted-foreground">Step {i + 1}</span>
            <button type="button" onClick={() => onChange(steps.filter((_, j) => j !== i))} aria-label={`Remove step ${i + 1}`}
              className="ml-auto w-10 h-10 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-secondary">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <input value={s.target ?? ""} onChange={e => set(i, { target: e.target.value.trim() || null })}
            placeholder='Points at data-tour="…" (blank = centred step)'
            className="w-full h-11 px-3 rounded-lg border border-border bg-background font-mono text-sm" />
          <input value={s.title} onChange={e => set(i, { title: e.target.value })} placeholder="Title, e.g. Print front labels"
            className="w-full h-11 px-3 rounded-lg border border-border bg-background text-base font-semibold" />
          <textarea value={s.body} onChange={e => set(i, { body: e.target.value })} rows={3}
            placeholder="What it is, why it helps, how to use it"
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-base" />
          {s.target && (
            <input value={s.hiddenNote ?? ""} onChange={e => set(i, { hiddenNote: e.target.value || null })}
              placeholder="If it isn't on screen: where/when it appears"
              className="w-full h-11 px-3 rounded-lg border border-border bg-background text-sm" />
          )}
        </div>
      ))}
      <button type="button" onClick={() => onChange([...steps, blankStep()])}
        className="h-11 px-4 rounded-xl border-2 border-dashed border-border font-semibold inline-flex items-center gap-2 hover:bg-secondary">
        <Plus className="w-4 h-4" /> Add a step
      </button>
    </div>
  );
}

function stepsOf(raw: unknown): TutorialStep[] {
  const r = parseTutorial(raw);
  if (r.ok) return r.tutorial?.steps ?? [];
  // Keep whatever is there so it can be fixed rather than lost.
  const s = (raw as { steps?: unknown })?.steps;
  return Array.isArray(s) ? s.map(x => ({ ...blankStep(), ...(x as object) })) : [];
}

function NewChangeCard({ areas }: { areas: ChangeArea[] }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [steps, setSteps] = useState<TutorialStep[]>([]);
  const guess = useMutation({
    mutationFn: () => send("/guess", "POST", { title, body }),
    onSuccess: r => setPicked(r.areas ?? []),
  });
  const create = useMutation({
    mutationFn: () => send("", "POST", { title: title.trim() || null, body, areas: picked, tutorial: steps.length ? { steps } : null }),
    onSuccess: () => {
      setTitle(""); setBody(""); setPicked([]); setSteps([]);
      qc.invalidateQueries({ queryKey: ADMIN_KEY });
      qc.invalidateQueries({ queryKey: ["station-changes"] });
    },
  });
  const check = parseTutorial(steps.length ? { steps } : null);

  return (
    <div className="rounded-2xl border-2 border-primary/30 bg-card p-5 space-y-4">
      <div className="flex items-center gap-3">
        <Sparkles className="w-6 h-6 text-primary" />
        <h2 className="text-xl font-bold">Add a change</h2>
      </div>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title, e.g. Print front labels on Wrapping"
        className="w-full h-12 px-3 rounded-xl border border-border bg-background text-lg font-semibold" />
      <textarea value={body} onChange={e => setBody(e.target.value)} rows={4} placeholder="One line per point the team should know"
        className="w-full px-3 py-2 rounded-xl border border-border bg-background text-base" />
      <div className="flex items-center gap-3">
        <p className="font-semibold">Where does it apply?</p>
        <button type="button" onClick={() => guess.mutate()} disabled={!title.trim() && !body.trim()}
          className="h-11 px-3 rounded-xl border-2 border-border text-sm font-semibold inline-flex items-center gap-2 hover:bg-secondary disabled:opacity-50">
          {guess.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />} Guess from the words
        </button>
      </div>
      <AreaPicker areas={areas} value={picked} onChange={setPicked} />
      <details className="rounded-xl border border-border p-3">
        <summary className="font-semibold cursor-pointer">Walkthrough ({steps.length} step{steps.length === 1 ? "" : "s"})</summary>
        <div className="pt-3"><TutorialEditor steps={steps} onChange={setSteps} /></div>
      </details>
      {!check.ok && <p className="text-sm font-semibold text-destructive">{check.errors.join(" ")}</p>}
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => create.mutate()} disabled={!body.trim() || !check.ok || create.isPending}
          className="h-12 px-5 rounded-xl bg-primary text-primary-foreground font-bold inline-flex items-center gap-2 disabled:opacity-50">
          <Plus className="w-5 h-5" /> Add change
        </button>
        {picked.length === 0 && body.trim() && <span className="text-sm text-amber-700 dark:text-amber-300 font-semibold">No area picked — it won't show on any station.</span>}
        <SaveState m={create} />
      </div>
    </div>
  );
}

function EntryCard({ entry, areas }: { entry: AdminEntry; areas: ChangeArea[] }) {
  const qc = useQueryClient();
  const [steps, setSteps] = useState<TutorialStep[]>(() => stepsOf(entry.tutorialRaw));
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false);
  useEffect(() => { if (!dirty) setSteps(stepsOf(entry.tutorialRaw)); }, [entry.tutorialRaw, dirty]);

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => send(`/${entry.id}`, "PUT", body),
    onMutate: body => {
      qc.setQueryData<AdminData>(ADMIN_KEY, prev => prev && ({
        ...prev,
        entries: prev.entries.map(e => (e.id === entry.id ? { ...e, ...(body as Partial<AdminEntry>) } : e)),
      }));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ADMIN_KEY });
      qc.invalidateQueries({ queryKey: ["station-changes"] });
    },
  });
  const saveTutorial = useMutation({
    mutationFn: () => send(`/${entry.id}`, "PUT", { tutorial: steps.length ? { steps } : null }),
    onSuccess: () => { setDirty(false); qc.invalidateQueries({ queryKey: ADMIN_KEY }); qc.invalidateQueries({ queryKey: ["station-changes"] }); },
  });
  const check = parseTutorial(steps.length ? { steps } : null);

  return (
    <div className={cn("rounded-2xl border-2 bg-card p-5 space-y-3", entry.areas.length === 0 ? "border-amber-400/60" : "border-border")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">
            {format(new Date(entry.createdAt), "EEE d MMM yyyy")}
            {entry.slug && <span className="ml-2 font-mono text-xs">{entry.slug}</span>}
          </p>
          <h3 className="text-xl font-bold leading-snug">{entry.title || entry.bullets[0] || "(untitled)"}</h3>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold shrink-0 min-h-11 cursor-pointer">
          <input type="checkbox" className="w-5 h-5 accent-primary" checked={entry.published}
            onChange={e => patch.mutate({ published: e.target.checked })} />
          Published
        </label>
      </div>
      <ul className="text-base text-muted-foreground space-y-1">
        {entry.bullets.map((b, i) => <li key={i} className="flex gap-2"><span className="text-primary">•</span><span>{b}</span></li>)}
      </ul>
      {entry.areas.length === 0 && (
        <p className="text-sm font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4" /> Not tagged — it won't show on any station or in the meeting.
        </p>
      )}
      <AreaPicker areas={areas} value={entry.areas} onChange={next => patch.mutate({ areas: next })} />
      <div className="min-h-6"><SaveState m={patch} /></div>

      <details className="rounded-xl border border-border p-3" open={steps.length > 0 && dirty}>
        <summary className="font-semibold cursor-pointer">
          Walkthrough ({steps.length} step{steps.length === 1 ? "" : "s"}){!check.ok && <span className="text-destructive"> — needs fixing</span>}
        </summary>
        <div className="pt-3 space-y-3">
          <TutorialEditor steps={steps} onChange={s => { setSteps(s); setDirty(true); }} />
          {!check.ok && <p className="text-sm font-semibold text-destructive">{check.errors.join(" ")}</p>}
          <div className="flex items-center gap-3 flex-wrap">
            <button type="button" onClick={() => saveTutorial.mutate()} disabled={!dirty || !check.ok || saveTutorial.isPending}
              className="h-11 px-4 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-50">
              Save walkthrough
            </button>
            {check.ok && check.tutorial && (
              <button type="button" onClick={() => setPreview(true)}
                className="h-11 px-4 rounded-xl border-2 border-border font-semibold inline-flex items-center gap-2 hover:bg-secondary">
                <PlayCircle className="w-4 h-4" /> Try it here
              </button>
            )}
            {dirty && !saveTutorial.isPending && <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">Not saved yet</span>}
            <SaveState m={saveTutorial} />
          </div>
        </div>
      </details>
      {preview && check.ok && check.tutorial && (
        <TutorialOverlay tutorial={check.tutorial} heading={entry.title} onClose={() => setPreview(false)} />
      )}
    </div>
  );
}
