/**
 * "It's on your record" email (Graeme, 24 Nov 2026): when a meeting's
 * write-up or a performance report is published to someone, the manager can
 * tick "Email them" — ticked by default for performance reviews and
 * disciplinaries. The email only says something is there and links to My
 * Record; it never carries what was written. Sent from the HR identity the
 * founder set (same as "a letter is waiting"). A failed email never undoes
 * the publish — it's reported back, not swallowed.
 */
import { eq, sql } from "drizzle-orm";
import { db, usersTable, peopleHrSettingsTable, peopleRecordAuditTable } from "@workspace/db";
import { hrEmailIdentity, publishedKind, recordPublishedEmail, type PublishedKind } from "@workspace/people-reviews";
import { sendEmail, FROM_EMAIL } from "../lib/email";
import { FOUNDER_EMAIL } from "../lib/founder-email";

export interface PublishedEmailResult { emailed: { to: string } | null; emailError: string | null }

/** What kind of entry it is, for the wording. No entry → a performance report. */
export async function entryPublishedKind(entryId: number | null): Promise<PublishedKind> {
  if (entryId == null) return "performance";
  const r = await db.execute<{ labels: string[] | null; meeting_type: string | null }>(sql`
    SELECT e.meeting_type,
           ARRAY(SELECT c.label FROM people_record_classifications c
                  WHERE c.id = e.classification_id
                     OR c.id IN (SELECT ec.classification_id FROM people_record_entry_classifications ec WHERE ec.entry_id = e.id)) AS labels
      FROM people_record_entries e WHERE e.id = ${entryId}
  `);
  const row = r.rows?.[0];
  return publishedKind(row?.labels ?? [], row?.meeting_type ?? null);
}

export async function emailRecordPublished(
  sender: { id: number; name: string },
  subjectUserId: number,
  entryId: number | null,
  /** A performance report is always worded as a performance review. */
  kindOverride?: PublishedKind,
): Promise<PublishedEmailResult> {
  const [person] = await db.select({ name: usersTable.name, email: usersTable.email, isActive: usersTable.isActive })
    .from(usersTable).where(eq(usersTable.id, subjectUserId));
  if (!person?.isActive) return { emailed: null, emailError: "They don't have an active account, so no email was sent." };
  if (!person.email) return { emailed: null, emailError: "There's no email address on their account, so no email was sent." };
  try {
    const kind = kindOverride ?? await entryPublishedKind(entryId);
    const appUrl = process.env["APP_URL"] ?? "https://tck-production-planner-dev-production.up.railway.app";
    const m = recordPublishedEmail(person.name, kind, appUrl);
    const [row] = await db.select().from(peopleHrSettingsTable).where(eq(peopleHrSettingsTable.id, 1));
    const identity = hrEmailIdentity({ fromName: row?.fromName ?? null, fromLocal: row?.fromLocal ?? null, replyTo: row?.replyTo ?? null }, FROM_EMAIL, FOUNDER_EMAIL);
    await sendEmail({
      to: person.email, subject: m.subject, text: m.text, html: m.html,
      fromName: identity.fromName, fromEmail: identity.fromEmail, replyTo: identity.replyTo,
    });
    await db.insert(peopleRecordAuditTable).values({
      viewerId: sender.id, viewerName: sender.name, subjectUserId, entryId, action: "review_email",
      detail: `Email sent to ${person.email}: ${m.subject}`.slice(0, 500),
    });
    return { emailed: { to: person.email }, emailError: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "The email didn't go";
    console.error("[record-published-email] failed:", msg);
    return { emailed: null, emailError: msg };
  }
}
