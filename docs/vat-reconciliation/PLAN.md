# VAT Invoice Reconciliation — build plan (v5, final for approval)

**Status:** awaiting Graeme's approval. No code written.
**Author:** Claude, 27 Aug 2026 (v5 — adds the supplier knowledge base and the
industry-practice recommendations after Graeme's "what are the best companies doing?"
question)
**Where it lives:** inside the existing production planner (Graeme's decision) — same
login, same database, same Railway deployment. Bookkeepers get their own users with a
finance-only access level.

All decisions are now made; there are no open questions left in this document. This
version is the one to approve or amend.

---

## 1. The problem and the shape of the answer

**How the bookkeeping actually works** (refined 27 Aug against the real "Outstanding
Transactions" Google Sheet): the ideal is not to post until the invoice is in hand, but
in practice the bookkeepers often **do post with a best-guess category and an estimated
VAT split** ("Posted to factory equipment — need invoice", "KC posted with VAT split —
please provide invoice") and then track the missing document by hand in the sheet. Other
lines sit unposted ("Not posted"). So the missing-invoice population spans **both** sides
of QuickBooks — posted-but-undocumented and not-yet-posted — and the QuickBooks API
cannot see the unposted side (the "For Review" queue is walled off; Intuit policy,
permanent). Any design that asks the bookkeepers to change how they post creates the
work this app exists to remove. Their workflow does not change. At all. The Google Sheet,
however, retires: the app *is* that sheet, automated.

**So the app works in front of QuickBooks, not behind it:**

1. It learns about spend from the **Capital on Tap card statement** (a simple exported
   file — details below) and the Allica account.
2. For every card line QuickBooks doesn't have yet, it scours
   `graeme@thecalzonekitchen.co.uk` (hosted on one.com, read over IMAP — the same
   connection Apple Mail uses) for the invoice, or failing that for *information* about
   the purchase.
3. Found invoice PDFs are stored permanently, viewable and downloadable by the
   bookkeepers, and pushed into QuickBooks' attachments area so the document is already
   waiting when they post.
4. Genuinely missing invoices get a drafted chase email that appears in Graeme's Apple
   Mail drafts folder for him to review and send.
5. When the bookkeeper posts the transaction in QuickBooks — exactly as she does today —
   the app notices via its hourly sync. **A line closes itself when it is both posted
   and adequately documented; nobody ever ticks anything off.** "Adequately" depends on
   the line (next point): a posted line still missing its document stays open as
   "posted — invoice still needed", which is exactly the state the green notes in the
   Google Sheet track by hand today.
6. **"Adequate" is judged against what the line actually needs.** A UK purchase with VAT
   to reclaim needs a proper VAT invoice. An international or no-VAT purchase (Railway,
   many SaaS tools, foreign suppliers) has no VAT to reclaim — a receipt or order
   confirmation is normally sufficient evidence there, and the app treats it as
   completing the line rather than flagging it forever. This one rule dissolves the
   recurring "is an order confirmation good enough?" back-and-forth: the app answers it
   per line, explicitly, instead of the accountants and Graeme re-litigating it by
   email.

**Decisions locked in from conversation with Graeme (27 Aug):**

- Lives **inside the production planner** — shared logins, new finance-only access level.
- Bookkeepers are Graeme's mum and a family friend (trustees, trusted, already hold bank
  logins). They reliably log in and want the work — the app's job is purely to remove the
  information gap, with the **fewest possible extra steps for them**.
- No holding accounts, no posting-before-invoice, no auto-add rules (maybe much later).
- Card data arrives by file export — bookkeepers weekly or whenever they like; must be as
  frictionless as possible; automation of this is investigated early.
- **Amazon is deprioritised**: no invoice emails exist; the bookkeeper logs into the
  Amazon Business account and downloads invoices herself; that's under control. The
  app just labels Amazon charges helpfully. Focus is on **other suppliers**.
- No summary emails — the summary is the top of the dashboard they already log into.
- Push found PDFs into QuickBooks: **yes**.
- One-time backfill of the last 2–3 months; the app is a going-forward fix.
- one.com has no per-mailbox app passwords (checked 27 Aug — its 2FA covers the control
  panel login only, now enabled). The app connects with the mailbox password itself,
  exactly as Apple Mail does, stored encrypted.
- **New: delivery-door photo capture** — staff photograph invoices/delivery notes as
  goods arrive; the photos land on the bookkeepers' dashboard the same day. See below.
- **New: the app is an advisor, not just a filing cabinet.** The goal (Graeme, 27 Aug
  evening) is that the bookkeepers never face a naked card line: even when no invoice
  exists, the app supplies everything it knows — supplier details, what this usually is,
  how it's usually categorised — clearly labelled as confirmed fact or best guess. The
  supplier knowledge base (next section) is that idea made concrete.

---

## 1a. The supplier knowledge base — the advisory layer

Every supplier gets a living profile card that appears alongside any of their card lines:

- **Contact details:** website, accounts email address, phone number, a named point of
  contact if we have one, portal login URL if their invoices live behind one.
- **What we buy from them:** learned from every invoice the app reads and every line the
  bookkeeper posts — "usually cleaning supplies", "usually equipment", with the actual
  history one click away.
- **Usual categorisation:** the QuickBooks category this supplier's lines historically
  land in, offered as a suggestion — "the last 9 Screwfix lines were posted to Repairs &
  Maintenance". The bookkeeper still decides; the app just saves her the archaeology.
- **VAT profile:** whether their invoices normally carry standard, zero, or mixed VAT —
  learned from real invoices.
- **Invoice behaviour:** do they email invoices unprompted, only on request, portal-only,
  or never? This drives what the app does with their lines (auto-find, chase, or go
  straight to "here's everything we know" without a pointless chase).

**Every field carries a confidence label — "confirmed" or "estimate".** Contact details
harvested from an email signature start as estimates; ones Graeme or a bookkeeper edits
become confirmed. Categorisation suggestions always show their evidence ("based on 9
previous postings"). Estimates are honestly presented as estimates, exactly as Graeme
specified — and they harden into facts with use, without anyone doing data entry as a
task. Profiles are editable by admin and bookkeepers alike; a "rules per transaction
type" layer (different handling for subscriptions vs one-offs vs fuel vs refunds) grows
on top of this in a later phase, once real usage shows which rules earn their keep.

The knowledge base starts life in Phase 1 (basic profile card + editable contacts) and
gets its learning loops in Phase 3 alongside the matching engine, which feeds it.

---

## 2. Where transactions come from

### 2.1 The card statement export (primary source)

Capital on Tap's website has an export button that downloads the card's transaction
history as a spreadsheet file (CSV): one row per transaction — date, merchant descriptor,
amount. **A real export is now in hand** (28 Jul–27 Aug, saved at
`docs/vat-reconciliation/samples/capital-on-tap-2026-08.csv` as the parser's reference
fixture), and it's richer than planned for:

- **Both dates**: separate authorisation and clearance dates per line — the
  auth-vs-settlement drift the matcher worried about is handed to us directly (match
  against the authorisation date, the one closest to when the order was placed).
- **A pre-cleaned `Merchant Name` column** alongside the raw descriptor — the
  normalisation problem starts half-solved.
- **`Cardholder Name` per line** — buyer attribution for free (three cardholders in the
  sample: Graeme, Jane Miles, Jacqueline Carter).
- **Foreign currency handled natively**: `Original Amount` + `Original Currency` (e.g.
  Railway $20.00 → £14.93, Klaviyo $1,235 → £919.45) — no exchange-rate table needed for
  card lines; the implied rate is on the row.
- **Repayments are explicit**: negative "Payment made (…)" rows, excluded by rule.
- A `Has Receipts` column — Capital on Tap has its own receipt-attachment feature
  (unused: all "No"). Noted as a possible future complement, not part of this design —
  the bookkeepers live in QuickBooks, not the card portal.
- Sample volume: 96 purchase lines, ~£35.8k spend in the month — against ~34 unresolved
  lines in four months on the outstanding sheet. So ~90% of lines already resolve
  themselves through existing habits; the app's matching effort aims at the ~10%/month
  tail, while its storage/advice value applies to everything.

There is no proper API for cardholders (verified — their accounting integration
feeds QuickBooks' For Review queue, the one place the API can't read), so the export is
the clean route.

Designed for minimum friction, per Graeme:

- **Drag-and-drop upload box, front and centre on the bookkeeper dashboard.** Log in →
  export → drop the file. Done.
- **Any-time, overlap-safe.** Every row is deduplicated (source + date + amount +
  descriptor hash), so exports can overlap freely — nobody needs to remember where the
  last one ended. Weekly is the suggested rhythm; more often is fine; the dashboard shows
  "card data current to \<date\>" so staleness is visible, not nagged about.
- **Phase 0 investigates killing the manual step entirely:** if Capital on Tap can email
  statements (CSV or parseable PDF) to graeme@ — a mailbox the app already reads —
  ingestion becomes automatic and the manual export becomes the backup. Same check for
  Allica. The plan works either way.
- Allica gets the same treatment at a lower cadence (supplier direct debits live there;
  the card is where the messy spend is).
- Parsers are fixture-tested per source; a format change alarms loudly rather than
  importing garbage.

### 2.2 QuickBooks' role — completion, not discovery

Hourly sync (Change Data Capture) of posted Purchases/Bills. Each newly posted
transaction is matched against open card lines (exact/near-exact amount + date within 3
days + descriptor similarity — conservative; anything ambiguous goes to a small review
list rather than auto-closing). A matched line becomes **posted** — done. Posted
transactions also carry the real VAT figures, which feed reporting ("VAT reclaimed vs
written off this quarter") and teach the app each vendor's VAT profile.

Known limitation, stated honestly: a brand-new charge is invisible to the app until the
next export lands. Bounded by the upload rhythm; the acceptable cost of leaving the
bookkeepers' workflow untouched.

### 2.2a Seed data: the Outstanding Transactions backlog

The current manual system — the shared Google Sheet where the team logs transactions
they can't document and Graeme hunts — is **replaced outright, immediately**. Graeme has
supplied its full contents (screenshot, 27 Aug — roughly 35 open lines, ~£4,800 gross,
aging back to April); that data is seeded into the app during Phase 1 as the opening
backlog, statuses and notes included ("posted — need invoice", "not posted", "KC posted
with VAT split", "chasing"). Nobody exports, shares, or updates the sheet again. The
backlog also taught the plan things it now reflects: multiple cards are in play (the REF
column holds card last-four digits — 3465, 9275, 3456, 7859 — mapping to team members,
so lines carry per-card, per-buyer attribution), roughly half the outstanding lines are
recurring subscriptions, and the bookkeepers have asked for the bank/card provider to be
shown per line — the app does that natively.

### 2.2b Moment-of-purchase capture (Graeme's addition)

For odd, one-off purchases from random websites — the hardest lines to reconstruct weeks
later — Graeme records them **at the moment of buying**, from his phone, in whatever form
is fastest: a dictated/typed note ("just bought a replacement pump from Aluxo, about
£315"), or a screenshot of the order confirmation. The app files it as a *pending
purchase*; when the card line arrives days later, it matches on amount/date/supplier and
the bookkeeper gets the full story without anyone reconstructing anything. Same phase as
the delivery-door photos — it's the same principle (capture at the moment, not after)
applied to online buying instead of the goods-in door. The planner already has an AI
quick-add pattern (founder tasks) to reuse for parsing the free-text note.

### 2.3 Delivery-door photo capture (Graeme's addition — new)

Suppliers who hand over paper at the door (the weekly-paperwork-collection problem):

- A simple page on the kitchen iPad — the planner already lives there — "Received a
  delivery? Photograph the paperwork." Snap invoice and/or delivery note, pick the
  supplier from a list (or skip it), done. Autosave with visible save state, per the
  charter, like every other data-entry surface in the planner.
- Photos are stored like every other document (permanently, in the database), flagged as
  needing pairing, and surface on the bookkeeper dashboard the same day: "3 new documents
  from deliveries today."
- When the matching card/Allica line arrives later, the photo is already in the candidate
  pool — date + supplier + any amount the text extraction can read off the image make it
  an easy match.
- HMRC accepts legible digital copies of invoices, so a decent photo is real evidence,
  not a stopgap — the validity checker (below) runs on photos too, and flags an illegible
  one so someone knows to keep the paper.
- Kitchen staff see only the camera page — never amounts, dashboards, or anything
  financial.

---

## 3. Where it lives: inside the production planner

Graeme's call, and it simplifies the build: login system, database, deployment, backups,
and UI conventions all already exist.

| Layer | Approach |
|---|---|
| API | New route files in `artifacts/api-server/src/routes/` (e.g. `finance-*.ts`) — no new code in the charter's frozen files (`production-plans.ts`, `settings.tsx`, `reports.tsx`) |
| Frontend | New pages in `artifacts/production-planner` — React Query for all data fetching, shadcn/ui, autosave with visible save state on every entry field |
| Database | Same planner Postgres; new tables via Drizzle migration files in `lib/db/migrations/` (auto-applied at startup — the established pattern). Covered by the Railway daily volume backups already verified working. |
| Validation | zod `validate()` on every new endpoint (charter rule; this is money-shaped input) |
| Users & roles | Existing users table. New **bookkeeper** access level: sees the finance pages and nothing of kitchen operations; kitchen roles see nothing of finance; admin (Graeme) sees everything. Mailbox-touching endpoints are **admin-only, enforced at the route layer** — bookkeepers can see documents the app has filed, never raw email. |
| Jobs | The planner's existing in-process scheduling approach; every job idempotent, cursors persisted in the DB, resumable after any deploy |
| Deploys | Rides the normal dev → master flow. The no-deploys-7am–3pm rule and "only push master on explicit deploy" apply as ever. |
| Write guards | `BLOCK_QBO_WRITES` env flag gating all QuickBooks writes, same pattern as `BLOCK_SHOPIFY_WRITES` |

Trade-offs accepted with the monorepo choice (for the record): financial tables share the
kitchen app's database and deploy cycle, and a planner bug/deploy can in principle touch
them. Mitigations: separate route files, migrations reviewed like any other, the write
guard, and app-layer encryption of credentials (below). The shared-login benefit is worth
it — the bookkeepers get one front door and Graeme keeps one system to run.

### 3.1 Storing invoice PDFs: permanent, in the database — and why the label rule doesn't apply

Reuses the planner's existing pattern (documents stored as binary columns, served by
same-origin routes — the `risk_assessments` approach). One contrast to put on record: the
planner deliberately **never** stores carrier label PDFs
([fulfilment.ts:1314](artifacts/api-server/src/routes/fulfilment.ts:1314) — "a cached PDF
is a wrong label on a real box"), because labels are mutable and a stale one misroutes a
real parcel. Supplier VAT invoices are the exact opposite on every axis: **immutable once
issued** (corrections arrive as a credit note plus a new invoice), a stale copy *is* the
correct copy, a missing copy can cost the VAT reclaim (portals expire, suppliers fold),
and HMRC requires **six-year retention**. Permanent storage is not a violation of the
label lesson — it's the same reasoning reaching the opposite conclusion, and this
paragraph exists so nobody ever "fixes" it.

Serving into the viewer: same-origin routes (`/api/finance/documents/:id/file.pdf`),
never `blob:` URLs — the planner's Content-Security-Policy (`frame-src 'self'`) blocks
those, a lesson already paid for. Plus a sandbox policy on the PDF response itself, since
these files come from arbitrary external senders.

---

## 4. QuickBooks integration

- **Entities:** `Purchase` (what the QuickBooks UI calls an Expense) and `Bill` for
  completion detection; `Attachable` for reading (does a posted transaction already have
  a document?) and writing (below); `VendorCredit` to net refunds. Explicitly excluded:
  `BillPayment` (it's the settlement — counting it doubles things) and `Transfer` (the
  monthly Capital on Tap repayment from Allica must never look like chaseable spend).
- **UK VAT specifics:** non-US QuickBooks uses the global tax model —
  `GlobalTaxCalculation` says whether a total is VAT-inclusive or exclusive (getting this
  wrong skews every amount comparison by 20% on some transactions — the single
  highest-risk field), `TaxCodeRef` per line uses company-specific IDs (fetched and
  cached at connect time, never hard-coded — the charter's no-hard-coded-names rule),
  `TxnTaxDetail` is the authoritative VAT breakdown. Reverse-charge codes get their own
  bucket. API version pinned at `minorversion=75` (versions 1–74 were retired Aug 2025).
  **The exact UK shapes are verified empirically in Phase 0** — a UK sandbox (region is
  permanent at creation; must be created as UK) plus a read-only pull of ~20 real
  transactions — before any matching logic depends on them.
- **Cost:** Intuit's developer platform charges usage fees since mid-2025, but the free
  tier allows 500,000 read operations/month and writes are free. Our design (one company,
  hourly change-detection sync) uses roughly 1,000–3,000 reads/month — under 1% of the
  free tier. Effectively £0, with a watch-item: if Intuit ever shrinks the free tier,
  our usage is small enough that even the design's worst case stays far inside it.
- **Tokens:** access tokens live 1 hour; refresh tokens live 100 days **but rotate
  roughly daily** — the app persists each new pair atomically before using it, refreshes
  proactively at ~45 minutes, and serialises refreshes behind a database lock so
  overlapping deploy instances can't race each other into a dead connection. A dead
  connection shows a loud dashboard banner — it must never look like a quiet week.
  Intuit's Reconnect URL (mandatory in their portal since Feb 2026) points at the app's
  QuickBooks settings page.
- **Pushing PDFs into QuickBooks** (Graeme: yes): the twist in this workflow is that when
  an invoice is found, the transaction usually **doesn't exist in QuickBooks yet** — so
  the app uploads it as an **unattached document** (an `Attachable` with no transaction
  reference), which lands in QuickBooks' attachments list (Gear menu → Attachments),
  named findably (`2026-08-14 Screwfix £84.20.pdf`). The bookkeeper attaches it in one
  click when she posts. If the transaction does already exist, it's attached directly.
  Guard rails: per-line "Push to QuickBooks" button (auto-push is a later opt-in), the
  `BLOCK_QBO_WRITES` flag, and never pushing a document the validity checker couldn't
  read. **Phase 0 verifies this unattached-upload flow works pleasantly in a real UK
  company file — it's now core, and it's only paper-verified.**

---

## 5. The mailbox connection (one.com IMAP)

- Connects to `imap.one.com` (SSL) exactly as Apple Mail does, authenticated with a
  the **mailbox password** — one.com offers no per-mailbox app passwords (confirmed
  27 Aug; its 2FA protects only the control panel login, which Graeme has now enabled).
  Because this is IMAP and not Gmail, the entire Google verification bureaucracy from
  earlier drafts simply doesn't exist.
- Honest trade-off: the IMAP password is full-mailbox access — there's no read-only
  variant. Mitigations: it's encrypted at rest (below), the app contains **no code paths
  that delete or send mail at all**, and the password is revocable in one.com's control
  panel in seconds.
- **The app never mirrors the mailbox.** It scans message headers, classifies which
  messages look invoice-like (sender, subject keywords, PDF attached), fetches bodies
  only for those, extracts features (amounts, order numbers, VAT numbers), and stores
  only those features. Bodies are processed in memory and dropped. Full PDFs are stored
  only when attached to a card line. A database compromise therefore yields supplier
  invoices and a transaction list — not the mailbox.
- Incremental sync hourly; the initial one-time scan covers the agreed 2–3 month
  backfill. Folder gotcha checked in Phase 0: if Apple Mail files things into "On My
  Mac" folders, those are local to the Mac and invisible to IMAP — invoices would need to
  live in server-side folders instead.
- Threads are reconstructed from mail headers, because the message that matches on
  amount is often the order confirmation while the actual PDF hangs off a later reply —
  candidates always expand to their whole conversation before harvesting attachments.
- HTML-only invoices (SumUp, Stripe, subscriptions) are rendered to PDF and stored
  marked as such. "Log in to view your invoice" portal emails get a status of their own
  with the link captured — the app never logs into supplier portals.

---

## 6. Statuses, matching, and chasing

### 6.1 The life of a card line

```
   file upload ──▶ open ──▶ (app scours mailbox + photos)
                    │
     ┌──────────────┼───────────────┬─────────────────────┐
     ▼              ▼               ▼                     ▼
  matched       identified     needs_chasing       not_reclaimable
  (invoice      (we know what  (nothing found,     (no VAT to recover —
  in hand)      it was, no     worth chasing)      zero-rated etc.)
                invoice yet)        │
                                    ▼
                                 chased ──▶ reminder ×2 ──▶ written_off
                                    │                       (admin only,
                                    ▼ invoice arrives        reason required)
                                 matched
     └──────────────┴───────────────┴─────────────────────┘
                                    ▼
                    posted — bookkeeper posts in QuickBooks;
                    the app notices and closes the line itself
```

Two separate gradings per line, kept deliberately distinct: the **status** above, and an
**evidence grade** answering "would HMRC accept this document for reclaim?" — full VAT
invoice / simplified (£250-and-under rules) / insufficient / none. An order-confirmation
email identifies a purchase without evidencing it; a line can be *matched* yet carry an
*insufficient* document, and the dashboard shows that as a problem, not a win — that
exact case is today's silent money leak. Documents are append-only (superseded, never
deleted — six-year retention makes deletion a compliance event, not a button). Every
state change is audit-logged. Write-offs are admin-only and require a reason: throwing
away VAT should feel like a decision.

### 6.2 Matching (the engine)

Card descriptor ↔ mailbox/photos. Four stages, all deterministic and unit-testable
(pure logic, per the charter's testing rule) — no AI in the scoring:

- **Candidates, generously:** date-windowed messages matching the vendor's known sending
  domains, or containing a plausible amount, or matching the normalised descriptor —
  expanded to whole threads. Photos from the door join the same pool.
- **Descriptor normalisation:** card descriptors are hostile (`SUMUP *THE BAKERY`,
  `WWW.SCREWFIX.C`, `PAYPAL *NITROPACK`) — a tested pipeline strips processor prefixes
  (the token *after* `SUMUP *` is the real merchant), branch numbers, cities, legal
  suffixes, and compares prefix-tolerantly (descriptors truncate at ~22 characters).
  Every human confirmation teaches an alias table (descriptor pattern → supplier →
  email domain), so the second Screwfix invoice matches near-certainly because a human
  confirmed the first. The engine is meaningfully better in week 4 than week 1.
- **Amounts, in tiers, because they legitimately differ:** exact; net-vs-gross (VAT);
  plus-delivery; split shipments; within 1%; foreign currency against a daily exchange
  rate table (foreign purchases rarely carry reclaimable UK VAT — identified, not
  chased). Amount alone is never sufficient — two unrelated £12.99s in a week is normal.
- **Dates:** invoice usually at/before dispatch, card settles after, some suppliers bill
  monthly in arrears — window from 30 days before to 5 days after the charge, scored on
  a plateau that decays at the edges.
- **Confidence with honest thresholds:** scores 0–100; above a high bar auto-match, a
  middle band goes to a human review queue (with a one-line "why we think this matches"),
  below rejects. **The bars are calibrated, not invented:** the engine launches in
  shadow mode — scoring everything, auto-matching nothing — until ~200 human decisions
  let us set the auto bar where observed precision is ≥99%. The asymmetry demands it: a
  wrong auto-match attaches the wrong invoice and *looks correct* — an HMRC exposure
  found by an inspector, not by us; a missed match just costs a human glance. If the top
  two candidates score within 10 points of each other, it's forced to review regardless.
- **Where AI is used** (Anthropic API, as the planner's Caz tools already do): reading
  fields out of PDFs and photos (VAT number, tax point, VAT breakdown — checked against
  format rules including the VAT-number checksum), drafting chase emails, and writing
  the one-line match explanations. AI output never changes a status directly.

**Amazon, deprioritised per Graeme:** no invoice emails exist and the bookkeeper
self-serves from the Amazon Business account, which is under control. The app just
recognises Amazon descriptors, marks lines *identified*, and links to the orders page.
No order-email harvesting, no clever machinery — revisit only if Amazon lines turn out
to clog the review queue. Focus stays on other suppliers.

### 6.3 Chasing — and the recurring-subscription rule

**Recurring subscriptions get their own treatment, not chases.** The real outstanding
list is dominated by them — Apple (twice monthly), one.com, Slack, Railway, Gigaclear,
Starlink, HP Instant Ink, Indeed. Emailing Railway a chase is pointless: as Graeme says,
they post "you have a new bill" and the invoice lives behind a login. For these, the
supplier profile stores *where the invoice lives* (portal URL, which login, any direct
invoice-page link) and the app rolls every portal-dwelling invoice into **one monthly
"portal run" checklist** — a single sitting of ten downloads with links, instead of ten
scattered nags across the month. Each new month's charge from a known subscription
auto-creates its checklist entry; many of these are also international/no-VAT, where the
emailed receipt already suffices (see the "adequate evidence" rule) and nothing needs
doing at all.

- **Priority is expected VAT at stake, not count.** TCK is a food business — much spend
  is zero-rated, where a chase recovers £0. Each vendor carries a learned VAT profile
  (standard/zero/mixed/unknown — confirmed automatically from every invoice the app
  reads); known zero-rated vendors are never chased. Likely the single biggest cut to
  the list.
- Drafts are templated + AI-polished: supplier, date, amount, explicitly requesting a
  **VAT invoice** (the phrase matters — "receipt" gets you a card slip), including TCK's
  VAT number and address so it's issued right first time. **Batched per supplier** —
  twelve Screwfix lines make one email, not twelve.
- Delivery: the app places the draft **directly into the one.com Drafts folder over
  IMAP, so it appears inside Apple Mail's drafts** as if Graeme wrote it. He reviews and
  sends; the app never sends anything. Replies land in the normal inbox; a reply
  carrying a PDF enters the matcher pre-linked to its chase (near-certain match); silence
  triggers reminders at 7 and 21 days, then a *proposed* write-off for Graeme to decide.
  Send detection is a heuristic (draft disappears + a matching message in Sent) backed
  by a manual "mark as sent" button. **Phase 0 tests this draft round-trip on one.com
  specifically** — shared-host IMAP servers vary; the fallback is a copy-paste flow.

---

## 7. Security, privacy, compliance

- **Credentials** (QuickBooks tokens, one.com mailbox password) encrypted at the application
  layer (AES-256-GCM, key in a Railway env var). Reason: Railway's daily backups copy
  the database; plaintext credentials would make every backup a standing key to the
  mailbox. Encrypted, a leaked backup is inert. Never logged; auth headers redacted in
  any debug logging.
- **Access levels:** bookkeepers see finance pages, stored documents, and the review
  queue — never raw email, connections, settings, or kitchen operations; kitchen staff
  see only the delivery-photo page; everything mailbox-touching is admin-only at the
  route layer. Kept even though the bookkeepers are trusted family: it's cheap hygiene,
  and the login itself can always be phished. Per-download audit logging throughout.
- **HMRC validity — the app validates, not just stores.** A stored PDF that isn't a
  valid VAT invoice doesn't support reclaim. Over £250: supplier VAT number, invoice
  number, tax point, customer details, VAT shown separately, and the rest of the full
  requirements. £250 or under: the shorter "simplified invoice" rules apply — the checker
  is amount-aware so a £14 receipt isn't flagged for missing things it doesn't need.
  VAT numbers are format- and checksum-checked. The most common real failure — the
  document is an order confirmation, quote, or delivery note rather than an invoice —
  is checked explicitly. This is a completeness check on the document's face, not tax
  advice.
- **UK GDPR:** this is the founder processing his own mailbox — not worker monitoring,
  so the heavyweight ICO monitoring-at-work regime doesn't apply (revisit immediately if
  a staff or shared mailbox ever comes into scope). Lawful basis: legitimate interests,
  documented in a one-page assessment. Retention: VAT records six years (legal
  obligation — no GDPR conflict); email metadata for rejected candidates purged after 90
  days; all written down, because "kept forever because it felt safer" is the actual
  non-compliance.

---

## 7a. What the best-run companies do — and what we're adopting

Graeme's question: this is a fundamental, common business problem — what would the best
company in the world be doing? Honest answer, ranked by leverage for TCK, with what each
one costs:

**1. A dedicated accounts email address — exists, with a real limitation.**
TCK already has `accounts@thecalzonekitchen.co.uk`. But Graeme's constraint (27 Aug) is
structural: most supplier accounts allow **one email address**, which doubles as the
login — and it has to be his, because 2FA codes and password resets land there, and he
needs to order at will. Marketing spam to the accounts address is also unwanted. So the
realistic rule is: **use the accounts address only where a supplier separates "billing
email" from "login email"** (many do — set it and forget it), and everywhere else let
invoices land in graeme@ — which is fine, *because reading graeme@ automatically is
precisely what this app does*. The app's mailbox-scouring converts the personal-inbox
bottleneck from a process problem into a solved technical one. The related shared-login
pain (bookkeepers locked out of supplier portals by 2FA codes going to Graeme) is real
but separate — the practical fix is a shared password manager whose vault holds the
authenticator-app codes too (1Password-style, so codes generate for whoever has vault
access, no inbox needed, wherever suppliers offer authenticator 2FA). Noted for Graeme;
not an app feature. **The app watches both mailboxes if accounts@ receives anything
today — to confirm.**

**2. Fix it at the source: trade accounts with repeat suppliers.**
The best companies make invoices arrive automatically rather than finding them cleverly.
Most repeat suppliers (Screwfix, Booker, and their like) offer free business/trade
accounts that email a proper VAT invoice on every purchase, unprompted — the Amazon
Business move, repeated everywhere it exists. The app supports this by reporting which
suppliers generate the most chasing (the "supplier scorecard"), turning "who should we
get an account with next?" into a ranked list. **Adopted: scorecard in the polish phase;
opening the accounts is an ongoing 10-minutes-each habit, not a build item.**

**3. Supplier statement reconciliation.**
Mature bookkeeping asks key suppliers for a monthly statement of account, then checks it
against what's on file — missing invoices reveal *themselves*, before anyone hunts. The
chase email template will offer suppliers this option ("or add us to your monthly
statement run"), and a statement-checking view is queued for the polish phase. **Adopted,
later phase.**

**4. Capture at the moment of purchase, not after.**
Spend-management card platforms (Pleo, Soldo, Payhawk and similar) prompt the buyer to
snap the receipt the moment the card is charged, then push transaction + image straight
into QuickBooks. It's the gold standard for staff spend — but adopting one would mean
replacing Capital on Tap, which is a commercial decision (credit line, rewards) well
beyond this project. **Partially adopted: the delivery-door photo page is exactly this
principle applied to paper, without changing the card.** If TCK ever outgrows Capital on
Tap, this is the category to look at.

**5. Off-the-shelf invoice-capture tools — the honest build-vs-buy note.**
Dext, Hubdoc and AutoEntry (~£10–25/month) do part of this: you forward or photograph
invoices, they extract the data and publish to QuickBooks with the document attached. If
the plan were *only* "get documents into QuickBooks", buying one would beat building.
What they don't do — and where this build earns its keep — is everything TCK actually
asked for: scouring an *existing* mailbox for historical and unforwarded invoices,
matching against the card statement to show what's *missing*, chasing suppliers, the
advisory layer, and living inside the planner the team already uses. They could even run
alongside us later if wanted; nothing in this design conflicts. **Considered, not
adopted — but recorded so the decision is a decision.**

**6. QuickBooks' own receipt-forwarding.**
QuickBooks has a built-in address you can forward receipts to; it extracts and suggests
matches against posted transactions. Free and harmless, but it only helps *after*
posting — which is backwards for TCK's actual problem — and using it alongside the app
would put documents in two places. **Not adopted for now; noted so nobody wonders.**

The theme across all six: the best companies don't chase better — **they arrange for
there to be less to chase.** Items 1 and 2 are that principle, and they're also the
cheapest things on this page.

---

## 8. Build order

### Phase 0 — prove the risky bits (2–3 days, no product)

1. Get one real Capital on Tap export: columns, descriptor quality, how descriptors
   compare with what QuickBooks' bank feed shows. Check whether statements can be
   emailed in for automatic ingestion.
2. UK QuickBooks sandbox + read-only pull of ~20 real transactions: pin down the UK VAT
   field shapes; verify the unattached-document upload lands nicely in the Attachments
   list.
3. one.com round trip with the mailbox password: scan speed, the draft-into-Apple-Mail test,
   and the local-folders check.
4. Count the problem: unposted card lines over the last 2–3 months and estimated VAT at
   stake. **If this comes back tiny, we stop and chase them by hand — that outcome is
   explicitly on the table.**

### Phase 1 — the list (~1 week)

CSV upload + dedupe → the line queue; QuickBooks sync + auto-close on posting; bookkeeper
dashboard (summary block on top — their "digest" lives here, no emails) sorted by
expected VAT at stake; manual PDF upload + viewer + validity check; bookkeeper access
level; **supplier profile cards** (editable contacts, website, accounts email, notes —
the knowledge base's skeleton, learning loops come in Phase 3); and the **one-time
import of the Outstanding Transactions Google Sheet** (suppliers, statuses, notes,
backlog to April), after which the sheet retires. No email reading yet. **This alone
removes most of their information gap.**

### Phase 2 — delivery-door photos (~half a week)

The iPad capture page, dashboard surfacing, photos joining the document pool. Scheduled
early per Graeme — it's independent of the mailbox work and delivers same-day paperwork
immediately.

### Phase 3 — the mailbox engine (2–3 weeks)

IMAP connection, local index, 2–3-month backfill scour, matching in shadow mode, review
queue, alias learning, push-to-QuickBooks behind its guard. Exit: ~200 human decisions →
calibrate thresholds → switch on auto-match.

### Phase 4 — chasing (1–2 weeks)

Supplier-batched drafts into Apple Mail, reply watching, reminders, write-off flow.

### Phase 5 — polish

VAT-period reporting, HMRC VAT-number lookup API, supplier scorecards ("this supplier
never sends invoices unprompted" — the ranked who-to-get-a-trade-account-with-next list),
supplier statement reconciliation view, per-transaction-type rules on top of the
knowledge base (subscriptions vs one-offs vs fuel vs refunds), statement-email
auto-ingestion if Phase 0 found it viable, auto-add QuickBooks rules if the bookkeepers
ever warm to them.

---

## 9. Honest risk list

| Risk | Level | Notes |
|---|---|---|
| Export habit lapses | High | The queue's freshness rests on a small recurring task. Mitigated: any-time overlap-safe uploads, visible "current to" date, and Phase 0's hunt for full automation. |
| Line-to-QuickBooks completion matching errs | High | Wrongly closing a line whose invoice is missing is the silent failure the app exists to prevent. Conservative thresholds; ambiguity goes to review, never auto-close. |
| Wrong invoice auto-attached | High | Looks correct, discovered by an HMRC inspector. Shadow mode, 99%-precision calibration, ambiguity guard, append-only documents, audit log. |
| Silent sync death (rotated token lost, mailbox password changed) | High | A stale dashboard looks healthy. Per-connection heartbeats, loud banner after 6 hours, daily alert while broken. |
| IMAP password is full-access | Med-High | No read-only IMAP exists. Encrypted at rest, no delete/send code paths, revocable in seconds, minimised data retention. Accepted trade. |
| one.com drafts quirks | Medium | Shared-host IMAP varies. Phase 0 tests before the feature is promised; copy-paste fallback. |
| Export format drift | Medium | Fixture-tested parsers; failures alarm, never import garbage. |
| Descriptor long tail | Medium | First 20 suppliers take a day, last 20 take a week. Alias learning; judge the engine at week 4. |
| Photo quality at the door | Medium | Blurry photos are worthless as evidence. Validity checker flags illegible ones same-day so the paper is kept. |
| Portal-only suppliers | Medium | "Log in to view invoice" — no attachment ever exists. Own status + captured link; no portal scraping, ever. |
| Shared database/deploys with the kitchen app | Medium | Monorepo trade-off, accepted for shared logins. Separate route files, write guard, encrypted credentials, reviewed migrations. |
| Postgres growth from stored documents | Low | Roughly 2GB over six years at TCK volume. Monitored. |

**Where this plan is most likely wrong, stated plainly:**

1. **The matching engine may be more machine than the volume justifies.** If Phase 0
   counts ~30 problem lines a month, Phase 1's list plus the photo page probably solves
   the whole thing and the engine never earns its keep. Phase 0 exists to catch this,
   and stopping after Phase 2 would be a success, not a failure.
2. **The unattached-upload flow in QuickBooks is core and only paper-verified.** If
   attaching from the Attachments list turns out to be awkward at posting time, the
   fallback is downloading from the dashboard — workable but weaker. Phase 0 settles it.
3. **UK VAT edge cases will be messier than modelled** — mixed-rate invoices, margin
   schemes, imports. The validity checker and vendor VAT profiles will need tuning
   against real documents.
4. **Send-detection for chases is a heuristic**; the manual "mark as sent" button is the
   true mechanism, and if that annoys in practice the answer may be letting the app send
   — a scope change to discuss then, not assume now.

---

## 10. Your actions

Four small tasks, then a word:

1. ~~one.com setup~~ **Done 27 Aug** — control-panel 2FA enabled; no app passwords
   exist on one.com, so the app will use the mailbox password (entered into the app's
   settings screen when it exists, never shared in chat). Remember to update it there if
   the email password ever changes. During Phase 0 we'll also check whether
   `accounts@thecalzonekitchen.co.uk` receives supplier invoices — if it does, the app
   watches that mailbox too.
2. ~~Capital on Tap export~~ **Done 27 Aug** — real file received and saved as the
   parser's reference sample; findings folded into the plan above.
3. Create the UK QuickBooks practice company under your Intuit developer account (sign
   in at developer.intuit.com with your normal QuickBooks login — safe, touches nothing;
   10 minutes together; the country choice is permanent, so it must be United Kingdom).
4. Say "go" — approving this plan approves Phase 0 only; each phase ends with a check-in
   before the next starts.

The outstanding-backlog data is already in hand (from the screenshot); the Google Sheet
needs nothing further from anyone and retires the day Phase 1 ships.
