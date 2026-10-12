/**
 * The lists behind the employment record, editable in place (autosaved):
 *   • Classifications — label, which extra field sets it switches on, on/off
 *     (founder, or an admin with People access)
 *   • Stages — label, warning expiry in months, on/off (same)
 *   • Letter templates — wording, on/off (founder only)
 *   • Who letter emails come from — display name, sending name on the
 *     verified domain, replies-to (founder only)
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2, Plus } from "lucide-react";
import {
  FIELD_SETS, FIELD_SET_LABEL, sortClassifications, sortStages, type Classification, type Stage, type LetterTemplate,
} from "@workspace/people-reviews";
import { toast } from "@/hooks/use-toast";
import { peopleFetch, peopleRetry } from "@/hooks/use-people-gate";
import { AutoText, AutoChoice, AutoChecklist } from "./review-fields";
import { recordSend, useLetterTemplates, letterTemplatesKey } from "./reviews-api";
import { useLetterIdentity } from "./letter-editor";

function Fold({ title, children, initiallyOpen = false }: { title: string; children: React.ReactNode; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <section className="rounded-3xl border-2 border-border bg-card">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full min-h-16 px-4 flex items-center gap-3 text-left">
        {open ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
        <span className="text-lg font-bold">{title}</span>
      </button>
      {open && <div className="px-4 pb-4 space-y-4">{children}</div>}
    </section>
  );
}

export function RecordSettings({ canEditLists }: { canEditLists: boolean }) {
  const qc = useQueryClient();
  const lists = useQuery<{ classifications: Classification[]; stages: Stage[]; canEdit: boolean }>({
    queryKey: ["people-record-entries", "lists"],
    queryFn: () => peopleFetch("/people-reviews/lists"),
    retry: peopleRetry,
  });
  const templates = useLetterTemplates(true);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["people-record-entries"] });
  };
  const isFounder = templates.data?.canEdit ?? false;

  if (lists.isLoading) return <Loader2 className="w-6 h-6 animate-spin" />;
  return (
    <div className="space-y-4">
      {isFounder && <EmailIdentity />}
      {canEditLists && lists.data && (
        <Fold title="Classifications">
          {sortClassifications(lists.data.classifications).map(c => <ClassificationRow key={c.id} c={c} onSaved={refresh} />)}
          <AddClassification onAdded={refresh} />
        </Fold>
      )}
      {canEditLists && lists.data && (
        <Fold title="Stages & warning expiry">
          {sortStages(lists.data.stages).map(s => <StageRow key={s.id} s={s} onSaved={refresh} />)}
        </Fold>
      )}
      {isFounder && templates.data && (
        <Fold title="Letter templates">
          <p className="text-base text-muted-foreground">
            Merge fields fill in from the entry: {templates.data.mergeFields.map(f => `{${f.key}}`).join(" ")}
          </p>
          {templates.data.templates.map(t => (
            <TemplateRow key={t.id} t={t} onSaved={() => void qc.invalidateQueries({ queryKey: letterTemplatesKey })} />
          ))}
        </Fold>
      )}
      {!canEditLists && !isFounder && <p className="text-base text-muted-foreground">Only Graeme, or an admin with People access, can change these lists.</p>}
    </div>
  );
}

function EmailIdentity() {
  const q = useLetterIdentity(true);
  const full = useQuery<{
    settings: { fromName: string | null; fromLocal: string | null; replyTo: string | null } | null;
    identity: { line: string; fromEmail: string };
    leadTimes: { probationDays: number; reviewDays: number; warningDays: number };
  }>({
    queryKey: ["people-record-entries", "hr-settings"],
    queryFn: () => peopleFetch("/people-reviews/hr-settings"),
    retry: peopleRetry,
  });
  const qc = useQueryClient();
  const save = async (patch: Record<string, string | number | null>) => {
    await recordSend("PATCH", "/hr-settings", patch);
    void qc.invalidateQueries({ queryKey: ["people-record-entries", "hr-settings"] });
  };
  const s = full.data?.settings;
  if (!full.data) return null;
  const domain = full.data.identity.fromEmail.split("@")[1];
  return (
    <Fold title="HR settings — letter emails and lead times" initiallyOpen>
      <AutoText label="Display name" initial={s?.fromName ?? ""} placeholder="The Calzone Kitchen HR" maxLength={80}
        onSave={v => save({ fromName: v || null })} />
      <AutoText label={`Sending address (before @${domain})`} initial={s?.fromLocal ?? ""} placeholder="hr" maxLength={64}
        onSave={v => save({ fromLocal: v || null })} />
      <AutoText label="Replies go to" initial={s?.replyTo ?? ""} placeholder="Graeme's email" maxLength={254}
        onSave={v => save({ replyTo: v || null })} />
      <p className="text-base font-semibold">{q.data?.identity.line ?? full.data.identity.line}</p>
      <p className="text-sm text-muted-foreground">Emails only ever say a letter is waiting in the app — the letter itself is never attached.</p>
      <p className="text-lg font-bold pt-2">Needs attention — how far ahead to flag</p>
      <div className="grid gap-4 sm:grid-cols-3">
        {([["probationDays", "Probation ending (days)"], ["reviewDays", "Review period ending (days)"], ["warningDays", "Warning expiring (days)"]] as const).map(([k, label]) => (
          <AutoText key={k} label={label} initial={String(full.data!.leadTimes[k])} maxLength={2}
            onSave={async v => {
              const n = Number(v);
              if (!Number.isInteger(n) || n < 1 || n > 90) throw new Error("A whole number of days, 1–90");
              await save({ [k]: n });
            }} />
        ))}
      </div>
    </Fold>
  );
}

function ClassificationRow({ c, onSaved }: { c: Classification; onSaved: () => void }) {
  const save = async (p: Partial<Classification>) => { await recordSend("PATCH", `/classifications/${c.id}`, p); onSaved(); };
  return (
    <div className="rounded-2xl border-2 border-border p-3 space-y-3">
      <AutoText label="Name" initial={c.label} maxLength={80} onSave={v => save({ label: v })} />
      <AutoChecklist label="Extra fields it shows" items={FIELD_SETS.map(f => ({ key: f, label: FIELD_SET_LABEL[f] }))}
        initial={c.fieldSets} onSave={keys => save({ fieldSets: keys as Classification["fieldSets"] })} />
      <AutoChoice label="In the list?" value={c.active ? "yes" : "no"} columns={2}
        options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No — hidden" }]}
        onSave={v => save({ active: v === "yes" })} />
    </div>
  );
}

function AddClassification({ onAdded }: { onAdded: () => void }) {
  const [label, setLabel] = useState("");
  return (
    <div className="flex gap-2">
      <input value={label} onChange={e => setLabel(e.target.value)} placeholder="New classification" maxLength={80}
        className="flex-1 min-w-0 h-14 rounded-2xl border-2 border-border bg-card px-4 text-lg" />
      <button type="button" disabled={!label.trim()}
        onClick={async () => {
          try { await recordSend("POST", "/classifications", { label, fieldSets: [] }); setLabel(""); onAdded(); }
          catch (e) { toast({ title: "Couldn't add it", description: e instanceof Error ? e.message : "Try again", variant: "destructive" }); }
        }}
        className="h-14 px-4 rounded-2xl bg-primary text-primary-foreground font-bold flex items-center gap-2 disabled:opacity-50">
        <Plus className="w-5 h-5" /> Add
      </button>
    </div>
  );
}

function StageRow({ s, onSaved }: { s: Stage; onSaved: () => void }) {
  const save = async (p: Partial<Stage>) => { await recordSend("PATCH", `/stages/${s.id}`, p); onSaved(); };
  return (
    <div className="rounded-2xl border-2 border-border p-3 space-y-3">
      <AutoText label="Stage" initial={s.label} maxLength={80} onSave={v => save({ label: v })} />
      {s.type === "warning" && (
        <AutoText label="Live for (months)" initial={String(s.defaultExpiryMonths ?? 12)} maxLength={2}
          onSave={async v => {
            const n = Number(v);
            if (!Number.isInteger(n) || n < 1 || n > 60) throw new Error("A whole number of months, 1–60");
            await save({ defaultExpiryMonths: n });
          }} />
      )}
    </div>
  );
}

function TemplateRow({ t, onSaved }: { t: LetterTemplate; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const save = async (p: Partial<LetterTemplate>) => { await recordSend("PATCH", `/letter-templates/${t.id}`, p); onSaved(); };
  return (
    <div className="rounded-2xl border-2 border-border">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full min-h-14 px-4 flex items-center gap-2 text-left text-lg font-bold">
        {open ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />} {t.title}{!t.active && " (off)"}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3">
          <AutoText label="Title" initial={t.title} maxLength={200} onSave={v => save({ title: v })} />
          <AutoText label="Wording" initial={t.body} rows={16} onSave={v => save({ body: v })} />
        </div>
      )}
    </div>
  );
}
