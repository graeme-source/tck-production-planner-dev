import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { invoiceMoney, money, ukDate, type ReadInvoice } from "@/pages/finance-invoice-drop";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ListChecks, Loader2 } from "lucide-react";

// What an invoice can do next (Graeme, 4 Nov 2026). "I think it's this one"
// only ever means a strong match: same amount, same supplier, close date.
// If the amount or supplier is off, the first thing anyone sees is "Transaction
// doesn't match" and the problem, with the rest behind More info. One invoice
// can also cover several card charges, so they can be ticked together.

export type Suggestion = {
  lineId: number;
  lineDate: string;
  supplier: string;
  descriptor: string;
  amount: string;
  cardLast4: string | null;
  cardholder: string | null;
  posted: boolean;
  strength: "weak" | "medium" | "strong" | "very_strong";
  reasons: string[];
  mismatches: string[];
  doubts: string[];
  evidence: { amount: boolean; supplier: boolean; date: boolean; reference: boolean };
};

export type InvoiceMatches = { suggestions: Suggestion[]; confident: boolean; addsUp: number[] | null };

const pence = (v: string | number) => Math.round(Number(v) * 100);
const sumOf = (lines: Suggestion[]) => lines.reduce((sum, l) => sum + pence(l.amount), 0) / 100;

function chargeDetails(s: Suggestion) {
  return `${money(s.amount)} on ${ukDate(s.lineDate)}${s.cardLast4 ? ` · card ${s.cardLast4}` : ""}${s.cardholder ? ` · ${s.cardholder}` : ""}${s.posted ? " · posted in QuickBooks" : ""}`;
}

function MoreInfoButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} aria-expanded={open}>
      {open ? <ChevronDown className="h-4 w-4 mr-1" /> : <ChevronRight className="h-4 w-4 mr-1" />}
      {open ? "Less info" : "More info"}
    </Button>
  );
}

/** Hard to miss on purpose: read every time, before anything is attached. */
function DoesntMatchWarning({ issues, children }: { issues: string[]; children?: ReactNode }) {
  return (
    <div role="alert" className="rounded-xl border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/30 p-4 flex items-start gap-3">
      <AlertTriangle className="h-6 w-6 mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="text-lg font-bold">Transaction doesn't match</div>
        {issues.map((issue) => <div key={issue} className="text-base font-medium break-words">{issue}</div>)}
        {children && <div className="pt-2">{children}</div>}
      </div>
    </div>
  );
}

function NothingYet({ invoice }: { invoice: ReadInvoice }) {
  return (
    <div className="rounded-xl border p-4">
      <div className="font-semibold">No transaction yet</div>
      <div className="text-sm text-muted-foreground">
        Nothing here for {invoice.totalAmount ? invoiceMoney(invoice.totalAmount, invoice.currency) : "this invoice"}. It stays in the queue and attaches itself when the charge comes in.
      </div>
    </div>
  );
}

function SuggestionBox({ s, heading, busy, onAttach }: { s: Suggestion; heading: string; busy: boolean; onAttach: () => void }) {
  return (
    <div className="rounded-xl border border-primary/50 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{heading}</div>
        <div className="text-base font-semibold break-words">{s.supplier}</div>
        <div className="text-sm break-words">{chargeDetails(s)}</div>
        {s.reasons.length > 0 && <div className="text-xs text-muted-foreground mt-1">{s.reasons.join(" · ")}</div>}
        {s.doubts.length > 0 && (
          <div className="text-sm font-medium text-amber-700 dark:text-amber-400 mt-1 flex items-start gap-1.5">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {s.doubts.join(" · ")}
          </div>
        )}
      </div>
      <Button size="lg" onClick={onAttach} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
        Yes, attach
      </Button>
    </div>
  );
}

/** Several charges that come to the invoice total exactly. */
function AddsUpBox({ invoice, lines, busy, onAttach }: { invoice: ReadInvoice; lines: Suggestion[]; busy: boolean; onAttach: () => void }) {
  return (
    <div className="rounded-xl border border-primary/50 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">These {lines.length} charges add up to {money(invoice.totalAmount)}</div>
        <ul className="mt-1 space-y-0.5">
          {lines.map((l) => <li key={l.lineId} className="text-sm break-words">{chargeDetails(l)}</li>)}
        </ul>
      </div>
      <Button size="lg" onClick={onAttach} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
        Yes, attach to all {lines.length}
      </Button>
    </div>
  );
}

function ChooseCharges({ invoice, lines, busy, onAttach }: { invoice: ReadInvoice; lines: Suggestion[]; busy: boolean; onAttach: (lines: Suggestion[]) => void }) {
  const [ticked, setTicked] = useState<number[]>([]);
  const chosen = lines.filter((l) => ticked.includes(l.lineId));
  const total = sumOf(chosen);
  // Charges are in pounds, so a foreign invoice has no total to sum them to.
  const invoiceTotal = invoice.totalAmount && (invoice.currency ?? "GBP").toUpperCase() === "GBP" ? Number(invoice.totalAmount) : null;
  const gap = invoiceTotal === null ? 0 : (pence(total) - pence(invoiceTotal)) / 100;
  const exact = gap === 0;
  const issues = [
    ...(exact ? [] : [`Amount is ${money(Math.abs(gap).toFixed(2))} ${gap > 0 ? "more" : "less"} than the invoice`]),
    ...chosen.filter((l) => !l.evidence.supplier).map((l) => `Supplier is different: ${l.supplier}`),
  ];

  return (
    <div className="rounded-xl border divide-y">
      {lines.map((l) => (
        <label key={l.lineId} className="flex items-center gap-3 p-3 cursor-pointer hover:bg-secondary/40">
          <Checkbox
            checked={ticked.includes(l.lineId)}
            onCheckedChange={(on) => setTicked((all) => (on ? [...all, l.lineId] : all.filter((id) => id !== l.lineId)))}
          />
          <span className="min-w-0">
            <span className="block font-medium break-words">{l.supplier}</span>
            <span className="block text-sm text-muted-foreground break-words">{chargeDetails(l)}</span>
          </span>
        </label>
      ))}
      {chosen.length > 0 && (
        <div className="p-3 space-y-3">
          {issues.length > 0 && <DoesntMatchWarning issues={issues} />}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 min-w-0 text-sm">
              <span className="font-semibold">{money(total.toFixed(2))} ticked</span>
              {invoiceTotal !== null && <span> of {money(invoice.totalAmount)}</span>}
            </div>
            <Button variant={issues.length === 0 ? "default" : "outline"} onClick={() => onAttach(chosen)} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {issues.length === 0 ? "Attach" : "Attach anyway"} to {chosen.length === 1 ? "this transaction" : `these ${chosen.length}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function MatchOptions({ invoice, matches, busy, onAttach, onReject }: {
  invoice: ReadInvoice;
  matches: InvoiceMatches;
  busy: boolean;
  onAttach: (lines: Suggestion[]) => void;
  onReject: (lineId: number) => void;
}) {
  const [more, setMore] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const { suggestions, confident, addsUp } = matches;
  const [top] = suggestions;
  const together = (addsUp ?? []).flatMap((id) => suggestions.filter((s) => s.lineId === id));
  const addsUpToIt = together.length > 1;
  const matched = !!top && top.mismatches.length === 0;
  const moreButton = <MoreInfoButton open={more} onClick={() => setMore((v) => !v)} />;
  const chooseButton = (
    <Button variant="outline" size="sm" onClick={() => setChoosing((v) => !v)} aria-expanded={choosing}>
      <ListChecks className="h-4 w-4 mr-1" /> {choosing ? "Hide transactions" : `Choose transactions (${suggestions.length})`}
    </Button>
  );

  return (
    <div className="space-y-3">
      {matched && <SuggestionBox s={top} heading={confident ? "I think it's this one" : "Same amount, check it's right"} busy={busy} onAttach={() => onAttach([top])} />}
      {!top && <NothingYet invoice={invoice} />}
      {addsUpToIt && <AddsUpBox invoice={invoice} lines={together} busy={busy} onAttach={() => onAttach(together)} />}
      {top && !matched && !addsUpToIt && <DoesntMatchWarning issues={top.mismatches}>{moreButton}</DoesntMatchWarning>}

      {matched && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onReject(top.lineId)}>Not this one</Button>
          {!confident && chooseButton}
        </div>
      )}
      {top && !matched && addsUpToIt && moreButton}

      {top && !matched && more && (
        <div className="rounded-xl border p-4 space-y-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Closest transaction</div>
            <div className="font-semibold break-words">{top.supplier}</div>
            <div className="text-sm break-words">{chargeDetails(top)}</div>
            {top.reasons.length > 0 && <div className="text-xs text-muted-foreground mt-1">{top.reasons.join(" · ")}</div>}
            {top.doubts.length > 0 && <div className="text-xs text-muted-foreground">{top.doubts.join(" · ")}</div>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onAttach([top])}>Attach anyway</Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onReject(top.lineId)}>Not this one</Button>
            {chooseButton}
          </div>
          <p className="text-sm text-muted-foreground">If you leave it, it stays in the queue and attaches itself when the right charge comes in.</p>
        </div>
      )}
      {choosing && <ChooseCharges invoice={invoice} lines={suggestions} busy={busy} onAttach={onAttach} />}
    </div>
  );
}
