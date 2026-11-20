/**
 * Who dismissed an operational warning, and when (Graeme, 20 Nov 2026 —
 * #140013 was named by the 2:16 check and never sent; nothing said whether
 * the alert was dismissed or by whom). The screens call logWarning for the
 * warnings they keep on the iPad; the server records its own. Never blocks
 * the dismiss itself. Managers read them on /warning-log.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const WARNING_LABELS: Record<string, string> = {
  dispatch_cutoff: "2:16 order check",
  kanban_not_today: "Kanban put off (Not today)",
  supplier_order_dismissed: "Supplier order dismissed on Orders",
  completion_failure: "Order didn't finish completing (Packing)",
  stock_check_popup: "2:55 stock check pop-up",
  forced_stock_check: "Stock check skipped",
};

export const ACTION_LABELS: Record<string, string> = {
  dismiss: "Dismissed",
  check_again: "Checked again",
  put_off: "Put off",
  carry_on: "Carried on",
  skip: "Skipped",
};

export function logWarning(warning: keyof typeof WARNING_LABELS, action: keyof typeof ACTION_LABELS, detail?: string | null): void {
  void fetch(`${BASE}/api/warning-log`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ warning, action, detail: detail ?? null, page: typeof window !== "undefined" ? window.location.pathname : null }),
  }).catch(() => undefined);
}
