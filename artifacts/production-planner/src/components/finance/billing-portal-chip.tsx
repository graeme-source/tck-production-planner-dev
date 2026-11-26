/**
 * The supplier's billing portal on the collapsed transaction (Graeme, 26 Nov
 * 2026: "this is Vonage, and therefore I can just click on that URL so that it
 * just takes me straight to where I can get the invoice from"). None set:
 * a "Billing portal URL" button opens a box right there to paste it in, so
 * they can be filled in one after another without opening each transaction.
 * Saves to the supplier, so every transaction of theirs gets it. Objective I.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Link2, Loader2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cleanLink } from "@/lib/supplier-name-suggest";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function BillingPortalChip({ vendorId, vendorName, portalUrl }: { vendorId: number; vendorName: string; portalUrl: string | null }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const link = draft.trim() ? cleanLink(draft) : null;
  const save = useMutation({
    mutationFn: async (url: string) => {
      const r = await fetch(`${BASE}/api/finance/vendors/${vendorId}`, {
        method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portalUrl: url, invoiceBehaviour: "portal" }),
      });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't save");
    },
    onSuccess: () => {
      toast({ title: `Billing portal saved for ${vendorName}` });
      setEditing(false); setDraft("");
      queryClient.invalidateQueries({ queryKey: ["/api/finance/lines"] });
    },
    onError: (e: Error) => toast({ title: "Couldn't save the link", description: e.message, variant: "destructive" }),
  });

  if (portalUrl) {
    return (
      <a href={portalUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-primary/10 text-primary text-sm font-semibold hover:bg-primary/20 shrink-0"
        title={`${vendorName}'s billing portal: ${portalUrl}`}>
        <ExternalLink className="h-4 w-4" /> Billing portal
      </a>
    );
  }
  if (!editing) {
    return (
      <button type="button" onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-dashed text-sm text-muted-foreground hover:bg-secondary shrink-0">
        <Link2 className="h-4 w-4" /> Billing portal URL
      </button>
    );
  }
  return (
    <form className="flex items-center gap-1.5 w-full" onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => { e.preventDefault(); if (link) save.mutate(link); }}>
      <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") { setEditing(false); setDraft(""); } }}
        placeholder={`${vendorName}'s billing portal link`} aria-label={`${vendorName}'s billing portal link`}
        className="h-9 flex-1 min-w-0 rounded-lg border-2 border-primary bg-background px-2 text-sm" />
      <button type="submit" disabled={!link || save.isPending} aria-label="Save the link"
        className="h-9 w-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-50">
        {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      </button>
      <button type="button" aria-label="Cancel" onClick={() => { setEditing(false); setDraft(""); }}
        className="h-9 w-9 rounded-lg border flex items-center justify-center"><X className="h-4 w-4" /></button>
    </form>
  );
}
