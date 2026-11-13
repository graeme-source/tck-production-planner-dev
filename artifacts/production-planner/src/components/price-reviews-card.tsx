import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ExternalLink, Loader2 } from "lucide-react";

// Inventory → Price changes to review (Graeme, 13 Nov 2026): recent
// invoices, matched to their deliveries, whose price per pack isn't ours.
// One tap updates our price (so orders and recipe costs follow), or leaves
// it. Shows nothing when there's nothing to review. Objective F.

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const KEY = ["/api/price-reviews"];

interface PriceReview {
  invoiceLineId: number;
  ingredientId: number;
  ingredientName: string;
  supplierName: string;
  invoiceId: number;
  invoiceNumber: string | null;
  invoiceDate: string;
  lineDescription: string;
  ourCostPerPack: number;
  invoiceCostPerPack: number;
  packLabel: string;
  secondary: boolean;
}

const gbp = (n: number) => n.toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 4 : 2 });
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function PriceReviewsCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const q = useQuery<PriceReview[]>({
    queryKey: KEY,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/price-reviews`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 60_000,
  });
  const decide = useMutation({
    mutationFn: async (body: { invoiceLineId: number; decision: "updated" | "dismissed" }) => {
      const r = await fetch(`${BASE}/api/price-reviews`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    },
    onSuccess: (_d, v) => {
      toast({ title: v.decision === "updated" ? "Price updated" : "Left as it is" });
      queryClient.invalidateQueries({ queryKey: KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/ingredients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-pricing"] });
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });

  const rows = q.data ?? [];
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold">Prices to check ({rows.length})</h2>
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {rows.map((r) => {
          const up = r.invoiceCostPerPack > r.ourCostPerPack;
          const pct = r.ourCostPerPack > 0 ? Math.round((r.invoiceCostPerPack / r.ourCostPerPack - 1) * 100) : null;
          const busy = decide.isPending && decide.variables?.invoiceLineId === r.invoiceLineId;
          return (
            <Card key={r.invoiceLineId}>
              <CardContent className="p-4 space-y-3">
                <div>
                  <div className="font-semibold break-words">{r.ingredientName}</div>
                  <div className="text-sm text-muted-foreground">{r.supplierName} · per {r.packLabel}</div>
                </div>
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="text-muted-foreground line-through tabular-nums">{r.ourCostPerPack > 0 ? gbp(r.ourCostPerPack) : "no price"}</span>
                  <span className="text-2xl font-bold tabular-nums">{gbp(r.invoiceCostPerPack)}</span>
                  {pct != null && <span className={up ? "text-amber-700 font-semibold" : "text-emerald-700 font-semibold"}>{up ? "+" : ""}{pct}%</span>}
                </div>
                <a href={`${BASE}/api/finance/invoices/${r.invoiceId}/file`} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
                  Invoice {r.invoiceNumber ?? ""} · {day(r.invoiceDate)} <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <div className="flex gap-2 flex-wrap">
                  <Button disabled={busy} onClick={() => decide.mutate({ invoiceLineId: r.invoiceLineId, decision: "updated" })}>
                    {busy && decide.variables?.decision === "updated" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null} Use {gbp(r.invoiceCostPerPack)}
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => decide.mutate({ invoiceLineId: r.invoiceLineId, decision: "dismissed" })}>Keep ours</Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
