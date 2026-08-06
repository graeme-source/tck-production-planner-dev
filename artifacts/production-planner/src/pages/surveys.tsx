/**
 * Customer Surveys — build test-product feedback surveys, share them to the
 * Shopify site (link + QR), and read the results.
 *
 * Three in-page views (list / builder / results) rather than dialogs: a
 * survey builder with a handful of questions needs the full iPad width.
 * The public survey page itself lives on Shopify — this page only manages
 * surveys and shows what came back.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Loader2, ArrowLeft, ArrowUp, ArrowDown, Trash2, Copy, Check,
  QrCode, BarChart2, Pencil, Star, AlertTriangle, Download, ExternalLink,
  MessagesSquare, Lock, LockOpen,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function jsonOrThrow(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? fallback);
  return data;
}

// ── Types (mirror routes/surveys.ts serialisation) ─────────────────────────

type SurveyStatus = "draft" | "open" | "closed";
type QuestionType = "rating" | "choice" | "multi" | "text" | "rank";

interface SurveyListItem {
  id: number;
  title: string;
  intro: string | null;
  status: SurveyStatus;
  createdAt: string;
  responseCount: number;
  questionCount: number;
  shareUrl: string;
}

interface RecipeOption { id: number; name: string; category: string | null; imageUrl: string | null }

interface ServerQuestion {
  id: number;
  type: QuestionType;
  prompt: string;
  recipeId: number | null;
  options: string[] | null;
  required: boolean;
  max: number;
  recipe: { id: number; name: string; category: string | null; imageUrl: string | null } | null;
}

interface SurveyDetail extends SurveyListItem { questions: ServerQuestion[] }

type Aggregates =
  | { kind: "rating"; count: number; average: number | null; distribution: Record<string, number> }
  | { kind: "options"; count: number; counts: Record<string, number> }
  | { kind: "rank"; count: number; averagePosition: Record<string, number | null> }
  | { kind: "text"; count: number; answers: { value: string; submittedAt: string | null }[] };

interface ResultsData {
  id: number;
  title: string;
  status: SurveyStatus;
  shareUrl: string;
  totalResponses: number;
  questions: (ServerQuestion & { aggregates: Aggregates })[];
}

// Builder-local question (no server id until saved)
interface DraftQuestion {
  key: string;
  id?: number;
  type: QuestionType;
  prompt: string;
  recipeId: number | null;
  options: string[];
  required: boolean;
  max: number;
}

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  rating: "Rating (stars)",
  choice: "Choice (one of)",
  multi: "Multi (any of)",
  text: "Free text",
  rank: "Rank the options",
};

const OPTION_TYPES: QuestionType[] = ["choice", "multi", "rank"];

let keyCounter = 0;
const nextKey = () => `q-${++keyCounter}`;

const STATUS_STYLES: Record<SurveyStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  open: "bg-primary/15 text-primary",
  closed: "bg-amber-500/15 text-amber-600",
};

// ── Recipe picker (split by category, per house convention) ────────────────

function groupRecipeOptions(recipes: RecipeOption[]) {
  const groups: { label: string; recipes: RecipeOption[] }[] = [];
  const byLabel = new Map<string, RecipeOption[]>();
  for (const r of recipes) {
    const label = r.category?.trim() || "Uncategorised";
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label)!.push(r);
  }
  // Calzones and Macaroni Cheese always lead, in that order; anything else
  // (Fried Chicken, future categories) follows alphabetically.
  const ordered = ["Calzones", "Macaroni Cheese", ...[...byLabel.keys()]
    .filter(l => l !== "Calzones" && l !== "Macaroni Cheese").sort()];
  for (const label of ordered) {
    const list = byLabel.get(label);
    if (list?.length) groups.push({ label, recipes: list });
  }
  return groups;
}

function RecipePicker({ recipes, value, onChange }: {
  recipes: RecipeOption[];
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const groups = useMemo(() => groupRecipeOptions(recipes), [recipes]);
  return (
    <Select
      value={value == null ? "none" : String(value)}
      onValueChange={(v) => onChange(v === "none" ? null : Number(v))}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="No recipe" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">No recipe</SelectItem>
        {groups.map(g => (
          <SelectGroup key={g.label}>
            <SelectLabel>{g.label}</SelectLabel>
            {g.recipes.map(r => (
              <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── Share dialog (URL + QR) ────────────────────────────────────────────────

function ShareDialog({ survey, onClose }: { survey: { id: number; title: string; shareUrl: string } | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  if (!survey) return null;
  const qrSrc = `${BASE}/api/surveys/${survey.id}/qr.png`;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share “{survey.title}”</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Input readOnly value={survey.shareUrl} className="text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button
              variant="outline" size="icon" className="flex-shrink-0"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(survey.shareUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  toast({ title: "Couldn't copy — select the text and copy manually", variant: "destructive" });
                }
              }}
            >
              {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
          <div className="flex flex-col items-center gap-3">
            <img src={qrSrc} alt="Survey QR code" className="w-56 h-56 rounded-lg border border-border bg-white p-2" />
            <Button asChild variant="outline">
              <a href={`${qrSrc}?download`}>
                <Download className="w-4 h-4 mr-2" /> Download QR PNG
              </a>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Builder ────────────────────────────────────────────────────────────────

function toDraftQuestions(questions: ServerQuestion[]): DraftQuestion[] {
  return questions.map(q => ({
    key: nextKey(),
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    recipeId: q.recipeId,
    options: q.options ?? [],
    required: q.required,
    max: q.max,
  }));
}

function QuestionEditor({ question, recipes, onChange, onRemove, onMove, isFirst, isLast }: {
  question: DraftQuestion;
  recipes: RecipeOption[];
  onChange: (q: DraftQuestion) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const recipe = question.recipeId != null ? recipes.find(r => r.id === question.recipeId) : undefined;
  const needsOptions = OPTION_TYPES.includes(question.type);

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 space-y-3">
          <div className="flex flex-wrap gap-3">
            <div className="w-44">
              <Select
                value={question.type}
                onValueChange={(v) => onChange({ ...question, type: v as QuestionType })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).map(t => (
                    <SelectItem key={t} value={t}>{QUESTION_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-48">
              <RecipePicker
                recipes={recipes}
                value={question.recipeId}
                onChange={(recipeId) => onChange({ ...question, recipeId })}
              />
            </div>
          </div>
          <Input
            value={question.prompt}
            placeholder="Question prompt, e.g. How would you rate the Mexican Chicken calzone?"
            onChange={(e) => onChange({ ...question, prompt: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={isFirst} onClick={() => onMove(-1)}>
            <ArrowUp className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={isLast} onClick={() => onMove(1)}>
            <ArrowDown className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onRemove}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {recipe?.imageUrl && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <img src={recipe.imageUrl} alt={recipe.name} className="w-8 h-8 rounded object-cover" />
          Shown on the public survey with this image
        </div>
      )}

      {needsOptions && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Options {question.type === "rank" ? "(customer puts these in order)" : ""}
          </p>
          {question.options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={opt}
                placeholder={`Option ${i + 1}`}
                onChange={(e) => {
                  const options = [...question.options];
                  options[i] = e.target.value;
                  onChange({ ...question, options });
                }}
              />
              <Button
                variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0 text-muted-foreground"
                onClick={() => onChange({ ...question, options: question.options.filter((_, j) => j !== i) })}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline" size="sm"
            onClick={() => onChange({ ...question, options: [...question.options, ""] })}
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Add option
          </Button>
        </div>
      )}

      <div className="flex items-center gap-6 pt-1">
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={question.required}
            onCheckedChange={(required) => onChange({ ...question, required })}
          />
          Required
        </label>
        {question.type === "rating" && (
          <label className="flex items-center gap-2 text-sm">
            Scale: 1–
            <Input
              type="number" min={2} max={10}
              className="w-16 h-8"
              value={question.max}
              onChange={(e) => {
                const max = Number(e.target.value);
                if (Number.isInteger(max)) onChange({ ...question, max });
              }}
            />
          </label>
        )}
      </div>
    </div>
  );
}

function BuilderView({ surveyId, onBack, onSaved }: {
  surveyId: number | null; // null = creating new
  onBack: () => void;
  onSaved: (id: number) => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [intro, setIntro] = useState("");
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const [shareTarget, setShareTarget] = useState<{ id: number; title: string; shareUrl: string } | null>(null);

  const { data: recipes } = useQuery<RecipeOption[]>({
    queryKey: ["survey-recipe-options"],
    queryFn: async () => jsonOrThrow(await fetch(`${BASE}/api/surveys/recipe-options`, { credentials: "include" }), "Failed to load recipes"),
  });

  const { data: existing, isLoading } = useQuery<SurveyDetail>({
    queryKey: ["survey", surveyId],
    enabled: surveyId != null,
    queryFn: async () => jsonOrThrow(await fetch(`${BASE}/api/surveys/${surveyId}`, { credentials: "include" }), "Failed to load survey"),
  });

  // Hydrate the form once per loaded survey (not on every refetch, which
  // would stomp in-progress edits).
  if (existing && loadedFor !== existing.id) {
    setTitle(existing.title);
    setIntro(existing.intro ?? "");
    setQuestions(toDraftQuestions(existing.questions));
    setLoadedFor(existing.id);
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        title: title.trim(),
        intro: intro.trim() || null,
        questions: questions.map(q => ({
          ...(q.id != null ? { id: q.id } : {}),
          type: q.type,
          prompt: q.prompt.trim(),
          recipeId: q.recipeId,
          options: OPTION_TYPES.includes(q.type) ? q.options.map(o => o.trim()).filter(Boolean) : null,
          required: q.required,
          max: q.max,
        })),
      };
      const url = surveyId == null ? `${BASE}/api/surveys` : `${BASE}/api/surveys/${surveyId}`;
      return jsonOrThrow(await fetch(url, {
        method: surveyId == null ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      }), "Failed to save survey") as Promise<SurveyDetail>;
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["surveys"] });
      queryClient.invalidateQueries({ queryKey: ["survey", saved.id] });
      toast({ title: "Survey saved" });
      setShareTarget({ id: saved.id, title: saved.title, shareUrl: saved.shareUrl });
      if (surveyId == null) onSaved(saved.id);
    },
    onError: (e) => toast({ title: e instanceof Error ? e.message : "Failed to save survey", variant: "destructive" }),
  });

  const canSave = title.trim().length > 0 &&
    questions.length > 0 &&
    questions.every(q =>
      q.prompt.trim().length > 0 &&
      (!OPTION_TYPES.includes(q.type) || q.options.map(o => o.trim()).filter(Boolean).length >= 2));

  if (surveyId != null && isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to surveys
        </Button>
        <Button onClick={() => save.mutate()} disabled={!canSave || save.isPending}>
          {save.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Save survey
        </Button>
      </div>

      {existing != null && existing.responseCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          This survey already has {existing.responseCount} response{existing.responseCount === 1 ? "" : "s"}.
          Removing a question deletes its answers; changing options can make old answers unreadable.
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <Input
          value={title}
          placeholder="Survey title, e.g. Mexican Test Box — March"
          className="text-base font-medium"
          onChange={(e) => setTitle(e.target.value)}
        />
        <Textarea
          value={intro}
          placeholder="Intro text shown above the questions (optional)"
          rows={2}
          onChange={(e) => setIntro(e.target.value)}
        />
      </div>

      {questions.map((q, i) => (
        <QuestionEditor
          key={q.key}
          question={q}
          recipes={recipes ?? []}
          isFirst={i === 0}
          isLast={i === questions.length - 1}
          onChange={(updated) => setQuestions(qs => qs.map(x => x.key === q.key ? updated : x))}
          onRemove={() => setQuestions(qs => qs.filter(x => x.key !== q.key))}
          onMove={(dir) => setQuestions(qs => {
            const idx = qs.findIndex(x => x.key === q.key);
            const target = idx + dir;
            if (target < 0 || target >= qs.length) return qs;
            const next = [...qs];
            [next[idx], next[target]] = [next[target], next[idx]];
            return next;
          })}
        />
      ))}

      <Button
        variant="outline" className="w-full"
        onClick={() => setQuestions(qs => [...qs, {
          key: nextKey(), type: "rating", prompt: "", recipeId: null, options: [], required: true, max: 5,
        }])}
      >
        <Plus className="w-4 h-4 mr-2" /> Add question
      </Button>

      <ShareDialog survey={shareTarget} onClose={() => setShareTarget(null)} />
    </div>
  );
}

// ── Results ────────────────────────────────────────────────────────────────

function CountBars({ counts, total }: { counts: Record<string, number>; total: number }) {
  const maxCount = Math.max(1, ...Object.values(counts));
  return (
    <div className="space-y-1.5">
      {Object.entries(counts).map(([label, count]) => (
        <div key={label} className="flex items-center gap-2 text-sm">
          <span className="w-40 truncate flex-shrink-0" title={label}>{label}</span>
          <div className="flex-1 h-5 rounded bg-muted overflow-hidden">
            <div className="h-full bg-primary/70" style={{ width: `${(count / maxCount) * 100}%` }} />
          </div>
          <span className="w-14 text-right text-muted-foreground text-xs">
            {count}{total > 0 ? ` (${Math.round((count / total) * 100)}%)` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function QuestionResults({ question }: { question: ResultsData["questions"][number] }) {
  const agg = question.aggregates;
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-sm">{question.prompt}</p>
        <Badge variant="outline" className="flex-shrink-0 text-xs">
          {agg.count} answer{agg.count === 1 ? "" : "s"}
        </Badge>
      </div>

      {agg.kind === "rating" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Star className="w-5 h-5 fill-amber-400 text-amber-400" />
            <span className="text-2xl font-semibold">{agg.average ?? "—"}</span>
            <span className="text-sm text-muted-foreground">/ {question.max} average</span>
          </div>
          <CountBars
            counts={Object.fromEntries(Object.entries(agg.distribution).map(([star, n]) => [`${star} star${star === "1" ? "" : "s"}`, n]))}
            total={agg.count}
          />
        </div>
      )}

      {agg.kind === "options" && <CountBars counts={agg.counts} total={agg.count} />}

      {agg.kind === "rank" && (
        <div className="space-y-1">
          {Object.entries(agg.averagePosition)
            .sort(([, a], [, b]) => (a ?? Infinity) - (b ?? Infinity))
            .map(([option, avg], i) => (
              <div key={option} className="flex items-center gap-3 text-sm py-1 border-b border-border/50 last:border-0">
                <span className="w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-semibold flex items-center justify-center flex-shrink-0">
                  {i + 1}
                </span>
                <span className="flex-1">{option}</span>
                <span className="text-xs text-muted-foreground">
                  {avg != null ? `avg position ${avg}` : "no rankings"}
                </span>
              </div>
            ))}
        </div>
      )}

      {agg.kind === "text" && (
        agg.answers.length === 0
          ? <p className="text-sm text-muted-foreground">No written answers yet.</p>
          : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {agg.answers.map((a, i) => (
                <div key={i} className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                  <p className="whitespace-pre-wrap">{a.value}</p>
                  {a.submittedAt && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(a.submittedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )
      )}
    </div>
  );
}

function ResultsView({ surveyId, onBack }: { surveyId: number; onBack: () => void }) {
  const { data, isLoading } = useQuery<ResultsData>({
    queryKey: ["survey-results", surveyId],
    queryFn: async () => jsonOrThrow(await fetch(`${BASE}/api/surveys/${surveyId}/results`, { credentials: "include" }), "Failed to load results"),
  });

  if (isLoading || !data) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  // Group questions under their recipe (spec: recipe sections first, in
  // question order; questions with no recipe fall into "General feedback").
  const groups: { label: string; imageUrl: string | null; questions: ResultsData["questions"] }[] = [];
  for (const q of data.questions) {
    const label = q.recipe?.name ?? "General feedback";
    let group = groups.find(g => g.label === label);
    if (!group) {
      group = { label, imageUrl: q.recipe?.imageUrl ?? null, questions: [] };
      groups.push(group);
    }
    group.questions.push(q);
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to surveys
        </Button>
        <Button asChild variant="outline" disabled={data.totalResponses === 0}>
          <a href={`${BASE}/api/surveys/${surveyId}/export.csv`}>
            <Download className="w-4 h-4 mr-2" /> Export CSV
          </a>
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-semibold">{data.title}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {data.totalResponses} response{data.totalResponses === 1 ? "" : "s"}
        </p>
      </div>

      {groups.map(group => (
        <div key={group.label} className="space-y-2">
          <div className="flex items-center gap-2 pt-2">
            {group.imageUrl && (
              <img src={group.imageUrl} alt={group.label} className="w-9 h-9 rounded-lg object-cover border border-border" />
            )}
            <h3 className="font-semibold text-sm">{group.label}</h3>
          </div>
          {group.questions.map(q => <QuestionResults key={q.id} question={q} />)}
        </div>
      ))}
    </div>
  );
}

// ── List ───────────────────────────────────────────────────────────────────

function SurveyCard({ survey, onEdit, onResults, onShare }: {
  survey: SurveyListItem;
  onEdit: () => void;
  onResults: () => void;
  onShare: () => void;
}) {
  const queryClient = useQueryClient();

  const setStatus = useMutation({
    mutationFn: async (status: SurveyStatus) =>
      jsonOrThrow(await fetch(`${BASE}/api/surveys/${survey.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      }), "Failed to update status"),
    onSuccess: (_, status) => {
      queryClient.invalidateQueries({ queryKey: ["surveys"] });
      queryClient.invalidateQueries({ queryKey: ["survey", survey.id] });
      toast({ title: status === "open" ? "Survey is now live" : "Survey closed" });
    },
    onError: (e) => toast({ title: e instanceof Error ? e.message : "Failed to update status", variant: "destructive" }),
  });

  const duplicate = useMutation({
    mutationFn: async () =>
      jsonOrThrow(await fetch(`${BASE}/api/surveys/${survey.id}/duplicate`, {
        method: "POST", credentials: "include",
      }), "Failed to duplicate"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["surveys"] });
      toast({ title: "Survey duplicated", description: "The copy starts as a draft with a fresh link." });
    },
    onError: (e) => toast({ title: e instanceof Error ? e.message : "Failed to duplicate", variant: "destructive" }),
  });

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold truncate">{survey.title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {survey.questionCount} question{survey.questionCount === 1 ? "" : "s"} ·{" "}
            {survey.responseCount} response{survey.responseCount === 1 ? "" : "s"} ·{" "}
            created {new Date(survey.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </p>
        </div>
        <Badge className={cn("capitalize flex-shrink-0", STATUS_STYLES[survey.status])}>{survey.status}</Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
        </Button>
        <Button variant="outline" size="sm" onClick={onResults}>
          <BarChart2 className="w-3.5 h-3.5 mr-1.5" /> Results
        </Button>
        <Button variant="outline" size="sm" onClick={onShare}>
          <QrCode className="w-3.5 h-3.5 mr-1.5" /> Share
        </Button>
        <Button variant="outline" size="sm" onClick={() => duplicate.mutate()} disabled={duplicate.isPending}>
          <Copy className="w-3.5 h-3.5 mr-1.5" /> Duplicate
        </Button>
        {survey.status === "open" ? (
          <Button variant="outline" size="sm" onClick={() => setStatus.mutate("closed")} disabled={setStatus.isPending}>
            <Lock className="w-3.5 h-3.5 mr-1.5" /> Close
          </Button>
        ) : (
          <Button size="sm" onClick={() => setStatus.mutate("open")} disabled={setStatus.isPending}>
            <LockOpen className="w-3.5 h-3.5 mr-1.5" /> {survey.status === "closed" ? "Reopen" : "Open"}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

type View = { name: "list" } | { name: "builder"; surveyId: number | null } | { name: "results"; surveyId: number };

export default function Surveys() {
  const [view, setView] = useState<View>({ name: "list" });
  const [shareTarget, setShareTarget] = useState<{ id: number; title: string; shareUrl: string } | null>(null);

  const { data: surveys, isLoading } = useQuery<SurveyListItem[]>({
    queryKey: ["surveys"],
    queryFn: async () => jsonOrThrow(await fetch(`${BASE}/api/surveys`, { credentials: "include" }), "Failed to load surveys"),
  });

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="Customer Surveys"
        description="Test-product feedback collected on the website"
        action={view.name === "list" ? (
          <Button onClick={() => setView({ name: "builder", surveyId: null })}>
            <Plus className="w-4 h-4 mr-2" /> New survey
          </Button>
        ) : undefined}
      />

      {view.name === "builder" && (
        <BuilderView
          surveyId={view.surveyId}
          onBack={() => setView({ name: "list" })}
          onSaved={(id) => setView({ name: "builder", surveyId: id })}
        />
      )}

      {view.name === "results" && (
        <ResultsView surveyId={view.surveyId} onBack={() => setView({ name: "list" })} />
      )}

      {view.name === "list" && (
        isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : !surveys?.length ? (
          <div className="max-w-md mx-auto text-center py-16 space-y-3">
            <MessagesSquare className="w-10 h-10 mx-auto text-muted-foreground/50" />
            <p className="text-muted-foreground text-sm">
              No surveys yet. Build one, open it, and share the link or QR code with customers.
            </p>
            <Button onClick={() => setView({ name: "builder", surveyId: null })}>
              <Plus className="w-4 h-4 mr-2" /> Create your first survey
            </Button>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto grid gap-3">
            {surveys.map(s => (
              <SurveyCard
                key={s.id}
                survey={s}
                onEdit={() => setView({ name: "builder", surveyId: s.id })}
                onResults={() => setView({ name: "results", surveyId: s.id })}
                onShare={() => setShareTarget({ id: s.id, title: s.title, shareUrl: s.shareUrl })}
              />
            ))}
          </div>
        )
      )}

      <ShareDialog survey={shareTarget} onClose={() => setShareTarget(null)} />
    </div>
  );
}
