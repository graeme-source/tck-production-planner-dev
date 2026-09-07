/**
 * "My Contract" — the Employee Hub section where somebody reads the
 * employment contract the founder issued to them, prints it, and
 * acknowledges it.
 *
 * Privacy posture (the 2026-09-04 to-do leak rule): the server's /mine
 * endpoint takes no user parameter — it can only ever answer for the
 * session — and every query here is ALSO keyed by the signed-in user's id,
 * so on a shared iPad a PIN switch can never show a frame of the previous
 * person's contract.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "@/hooks/use-toast";
import { printContract } from "@/components/contract-print";
import { Check, ChevronRight, FileSignature, Loader2, Printer, X } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface MyContract {
  id: number;
  body: string;
  jobTitle: string;
  startDate: string;
  issueDate: string;
  issuedAt: string;
  acknowledgedAt: string | null;
}

async function jsonOrThrow(res: Response) {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data;
}

function ContractSheet({ contract, meId, onClose }: { contract: MyContract; meId: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const ackMut = useMutation({
    mutationFn: () => fetch(`${BASE}/api/contracts/${contract.id}/acknowledge`, {
      method: "POST", credentials: "include",
    }).then(jsonOrThrow),
    onSuccess: () => {
      setConfirming(false);
      queryClient.invalidateQueries({ queryKey: ["contracts", "mine", meId] });
      toast({ title: "Contract acknowledged", description: "Thanks — your acknowledgement has been recorded." });
    },
    onError: (e: Error) => toast({ title: "Not recorded", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-border flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Your employment contract</h2>
            <p className="text-sm text-muted-foreground">Issued {contract.issueDate} · starts {contract.startDate}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => printContract("My employment contract", contract.body)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-secondary/50"
            >
              <Printer className="w-4 h-4" /> Print / PDF
            </button>
            <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-secondary/50">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto p-6 flex-1">
          <pre className="whitespace-pre-wrap font-serif text-[15px] leading-relaxed">{contract.body}</pre>
        </div>
        <div className="p-4 border-t border-border">
          {contract.acknowledgedAt ? (
            <p className="flex items-center justify-center gap-2 text-emerald-700 dark:text-emerald-300 font-semibold">
              <Check className="w-5 h-5" /> Acknowledged on {new Date(contract.acknowledgedAt).toLocaleDateString("en-GB")}
            </p>
          ) : confirming ? (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm font-medium">Confirm you have read this contract and agree to it?</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirming(false)} className="px-4 h-11 rounded-xl border border-border font-medium hover:bg-secondary/50">
                  Not yet
                </button>
                <button
                  onClick={() => ackMut.mutate()}
                  disabled={ackMut.isPending}
                  className="px-5 h-11 rounded-xl bg-primary text-primary-foreground font-bold flex items-center gap-2 disabled:opacity-50"
                >
                  {ackMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Yes — I agree
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="w-full h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.99] transition-all"
            >
              <Check className="w-5 h-5" /> I have read and agree to this contract
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function MyContractSection() {
  const { state } = useAuth();
  const meId = state.status === "authenticated" ? state.user.id : null;
  const [openId, setOpenId] = useState<number | null>(null);

  const { data, isLoading } = useQuery<MyContract[]>({
    // Keyed by user id — shared station iPads swap people by PIN all day,
    // and a cache entry keyed the same for everyone is exactly how the
    // to-do leak happened (2026-09-04).
    queryKey: ["contracts", "mine", meId],
    queryFn: () => fetch(`${BASE}/api/contracts/mine`, { credentials: "include" }).then(jsonOrThrow),
    enabled: meId !== null,
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  const contracts = data ?? [];
  if (contracts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No contract has been issued to you in the app yet.
      </p>
    );
  }

  const open = openId != null ? contracts.find(c => c.id === openId) ?? null : null;

  return (
    <div className="space-y-3">
      {contracts.map(c => (
        <button
          key={c.id}
          onClick={() => setOpenId(c.id)}
          className="w-full text-left bg-card border border-border rounded-2xl p-4 flex items-center gap-4 hover:bg-secondary/30 transition-colors"
        >
          <FileSignature className="w-8 h-8 text-primary flex-shrink-0" />
          <span className="flex-1 min-w-0">
            <span className="block font-semibold text-base">{c.jobTitle}</span>
            <span className="block text-sm text-muted-foreground">Issued {c.issueDate} · starts {c.startDate}</span>
          </span>
          {c.acknowledgedAt ? (
            <span className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
              <Check className="w-3.5 h-3.5" /> Acknowledged
            </span>
          ) : (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              Please read &amp; acknowledge
            </span>
          )}
          <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        </button>
      ))}
      {open && meId != null && <ContractSheet contract={open} meId={meId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
