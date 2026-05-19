import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from "react";
import { Link } from "wouter";
import { PageHeader } from "@/components/page-header";
import { Loader2, Plus, Trash2, RefreshCw, ChevronLeft, Tag, Scale, Save, Search, Pencil, X as XIcon, Mail, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

// ──────────────────────────────────────────────────────────────────────────────
// Label Stock Check tool
// ──────────────────────────────────────────────────────────────────────────────
// One page that does the whole job:
//   1. Editable global settings (empty-roll weight, label weight, default order qty)
//   2. Stock-check table — one row per real recipe (auto-populated from DPT)
//      plus any miscellaneous entries the user has added.
//   3. Live "Order qty" column powered by the backend water-fill rebalance.
//
// Single-source-of-truth: the backend recomputes everything on each call.
// The frontend just stages num_rolls + total_weight in local state, then
// posts each row's check to /recipes/:id/check.
// ──────────────────────────────────────────────────────────────────────────────

interface Settings {
  emptyRollWeight: number;
  labelWeight: number;
  defaultOrderQty: number;
  labelSpec: string;
  orderingEmail: string;
}

interface LatestCheck {
  id: number;
  numRolls: number;
  totalWeightG: string;
  emptyRollWeightGUsed: string;
  labelWeightGUsed: string;
  computedCount: number;
  checkedAt: string;
  userId: number | null;
}

interface LabelRecipeRow {
  id: number;
  kind: "real" | "misc";
  recipeId: number | null;
  recipeName: string;
  recipeColor: string | null;
  recipeCategory: string | null;
  miscName: string | null;
  miscDptPct: number | null;
  mappedRecipeId: number | null;
  mappedRecipeName: string | null;
  planningWeight: number;
  effectiveDptPct: number;
  currentStock: number | null;
  latestCheck: LatestCheck | null;
  notes: string | null;
}

interface OrderItem {
  id: number;
  recipeName: string;
  planningWeight: number;
  currentStock: number;
  hasStockCheck: boolean;
  orderQty: number;
  targetStock: number;
}

export default function LabelStockCheckPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rows, setRows] = useState<LabelRecipeRow[] | null>(null);
  const [totalToOrder, setTotalToOrder] = useState<number | null>(null);
  const [orderResult, setOrderResult] = useState<OrderItem[] | null>(null);
  const [orderPending, setOrderPending] = useState(false);
  // Stages per-row inputs (numRolls + totalWeightG) until the user saves.
  const [drafts, setDrafts] = useState<Record<number, { numRolls: string; totalWeightG: string; saving?: boolean }>>({});
  const [addMiscOpen, setAddMiscOpen] = useState(false);
  const [addFromMenuOpen, setAddFromMenuOpen] = useState(false);
  // Tracks the row whose DPT override is currently being edited inline.
  const [editingOverrideId, setEditingOverrideId] = useState<number | null>(null);
  const [overrideDraft, setOverrideDraft] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sendingOrder, setSendingOrder] = useState(false);

  // ── Initial load ────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    try {
      const [sRes, rRes] = await Promise.all([
        fetch("/api/label-stock/settings", { credentials: "include" }).then(r => r.json()),
        fetch("/api/label-stock/", { credentials: "include" }).then(r => r.json()),
      ]);
      setSettings(sRes);
      setRows(rRes.items ?? []);
      // Seed totalToOrder from the default if not yet set.
      setTotalToOrder(prev => prev ?? sRes.defaultOrderQty ?? 30000);
    } catch (err) {
      toast({ title: "Failed to load", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Order calculation (debounced on totalToOrder change) ────────────────────
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const calculateOrder = useCallback(async (qty: number) => {
    setOrderPending(true);
    try {
      const res = await fetch("/api/label-stock/calculate-order", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totalToOrder: qty }),
      });
      const data = await res.json();
      setOrderResult(data.items ?? []);
    } catch (err) {
      toast({ title: "Order calc failed", description: String(err), variant: "destructive" });
    } finally {
      setOrderPending(false);
    }
  }, []);

  useEffect(() => {
    if (totalToOrder == null || rows == null) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => calculateOrder(totalToOrder), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [totalToOrder, rows, calculateOrder]);

  const orderById = useMemo(() => {
    const map = new Map<number, OrderItem>();
    for (const o of orderResult ?? []) map.set(o.id, o);
    return map;
  }, [orderResult]);

  // ── Settings save ───────────────────────────────────────────────────────────
  const saveSettings = async (patch: Partial<Settings>) => {
    if (!settings) return;
    setSavingSettings(true);
    try {
      const res = await fetch("/api/label-stock/settings", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      setSettings(prev => prev ? { ...prev, ...patch } : prev);
    } catch (err) {
      toast({ title: "Couldn't save settings", description: String(err), variant: "destructive" });
    } finally {
      setSavingSettings(false);
    }
  };

  // ── Send order email ────────────────────────────────────────────────────────
  // POSTs the current `orderResult` items (only those with orderQty > 0) to
  // the backend, which assembles the email using the saved labelSpec as the
  // body intro and the orderingEmail as the recipient.
  const sendOrderEmail = useCallback(async () => {
    if (!orderResult || !settings) return;
    const items = orderResult
      .filter(o => o.orderQty > 0)
      .map(o => ({ recipeName: o.recipeName, orderQty: o.orderQty }));
    if (items.length === 0) {
      toast({ title: "Nothing to send", description: "No order quantities are above zero.", variant: "destructive" });
      return;
    }
    if (!settings.orderingEmail.trim()) {
      toast({ title: "Set an ordering email first", description: "Fill in the Ordering email field above.", variant: "destructive" });
      return;
    }
    if (!confirm(`Send this label order to ${settings.orderingEmail}?`)) return;
    setSendingOrder(true);
    try {
      const res = await fetch("/api/label-stock/send-order", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Send failed");
      toast({ title: "Order email sent", description: `${data.itemCount} lines to ${data.to}` });
    } catch (err) {
      toast({ title: "Couldn't send", description: String(err), variant: "destructive" });
    } finally {
      setSendingOrder(false);
    }
  }, [orderResult, settings]);

  // ── Per-row stock check save ────────────────────────────────────────────────
  // `silent` skips the success toast — used by auto-save-on-blur so the
  // operator doesn't get a barrage of toasts as they tab through rows.
  const saveCheck = useCallback(async (rowId: number, opts: { silent?: boolean } = {}) => {
    const draft = drafts[rowId];
    if (!draft) return;
    const numRolls = parseInt(draft.numRolls);
    const totalWeightG = parseFloat(draft.totalWeightG);
    if (!Number.isFinite(numRolls) || numRolls < 0) {
      toast({ title: "Bad number of rolls", description: "Must be a non-negative whole number.", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(totalWeightG) || totalWeightG < 0) {
      toast({ title: "Bad total weight", description: "Must be a non-negative number.", variant: "destructive" });
      return;
    }
    setDrafts(d => ({ ...d, [rowId]: { ...d[rowId], saving: true } }));
    try {
      const res = await fetch(`/api/label-stock/recipes/${rowId}/check`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numRolls, totalWeightG }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      if (!opts.silent) toast({ title: "Stock check saved" });
      // Clear draft and refetch so the row picks up the new computed count.
      setDrafts(d => { const nd = { ...d }; delete nd[rowId]; return nd; });
      await fetchAll();
    } catch (err) {
      toast({ title: "Couldn't save", description: String(err), variant: "destructive" });
      setDrafts(d => ({ ...d, [rowId]: { ...d[rowId], saving: false } }));
    }
  }, [drafts, fetchAll]);

  // Auto-save on blur when both fields are filled-in. Compares against the
  // last-saved values to skip no-op posts (e.g. the user tabs through
  // without changing anything).
  const autoSaveIfReady = useCallback((rowId: number, row: LabelRecipeRow) => {
    const draft = drafts[rowId];
    if (!draft || draft.saving) return;
    const numRolls = parseInt(draft.numRolls);
    const totalWeightG = parseFloat(draft.totalWeightG);
    if (!Number.isFinite(numRolls) || numRolls < 0) return;
    if (!Number.isFinite(totalWeightG) || totalWeightG < 0) return;
    // No-op if the draft matches the last saved values.
    const lastRolls = row.latestCheck?.numRolls;
    const lastWeight = row.latestCheck?.totalWeightG;
    if (lastRolls === numRolls && lastWeight != null && Number(lastWeight) === totalWeightG) {
      // Clear draft so the save icon hides.
      setDrafts(d => { const nd = { ...d }; delete nd[rowId]; return nd; });
      return;
    }
    saveCheck(rowId, { silent: true });
  }, [drafts, saveCheck]);

  // ── Save inline DPT % override (works for real + misc rows) ─────────────────
  const saveOverride = async (rowId: number, rawValue: string) => {
    const pct = rawValue.trim() === "" ? null : parseFloat(rawValue);
    if (pct !== null && (!Number.isFinite(pct) || pct < 0)) {
      toast({ title: "DPT % must be a non-negative number (or blank)", variant: "destructive" });
      return;
    }
    try {
      await fetch(`/api/label-stock/recipes/${rowId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ miscDptPct: pct }),
      });
      setEditingOverrideId(null);
      setOverrideDraft("");
      await fetchAll();
    } catch (err) {
      toast({ title: "Couldn't save override", description: String(err), variant: "destructive" });
    }
  };

  // ── Delete misc row ─────────────────────────────────────────────────────────
  const deleteRow = async (rowId: number) => {
    if (!confirm("Remove this recipe from the calculator? (If it has an active DPT it'll auto-reappear on next refresh.)")) return;
    try {
      await fetch(`/api/label-stock/recipes/${rowId}`, { method: "DELETE", credentials: "include" });
      toast({ title: "Removed" });
      await fetchAll();
    } catch (err) {
      toast({ title: "Couldn't remove", description: String(err), variant: "destructive" });
    }
  };

  if (loading || !settings || !rows) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
      </div>
    );
  }

  const summaryTotal = (orderResult ?? []).reduce((s, o) => s + o.orderQty, 0);
  // Sum of final stocks (current + ordered) across all rows — denominator for
  // the "Final %" column so the operator can compare it side-by-side with the
  // DPT % column and visually confirm the rebalance is on target.
  const finalStockSum = (orderResult ?? []).reduce((s, o) => s + o.currentStock + o.orderQty, 0);

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Label Stock Check"
        description="Weigh label rolls to estimate stock and rebalance your label order to DPT planning weights."
      />

      <div className="flex items-center justify-between">
        <Link href="/inventory/tools" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="w-4 h-4" /> Back to Tools
        </Link>
        <button
          onClick={() => fetchAll()}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          title="Refresh from server"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* ── Settings strip ────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="font-semibold text-lg flex items-center gap-2 mb-3">
          <Scale className="w-5 h-5 text-blue-500" />
          Global Settings
          {savingSettings && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          These apply to every recipe. Stock checks snapshot the values at the time so historical counts stay stable if you recalibrate later.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SettingsNumberInput
            label="Empty roll weight"
            unit="g"
            step={0.001}
            value={settings.emptyRollWeight}
            onCommit={v => saveSettings({ emptyRollWeight: v })}
            hint="Weight of one empty cardboard roll (3 dp)."
          />
          <SettingsNumberInput
            label="Weight per label"
            unit="g"
            step={0.0001}
            value={settings.labelWeight}
            onCommit={v => saveSettings({ labelWeight: v })}
            hint="Weight of a single printed label (4 dp)."
          />
          <SettingsNumberInput
            label="Default order quantity"
            unit="labels"
            step={1}
            value={settings.defaultOrderQty}
            onCommit={v => saveSettings({ defaultOrderQty: Math.round(v) })}
            hint="Used as the starting point for the rebalance."
          />
        </div>

        {/* Email-the-order settings — spec text appears in the email body
            above the recipe/quantity list, and orderingEmail is the supplier
            address the email gets sent to. Both are saved on blur. */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_18rem] gap-4 mt-5 pt-5 border-t border-border">
          <SettingsTextArea
            label="Label specification (email body)"
            value={settings.labelSpec}
            onCommit={v => saveSettings({ labelSpec: v })}
            placeholder="Paste the supplier-facing spec / body copy here — e.g. label dimensions, paper, finish, lead time…"
            hint="Goes into the order email above the recipe + quantity list."
          />
          <SettingsTextInput
            label="Ordering email"
            value={settings.orderingEmail}
            onCommit={v => saveSettings({ orderingEmail: v })}
            placeholder="orders@supplier.com"
            hint="Recipient when you press Send order email."
            icon={<Mail className="w-3.5 h-3.5" />}
          />
        </div>
      </div>

      {/* ── Order summary + total input ───────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-3">
          <div>
            <h2 className="font-semibold text-lg flex items-center gap-2">
              <Tag className="w-5 h-5 text-blue-500" />
              Order quantities
              {orderPending && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            </h2>
            <p className="text-sm text-muted-foreground">
              Edit the total to rebalance — the table below updates live.
            </p>
          </div>
          <div className="flex items-end gap-3">
            <label className="block">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Total to order</span>
              <input
                type="number"
                min={0}
                step={100}
                value={totalToOrder ?? ""}
                onChange={e => {
                  const v = parseInt(e.target.value);
                  setTotalToOrder(Number.isFinite(v) ? v : 0);
                }}
                className="block w-40 px-3 py-2 text-lg font-bold tabular-nums bg-background border border-border rounded-lg"
              />
            </label>
            <div className="text-right">
              <span className="block text-xs text-muted-foreground uppercase tracking-wider">Allocated</span>
              <span className={cn(
                "block text-lg font-bold tabular-nums",
                summaryTotal === (totalToOrder ?? 0) ? "text-emerald-600" : "text-amber-600"
              )}>{summaryTotal.toLocaleString()}</span>
            </div>
            <button
              onClick={sendOrderEmail}
              disabled={
                sendingOrder
                || !orderResult
                || orderResult.filter(o => o.orderQty > 0).length === 0
                || !settings.orderingEmail.trim()
              }
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              title={
                !settings.orderingEmail.trim()
                  ? "Set the Ordering email in Global Settings first"
                  : `Email the order to ${settings.orderingEmail}`
              }
            >
              {sendingOrder ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Send order email
            </button>
          </div>
        </div>
      </div>

      {/* ── Stock check table ─────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-lg">Recipes</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAddFromMenuOpen(true)}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" /> Add from menu
            </button>
            <button
              onClick={() => setAddMiscOpen(true)}
              className="px-3 py-1.5 text-sm border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" /> Add miscellaneous
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-base">
            <thead>
              <tr className="text-left text-xs text-muted-foreground uppercase tracking-wider border-b border-border">
                <th className="px-5 py-3">Recipe</th>
                <th className="px-3 py-3 text-right">DPT %</th>
                <th className="px-3 py-3 text-right">Rolls</th>
                <th className="px-3 py-3 text-right">Total wt (g)</th>
                <th className="px-3 py-3 text-right">Current stock</th>
                <th className="px-3 py-3 text-right bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 font-bold">Order qty</th>
                <th className="px-3 py-3 text-right">Final stock</th>
                <th className="px-3 py-3 text-right">Final %</th>
                <th className="px-3 py-3 w-12" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-10 text-center text-muted-foreground">
                    No recipes yet. Set DPT % on your recipes (or add a miscellaneous entry) to get started.
                  </td>
                </tr>
              ) : (
                rows.map(row => {
                  const draft = drafts[row.id];
                  const order = orderById.get(row.id);
                  const numRollsValue = draft?.numRolls ?? String(row.latestCheck?.numRolls ?? "");
                  const totalWeightValue = draft?.totalWeightG ?? String(row.latestCheck?.totalWeightG ?? "");
                  const isDirty = !!draft && (
                    draft.numRolls !== String(row.latestCheck?.numRolls ?? "")
                    || draft.totalWeightG !== String(row.latestCheck?.totalWeightG ?? "")
                  );
                  return (
                    <tr key={row.id} className="border-b border-border/50 hover:bg-secondary/20">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          {row.recipeColor && (
                            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: row.recipeColor }} />
                          )}
                          <div>
                            <p className="font-semibold">{row.recipeName}</p>
                            {row.kind === "misc" && (
                              <p className="text-xs text-amber-600">
                                Miscellaneous
                                {row.mappedRecipeName ? ` · mapped to ${row.mappedRecipeName}` : ""}
                              </p>
                            )}
                            {row.recipeCategory && row.kind === "real" && (
                              <p className="text-xs text-muted-foreground">{row.recipeCategory}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {editingOverrideId === row.id ? (
                          <div className="flex items-center justify-end gap-1">
                            <input
                              type="number"
                              min={0}
                              step={0.1}
                              autoFocus
                              value={overrideDraft}
                              onChange={e => setOverrideDraft(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter") saveOverride(row.id, overrideDraft);
                                if (e.key === "Escape") { setEditingOverrideId(null); setOverrideDraft(""); }
                              }}
                              placeholder="blank=auto"
                              className="w-20 px-1.5 py-1 text-right bg-background border border-primary rounded text-sm tabular-nums"
                            />
                            <button
                              onClick={() => saveOverride(row.id, overrideDraft)}
                              className="p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded"
                              title="Save override"
                            >
                              <Save className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => { setEditingOverrideId(null); setOverrideDraft(""); }}
                              className="p-1 text-muted-foreground hover:bg-secondary rounded"
                              title="Cancel"
                            >
                              <XIcon className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setEditingOverrideId(row.id);
                              setOverrideDraft(row.miscDptPct != null ? String(row.miscDptPct) : "");
                            }}
                            className={cn(
                              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-secondary",
                              row.miscDptPct != null ? "text-amber-600 font-semibold" : ""
                            )}
                            title={row.miscDptPct != null
                              ? `Override active (${row.miscDptPct}%). Click to edit.`
                              : "Click to set a DPT % override for this row"}
                          >
                            {row.effectiveDptPct.toFixed(1)}%
                            {row.miscDptPct != null && <span className="text-[10px]">(override)</span>}
                            <Pencil className="w-3 h-3 opacity-40" />
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={numRollsValue}
                          onChange={e => setDrafts(d => ({
                            ...d,
                            [row.id]: {
                              numRolls: e.target.value,
                              totalWeightG: d[row.id]?.totalWeightG ?? String(row.latestCheck?.totalWeightG ?? ""),
                            },
                          }))}
                          onBlur={() => autoSaveIfReady(row.id, row)}
                          className="w-20 px-2 py-1.5 text-right bg-background border border-border rounded text-base tabular-nums"
                          placeholder="0"
                        />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={totalWeightValue}
                          onChange={e => setDrafts(d => ({
                            ...d,
                            [row.id]: {
                              numRolls: d[row.id]?.numRolls ?? String(row.latestCheck?.numRolls ?? ""),
                              totalWeightG: e.target.value,
                            },
                          }))}
                          onBlur={() => autoSaveIfReady(row.id, row)}
                          className="w-28 px-2 py-1.5 text-right bg-background border border-border rounded text-base tabular-nums"
                          placeholder="0"
                        />
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {row.currentStock != null ? (
                          <span className="font-semibold">{row.currentStock.toLocaleString()}</span>
                        ) : (
                          <span className="text-muted-foreground italic text-sm">no check</span>
                        )}
                      </td>
                      {/* Order qty — the headline number, styled prominently
                          so it stands out against the other columns. This is
                          the value the operator types into the supplier's
                          order form. */}
                      <td className="px-3 py-3 text-right tabular-nums bg-emerald-50 dark:bg-emerald-950/30">
                        {order && order.planningWeight > 0 ? (
                          <span className="font-bold text-xl text-emerald-700 dark:text-emerald-300">
                            {order.orderQty.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </td>
                      {/* Final stock = current + order, i.e. what the kitchen
                          will have after the order arrives. This is the value
                          the rebalance is actually targeting. */}
                      <td className="px-3 py-3 text-right tabular-nums">
                        {order ? (
                          <span className="font-semibold">{(order.currentStock + order.orderQty).toLocaleString()}</span>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </td>
                      {/* Final % = this row's share of total final stock.
                          Should match DPT % closely once everything is on
                          target — quick visual check that the rebalance is
                          doing what it should. */}
                      <td className="px-3 py-3 text-right tabular-nums">
                        {order && finalStockSum > 0 ? (
                          <span className={cn(
                            "text-sm",
                            // Soft green when within 1 pt of the DPT %.
                            Math.abs(((order.currentStock + order.orderQty) / finalStockSum) * 100 - row.effectiveDptPct) < 1
                              ? "text-emerald-600 font-semibold"
                              : "text-muted-foreground"
                          )}>
                            {(((order.currentStock + order.orderQty) / finalStockSum) * 100).toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isDirty && (
                            <button
                              onClick={() => saveCheck(row.id)}
                              disabled={draft?.saving}
                              className="p-1.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded"
                              title="Save stock check (auto-saves on blur too)"
                            >
                              {draft?.saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            </button>
                          )}
                          <button
                            onClick={() => deleteRow(row.id)}
                            className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded"
                            title={row.kind === "real"
                              ? "Remove (will re-add itself on next refresh if DPT is active and packs_sold > 0)"
                              : "Remove"}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {addMiscOpen && (
        <AddMiscDialog
          onClose={() => setAddMiscOpen(false)}
          onAdded={async () => {
            setAddMiscOpen(false);
            await fetchAll();
          }}
          existingRecipes={rows.filter(r => r.kind === "real").map(r => ({ id: r.recipeId!, name: r.recipeName }))}
        />
      )}

      {addFromMenuOpen && (
        <AddFromMenuDialog
          onClose={() => setAddFromMenuOpen(false)}
          onAdded={async () => {
            setAddFromMenuOpen(false);
            await fetchAll();
          }}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Settings number input — commits onBlur or Enter, not on every keystroke,
// so the per-row stock check doesn't get spammed with PUTs as you type.
// ──────────────────────────────────────────────────────────────────────────────
function SettingsNumberInput({ label, unit, value, step, hint, onCommit }: {
  label: string;
  unit: string;
  value: number;
  step: number;
  hint?: string;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = () => {
    const n = Number(text);
    if (!Number.isFinite(n) || n < 0) {
      setText(String(value));
      return;
    }
    if (n !== value) onCommit(n);
  };
  return (
    <label className="block">
      <span className="block text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</span>
      <div className="flex items-baseline gap-2">
        <input
          type="number"
          min={0}
          step={step}
          value={text}
          onChange={e => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="flex-1 px-3 py-2 text-lg font-bold tabular-nums bg-background border border-border rounded-lg"
        />
        <span className="text-sm text-muted-foreground">{unit}</span>
      </div>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </label>
  );
}

function SettingsTextArea({ label, value, hint, placeholder, onCommit }: {
  label: string;
  value: string;
  hint?: string;
  placeholder?: string;
  onCommit: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  const commit = () => { if (text !== value) onCommit(text); };
  return (
    <label className="block">
      <span className="block text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</span>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={commit}
        placeholder={placeholder}
        rows={4}
        className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg resize-y min-h-[6rem]"
      />
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </label>
  );
}

function SettingsTextInput({ label, value, hint, placeholder, icon, onCommit }: {
  label: string;
  value: string;
  hint?: string;
  placeholder?: string;
  icon?: ReactNode;
  onCommit: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  const commit = () => { if (text.trim() !== value.trim()) onCommit(text.trim()); };
  return (
    <label className="block">
      <span className="block text-xs text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
        {icon}{label}
      </span>
      <input
        type="email"
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg"
      />
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </label>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Add from menu dialog — picker for any real recipe not already in the
// calculator. Shows the DPT packs sold so the user knows whether a manual
// override % is needed (mac cheese has packs_sold=0 so it gets one).
// ──────────────────────────────────────────────────────────────────────────────
interface MenuRecipe {
  id: number;
  name: string;
  category: string | null;
  color: string | null;
  dptPacksSold: number | null;
  dptIsActive: boolean | null;
}

function AddFromMenuDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [menu, setMenu] = useState<MenuRecipe[] | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [overridePct, setOverridePct] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/label-stock/menu-recipes", { credentials: "include" })
      .then(r => r.json())
      .then(d => setMenu(d.items ?? []))
      .catch(() => setMenu([]));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!menu) return [];
    if (!q) return menu;
    return menu.filter(r =>
      r.name.toLowerCase().includes(q)
      || (r.category ?? "").toLowerCase().includes(q)
    );
  }, [menu, search]);

  // Group by category so mac cheese / calzones cluster naturally.
  const grouped = useMemo(() => {
    const map = new Map<string, MenuRecipe[]>();
    for (const r of filtered) {
      const cat = r.category ?? "Uncategorised";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(r);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const selectedRecipe = menu?.find(r => r.id === selected) ?? null;
  // If the selected recipe has packs_sold=0 (or no DPT), an override is
  // basically required for it to get any order allocation. Surface that.
  const needsOverride = selectedRecipe != null && (!selectedRecipe.dptIsActive || !selectedRecipe.dptPacksSold);

  const submit = async () => {
    if (selected == null) return;
    const pct = overridePct.trim() === "" ? undefined : parseFloat(overridePct);
    if (overridePct.trim() !== "" && (!Number.isFinite(pct as number) || (pct as number) < 0)) {
      toast({ title: "Override % must be a non-negative number (or blank)", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/label-stock/recipes/from-menu", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipeId: selected, dptPctOverride: pct }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Add failed");
      onAdded();
    } catch (err) {
      toast({ title: "Couldn't add", description: String(err), variant: "destructive" });
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl p-6 w-full max-w-xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-lg mb-1">Add from menu</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Pick any recipe to add it to the label calculator. Recipes with no DPT packs sold (e.g. mac cheese) need a manual DPT % override to get an order allocation.
        </p>

        {/* Search box */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search recipes…"
            className="w-full pl-9 pr-3 py-2 bg-background border border-border rounded-lg"
          />
        </div>

        {/* Grouped recipe list */}
        <div className="flex-1 overflow-y-auto border border-border rounded-lg">
          {menu == null ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
            </div>
          ) : grouped.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">
              {menu.length === 0
                ? "Every recipe is already in the calculator."
                : "No matches."}
            </div>
          ) : (
            grouped.map(([category, items]) => (
              <div key={category}>
                <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-secondary/40 sticky top-0">
                  {category}
                </div>
                {items.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelected(r.id)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2 text-left border-b border-border/30 transition-colors",
                      selected === r.id
                        ? "bg-blue-500/10 border-l-4 border-l-blue-500"
                        : "hover:bg-secondary/40 border-l-4 border-l-transparent"
                    )}
                  >
                    {r.color && <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: r.color }} />}
                    <span className="flex-1 truncate">{r.name}</span>
                    <span className={cn(
                      "text-xs tabular-nums",
                      !r.dptIsActive || !r.dptPacksSold ? "text-amber-600" : "text-muted-foreground"
                    )}>
                      {r.dptIsActive && r.dptPacksSold ? `DPT ${r.dptPacksSold}` : "no DPT"}
                    </span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Override input — only shown when a recipe is selected. Required-ish
            when the selected recipe has no DPT packs. */}
        {selectedRecipe && (
          <div className={cn(
            "mt-3 p-3 rounded-lg border",
            needsOverride ? "border-amber-300 bg-amber-50 dark:bg-amber-950/20" : "border-border bg-background"
          )}>
            <label className="block">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">
                DPT % override {needsOverride ? "(recommended — no DPT packs)" : "(optional)"}
              </span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={overridePct}
                onChange={e => setOverridePct(e.target.value)}
                placeholder={needsOverride ? "e.g. 15" : "blank = use real DPT"}
                className="w-full mt-1 px-3 py-2 bg-background border border-border rounded-lg tabular-nums"
              />
              <span className="text-xs text-muted-foreground mt-1 block">
                {needsOverride
                  ? "This recipe has 0 packs sold in DPT, so without an override it gets 0% planning weight and no labels allocated."
                  : "If set, this overrides the real DPT weight for this calculator only. Leave blank to auto-derive."}
              </span>
            </label>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted">Cancel</button>
          <button
            onClick={submit}
            disabled={submitting || selected == null}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add to calculator
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Add miscellaneous recipe dialog
// ──────────────────────────────────────────────────────────────────────────────
function AddMiscDialog({ onClose, onAdded, existingRecipes }: {
  onClose: () => void;
  onAdded: () => void;
  existingRecipes: Array<{ id: number; name: string }>;
}) {
  const [name, setName] = useState("");
  const [dptPct, setDptPct] = useState("");
  const [mappedRecipeId, setMappedRecipeId] = useState<number | "">("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const pct = parseFloat(dptPct);
    if (!name.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
    if (!Number.isFinite(pct) || pct < 0) { toast({ title: "DPT % must be a non-negative number", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/label-stock/recipes", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          miscName: name.trim(),
          miscDptPct: pct,
          mappedRecipeId: mappedRecipeId === "" ? null : mappedRecipeId,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Add failed");
      onAdded();
    } catch (err) {
      toast({ title: "Couldn't add", description: String(err), variant: "destructive" });
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-lg mb-1">Add miscellaneous recipe</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Use this for label types not yet in the recipes system. The DPT % only applies to this calculator.
        </p>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Name</span>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Test Recipe Spring 2026"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">DPT % (rough)</span>
            <input
              type="number"
              min={0}
              step={0.1}
              value={dptPct}
              onChange={e => setDptPct(e.target.value)}
              placeholder="e.g. 5"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg tabular-nums"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Map to recipe (optional)</span>
            <select
              value={mappedRecipeId}
              onChange={e => setMappedRecipeId(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg"
            >
              <option value="">— Not mapped —</option>
              {existingRecipes.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground mt-1 block">
              If mapped, the calculator uses the real recipe's DPT instead of the % above.
            </span>
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted">Cancel</button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
