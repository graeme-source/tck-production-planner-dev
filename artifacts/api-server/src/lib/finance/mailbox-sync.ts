import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { db, finEmailIndexTable, finLinesTable, finMailboxTable, finMatchesTable, finVendorsTable } from "@workspace/db";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { openSecret } from "./secret-box";
import { extractAmounts } from "./amounts";
import { suggestMatches, type EmailForMatch, type LineForMatch } from "./matching";

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

export async function runMailboxSync(): Promise<SyncOutcome> {
  if (syncRunning) return { scanned: 0, indexed: 0, suggestionsRefreshed: 0, error: "Sync already running" };
  syncRunning = true;
  try {
    return await doSync();
  } finally {
    syncRunning = false;
  }
}

async function doSync(): Promise<SyncOutcome> {
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

        // Bound the initial scan by the backfill horizon.
        const since = box.scanSince ? new Date(`${box.scanSince}T00:00:00Z`) : undefined;
        const range = `${startUid}:*`;
        const search: any = since && startUid === 1 ? { since } : { uid: range };

        let maxUid = startUid - 1;
        for await (const msg of client.fetch(search, { uid: true, envelope: true, bodyStructure: true, internalDate: true }, { uid: startUid > 1 })) {
          scanned++;
          if (msg.uid > maxUid) maxUid = msg.uid;
          const env = msg.envelope;
          const sender = env?.from?.[0]?.address ?? undefined;
          const subject = env?.subject ?? undefined;
          const hasPdf = structureHasPdf(msg.bodyStructure);
          if (!looksInvoiceLike(subject, hasPdf, sender)) continue;

          // Transient body fetch for amount extraction; body is discarded.
          let amounts: string[] = [];
          try {
            const dl = await client.download(String(msg.uid), undefined, { uid: true });
            if (dl?.content) {
              const parsed = await simpleParser(dl.content);
              amounts = extractAmounts(`${subject ?? ""}\n${parsed.text ?? ""}`);
            }
          } catch {
            amounts = extractAmounts(subject ?? "");
          }

          await db
            .insert(finEmailIndexTable)
            .values({
              folder,
              imapUid: msg.uid,
              messageIdHdr: env?.messageId ?? null,
              fromAddress: sender ?? null,
              fromDomain: fromDomain(sender),
              subject: subject ?? null,
              internalDate: msg.internalDate ? new Date(msg.internalDate) : null,
              hasPdf,
              amountsFound: amounts,
            })
            .onConflictDoNothing({ target: [finEmailIndexTable.folder, finEmailIndexTable.imapUid] });
          indexed++;
        }

        uidState[folder] = { uidvalidity: validity, uidnext: Math.max(maxUid + 1, Number(mailbox.uidNext ?? 1)) };
      } finally {
        lock.release();
      }
    }

    await client.logout();
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
    const emails: EmailForMatch[] = candidates.map((c) => ({
      id: c.id,
      fromDomain: c.fromDomain,
      fromAddress: c.fromAddress,
      subject: c.subject,
      internalDate: c.internalDate,
      hasPdf: c.hasPdf,
      amountsFound: c.amountsFound,
    }));

    const suggestions = suggestMatches(lineForMatch, emails);
    for (const s of suggestions) {
      await db
        .insert(finMatchesTable)
        .values({ lineId: l.id, emailIndexId: s.emailIndexId, score: s.score, reasons: s.reasons })
        .onConflictDoUpdate({
          target: [finMatchesTable.lineId, finMatchesTable.emailIndexId],
          set: { score: s.score, reasons: s.reasons },
          setWhere: sql`${finMatchesTable.state} = 'suggested'`,
        });
    }
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
