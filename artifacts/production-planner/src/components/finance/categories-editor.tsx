/**
 * Finance → Admin → "What is this item?" categories (Graeme, 18 Nov 2026).
 * Name each one EXACTLY as its QuickBooks account so the bookkeeper posts to
 * the account it says. Keep the list short: only the ones in use. A hidden
 * category leaves the dropdown; anything already set to it keeps it.
 * Renames save when you leave the box.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Loader2, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { FINANCE_CATEGORIES_KEY, useFinanceCategories, type FinanceCategory } from "@/components/finance/category-select";
import { QboAccountPicker } from "@/components/finance/qbo-account-picker";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(`${BASE}${url}`, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Couldn't save that");
  return data;
}

function Row({ c }: { c: FinanceCategory }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState(c.name);
  const save = useMutation({
    mutationFn: (patch: { name?: string; hidden?: boolean }) => send(`/api/finance/categories/${c.id}`, "PATCH", patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: FINANCE_CATEGORIES_KEY }),
    onError: (e: Error) => { setName(c.name); toast({ title: "Couldn't save the category", description: e.message, variant: "destructive" }); },
  });
  return (
    <div className={cn("flex items-center gap-2 flex-wrap", c.hidden && "opacity-60")}>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => { if (name.trim() && name !== c.name) save.mutate({ name }); else setName(c.name); }}
        aria-label={`Category name: ${c.name}`}
        className="h-10 flex-1 min-w-[14rem]"
      />
      <Button type="button" size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate({ hidden: !c.hidden })}>
        {c.hidden ? <><Eye className="h-4 w-4 mr-1" /> Show</> : <><EyeOff className="h-4 w-4 mr-1" /> Hide</>}
      </Button>
      <span className="text-xs text-muted-foreground w-20">
        {save.isPending ? "Saving…" : save.isError ? "Not saved" : save.isSuccess ? "Saved" : c.hidden ? "Hidden" : ""}
      </span>
    </div>
  );
}

export function CategoriesEditor() {
  const all = useFinanceCategories(true);
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium flex items-center gap-2"><Tags className="h-4 w-4" /> "What is this item?" categories</div>
      <p className="text-xs text-muted-foreground">
        Asked on every invoice upload and shown on every invoice and transaction. Each is a QuickBooks account, with its exact name. Keep it to the ones in use.
      </p>
      {all.isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        : all.isError ? <p className="text-sm text-destructive">{(all.error as Error).message}</p>
        : <div className="space-y-2">{(all.data ?? []).map(c => <Row key={`${c.id}-${c.name}-${c.hidden}`} c={c} />)}</div>}
      <div className="space-y-1 pt-1">
        <div className="text-xs font-semibold text-muted-foreground">Add one from QuickBooks</div>
        <QboAccountPicker autoFocus={false} onAdded={() => {}} />
      </div>
    </div>
  );
}
