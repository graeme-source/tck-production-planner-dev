/**
 * Starter forms — fill and sign the HMRC starter checklist, payroll details
 * and health questionnaire in-app (Graeme, 2026-09-07).
 *
 * Everything renders from the server's definitions (one source of truth);
 * drafts autosave with a visible state; signing needs typed initials and
 * freezes the submission with an archival PDF, exactly like the contract.
 *
 * Privacy: queries are keyed by the signed-in user's id (the 2026-09-04
 * to-do leak rule) and the endpoints are owner-scoped server-side.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ContractPaper } from "@/components/contract-view";
import { Check, ChevronRight, ClipboardList, FileDown, Loader2, PenLine, X } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Mirrors api-server/src/lib/starter-forms.ts types (served as JSON).
type Field =
  | { kind: "text"; key: string; label: string; required?: boolean; help?: string; inputMode?: "numeric" }
  | { kind: "date"; key: string; label: string; required?: boolean; help?: string }
  | { kind: "textarea"; key: string; label: string; required?: boolean; help?: string }
  | { kind: "radio"; key: string; label: string; required?: boolean; help?: string; options: { value: string; label: string; help?: string }[] }
  | { kind: "checkboxes"; key: string; label: string; help?: string; options: { value: string; label: string; help?: string }[] }
  | { kind: "yesno_detail"; key: string; label: string; required?: boolean }
  | { kind: "info"; key: string; text: string };

interface Section { title: string; description?: string; fields: Field[]; showWhen?: { key: string; equals: string[] } }
export interface StarterFormDef { type: string; title: string; description: string; sections: Section[] }

type Answers = Record<string, string | string[]>;

interface Submission {
  id: number;
  formType: string;
  answers: Answers;
  body: string | null;
  signedAt: string | null;
  signedInitials: string | null;
}

async function jsonOrThrow(res: Response) {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data;
}

export function useStarterForms(meId: number | null) {
  const defs = useQuery<StarterFormDef[]>({
    queryKey: ["starter-forms", "definitions"],
    queryFn: () => fetch(`${BASE}/api/starter-forms/definitions`, { credentials: "include" }).then(jsonOrThrow),
    staleTime: 10 * 60_000,
    enabled: meId !== null,
  });
  const mine = useQuery<Submission[]>({
    queryKey: ["starter-forms", "mine", meId],
    queryFn: () => fetch(`${BASE}/api/starter-forms/mine`, { credentials: "include" }).then(jsonOrThrow),
    enabled: meId !== null,
  });
  return { defs: defs.data ?? [], mine: mine.data ?? [], isLoading: defs.isLoading || mine.isLoading };
}

function sectionActive(section: Section, answers: Answers): boolean {
  if (!section.showWhen) return true;
  const v = answers[section.showWhen.key];
  return typeof v === "string" && section.showWhen.equals.includes(v);
}

// ── One form: fill + sign ──────────────────────────────────────────────────

function FormSheet({ def, submission, meId, onClose }: {
  def: StarterFormDef;
  submission: Submission | null;
  meId: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const signed = submission?.signedAt != null;
  const [answers, setAnswers] = useState<Answers>(submission?.answers ?? {});
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [confirming, setConfirming] = useState(false);
  const [initials, setInitials] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const answersRef = useRef(answers);
  answersRef.current = answers;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["starter-forms", "mine", meId] });

  const draftMut = useMutation({
    mutationFn: (a: Answers) => fetch(`${BASE}/api/starter-forms/mine/${def.type}`, {
      method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: a }),
    }).then(jsonOrThrow),
    onSuccess: () => setSaveState("saved"),
    onError: () => setSaveState("error"),
  });

  const signMut = useMutation({
    mutationFn: () => fetch(`${BASE}/api/starter-forms/mine/${def.type}/sign`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initials: initials.trim(), answers: answersRef.current }),
    }).then(jsonOrThrow),
    onSuccess: () => {
      setConfirming(false);
      invalidate();
      toast({ title: `${def.title} signed`, description: "Saved as a permanent record with your initials and the date." });
    },
    onError: (e: Error) => toast({ title: "Not signed", description: e.message, variant: "destructive" }),
  });

  function setAnswer(key: string, value: string | string[]) {
    setAnswers(prev => {
      const next = { ...prev, [key]: value };
      setSaveState("dirty");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { setSaveState("saving"); draftMut.mutate(next); }, 1200);
      return next;
    });
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const chip =
    saveState === "saving" ? { text: "Saving…", cls: "text-muted-foreground" } :
    saveState === "dirty" ? { text: "Unsaved…", cls: "text-muted-foreground" } :
    saveState === "saved" ? { text: "Draft saved", cls: "text-emerald-600 dark:text-emerald-400" } :
    saveState === "error" ? { text: "Couldn't save — check connection", cls: "text-destructive" } :
    { text: "", cls: "" };

  const inputCls = "w-full px-3 py-2.5 bg-background border border-border rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-primary/30";

  function renderField(field: Field) {
    if (field.kind === "info") {
      return <p key={field.key} className="text-sm text-muted-foreground">{field.text}</p>;
    }
    const label = (
      <span className="text-sm font-medium block mb-1">
        {field.label}
        {"required" in field && field.required && <span className="text-destructive"> *</span>}
      </span>
    );
    const help = "help" in field && field.help
      ? <p className="text-xs text-muted-foreground mt-1 whitespace-pre-line">{field.help}</p>
      : null;

    if (field.kind === "text" || field.kind === "date") {
      return (
        <label key={field.key} className="block">
          {label}
          <input
            type={field.kind === "date" ? "date" : "text"}
            inputMode={"inputMode" in field ? field.inputMode : undefined}
            value={typeof answers[field.key] === "string" ? (answers[field.key] as string) : ""}
            onChange={e => setAnswer(field.key, e.target.value)}
            className={inputCls}
          />
          {help}
        </label>
      );
    }
    if (field.kind === "textarea") {
      return (
        <label key={field.key} className="block">
          {label}
          <textarea
            value={typeof answers[field.key] === "string" ? (answers[field.key] as string) : ""}
            onChange={e => setAnswer(field.key, e.target.value)}
            rows={3}
            className={inputCls}
          />
          {help}
        </label>
      );
    }
    if (field.kind === "radio") {
      return (
        <div key={field.key}>
          {label}
          <div className="space-y-2">
            {field.options.map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => setAnswer(field.key, o.value)}
                className={cn(
                  "w-full text-left px-4 py-3 rounded-xl border-2 transition-colors",
                  answers[field.key] === o.value ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/40",
                )}
              >
                <span className="text-base font-medium">{o.label}</span>
                {o.help && <span className="block text-xs text-muted-foreground mt-0.5">{o.help}</span>}
              </button>
            ))}
          </div>
          {help}
        </div>
      );
    }
    if (field.kind === "checkboxes") {
      const current = Array.isArray(answers[field.key]) ? (answers[field.key] as string[]) : [];
      return (
        <div key={field.key}>
          {label}
          <div className="space-y-2">
            {field.options.map(o => {
              const on = current.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setAnswer(field.key, on ? current.filter(v => v !== o.value) : [...current, o.value])}
                  className={cn(
                    "w-full text-left px-4 py-3 rounded-xl border-2 flex items-center gap-3 transition-colors",
                    on ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/40",
                  )}
                >
                  <span className={cn("w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0", on ? "bg-primary border-primary text-primary-foreground" : "border-border")}>
                    {on && <Check className="w-3.5 h-3.5" />}
                  </span>
                  <span className="text-base">{o.label}</span>
                </button>
              );
            })}
          </div>
          {help}
        </div>
      );
    }
    // yesno_detail
    const v = answers[field.key];
    return (
      <div key={field.key} className="border border-border rounded-xl p-3">
        {label}
        <div className="flex gap-2 mt-1">
          {(["yes", "no"] as const).map(o => (
            <button
              key={o}
              type="button"
              onClick={() => setAnswer(field.key, o)}
              className={cn(
                "px-6 py-2 rounded-lg border-2 font-semibold transition-colors",
                v === o ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/40",
              )}
            >
              {o === "yes" ? "Yes" : "No"}
            </button>
          ))}
        </div>
        {v === "yes" && (
          <label className="block mt-2">
            <span className="text-xs font-medium text-muted-foreground block mb-1">Details</span>
            <textarea
              value={typeof answers[`${field.key}_detail`] === "string" ? (answers[`${field.key}_detail`] as string) : ""}
              onChange={e => setAnswer(`${field.key}_detail`, e.target.value)}
              rows={2}
              className={inputCls}
            />
          </label>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl max-w-2xl w-full max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-border flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold truncate">{def.title}</h2>
            {!signed && <span className={cn("text-xs font-medium", chip.cls)} aria-live="polite">{chip.text || "Autosaves as you go"}</span>}
          </div>
          <div className="flex items-center gap-2">
            {signed && submission && (
              <a
                href={`${BASE}/api/starter-forms/submission/${submission.id}/signed.pdf`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-secondary/50"
              >
                <FileDown className="w-4 h-4" /> Signed PDF
              </a>
            )}
            <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-secondary/50">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-4 sm:p-6 bg-secondary/30">
          {signed && submission?.body ? (
            <ContractPaper body={submission.body} />
          ) : (
            <div className="space-y-6">
              <p className="text-sm text-muted-foreground">{def.description}</p>
              {def.sections.filter(s => sectionActive(s, answers)).map(section => (
                <section key={section.title} className="bg-card border border-border rounded-2xl p-4 sm:p-5 space-y-4">
                  <div>
                    <h3 className="font-semibold text-base">{section.title}</h3>
                    {section.description && <p className="text-sm text-muted-foreground mt-1">{section.description}</p>}
                  </div>
                  {section.fields.map(renderField)}
                </section>
              ))}
            </div>
          )}
        </div>

        {!signed && (
          <div className="p-4 border-t border-border">
            {confirming ? (
              <div className="space-y-3">
                <p className="text-sm font-medium">
                  Type your initials to sign. They'll be written onto the form with today's date, as your record and ours.
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  <input
                    value={initials}
                    onChange={e => setInitials(e.target.value)}
                    placeholder="e.g. JS"
                    maxLength={12}
                    autoFocus
                    className="w-32 h-12 px-3 rounded-xl border-2 border-primary bg-background text-xl font-bold tracking-widest text-center uppercase focus:outline-none"
                  />
                  <div className="flex gap-2 ml-auto">
                    <button onClick={() => { setConfirming(false); setInitials(""); }} className="px-4 h-12 rounded-xl border border-border font-medium hover:bg-secondary/50">
                      Not yet
                    </button>
                    <button
                      onClick={() => signMut.mutate()}
                      disabled={signMut.isPending || initials.trim().length < 2}
                      className="px-5 h-12 rounded-xl bg-primary text-primary-foreground font-bold flex items-center gap-2 disabled:opacity-50"
                    >
                      {signMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenLine className="w-4 h-4" />}
                      Sign form
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                className="w-full h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.99] transition-all"
              >
                <PenLine className="w-5 h-5" /> Check it over — then sign
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── The list of three ──────────────────────────────────────────────────────

export function StarterFormsList() {
  const { state } = useAuth();
  const meId = state.status === "authenticated" ? state.user.id : null;
  const { defs, mine, isLoading } = useStarterForms(meId);
  const [openType, setOpenType] = useState<string | null>(null);

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  const openDef = openType != null ? defs.find(d => d.type === openType) ?? null : null;
  const subFor = (type: string) => mine.find(m => m.formType === type) ?? null;

  return (
    <div className="space-y-3">
      {defs.map(def => {
        const sub = subFor(def.type);
        const signed = sub?.signedAt != null;
        const started = sub != null && !signed && Object.keys(sub.answers ?? {}).length > 0;
        return (
          <button
            key={def.type}
            onClick={() => setOpenType(def.type)}
            className="w-full text-left bg-card border border-border rounded-2xl p-4 flex items-center gap-4 hover:bg-secondary/30 transition-colors"
          >
            <ClipboardList className="w-8 h-8 text-primary flex-shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="block font-semibold text-base">{def.title}</span>
              <span className="block text-sm text-muted-foreground truncate">{def.description}</span>
            </span>
            {signed ? (
              <span className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                <Check className="w-3.5 h-3.5" /> Signed
              </span>
            ) : (
              <span className={cn(
                "text-xs font-semibold px-2.5 py-1 rounded-full",
                started ? "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300" : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
              )}>
                {started ? "Draft — carry on" : "Please fill in & sign"}
              </span>
            )}
            <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          </button>
        );
      })}
      {openDef && meId != null && (
        <FormSheet
          key={`${openDef.type}-${subFor(openDef.type)?.signedAt ?? "draft"}`}
          def={openDef}
          submission={subFor(openDef.type)}
          meId={meId}
          onClose={() => setOpenType(null)}
        />
      )}
    </div>
  );
}
