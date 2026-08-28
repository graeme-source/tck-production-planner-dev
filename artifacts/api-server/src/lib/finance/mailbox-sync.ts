import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { db, finEmailIndexTable, finLinesTable, finMailboxTable, finMatchesTable, finVendorsTable } from "@workspace/db";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { openSecret } from "./secret-box";
import { extractAmounts } from "./amounts";
import { suggestMatches, extractRefTokens, type EmailForMatch, type LineForMatch } from "./matching";

// Mailbox sync: scan one.com over IMAP, index invoice-like messages
// (metadata + extracted amounts ONLY — bodies are parsed transiently and
// dropped; see the plan's minimisation section), then refresh match
// suggestions for open lines. Runs hourly plus on demand from the settings
// page. Single-flight guarded — a slow scan must never overlap the next.

const INVOICE_HINTS = /invoice|receipt|order|payment|billing|statement|vat|purchase|confirm/i;

let syncRunning = false;

export interface SyncOutcome {
  scanned: number;
  indexed: number;
  suggestionsRefreshed: number;
  error?: string;
}

function fromDomain(address: string | undefined): string | null {
  if (!address) return null;
  const at = address.lastIndexOf("@");
  return at >= 0 ? address.slice(at + 1).toLowerCase() : null;
}

/** Message metadata classifier: is this worth body-scanning at all? */
export function looksInvoiceLike(subject: string | undefined, hasPdf: boolean, sender: string | undefined): boolean {
  if (hasPdf) return true;
  if (subject && INVOICE_HINTS.test(subject)) return true;
  if (sender && /invoice|billing|accounts|receipt|noreply|no-reply|orders?@/i.test(sender)) return true;
  return false;
}

// Overall deadline on a whole sync pass. Live incident #2 (2026-08-28,
// same morning as the crash): one.com tar-pits connections from Railway's
// datacenter IPs — the socket opens and then starves, below the socket
// timeout's radar, and the single-flight lock jammed until restart. The
// watchdog guarantees the lock frees and the failure is visible.
const SYNC_DEADLINE_MS = 15 * 60_000;

export interface SyncOptions {
  /** One-off ranged scan (ISO dates, inclusive from / exclusive to): ignores
   *  and does not advance the UID cursor, so it can reach back before the
   *  configured backfill date (Graeme, 2026-08-28: "sync a month back in
   *  June so I can test those early June ones"). */
  rangeFrom?: string;
  rangeTo?: string;
}

export async function runMailboxSync(options: SyncOptions = {}): Promise<SyncOutcome> {
  if (syncRunning) return { scanned: 0, indexed: 0, suggestionsRefreshed: 0, error: "Sync already running" };
  syncRunning = true;
  try {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<SyncOutcome>((resolve) => {
      timer = setTimeout(async () => {
        const msg = `Sync gave up after ${SYNC_DEADLINE_MS / 60000} minutes — the mail server accepted the connection but never answered (this happens when one.com throttles datacenter IPs). It will retry on the next hourly pass.`;
        try {
          const [box] = await db.select({ id: finMailboxTable.id }).from(finMailboxTable).limit(1);
          if (box) await db.update(finMailboxTable).set({ lastError: msg, updatedAt: new Date() }).where(eq(finMailboxTable.id, box.id));
        } catch { /* best effort */ }
        resolve({ scanned: 0, indexed: 0, suggestionsRefreshed: 0, error: msg });
      }, SYNC_DEADLINE_MS);
      timer.unref?.();
    });
    const result = await Promise.race([doSync(options), deadline]);
    if (timer) clearTimeout(timer);
    return result;
  } finally {
    syncRunning = false;
  }
}

async function doSync(options: SyncOptions = {}): Promise<SyncOutcome> {
  const [box] = await db.select().from(finMailboxTable).limit(1);
  if (!box) return { scanned: 0, indexed: 0, suggestionsRefreshed: 0, error: "No mailbox configured" };

  let password: string;
  try {
    password = openSecret(box.passwordEnc);
  } catch (e: any) {
    await db.update(finMailboxTable).set({ lastError: e.message, updatedAt: new Date() }).where(eq(finMailboxTable.id, box.id));
    return { scanned: 0, indexed: 0, suggestionsRefreshed: 0, error: e.message };
  }

  const client = new ImapFlow({
    host: box.imapHost,
    port: 993,
    secure: true,
    auth: { user: box.emailAddress, pass: password },
    logger: false,
    // A 3-month backfill over a shared host is slow; give commands room.
    socketTimeout: 10 * 60_000,
  });
  // CRASH-PROOFING (live outage 2026-08-28): ImapFlow is an EventEmitter and
  // emits 'error' for socket-level failures BETWEEN awaited operations (e.g.
  // socket timeout mid-scan). With no listener, Node treats it as an
  // unhandled 'error' event and kills the whole process — which took the
  // live app down during Graeme's first big sync. The in-flight command
  // still rejects and is handled by the try/catch below; this listener just
  // absorbs the emitter-level duplicate.
  client.on("error", (err: any) => {
    console.error("[finance] IMAP connection error:", err?.message ?? err);
  });

  let scanned = 0;
  let indexed = 0;
  const uidState = { ...box.uidState };

  try {
    await client.connect();

    for (const folder of box.foldersWatched) {
      const lock = await client.getMailboxLock(folder);
      try {
        const mailbox = client.mailbox;
        if (!mailbox || typeof mailbox === "boolean") continue;
        const validity = Number(mailbox.uidValidity ?? 0);
        const prev = uidState[folder];
        // UIDVALIDITY change voids every cached UID → full rescan of the folder.
        const startUid = prev && prev.uidvalidity === validity ? prev.uidnext : 1;
        const ranged = Boolean(options.rangeFrom);

        // Bound the initial scan by the backfill horizon — or, for a ranged
        // scan, by the requested window (cursor untouched).
        const since = ranged
          ? new Date(`${options.rangeFrom}T00:00:00Z`)
          : box.scanSince ? new Date(`${box.scanSince}T00:00:00Z`) : undefined;
        const before = ranged && options.rangeTo ? new Date(`${options.rangeTo}T00:00:00Z`) : undefined;
        const range = `${startUid}:*`;
        const search: any = ranged
          ? (before ? { since, before } : { since })
          : since && startUid === 1 ? { since } : { uid: range };

        // Large-mailbox hardening (2026-08-28: graeme@ holds 94k messages)
        // AND the imapflow deadlock fix: download() must NEVER be called
        // while the fetch iterator is still running — commands serialise on
        // one connection, so the iterator waits on the download and the
        // download queues behind the iterator. That deadlock is what made
        // every earlier sync die silently (and crashed live at 08:15).
        // Phase 1 collects metadata; phase 2 downloads bodies afterwards.
        let maxUid = startUid - 1;
        const persistProgress = async () => {
          if (ranged || maxUid < startUid) return;
          uidState[folder] = { uidvalidity: validity, uidnext: maxUid + 1 };
          await db.update(finMailboxTable)
            .set({ uidState, updatedAt: new Date() })
            .where(eq(finMailboxTable.id, box.id))
            .catch(() => undefined);
        };

        interface Collected {
          uid: number;
          sender?: string;
          subject?: string;
          hasPdf: boolean;
          messageId: string | null;
          internalDate: Date | null;
        }
        const collected: Collected[] = [];
        try {
          for await (const msg of client.fetch(search, { uid: true, envelope: true, bodyStructure: true, internalDate: true }, { uid: !ranged && startUid > 1 })) {
            scanned++;
            if (msg.uid > maxUid) maxUid = msg.uid;
            const env = msg.envelope;
            collected.push({
              uid: msg.uid,
              sender: env?.from?.[0]?.address ?? undefined,
              subject: env?.subject ?? undefined,
              hasPdf: structureHasPdf(msg.bodyStructure),
              messageId: env?.messageId ?? null,
              internalDate: msg.internalDate ? new Date(msg.internalDate) : null,
            });
          }
        } catch (fetchErr: any) {
          console.error(`[finance] metadata fetch of ${folder} interrupted after ${scanned}:`, fetchErr?.message ?? fetchErr);
        }

        // Phase 2: bodies for invoice-like messages, one command at a time,
        // each raced against a timeout; progress persists as we go so an
        // interruption costs nothing.
        try {
          for (const m of collected) {
            if (!looksInvoiceLike(m.subject, m.hasPdf, m.sender)) continue;
            let amounts: string[] = [];
            let refTokens: string[] = [];
            try {
              const dl = await Promise.race([
                client.download(String(m.uid), undefined, { uid: true }),
                new Promise<null>((resolve) => setTimeout(() => resolve(null), 45_000).unref?.()),
              ]);
              if (dl?.content) {
                const parsed = await simpleParser(dl.content);
                const text = `${m.subject ?? ""}\n${parsed.text ?? ""}`;
                amounts = extractAmounts(text);
                refTokens = extractRefTokens(text);
              } else {
                amounts = extractAmounts(m.subject ?? "");
                refTokens = extractRefTokens(m.subject ?? "");
              }
            } catch {
              amounts = extractAmounts(m.subject ?? "");
              refTokens = extractRefTokens(m.subject ?? "");
            }

            await db
              .insert(finEmailIndexTable)
              .values({
                folder,
                imapUid: m.uid,
                messageIdHdr: m.messageId,
                fromAddress: m.sender ?? null,
                fromDomain: fromDomain(m.sender),
                subject: m.subject ?? null,
                internalDate: m.internalDate,
                hasPdf: m.hasPdf,
                amountsFound: amounts,
                orderIdsFound: refTokens,
              })
              .onConflictDoNothing({ target: [finEmailIndexTable.folder, finEmailIndexTable.imapUid] });
            indexed++;
            if (indexed % 20 === 0) {
              console.log(`[finance] mailbox scan: ${scanned} scanned, ${indexed} indexed (${folder})`);
            }
          }
          await persistProgress();
        } catch (bodyErr: any) {
          console.error(`[finance] body pass of ${folder} interrupted after ${indexed} indexed:`, bodyErr?.message ?? bodyErr);
          await persistProgress();
        }
      } finally {
        lock.release();
      }
    }

    await client.logout().catch(() => undefined);
  } catch (e: any) {
    try { await client.close(); } catch { /* already closed */ }
    const msg = e?.message ?? String(e);
    await db.update(finMailboxTable).set({ lastError: msg, updatedAt: new Date() }).where(eq(finMailboxTable.id, box.id));
    return { scanned, indexed, suggestionsRefreshed: 0, error: msg };
  }

  await db
    .update(finMailboxTable)
    .set({ uidState, lastSyncAt: new Date(), lastError: null, updatedAt: new Date() })
    .where(eq(finMailboxTable.id, box.id));

  const suggestionsRefreshed = await refreshSuggestions();
  return { scanned, indexed, suggestionsRefreshed };
}

function structureHasPdf(node: any): boolean {
  if (!node) return false;
  const type = `${node.type ?? ""}`.toLowerCase();
  const name = `${node.parameters?.name ?? node.dispositionParameters?.filename ?? ""}`.toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return true;
  if (Array.isArray(node.childNodes)) return node.childNodes.some(structureHasPdf);
  return false;
}

/** Re-run the pure matcher for every open line against the local index. */
export async function refreshSuggestions(): Promise<number> {
  const openLines = await db
    .select()
    .from(finLinesTable)
    .where(inArray(finLinesTable.status, ["open", "identified"]));
  if (openLines.length === 0) return 0;

  const vendorIds = [...new Set(openLines.map((l) => l.vendorId).filter((v): v is number => v !== null))];
  const vendors = vendorIds.length
    ? await db.select().from(finVendorsTable).where(inArray(finVendorsTable.id, vendorIds))
    : [];
  const vendorDomains = new Map<number, string[]>();
  for (const v of vendors) {
    const domains: string[] = [];
    if (v.accountsEmail) {
      const d = fromDomain(v.accountsEmail);
      if (d) domains.push(d);
    }
    if (v.website) {
      const d = v.website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
      if (d) domains.push(d);
    }
    vendorDomains.set(v.id, domains);
  }

  let refreshed = 0;
  for (const l of openLines) {
    const anchor = l.authDate ?? l.lineDate;
    const from = new Date(`${anchor}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() - 30);
    const to = new Date(`${anchor}T00:00:00Z`);
    to.setUTCDate(to.getUTCDate() + 6);

    const candidates = await db
      .select()
      .from(finEmailIndexTable)
      .where(and(gte(finEmailIndexTable.internalDate, from), lte(finEmailIndexTable.internalDate, to)));

    const lineForMatch: LineForMatch = {
      id: l.id,
      merchant: l.merchant,
      descriptor: l.descriptor,
      amount: l.amount,
      originalAmount: l.originalAmount,
      authDate: l.authDate,
      lineDate: l.lineDate,
      vendorDomains: l.vendorId ? (vendorDomains.get(l.vendorId) ?? []) : [],
    };
    // Duplicate deliveries of the same email (same Message-ID under
    // different UIDs — CC copies, resends) collapse to one candidate.
    const seenMsgIds = new Set<string>();
    const deduped = candidates.filter((c) => {
      if (!c.messageIdHdr) return true;
      if (seenMsgIds.has(c.messageIdHdr)) return false;
      seenMsgIds.add(c.messageIdHdr);
      return true;
    });
    const emails: EmailForMatch[] = deduped.map((c) => ({
      id: c.id,
      fromDomain: c.fromDomain,
      fromAddress: c.fromAddress,
      subject: c.subject,
      internalDate: c.internalDate,
      hasPdf: c.hasPdf,
      amountsFound: c.amountsFound,
      orderIdsFound: c.orderIdsFound ?? [],
    }));

    const suggestions = suggestMatches(lineForMatch, emails);
    for (const s of suggestions) {
      await db
        .insert(finMatchesTable)
        .values({ lineId: l.id, emailIndexId: s.emailIndexId, score: s.score, signals: s.signals, strength: s.strength, reasons: s.reasons })
        .onConflictDoUpdate({
          target: [finMatchesTable.lineId, finMatchesTable.emailIndexId],
          set: { score: s.score, signals: s.signals, strength: s.strength, reasons: s.reasons },
          setWhere: sql`${finMatchesTable.state} = 'suggested'`,
        });
    }
    // Purge undecided suggestions that no longer qualify under the current
    // rules (e.g. the pdf-plus-date junk this rule change removes). Human
    // decisions — confirmed/rejected — are never touched.
    const keepIds = suggestions.map((s) => s.emailIndexId);
    await db.delete(finMatchesTable).where(and(
      eq(finMatchesTable.lineId, l.id),
      eq(finMatchesTable.state, "suggested"),
      keepIds.length > 0 ? sql`${finMatchesTable.emailIndexId} NOT IN (${sql.join(keepIds.map(id => sql`${id}`), sql`, `)})` : sql`TRUE`,
    ));
    if (suggestions.length > 0) refreshed++;
  }
  return refreshed;
}

/** Download one attachment (or the full message rendered) for a confirmed match. */
export async function fetchAttachmentForMessage(
  folder: string,
  uid: number
): Promise<{ fileName: string; mime: string; content: Buffer } | null> {
  const [box] = await db.select().from(finMailboxTable).limit(1);
  if (!box) return null;
  const client = new ImapFlow({
    host: box.imapHost,
    port: 993,
    secure: true,
    auth: { user: box.emailAddress, pass: openSecret(box.passwordEnc) },
    logger: false,
    socketTimeout: 2 * 60_000,
  });
  // Same crash-proofing as the sync client (see above).
  client.on("error", (err: any) => {
    console.error("[finance] IMAP connection error:", err?.message ?? err);
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      const dl = await client.download(String(uid), undefined, { uid: true });
      if (!dl?.content) return null;
      const parsed = await simpleParser(dl.content);
      const pdf = parsed.attachments.find(
        (a) => a.contentType === "application/pdf" || (a.filename ?? "").toLowerCase().endsWith(".pdf")
      );
      if (pdf) {
        return {
          fileName: pdf.filename || "invoice.pdf",
          mime: "application/pdf",
          content: Buffer.from(pdf.content),
        };
      }
      // No PDF: keep the message text as a .eml-style text file so the
      // bookkeeper still gets the evidence (HTML-only invoices).
      const text = parsed.text || parsed.html || "";
      if (!text) return null;
      return {
        fileName: `${(parsed.subject || "email").slice(0, 60).replace(/[^\w\s.-]/g, "_")}.txt`,
        mime: "text/plain",
        content: Buffer.from(String(text), "utf8"),
      };
    } finally {
      lock.release();
      await client.logout();
    }
  } catch {
    try { await client.close(); } catch { /* already closed */ }
    return null;
  }
}
