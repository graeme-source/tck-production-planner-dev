/**
 * Mailbox-sync bridge: runs the finance mailbox sync from a machine whose
 * IP one.com actually serves (a residential connection), writing into the
 * LIVE database. Exists because one.com tar-pits IMAP connections from
 * Railway's datacenter IPs (incident notes, 2026-08-28) — the in-app
 * hourly sync stays enabled and takes over if that ever unblocks.
 *
 * Usage (from repo root; DATABASE_URL + SESSION_SECRET must be the LIVE
 * values, e.g. pulled via `railway variables`):
 *   DATABASE_URL=... SESSION_SECRET=... npx tsx tools/finance-mailbox-bridge/run.ts [--from 2026-06-01 [--to 2026-07-01]]
 */
import { runMailboxSync } from "../../artifacts/api-server/src/lib/finance/mailbox-sync";

const args = process.argv.slice(2);
function argVal(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const rangeFrom = argVal("--from");
const rangeTo = argVal("--to");

(async () => {
  console.log(`[bridge] starting sync${rangeFrom ? ` for ${rangeFrom} → ${rangeTo ?? "now"}` : ""}…`);
  try {
    const outcome = await runMailboxSync(rangeFrom ? { rangeFrom, rangeTo } : {});
    console.log(`[bridge] scanned ${outcome.scanned}, indexed ${outcome.indexed}, suggestions refreshed for ${outcome.suggestionsRefreshed} lines`);
    if (outcome.error) console.error(`[bridge] error: ${outcome.error}`);
    process.exitCode = outcome.error ? 1 : 0;
  } catch (err) {
    console.error("[bridge] crashed:", err);
    process.exitCode = 1;
  } finally {
    // Let node exit naturally so stdout flushes — process.exit() truncated
    // the outcome line on the first runs. The pg pool would otherwise keep
    // the loop alive forever.
    const { pool } = await import("@workspace/db");
    await pool.end().catch(() => undefined);
  }
})();
