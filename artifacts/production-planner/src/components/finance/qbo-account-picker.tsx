/**
 * Add a "What is this item?" category by searching every QuickBooks account
 * (Graeme, 26 Nov 2026: "I can't remember what the account's called… I just
 * need it to pre-populate when I start typing in 'entertainment'"). The list
 * narrows with each letter; tapping an account adds it to the categories
 * with QuickBooks' exact name — only the chosen ones join the dropdown. A
 * hidden category is shown again instead. If QuickBooks can't be read, the
 * name can still be typed by hand. Objective I.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FINANCE_CATEGORIES_KEY, useFinanceCategories, type FinanceCategory } from "@/components/finance/category-select";
import { searchQboAccounts, type AccountChoice, type QboPickerAccount } from "@/lib/qbo-account-search";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type AccountsResponse = { connected: boolean; accounts: QboPickerAccount[]; reason?: string };

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(`${BASE}${url}`, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Couldn't add the category");
  return data as { category: FinanceCategory };
}

export function QboAccountPicker({ onAdded, onCancel, size = "sm", autoFocus = true, className }: {
  /** The category added (or shown again). */
  onAdded: (c: FinanceCategory) => void;
  onCancel?: () => void;
  size?: "sm" | "lg";
  autoFocus?: boolean;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const accounts = useQuery<AccountsResponse>({
    queryKey: ["/api/finance/categories/qbo-accounts"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/finance/categories/qbo-accounts`, { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? "Couldn't read QuickBooks");
      return body as AccountsResponse;
    },
    staleTime: 10 * 60_000,
  });
  const categories = useFinanceCategories(true);
  const choices = useMemo(
    () => searchQboAccounts(accounts.data?.accounts ?? [], categories.data ?? [], q),
    [accounts.data, categories.data, q],
  );
  const pick = useMutation({
    mutationFn: (a: AccountChoice | { name: string; category: null }) =>
      a.category ? send(`/api/finance/categories/${a.category.id}`, "PATCH", { hidden: false }) : send("/api/finance/categories", "POST", { name: a.name }),
    onSuccess: async ({ category }) => {
      await queryClient.invalidateQueries({ queryKey: FINANCE_CATEGORIES_KEY });
      setQ("");
      onAdded(category);
    },
  });

  const offline = accounts.data && !accounts.data.connected;
  const failed = accounts.isError || offline;
  const lg = size === "lg";

  return (
    <div className={cn("w-full space-y-2", className)}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            autoFocus={autoFocus}
            value={q}
            onChange={e => { setQ(e.target.value); pick.reset(); }}
            onKeyDown={e => {
              if (e.key === "Escape") onCancel?.();
              if (e.key === "Enter") {
                e.preventDefault();
                if (failed && q.trim()) pick.mutate({ name: q, category: null });
                else if (choices[0] && !(choices[0].category && !choices[0].category.hidden)) pick.mutate(choices[0]);
              }
            }}
            placeholder={failed ? "Its QuickBooks account name, exactly" : "Search QuickBooks accounts, e.g. entertainment"}
            aria-label="Search QuickBooks accounts"
            className={cn("w-full rounded-xl border-2 border-primary bg-background pl-9 pr-3 font-semibold focus:outline-none", lg ? "h-14 text-lg" : "h-11 text-sm")}
          />
        </div>
        {failed && (
          <button type="button" disabled={!q.trim() || pick.isPending} onClick={() => pick.mutate({ name: q, category: null })}
            className="h-11 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">
            {pick.isPending ? "Adding…" : "Add"}
          </button>
        )}
        {onCancel && (
          <button type="button" onClick={onCancel} aria-label="Cancel adding a category"
            className="h-11 px-3 rounded-lg border text-sm font-semibold flex items-center gap-1"><X className="h-4 w-4" /> Cancel</button>
        )}
      </div>

      {accounts.isLoading && <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Reading QuickBooks accounts…</p>}
      {failed && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {offline ? accounts.data!.reason ?? "QuickBooks isn't connected" : "Couldn't read QuickBooks"} — type the account name exactly as it is in QuickBooks.
        </p>
      )}
      {!failed && accounts.data && (
        choices.length === 0
          ? <p className="text-sm text-muted-foreground px-1">No QuickBooks account matches &ldquo;{q}&rdquo;.</p>
          : (
            <ul className="max-h-72 overflow-y-auto rounded-xl border border-border divide-y divide-border bg-background">
              {choices.map(a => {
                const inList = a.category != null && !a.category.hidden;
                return (
                  <li key={a.id}>
                    <button type="button" disabled={inList || pick.isPending} onClick={() => pick.mutate(a)}
                      className="w-full text-left min-h-[48px] px-3 py-2 flex items-center gap-3 hover:bg-secondary disabled:hover:bg-transparent disabled:cursor-default">
                      <span className="flex-1 min-w-0">
                        <span className={cn("block font-semibold break-words", lg ? "text-base" : "text-sm", inList && "text-muted-foreground")}>{a.name}</span>
                        <span className="block text-xs text-muted-foreground break-words">{[a.parent, a.type].filter(Boolean).join(" · ")}</span>
                      </span>
                      {inList
                        ? <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0"><Check className="h-3.5 w-3.5" /> In your list</span>
                        : <span className="text-xs font-semibold text-primary flex items-center gap-1 shrink-0">
                            {pick.isPending && pick.variables && "id" in pick.variables && pick.variables.id === a.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Plus className="h-3.5 w-3.5" />}
                            {a.category?.hidden ? "Show again" : "Add"}
                          </span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )
      )}
      {pick.isError && <p className="text-xs text-destructive">{(pick.error as Error).message}</p>}
    </div>
  );
}
