// The QuickBooks chart of accounts, for picking a "What is this item?"
// category (Graeme, 26 Nov 2026: "searching all of the available accounts
// that we've already created in QuickBooks, so I can choose the relevant
// one" — only the chosen ones join the dropdown). Read only; QuickBooks is
// asked at most every 10 minutes. Objective I.

import { qboConfigured, qboQuery, qboStatus } from "./qbo";
import { qboAccountsForPicker, type QboAccountRow, type QboPickerAccount } from "./qbo-accounts-rules";

const TTL_MS = 10 * 60_000;
let cache: { at: number; accounts: QboPickerAccount[] } | null = null;

export type QboAccountsResult =
  | { connected: true; accounts: QboPickerAccount[] }
  | { connected: false; accounts: []; reason: string };

export async function loadQboAccounts(): Promise<QboAccountsResult> {
  if (cache && Date.now() - cache.at < TTL_MS) return { connected: true, accounts: cache.accounts };
  if (!qboConfigured() || !(await qboStatus()).connected) {
    return { connected: false, accounts: [], reason: "QuickBooks isn't connected" };
  }
  try {
    const rows = await qboQuery<QboAccountRow>("SELECT Id, Name, FullyQualifiedName, AccountType, Classification, Active FROM Account WHERE Active = true MAXRESULTS 1000");
    const accounts = qboAccountsForPicker(rows);
    cache = { at: Date.now(), accounts };
    return { connected: true, accounts };
  } catch (err) {
    console.warn("[finance] QuickBooks accounts read failed:", err instanceof Error ? err.message : err);
    if (cache) return { connected: true, accounts: cache.accounts };
    return { connected: false, accounts: [], reason: "QuickBooks didn't answer just now" };
  }
}
