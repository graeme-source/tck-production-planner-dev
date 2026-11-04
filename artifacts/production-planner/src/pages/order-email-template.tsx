import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { SaveChip } from "@/components/save-chip";
import { Switch } from "@/components/ui/switch";
import { ORDER_EMAIL_QUERY_KEY, useOrderEmailTemplate } from "@/hooks/use-order-email-template";
import { useAutosave } from "@/hooks/use-autosave";
import { DEFAULT_ORDER_EMAIL_TEMPLATE, ORDER_EMAIL_FIELDS, ORDER_EMAIL_SETTING_KEY, type OrderEmailTemplate } from "@/lib/order-email-template";
import { buildOrderMessage, orderEmailSubject } from "@/lib/order-line-text";
import { Loader2, RotateCcw } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// The wording of the order sent to suppliers (Graeme, 2026-11-04). Saves as
// you type. Managers and admins can change it.

const SAMPLE_LINES = [
  { ingredientName: "Plain Flour", supplierPartNumber: "F123", unit: "kg", packWeight: 16, costPerPack: 12.5, editedPacks: 2 },
  { ingredientName: "Tomato Passata", supplierPartNumber: null, unit: "kg", packWeight: 2.5, costPerPack: 3.2, editedPacks: 6 },
];
const SAMPLE = { contactName: "James", accountNumber: "TCK1234" };

export default function OrderEmailTemplatePage() {
  const saved = useOrderEmailTemplate();
  if (!saved.data) {
    return <div className="p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Loading…</div>;
  }
  return <Editor initial={saved.data} />;
}

function Editor({ initial }: { initial: OrderEmailTemplate }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(initial);
  const bodyBox = useRef<HTMLTextAreaElement>(null);
  const auto = useAutosave(async (value: OrderEmailTemplate) => {
    const res = await fetch(`${BASE}/api/app-settings/${ORDER_EMAIL_SETTING_KEY}`, {
      method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: JSON.stringify(value) }),
    });
    if (!res.ok) throw new Error(res.status === 403 ? "Only managers and admins can change this" : "Couldn't save");
    queryClient.setQueryData(ORDER_EMAIL_QUERY_KEY, value);
  });
  const change = (patch: Partial<OrderEmailTemplate>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    auto.schedule(next);
  };
  const insert = (key: string) => {
    const box = bodyBox.current;
    const at = box?.selectionStart ?? draft.body.length;
    change({ body: `${draft.body.slice(0, at)}{${key}}${draft.body.slice(box?.selectionEnd ?? at)}` });
    box?.focus();
  };
  const extras = { template: draft, ...SAMPLE };
  const preview = useMemo(() => ({
    subject: orderEmailSubject("Brakes Food Service", "Tue 10 Nov", extras),
    body: buildOrderMessage("Brakes Food Service", SAMPLE_LINES, "Tue 10 Nov", extras),
  }), [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const box = "w-full rounded-xl border-2 border-border bg-card px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-primary/40";
  const toggles: Array<{ key: "showPartNumber" | "showPackSize" | "showPrice"; label: string }> = [
    { key: "showPartNumber", label: "Supplier's part number" },
    { key: "showPackSize", label: "Pack size" },
    { key: "showPrice", label: "Price per pack" },
  ];

  return (
    <div className="p-4 md:p-6 space-y-5">
      <PageHeader title="Order email template" description="The wording of the orders sent to suppliers by email, WhatsApp and Copy order." />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <div className="rounded-2xl border-2 border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold">Wording</h2>
              <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />
            </div>
            <label className="block space-y-1">
              <span className="text-sm font-semibold">Subject</span>
              <input value={draft.subject} onChange={e => change({ subject: e.target.value })} onBlur={() => void auto.flush()} className={box} />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-semibold">Message</span>
              <textarea ref={bodyBox} value={draft.body} rows={11} onChange={e => change({ body: e.target.value })} onBlur={() => void auto.flush()} className={box} />
            </label>
            <div className="space-y-2">
              <p className="text-sm font-semibold">Add to the message</p>
              <div className="flex flex-wrap gap-2">
                {ORDER_EMAIL_FIELDS.map(f => (
                  <button key={f.key} type="button" onClick={() => insert(f.key)}
                    className="min-h-[44px] px-3 rounded-lg border-2 border-border text-sm font-medium hover:bg-secondary">
                    {f.label}
                  </button>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">Words in curly brackets are filled in for each order. A line is left out if there's nothing to put in it.</p>
            </div>
          </div>
          <div className="rounded-2xl border-2 border-border bg-card p-4 space-y-3">
            <h2 className="text-lg font-bold">On each item</h2>
            {toggles.map(t => (
              <label key={t.key} className="flex items-center gap-3 min-h-[44px] cursor-pointer">
                <Switch checked={draft[t.key]} onCheckedChange={v => { change({ [t.key]: v }); }} />
                <span className="text-base">{t.label}</span>
              </label>
            ))}
          </div>
          <button type="button" onClick={() => change(DEFAULT_ORDER_EMAIL_TEMPLATE)}
            className="min-h-[44px] px-4 rounded-lg border-2 border-border text-sm font-semibold inline-flex items-center gap-2 hover:bg-secondary">
            <RotateCcw className="w-4 h-4" /> Back to the standard wording
          </button>
        </div>
        <div className="rounded-2xl border-2 border-border bg-card p-4 space-y-3 self-start">
          <h2 className="text-lg font-bold">How it will look</h2>
          <p className="text-sm font-semibold break-words">{preview.subject}</p>
          <pre className="whitespace-pre-wrap break-words font-sans text-base">{preview.body}</pre>
        </div>
      </div>
    </div>
  );
}
