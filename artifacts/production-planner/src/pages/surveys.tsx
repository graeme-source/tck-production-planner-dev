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
  MessagesSquare, Lock, LockOpen, Eye, Boxes, Filter,
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
type QuestionType = "rating" | "slider" | "choice" | "multi" | "text" | "rank";

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

interface CollectionOption { id: number; title: string }

interface CollectionTemplate {
  collection: CollectionOption;
  title: string;
  intro: string;
  questions: Array<{ type: QuestionType; prompt: string; recipeId: number | null; options: string[] | null; required: boolean; max: number }>;
  deliveryDates: string[];
  matchingOrders: number;
  lookbackDays: number;
  unmatchedProducts: string[];
}

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
  | { kind: "slider"; count: number; average: number | null }
  | { kind: "options"; count: number; counts: Record<string, number> }
  | { kind: "rank"; count: number; averagePosition: Record<string, number | null> }
  | { kind: "text"; count: number; answers: { value: string; submittedAt: string | null }[] };

interface ResultsData {
  id: number;
  title: string;
  status: SurveyStatus;
  shareUrl: string;
  totalResponses: number;
  unfilteredResponses: number;
  questions: (ServerQuestion & { aggregates: Aggregates })[];
}

// Builder-local question (no server id until saved)
interface DraftQuestion {
  key: string;
  id?: number;
  type: QuestionType;
  prompt: string;
  // False while the prompt is empty or still an auto-filled template —
  // picking a recipe (or switching type) may then (re)write it. Goes true
  // the moment the user types their own text, and auto-fill backs off.
  promptEdited: boolean;
  recipeId: number | null;
  options: string[];
  required: boolean;
  max: number;
}

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  rating: "Rating (stars)",
  slider: "Approval slider (0–100%)",
  choice: "Choice (one of)",
  multi: "Multi (any of)",
  text: "Free text",
  rank: "Rank the options",
};

// Stars stay coarse — 2..10. Bigger granular scales are what the slider
// type is for. The server rejects anything outside this range too.
const RATING_MAX_MIN = 2;
const RATING_MAX_MAX = 10;
const clampRatingMax = (n: number) => Math.min(RATING_MAX_MAX, Math.max(RATING_MAX_MIN, n));

// "the {name}" without doubling the article for names like "The Benji".
const withArticle = (name: string) => /^the\s/i.test(name.trim()) ? name.trim() : `the ${name.trim()}`;

// Prompt templates applied when a recipe is picked and the prompt hasn't
// been hand-written (empty or still a previous auto-fill). Always editable
// afterwards — auto-fill never overwrites a customised prompt.
const PROMPT_TEMPLATES: Record<QuestionType, (name: string) => string> = {
  rating: (name) => `How would you rate ${withArticle(name)} recipe?`,
  slider: (name) => `Overall, how likely are you to approve ${withArticle(name)} for the menu?`,
  choice: (name) => `Which best describes ${withArticle(name)}?`,
  multi: (name) => `Which of these apply to ${withArticle(name)}?`,
  text: (name) => `What did you think of ${withArticle(name)}?`,
  rank: (name) => `Rank what you enjoyed most about ${withArticle(name)}`,
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

// ── Klaviyo connect card ───────────────────────────────────────────────────
// Stores the surveys-only Klaviyo key ("TCK Planner 2" — write scopes for
// lists/profiles/campaigns/templates). Separate from the read-only Founder
// Sales key. Powers the upcoming "Email the buyers" panel.

function KlaviyoCard() {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");

  const { data } = useQuery<{ connected: boolean }>({
    queryKey: ["surveys-klaviyo"],
    queryFn: async () => jsonOrThrow(await fetch(`${BASE}/api/surveys/klaviyo`, { credentials: "include" }), "Failed to check Klaviyo"),
  });

  const connect = useMutation({
    mutationFn: async () =>
      jsonOrThrow(await fetch(`${BASE}/api/surveys/klaviyo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      }), "Klaviyo rejected that key") as Promise<{ accountName: string | null }>,
    onSuccess: (d) => {
      setApiKey("");
      queryClient.invalidateQueries({ queryKey: ["surveys-klaviyo"] });
      toast({ title: "Klaviyo connected", description: d.accountName ? `Account: ${d.accountName}` : undefined });
    },
    onError: (e) => toast({ title: e instanceof Error ? e.message : "Klaviyo rejected that key", variant: "destructive" }),
  });

  const disconnect = useMutation({
    mutationFn: async () =>
      jsonOrThrow(await fetch(`${BASE}/api/surveys/klaviyo`, { method: "DELETE", credentials: "include" }), "Failed to disconnect"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["surveys-klaviyo"] });
      toast({ title: "Klaviyo disconnected" });
    },
  });

  if (!data) return null;

  if (data.connected) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-2.5">
        <p className="text-sm flex items-center gap-2">
          <Check className="w-4 h-4 text-primary" />
          Klaviyo connected — ready to email survey invites to recent buyers
        </p>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => disconnect.mutate()}>
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 space-y-2">
      <p className="text-sm font-medium">Connect Klaviyo for survey email invites</p>
      <p className="text-xs text-muted-foreground">
        Paste the <b>“TCK Planner 2”</b> private key (pk_…) — the one with list, profile, campaign and
        template scopes. The read-only Founder Sales key stays as it is.
      </p>
      <div className="flex gap-2">
        <Input
          type="password"
          value={apiKey}
          placeholder="pk_…"
          autoComplete="off"
          onChange={(e) => setApiKey(e.target.value)}
        />
        <Button
          disabled={apiKey.trim().length < 10 || connect.isPending}
          onClick={() => connect.mutate()}
        >
          {connect.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Connect
        </Button>
      </div>
    </div>
  );
}

// ── Build from collection ──────────────────────────────────────────────────
// Picks a Shopify collection + look-back window, asks the server to build
// the default test-box template (delivery-date question with auto-captured
// dates, rating + optional notes per product, overall feedback), then opens
// the builder pre-filled for editing.

function FromCollectionDialog({ onClose, onBuilt }: {
  onClose: () => void;
  onBuilt: (tpl: CollectionTemplate) => void;
}) {
  const [collectionId, setCollectionId] = useState<number | null>(null);
  const [days, setDays] = useState(30);

  const { data: collections, isLoading, error } = useQuery<CollectionOption[]>({
    queryKey: ["survey-collections"],
    queryFn: async () => jsonOrThrow(await fetch(`${BASE}/api/surveys/collections`, { credentials: "include" }), "Failed to load collections"),
  });

  const build = useMutation({
    mutationFn: async () =>
      jsonOrThrow(await fetch(
        `${BASE}/api/surveys/collection-template?collectionId=${collectionId}&days=${days}`,
        { credentials: "include" },
      ), "Failed to build the template") as Promise<CollectionTemplate>,
    onSuccess: (tpl) => {
      if (tpl.deliveryDates.length === 0) {
        toast({
          title: "No delivery dates found",
          description: `No date-tagged orders with these products in the last ${tpl.lookbackDays} days — the delivery-date question was left out.`,
        });
      }
      if (tpl.unmatchedProducts.length > 0) {
        toast({
          title: `${tpl.unmatchedProducts.length} product(s) without a matching recipe`,
          description: `${tpl.unmatchedProducts.join(", ")} — their questions have no recipe image.`,
        });
      }
      onBuilt(tpl);
    },
    onError: (e) => toast({ title: e instanceof Error ? e.message : "Failed to build the template", variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New survey from a collection</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error != null ? (
            <p className="text-sm text-destructive">Couldn't reach Shopify — try again in a minute.</p>
          ) : (
            <>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Shopify collection</p>
                <Select
                  value={collectionId == null ? "" : String(collectionId)}
                  onValueChange={(v) => setCollectionId(Number(v))}
                  disabled={isLoading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={isLoading ? "Loading collections…" : "Pick a collection"} />
                  </SelectTrigger>
                  <SelectContent>
                    {(collections ?? []).map(c => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Capture delivery dates from orders in the last…</p>
                <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="14">14 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="60">60 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                className="w-full"
                disabled={collectionId == null || build.isPending}
                onClick={() => build.mutate()}
              >
                {build.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Build survey
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Customer preview ───────────────────────────────────────────────────────
// An in-planner approximation of what the Shopify widget renders: same
// content, question order, images and controls, in a narrow customer-width
// card. Controls are interactive so the flow can be felt out, but nothing is
// ever submitted from here. (The real thing lives in the tck-theme survey
// section — this is a preview, not a pixel-perfect copy.)

interface PreviewQuestion {
  key: string;
  type: QuestionType;
  prompt: string;
  required: boolean;
  max: number;
  options: string[];
  recipe: { name: string; imageUrl: string | null } | null;
}

interface PreviewData { title: string; intro: string | null; questions: PreviewQuestion[] }

function PreviewStars({ max }: { max: number }) {
  const [value, setValue] = useState(0);
  return (
    <div className="flex gap-1">
      {Array.from({ length: max }, (_, i) => (
        <button key={i} type="button" onClick={() => setValue(i + 1)} className="p-0.5">
          <Star className={cn(
            "w-7 h-7 transition-colors",
            i < value ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40",
          )} />
        </button>
      ))}
    </div>
  );
}

function PreviewSlider() {
  const [value, setValue] = useState<number | null>(null);
  return (
    <div className="space-y-1">
      <input
        type="range" min={0} max={100} step={1}
        value={value ?? 50}
        onChange={(e) => setValue(Number(e.target.value))}
        className="w-full accent-primary"
      />
      <p className="text-sm text-muted-foreground text-right">{value == null ? "Slide to answer" : `${value}%`}</p>
    </div>
  );
}

function PreviewOptions({ options, multi }: { options: string[]; multi: boolean }) {
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (opt: string) => setSelected(prev =>
    multi
      ? (prev.includes(opt) ? prev.filter(o => o !== opt) : [...prev, opt])
      : [opt]);
  return (
    <div className="space-y-1.5">
      {options.map(opt => (
        <button
          key={opt} type="button" onClick={() => toggle(opt)}
          className={cn(
            "w-full text-left text-sm rounded-lg border px-3 py-2 transition-colors",
            selected.includes(opt) ? "border-primary bg-primary/10" : "border-border bg-background",
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function PreviewRank({ options }: { options: string[] }) {
  const [order, setOrder] = useState(options);
  const move = (idx: number, dir: -1 | 1) => setOrder(prev => {
    const target = idx + dir;
    if (target < 0 || target >= prev.length) return prev;
    const next = [...prev];
    [next[idx], next[target]] = [next[target], next[idx]];
    return next;
  });
  return (
    <div className="space-y-1.5">
      {order.map((opt, i) => (
        <div key={opt} className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm">
          <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-xs font-semibold flex items-center justify-center flex-shrink-0">
            {i + 1}
          </span>
          <span className="flex-1">{opt}</span>
          <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="p-1 disabled:opacity-30">
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button type="button" disabled={i === order.length - 1} onClick={() => move(i, 1)} className="p-1 disabled:opacity-30">
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

function PreviewQuestionCard({ q }: { q: PreviewQuestion }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      {q.recipe && (
        <div className="flex items-center gap-3">
          {q.recipe.imageUrl && (
            <img src={q.recipe.imageUrl} alt={q.recipe.name} className="w-12 h-12 rounded-lg object-cover border border-border" />
          )}
          <span className="font-semibold text-sm">{q.recipe.name}</span>
        </div>
      )}
      <p className="text-sm font-medium">
        {q.prompt || <span className="text-muted-foreground italic">(no prompt yet)</span>}
        {q.required && <span className="text-destructive ml-1">*</span>}
      </p>
      {q.type === "rating" && <PreviewStars max={q.max} />}
      {q.type === "slider" && <PreviewSlider />}
      {q.type === "choice" && <PreviewOptions options={q.options} multi={false} />}
      {q.type === "multi" && <PreviewOptions options={q.options} multi />}
      {q.type === "text" && <Textarea rows={3} placeholder="The customer types here…" />}
      {q.type === "rank" && <PreviewRank options={q.options} />}
    </div>
  );
}

function SurveyPreviewDialog({ data, onClose }: { data: PreviewData | null; onClose: () => void }) {
  if (!data) return null;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Eye className="w-4 h-4" /> Customer preview — nothing is recorded
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-center space-y-1 pb-1">
            <h2 className="text-lg font-bold">{data.title || "Untitled survey"}</h2>
            {data.intro && <p className="text-sm text-muted-foreground">{data.intro}</p>}
          </div>
          {data.questions.map(q => <PreviewQuestionCard key={q.key} q={q} />)}
          <Button
            className="w-full"
            onClick={() => toast({ title: "Preview only", description: "Nothing is recorded from the preview." })}
          >
            Send feedback
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** List-card preview: fetches the saved survey, then shows the dialog. */
function SavedSurveyPreview({ surveyId, onClose }: { surveyId: number; onClose: () => void }) {
  const { data, isLoading } = useQuery<SurveyDetail>({
    queryKey: ["survey", surveyId],
    queryFn: async () => jsonOrThrow(await fetch(`${BASE}/api/surveys/${surveyId}`, { credentials: "include" }), "Failed to load survey"),
  });
  if (isLoading || !data) return null;
  return (
    <SurveyPreviewDialog
      onClose={onClose}
      data={{
        title: data.title,
        intro: data.intro,
        questions: data.questions.map(q => ({
          key: String(q.id),
          type: q.type,
          prompt: q.prompt,
          required: q.required,
          max: q.max,
          options: q.options ?? [],
          recipe: q.recipe ? { name: q.recipe.name, imageUrl: q.recipe.imageUrl } : null,
        })),
      }}
    />
  );
}

// ── Builder ────────────────────────────────────────────────────────────────

function toDraftQuestions(questions: ServerQuestion[]): DraftQuestion[] {
  return questions.map(q => ({
    key: nextKey(),
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    // A saved prompt that still exactly matches its template counts as
    // unedited, so re-picking the recipe keeps re-templating. Anything else
    // the user wrote (or tweaked) is protected.
    promptEdited: q.prompt.trim() !== "" &&
      !(q.recipe && PROMPT_TEMPLATES[q.type](q.recipe.name) === q.prompt),
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

  /** Re-template the prompt if it hasn't been hand-written. */
  const withAutoFill = (next: DraftQuestion): DraftQuestion => {
    const nextRecipe = next.recipeId != null ? recipes.find(r => r.id === next.recipeId) : undefined;
    if (nextRecipe && (!next.promptEdited || next.prompt.trim() === "")) {
      return { ...next, prompt: PROMPT_TEMPLATES[next.type](nextRecipe.name), promptEdited: false };
    }
    return next;
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 space-y-3">
          <div className="flex flex-wrap gap-3">
            <div className="w-44">
              <Select
                value={question.type}
                onValueChange={(v) => onChange(withAutoFill({ ...question, type: v as QuestionType }))}
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
                onChange={(recipeId) => onChange(withAutoFill({ ...question, recipeId }))}
              />
            </div>
          </div>
          <Input
            value={question.prompt}
            placeholder="Question prompt, e.g. How would you rate the Mexican Chicken calzone?"
            onChange={(e) => {
              const prompt = e.target.value;
              // Typing marks the prompt as hand-written; clearing it re-arms
              // auto-fill for the next recipe/type pick.
              onChange({ ...question, prompt, promptEdited: prompt.trim() !== "" });
            }}
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
              type="number" min={RATING_MAX_MIN} max={RATING_MAX_MAX}
              className="w-16 h-8"
              value={question.max}
              onChange={(e) => {
                // Let intermediate keystrokes through (typing "10" passes
                // through 1); the blur below snaps into 2..10.
                const max = Number(e.target.value);
                if (Number.isInteger(max)) onChange({ ...question, max });
              }}
              onBlur={() => onChange({ ...question, max: clampRatingMax(question.max) })}
            />
            <span className="text-xs text-muted-foreground">max 10 — use the slider type for finer scales</span>
          </label>
        )}
        {question.type === "slider" && (
          <span className="text-xs text-muted-foreground">0–100% approval slider on the public survey</span>
        )}
      </div>
    </div>
  );
}

function BuilderView({ surveyId, initial, onBack, onSaved }: {
  surveyId: number | null; // null = creating new
  // Pre-filled draft (e.g. built from a Shopify collection). New surveys only.
  initial?: { title: string; intro: string; questions: CollectionTemplate["questions"] };
  onBack: () => void;
  onSaved: (id: number) => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [intro, setIntro] = useState(initial?.intro ?? "");
  const [questions, setQuestions] = useState<DraftQuestion[]>(() =>
    (initial?.questions ?? []).map(q => ({
      key: nextKey(),
      type: q.type,
      prompt: q.prompt,
      // Template prompts are deliberate — protect them from auto-refill.
      promptEdited: true,
      recipeId: q.recipeId,
      options: q.options ?? [],
      required: q.required,
      max: q.max,
    })));
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const [shareTarget, setShareTarget] = useState<{ id: number; title: string; shareUrl: string } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

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
          max: q.type === "rating" ? clampRatingMax(q.max) : q.max,
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
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setPreviewOpen(true)} disabled={questions.length === 0}>
            <Eye className="w-4 h-4 mr-2" /> Preview
          </Button>
          <Button onClick={() => save.mutate()} disabled={!canSave || save.isPending}>
            {save.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save survey
          </Button>
        </div>
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
          key: nextKey(), type: "rating", prompt: "", promptEdited: false, recipeId: null, options: [], required: true, max: 5,
        }])}
      >
        <Plus className="w-4 h-4 mr-2" /> Add question
      </Button>

      <ShareDialog survey={shareTarget} onClose={() => setShareTarget(null)} />

      {previewOpen && (
        <SurveyPreviewDialog
          onClose={() => setPreviewOpen(false)}
          // Built from the live draft state, so unsaved edits preview too.
          data={{
            title: title.trim(),
            intro: intro.trim() || null,
            questions: questions.map(q => {
              const recipe = q.recipeId != null ? (recipes ?? []).find(r => r.id === q.recipeId) : undefined;
              return {
                key: q.key,
                type: q.type,
                prompt: q.prompt,
                required: q.required,
                max: q.type === "rating" ? clampRatingMax(q.max) : q.max,
                options: q.options.map(o => o.trim()).filter(Boolean),
                recipe: recipe ? { name: recipe.name, imageUrl: recipe.imageUrl } : null,
              };
            }),
          }}
        />
      )}
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

      {agg.kind === "slider" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-semibold">{agg.average != null ? `${agg.average}%` : "—"}</span>
            <span className="text-sm text-muted-foreground">average approval</span>
          </div>
          {agg.average != null && (
            <div className="h-2 rounded bg-muted overflow-hidden">
              <div className="h-full bg-primary/70" style={{ width: `${agg.average}%` }} />
            </div>
          )}
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
  // Filter results to responses that answered a choice question a certain
  // way — built for the delivery-date question, so ratings can be compared
  // across delivery days (different production days = different tweaks).
  const [filter, setFilter] = useState<{ questionId: number; value: string } | null>(null);

  const { data, isLoading } = useQuery<ResultsData>({
    queryKey: ["survey-results", surveyId, filter],
    queryFn: async () => {
      const params = filter
        ? `?filterQuestionId=${filter.questionId}&filterValue=${encodeURIComponent(filter.value)}`
        : "";
      return jsonOrThrow(await fetch(`${BASE}/api/surveys/${surveyId}/results${params}`, { credentials: "include" }), "Failed to load results");
    },
  });

  if (isLoading || !data) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  const choiceQuestions = data.questions.filter(q => q.type === "choice" && (q.options?.length ?? 0) > 0);

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

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div>
          <h2 className="font-semibold">{data.title}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {filter
              ? `${data.totalResponses} of ${data.unfilteredResponses} responses (filtered)`
              : `${data.totalResponses} response${data.totalResponses === 1 ? "" : "s"}`}
          </p>
        </div>
        {choiceQuestions.length > 0 && (
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <Select
              value={filter ? `${filter.questionId}::${filter.value}` : "all"}
              onValueChange={(v) => {
                if (v === "all") { setFilter(null); return; }
                const sep = v.indexOf("::");
                setFilter({ questionId: Number(v.slice(0, sep)), value: v.slice(sep + 2) });
              }}
            >
              <SelectTrigger className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All responses</SelectItem>
                {choiceQuestions.map(q => (
                  <SelectGroup key={q.id}>
                    <SelectLabel>{q.prompt}</SelectLabel>
                    {(q.options ?? []).map(opt => (
                      <SelectItem key={opt} value={`${q.id}::${opt}`}>{opt}</SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
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

function SurveyCard({ survey, onEdit, onResults, onShare, onPreview }: {
  survey: SurveyListItem;
  onEdit: () => void;
  onResults: () => void;
  onShare: () => void;
  onPreview: () => void;
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
        <Button variant="outline" size="sm" onClick={onPreview}>
          <Eye className="w-3.5 h-3.5 mr-1.5" /> Preview
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

type View =
  | { name: "list" }
  | { name: "builder"; surveyId: number | null; initial?: { title: string; intro: string; questions: CollectionTemplate["questions"] } }
  | { name: "results"; surveyId: number };

export default function Surveys() {
  const [view, setView] = useState<View>({ name: "list" });
  const [shareTarget, setShareTarget] = useState<{ id: number; title: string; shareUrl: string } | null>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [fromCollectionOpen, setFromCollectionOpen] = useState(false);

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
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setFromCollectionOpen(true)}>
              <Boxes className="w-4 h-4 mr-2" /> From collection
            </Button>
            <Button onClick={() => setView({ name: "builder", surveyId: null })}>
              <Plus className="w-4 h-4 mr-2" /> New survey
            </Button>
          </div>
        ) : undefined}
      />

      {view.name === "builder" && (
        <BuilderView
          key={view.surveyId ?? "new"}
          surveyId={view.surveyId}
          initial={view.initial}
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
            <KlaviyoCard />
            {surveys.map(s => (
              <SurveyCard
                key={s.id}
                survey={s}
                onEdit={() => setView({ name: "builder", surveyId: s.id })}
                onResults={() => setView({ name: "results", surveyId: s.id })}
                onShare={() => setShareTarget({ id: s.id, title: s.title, shareUrl: s.shareUrl })}
                onPreview={() => setPreviewId(s.id)}
              />
            ))}
          </div>
        )
      )}

      <ShareDialog survey={shareTarget} onClose={() => setShareTarget(null)} />
      {previewId != null && (
        <SavedSurveyPreview surveyId={previewId} onClose={() => setPreviewId(null)} />
      )}
      {fromCollectionOpen && (
        <FromCollectionDialog
          onClose={() => setFromCollectionOpen(false)}
          onBuilt={(tpl) => {
            setFromCollectionOpen(false);
            setView({ name: "builder", surveyId: null, initial: { title: tpl.title, intro: tpl.intro, questions: tpl.questions } });
          }}
        />
      )}
    </div>
  );
}
