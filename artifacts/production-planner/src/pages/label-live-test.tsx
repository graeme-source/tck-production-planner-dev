import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Loader2, Printer, Copy, Check, AlertTriangle, Tag } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Label LIVE URL-scheme test harness ────────────────────────────────
// Proves two things before we build the real wrapping-station button:
//   1. Whether <b> tags inside a VARIABLE VALUE render as bold in a
//      Label LIVE design (they render when pasted; docs don't confirm
//      the variable path).
//   2. That the end-to-end link works: live deck from our API → RJSON
//      variables → labellive:// URL → Label LIVE print preview.
//
// Setup on the printing PC (one-time):
//   • In Label LIVE create a design with a text box containing
//     {DECK} and, on a second line, {MAY_CONTAIN} (create both under
//     Data → + first). Save it and PIN it to the Home screen.
//   • Enter the design's exact name below.
// Both buttons use printer=Preview so no paper is used.

type DeckResponse = {
  recipeName: string;
  deckText: string;
  mayContainStatement: string | null;
  isComplete: boolean;
  missingDeclarations: string[];
};

/** Escaping rules from Label LIVE's RJSON docs: single quotes inside a
 *  value become \' and ampersands become \& (the & would otherwise be
 *  read as a URL-option separator). */
function rjsonEscape(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/&/g, "\\&");
}

/** Our deck marks allergens as **X**; Label LIVE bolds <b>X</b>. */
function toLabelLiveBold(deckText: string): string {
  return deckText.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
}

function buildPrintUrl(designName: string, vars: Record<string, string>): string {
  const pairs = Object.entries(vars)
    .map(([k, v]) => `${k}:'${rjsonEscape(v)}'`)
    .join(",");
  // encodeURIComponent keeps ' literal (RJSON needs it) and percent-encodes
  // spaces/angle brackets, which Label LIVE decodes as standard URL parts.
  return `labellive://print?design=${encodeURIComponent(designName)}&variables=${encodeURIComponent(pairs)}&printer=Preview&window=show&copies=1`;
}

const MARGHERITA_RECIPE_ID = 1;

export default function LabelLiveTest() {
  const [designName, setDesignName] = useState(() => localStorage.getItem("labellive_test_design") ?? "tck-deck-test");
  useEffect(() => { localStorage.setItem("labellive_test_design", designName); }, [designName]);
  const [copied, setCopied] = useState<string | null>(null);

  const { data: deck, isLoading, error } = useQuery<DeckResponse>({
    queryKey: ["ingredient-deck", MARGHERITA_RECIPE_ID],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/recipes/${MARGHERITA_RECIPE_ID}/ingredient-deck`, { credentials: "include" });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      return d;
    },
  });

  const boldTestUrl = useMemo(
    () => buildPrintUrl(designName, {
      DECK: "Bold test: plain, <b>THIS SHOULD BE BOLD</b>, plain again. Apostrophe: O'Brien. Ampersand: Chicken & Chorizo.",
      MAY_CONTAIN: "May contain test line.",
    }),
    [designName],
  );

  const margheritaUrl = useMemo(() => {
    if (!deck) return null;
    return buildPrintUrl(designName, {
      DECK: toLabelLiveBold(deck.deckText),
      MAY_CONTAIN: deck.mayContainStatement ?? "",
    });
  }, [deck, designName]);

  const copyUrl = (url: string, key: string) => {
    navigator.clipboard.writeText(url);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="Label LIVE Test"
        description="Run these on the printing PC with Label LIVE installed. Both open a print PREVIEW — no paper used."
      />

      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <label className="text-sm font-semibold">Label LIVE design name</label>
        <input
          value={designName}
          onChange={e => setDesignName(e.target.value)}
          className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background font-mono"
          placeholder="tck-deck-test"
        />
        <p className="text-xs text-muted-foreground leading-relaxed">
          One-time setup in Label LIVE on this PC: create a design → Data tab → add variables
          <code className="mx-1 px-1 bg-secondary rounded">DECK</code> and
          <code className="mx-1 px-1 bg-secondary rounded">MAY_CONTAIN</code> → add a text box containing
          <code className="mx-1 px-1 bg-secondary rounded">{"{DECK}"}</code> and
          <code className="mx-1 px-1 bg-secondary rounded">{"{MAY_CONTAIN}"}</code> →
          save with the name above → <strong>pin it to the Home screen</strong> (required for the link to find it).
        </p>
      </div>

      {/* Test 1 — bold rendering */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h3 className="font-semibold flex items-center gap-2"><Tag className="w-4 h-4 text-primary" /> Test 1 — Does bold render inside a variable?</h3>
        <p className="text-sm text-muted-foreground">
          Opens Label LIVE with a short test sentence. In the preview, check: is
          &ldquo;THIS SHOULD BE BOLD&rdquo; actually bold? Do the apostrophe and ampersand come through intact?
        </p>
        <div className="flex items-center gap-2">
          <a
            href={boldTestUrl}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90"
          >
            <Printer className="w-4 h-4" /> Run bold test
          </a>
          <button
            onClick={() => copyUrl(boldTestUrl, "bold")}
            className="inline-flex items-center gap-1.5 px-3 py-2.5 border border-border rounded-xl text-xs text-muted-foreground hover:text-foreground"
          >
            {copied === "bold" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} Copy link
          </button>
        </div>
      </div>

      {/* Test 2 — live Margherita deck */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h3 className="font-semibold flex items-center gap-2"><Tag className="w-4 h-4 text-primary" /> Test 2 — Live Margherita deck</h3>
        {isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading live deck…</div>}
        {error != null && <p className="text-sm text-destructive">Failed to load deck: {(error as Error).message}</p>}
        {deck && (
          <>
            <div className="bg-secondary/20 rounded-lg p-3 border border-border">
              <p className="text-xs font-semibold text-muted-foreground mb-1">This exact text (live from the recipe) goes into the label:</p>
              <p className="text-sm leading-relaxed" dangerouslySetInnerHTML={{
                __html: deck.deckText
                  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
                  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>"),
              }} />
              {deck.mayContainStatement && (
                <p className="text-xs text-muted-foreground mt-2">{deck.mayContainStatement}</p>
              )}
            </div>
            {!deck.isComplete && (
              <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                Heads up: this deck has missing declarations ({deck.missingDeclarations.join(", ")}) — the real
                print button will refuse to print in this state. Fine for a rendering test.
              </p>
            )}
            <div className="flex items-center gap-2">
              <a
                href={margheritaUrl ?? "#"}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90"
              >
                <Printer className="w-4 h-4" /> Send Margherita deck to Label LIVE
              </a>
              <button
                onClick={() => margheritaUrl && copyUrl(margheritaUrl, "marg")}
                className="inline-flex items-center gap-1.5 px-3 py-2.5 border border-border rounded-xl text-xs text-muted-foreground hover:text-foreground"
              >
                {copied === "marg" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} Copy link
              </button>
            </div>
          </>
        )}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        How this works: the buttons are ordinary links that start with <code className="px-1 bg-secondary rounded">labellive://</code>.
        Your computer routes them to the Label LIVE app on this machine — like a mailto: link opening your email —
        carrying the deck text inside the link. Nothing is stored in Label LIVE; the deck is fetched live from the
        recipe at the moment you click. The first click will ask &ldquo;Open Label LIVE?&rdquo; — tick always allow.
      </p>
    </div>
  );
}
