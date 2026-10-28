/**
 * Lucky Order Number — the engine (Graeme, 27 Oct 2026). Objective I.
 * Rules live in rules.ts; why and the tables in migration
 * 0325_lucky_order_offer.sql.
 *
 * Every minute while the offer is on:
 *   1. find orders placed since the offer started (Shopify, newest first)
 *      and log each winner once (lucky_order_winners);
 *   2. work each winner's steps, each with its own status so a retry never
 *      repeats one that already happened:
 *        gift   — order edit: add the gift variant at 100% off (no email)
 *        refund — full refund to the original payment once it's paid;
 *                 above the auto limit it waits for the founder's approval
 *        code   — single-use subscription discount for that customer
 *        email  — a transactional "you've won" email through Resend, to
 *                 every winner whatever their marketing consent; wording
 *                 per prize is written on the Live offers tab
 *
 * Practice mode logs winners and touches nothing. Shopify writes go through
 * shopifyGraphQLWrite, so staging / BLOCK_SHOPIFY_WRITES never touch the
 * store. A step that keeps failing stops after MAX_ATTEMPTS and tells the
 * founder.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { schedule } from "node-cron";
import { isStaging } from "../app-env";
import { FOUNDER_EMAIL } from "../founder-email";
import { sendEmail } from "../email";
import { shopifyAdminOrderBase, shopifyGraphQL, shopifyGraphQLWrite, ShopifyWritesBlockedError } from "../../services/shopify";
import { randomBytes } from "node:crypto";
import {
  winningTier, orderNumberFromName, windowStart, refundNeedsApproval, subscriptionCodeFor,
  initialStatuses, TIER_LABEL, practiceCodeFor, subscriptionDiscountInput, type LuckyTier, type OfferWindow,
} from "./rules";
import { buildWinnerEmail, DEFAULT_TEMPLATES, DEFAULT_TERMS, type WinnerEmailTemplates } from "./emails";

export const OFFER_KEY = "lucky_order_number";
const MAX_ATTEMPTS = 5;
/** Never look further back than this, even for a long-running offer. */
const LOOKBACK_MS = 6 * 3_600_000;
/** Replies to the winner emails land here unless changed on the tab. */
export const DEFAULT_REPLY_TO = "hello@thecalzonekitchen.co.uk";

export interface LuckySettings {
  giftVariantId?: string | null;
  giftTitle?: string | null;
  refundAutoLimit: number;
  subscriptionAmount: number;
  subscriptionCycles: number;
  /** Subject + body per prize, written on the Live offers tab. */
  emails: WinnerEmailTemplates;
  /** Small-print block under every winner email. */
  terms: string;
  replyTo: string;
}

export interface LuckyOffer extends OfferWindow {
  practiceMode: boolean;
  settings: LuckySettings;
  updatedBy: string | null;
  updatedAt: string;
}

type StoredSettings = Partial<Omit<LuckySettings, "emails">> & { emails?: Partial<WinnerEmailTemplates> };

function withDefaults(stored: StoredSettings | null): LuckySettings {
  const x = stored ?? {};
  return {
    refundAutoLimit: 100,
    subscriptionAmount: 75,
    subscriptionCycles: 6,
    ...x,
    emails: {
      gift: { ...DEFAULT_TEMPLATES.gift, ...(x.emails?.gift ?? {}) },
      gift_refund: { ...DEFAULT_TEMPLATES.gift_refund, ...(x.emails?.gift_refund ?? {}) },
      subscription: { ...DEFAULT_TEMPLATES.subscription, ...(x.emails?.subscription ?? {}) },
    },
    terms: x.terms ?? DEFAULT_TERMS,
    replyTo: x.replyTo || DEFAULT_REPLY_TO,
  };
}

export async function loadOffer(): Promise<LuckyOffer | null> {
  const r = await db.execute<{
    enabled: boolean; practice_mode: boolean; starts_at: string | null; ends_at: string | null;
    activated_at: string | null; settings: StoredSettings | null; updated_by: string | null; updated_at: string;
  }>(sql`SELECT enabled, practice_mode, starts_at, ends_at, activated_at, settings, updated_by, updated_at FROM live_offers WHERE key = ${OFFER_KEY}`);
  const x = r.rows[0];
  if (!x) return null;
  const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);
  return {
    enabled: x.enabled,
    practiceMode: x.practice_mode,
    startsAt: iso(x.starts_at),
    endsAt: iso(x.ends_at),
    activatedAt: iso(x.activated_at),
    settings: withDefaults(x.settings),
    updatedBy: x.updated_by,
    updatedAt: new Date(x.updated_at).toISOString(),
  };
}

// ── Shopify ────────────────────────────────────────────────────────────────

type UserErrors = Array<{ field?: string[] | null; message: string }>;
function check(what: string, errs: UserErrors | undefined) {
  if (errs && errs.length) throw new Error(`${what}: ${errs.map(e => e.message).join("; ")}`);
}

interface OrderNode {
  id: string; name: string; createdAt: string; sourceName: string | null; tags: string[];
  cancelledAt: string | null; email: string | null;
  customer: { id: string; email: string | null; firstName: string | null; lastName: string | null } | null;
  currentTotalPriceSet: { shopMoney: { amount: string } };
}

/** Orders created since `since`, oldest first. */
async function ordersSince(since: string): Promise<OrderNode[]> {
  const out: OrderNode[] = [];
  let after: string | null = null;
  for (let page = 0; page < 20; page++) {
    const r: { orders: { nodes: OrderNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } = await shopifyGraphQL(
      `query ($q: String!, $after: String) {
        orders(first: 100, after: $after, sortKey: CREATED_AT, query: $q) {
          nodes { id name createdAt sourceName tags cancelledAt email
            customer { id email firstName lastName }
            currentTotalPriceSet { shopMoney { amount } } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { q: `created_at:>='${since}'`, after },
    );
    out.push(...r.orders.nodes);
    if (!r.orders.pageInfo.hasNextPage) break;
    after = r.orders.pageInfo.endCursor;
  }
  return out;
}

/** Add the gift at 100% off with an order edit. Idempotent. */
async function addGift(orderId: string, variantId: string): Promise<"added" | "already"> {
  const variantGid = variantId.startsWith("gid://") ? variantId : `gid://shopify/ProductVariant/${variantId}`;
  const o = await shopifyGraphQL<{ order: { displayFulfillmentStatus: string; lineItems: { nodes: Array<{ variant: { id: string } | null; discountedTotalSet: { shopMoney: { amount: string } } }> } } | null }>(
    `query ($id: ID!) { order(id: $id) { displayFulfillmentStatus
      lineItems(first: 100) { nodes { variant { id } discountedTotalSet { shopMoney { amount } } } } } }`,
    { id: orderId },
  );
  if (!o.order) throw new Error("order not found in Shopify");
  if (o.order.lineItems.nodes.some(l => l.variant?.id === variantGid && Number(l.discountedTotalSet.shopMoney.amount) === 0)) return "already";
  if (o.order.displayFulfillmentStatus === "FULFILLED") throw new Error("order already dispatched — add the gift by hand or send it separately");

  const begin = await shopifyGraphQLWrite<{ orderEditBegin: { calculatedOrder: { id: string } | null; userErrors: UserErrors } }>(
    "luckyOrderEditBegin",
    `mutation ($id: ID!) { orderEditBegin(id: $id) { calculatedOrder { id } userErrors { field message } } }`,
    { id: orderId },
  );
  check("starting the order edit", begin.orderEditBegin.userErrors);
  const calcId = begin.orderEditBegin.calculatedOrder!.id;

  const add = await shopifyGraphQLWrite<{ orderEditAddVariant: { calculatedLineItem: { id: string } | null; userErrors: UserErrors } }>(
    "luckyOrderEditAddVariant",
    `mutation ($id: ID!, $variantId: ID!) { orderEditAddVariant(id: $id, variantId: $variantId, quantity: 1, allowDuplicates: true) {
      calculatedLineItem { id } userErrors { field message } } }`,
    { id: calcId, variantId: variantGid },
  );
  check("adding the gift", add.orderEditAddVariant.userErrors);

  const disc = await shopifyGraphQLWrite<{ orderEditAddLineItemDiscount: { userErrors: UserErrors } }>(
    "luckyOrderEditDiscount",
    `mutation ($id: ID!, $lineItemId: ID!) { orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId,
      discount: { percentValue: 100, description: "Lucky Order Number free gift" }) { userErrors { field message } } }`,
    { id: calcId, lineItemId: add.orderEditAddVariant.calculatedLineItem!.id },
  );
  check("making the gift free", disc.orderEditAddLineItemDiscount.userErrors);

  const commit = await shopifyGraphQLWrite<{ orderEditCommit: { userErrors: UserErrors } }>(
    "luckyOrderEditCommit",
    `mutation ($id: ID!) { orderEditCommit(id: $id, notifyCustomer: false, staffNote: "Lucky Order Number free gift") { userErrors { field message } } }`,
    { id: calcId },
  );
  check("saving the order edit", commit.orderEditCommit.userErrors);
  await tagOrder(orderId, "lucky-order-gift");
  return "added";
}

async function tagOrder(orderId: string, tag: string): Promise<void> {
  const r = await shopifyGraphQLWrite<{ tagsAdd: { userErrors: UserErrors } }>(
    "luckyOrderTag",
    `mutation ($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }`,
    { id: orderId, tags: [tag] },
  );
  check("tagging the order", r.tagsAdd.userErrors);
}

interface RefundPlan {
  paid: boolean;
  alreadyRefunded: number;
  amount: number;
  transactions: Array<{ parentId: string; gateway: string; amount: string }>;
}

/** What a full refund would be, from Shopify's own suggestion. */
async function planRefund(orderId: string): Promise<RefundPlan> {
  const r = await shopifyGraphQL<{ order: {
    displayFinancialStatus: string;
    totalRefundedSet: { shopMoney: { amount: string } };
    suggestedRefund: { amountSet: { shopMoney: { amount: string } }; suggestedTransactions: Array<{ gateway: string; amountSet: { shopMoney: { amount: string } }; parentTransaction: { id: string } | null }> } | null;
  } | null }>(
    `query ($id: ID!) { order(id: $id) { displayFinancialStatus totalRefundedSet { shopMoney { amount } }
      suggestedRefund(suggestFullRefund: true, refundShipping: true) {
        amountSet { shopMoney { amount } }
        suggestedTransactions { gateway amountSet { shopMoney { amount } } parentTransaction { id } } } } }`,
    { id: orderId },
  );
  if (!r.order) throw new Error("order not found in Shopify");
  const status = r.order.displayFinancialStatus;
  return {
    paid: status === "PAID" || status === "PARTIALLY_REFUNDED" || status === "REFUNDED",
    alreadyRefunded: Number(r.order.totalRefundedSet.shopMoney.amount),
    amount: Number(r.order.suggestedRefund?.amountSet.shopMoney.amount ?? 0),
    transactions: (r.order.suggestedRefund?.suggestedTransactions ?? [])
      .filter(t => t.parentTransaction && Number(t.amountSet.shopMoney.amount) > 0)
      .map(t => ({ parentId: t.parentTransaction!.id, gateway: t.gateway, amount: t.amountSet.shopMoney.amount })),
  };
}

async function doRefund(orderId: string, plan: RefundPlan): Promise<number> {
  if (!plan.transactions.length) throw new Error("Shopify suggested nothing to refund");
  const r = await shopifyGraphQLWrite<{ refundCreate: { refund: { totalRefundedSet: { shopMoney: { amount: string } } } | null; userErrors: UserErrors } }>(
    "luckyRefundCreate",
    `mutation ($input: RefundInput!) { refundCreate(input: $input) { refund { totalRefundedSet { shopMoney { amount } } } userErrors { field message } } }`,
    { input: {
      orderId,
      note: "Lucky Order Number: full refund (order number ends in 00)",
      notify: false,
      transactions: plan.transactions.map(t => ({ orderId, parentId: t.parentId, gateway: t.gateway, amount: t.amount, kind: "REFUND" })),
    } },
  );
  check("refunding", r.refundCreate.userErrors);
  await tagOrder(orderId, "lucky-order-refund");
  return Number(r.refundCreate.refund?.totalRefundedSet.shopMoney.amount ?? plan.amount);
}

/** Single-use code: £X off each of the first N subscription orders, that customer only. */
async function createSubscriptionCode(w: WinnerRow, s: LuckySettings): Promise<string> {
  if (!w.customer_id) throw new Error("the order has no customer account to tie the code to");
  const code = subscriptionCodeFor(w.order_id, Number(w.order_number), process.env.SESSION_SECRET ?? "tck-lucky-order");
  const exists = await shopifyGraphQL<{ codeDiscountNodeByCode: { id: string } | null }>(
    `query ($code: String!) { codeDiscountNodeByCode(code: $code) { id } }`, { code },
  );
  if (exists.codeDiscountNodeByCode) return code;
  const r = await shopifyGraphQLWrite<{ discountCodeBasicCreate: { codeDiscountNode: { id: string } | null; userErrors: UserErrors } }>(
    "luckyDiscountCodeCreate",
    `mutation ($d: DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount: $d) { codeDiscountNode { id } userErrors { field message } } }`,
    { d: subscriptionDiscountInput({
      title: `Lucky Order Number ${w.order_name}: free subscription year`,
      code, customerId: w.customer_id, startsAt: new Date().toISOString(),
      amount: s.subscriptionAmount, cycles: s.subscriptionCycles,
    }) },
  );
  check("creating the subscription code", r.discountCodeBasicCreate.userErrors);
  await tagOrder(w.order_id, "lucky-order-subscription");
  return code;
}

/** A REAL, live practice 000 code for the founder to inspect in Shopify
 *  before the offer goes live (Graeme, 28 Oct 2026: "give me a live one,
 *  but just give it to me, no one else"). Built by the same input as a
 *  winner's code and tied to the founder's own Shopify customer account, so
 *  nobody else can use it. Disable it in Shopify when done. */
export async function createPracticeSubscriptionCode(): Promise<{ code: string; title: string; customerEmail: string; adminUrl: string | null }> {
  const offer = await loadOffer();
  if (!offer) throw new Error("The offer isn't set up yet");
  const found = await shopifyGraphQL<{ customers: { nodes: Array<{ id: string; email: string | null }> } }>(
    `query ($q: String!) { customers(first: 1, query: $q) { nodes { id email } } }`, { q: `email:${FOUNDER_EMAIL}` },
  );
  const customer = found.customers.nodes[0];
  if (!customer) throw new Error(`No Shopify customer account uses ${FOUNDER_EMAIL}, so there's no one to tie the practice code to`);
  const code = practiceCodeFor(randomBytes(4).toString("hex"));
  const title = `PRACTICE — Lucky Order Number 000 code for Graeme (disable after checking)`;
  const r = await shopifyGraphQLWrite<{ discountCodeBasicCreate: { codeDiscountNode: { id: string } | null; userErrors: UserErrors } }>(
    "luckyPracticeCodeCreate",
    `mutation ($d: DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount: $d) { codeDiscountNode { id } userErrors { field message } } }`,
    { d: subscriptionDiscountInput({
      title, code, customerId: customer.id, startsAt: new Date().toISOString(),
      amount: offer.settings.subscriptionAmount, cycles: offer.settings.subscriptionCycles,
    }) },
  );
  check("creating the practice code", r.discountCodeBasicCreate.userErrors);
  const id = r.discountCodeBasicCreate.codeDiscountNode?.id.split("/").pop() ?? null;
  return { code, title, customerEmail: customer.email ?? FOUNDER_EMAIL, adminUrl: id ? shopifyAdminOrderBase().replace(/orders\/$/, `discounts/${id}`) : null };
}

// ── Winner email (Resend) ───────────────────────────────────────────────────

export async function sendWinnerEmail(p: {
  to: string; firstName: string | null; tier: LuckyTier; orderName: string;
  giftTitle: string | null; refundAmount: number | null; discountCode: string | null;
  settings: LuckySettings; test?: boolean;
}): Promise<void> {
  if (!process.env["RESEND_API_KEY"]) throw new Error("Resend isn't set up on this server (RESEND_API_KEY), so the email can't go");
  const s = p.settings;
  const email = buildWinnerEmail(s.emails[p.tier], {
    firstName: p.firstName,
    orderName: p.orderName,
    gift: p.giftTitle ?? s.giftTitle ?? null,
    refundAmount: p.refundAmount,
    code: p.discountCode,
    amount: s.subscriptionAmount,
    orders: s.subscriptionCycles,
  }, s.terms);
  // fromName / replyTo force the Resend path in sendEmail (transactional,
  // so every winner gets it, whatever their marketing consent).
  await sendEmail({
    to: p.to,
    subject: p.test ? `[TEST] ${email.subject}` : email.subject,
    html: email.html,
    text: email.text,
    fromName: "The Calzone Kitchen",
    replyTo: s.replyTo,
  });
}

// ── Founder alerts ─────────────────────────────────────────────────────────

async function founderId(): Promise<number | null> {
  const u = await db.execute<{ id: number }>(sql`SELECT id FROM app_users WHERE lower(email) = lower(${FOUNDER_EMAIL}) LIMIT 1`);
  return u.rows[0]?.id ?? null;
}

async function tellFounder(message: string, todo?: { title: string; notes: string }): Promise<void> {
  try {
    const id = await founderId();
    if (!id) return;
    await db.execute(sql`INSERT INTO notifications (user_id, type, message, read) VALUES (${id}, 'lucky_order', ${message.slice(0, 500)}, false)`);
    if (todo) {
      await db.execute(sql`
        INSERT INTO todo_tasks (assignee_id, created_by, created_by_name, title, notes, url, priority, status)
        SELECT ${id}, NULL, 'Lucky Order Number', ${todo.title}, ${todo.notes}, '/founder/live-offers', 'high', 'open'
        WHERE NOT EXISTS (SELECT 1 FROM todo_tasks WHERE assignee_id = ${id} AND title = ${todo.title} AND status = 'open')
      `);
    }
  } catch (err) {
    console.warn("[lucky-order] couldn't notify the founder:", err instanceof Error ? err.message : err);
  }
}

// ── Detect + work ──────────────────────────────────────────────────────────

type WinnerRow = {
  order_id: string; order_name: string; order_number: string; tier: LuckyTier; practice: boolean;
  customer_id: string | null; customer_email: string | null; customer_name: string | null;
  gift_status: string; gift_title: string | null; refund_status: string; refund_amount: string | null;
  code_status: string; discount_code: string | null; email_status: string; attempts: number;
};

async function detectWinners(offer: LuckyOffer): Promise<number> {
  const start = windowStart(offer);
  if (!start) return 0;
  const since = new Date(Math.max(Date.parse(start), Date.now() - LOOKBACK_MS)).toISOString();
  let found = 0;
  for (const o of await ordersSince(since)) {
    const tier = winningTier({ name: o.name, createdAt: o.createdAt, sourceName: o.sourceName, tags: o.tags, cancelledAt: o.cancelledAt }, offer);
    if (!tier) continue;
    const st = initialStatuses(tier, offer.practiceMode);
    const name = [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(" ") || null;
    const r = await db.execute(sql`
      INSERT INTO lucky_order_winners (order_id, order_name, order_number, tier, practice, source_name,
        customer_id, customer_email, customer_name, order_total, order_created_at,
        gift_status, gift_title, refund_status, code_status, email_status)
      VALUES (${o.id}, ${o.name}, ${orderNumberFromName(o.name)}, ${tier}, ${offer.practiceMode}, ${o.sourceName},
        ${o.customer?.id ?? null}, ${o.customer?.email ?? o.email}, ${name}, ${o.currentTotalPriceSet.shopMoney.amount}, ${o.createdAt},
        ${st.giftStatus}, ${st.giftStatus === "n/a" ? null : offer.settings.giftTitle ?? null}, ${st.refundStatus}, ${st.codeStatus}, ${st.emailStatus})
      ON CONFLICT (order_id) DO NOTHING
    `);
    if (r.rowCount) {
      found++;
      console.log(`[lucky-order] ${offer.practiceMode ? "practice " : ""}winner ${o.name}: ${TIER_LABEL[tier]}`);
    }
  }
  return found;
}

async function update(orderId: string, fields: Record<string, unknown>): Promise<void> {
  const sets = Object.entries(fields).map(([k, v]) => sql`${sql.identifier(k)} = ${v}`);
  await db.execute(sql`UPDATE lucky_order_winners SET ${sql.join(sets, sql`, `)}, updated_at = NOW() WHERE order_id = ${orderId}`);
}

/** Work one winner's outstanding steps. Throws on a failed step. */
async function workWinner(w: WinnerRow, offer: LuckyOffer): Promise<void> {
  const s = offer.settings;

  if (w.gift_status === "pending") {
    if (!s.giftVariantId) throw new Error("no free gift chosen — pick one on the Live offers tab");
    await addGift(w.order_id, s.giftVariantId);
    await update(w.order_id, { gift_status: "done", gift_title: s.giftTitle ?? null });
    w.gift_status = "done";
  }

  if (w.refund_status === "pending" || w.refund_status === "approved") {
    const plan = await planRefund(w.order_id);
    if (plan.alreadyRefunded > 0 && plan.amount <= 0) {
      await update(w.order_id, { refund_status: "done", refund_amount: plan.alreadyRefunded });
      w.refund_status = "done";
      w.refund_amount = String(plan.alreadyRefunded);
    } else if (!plan.paid) {
      // Payment still settling — try again next minute.
    } else if (w.refund_status === "pending" && refundNeedsApproval(plan.amount, s.refundAutoLimit)) {
      await update(w.order_id, { refund_status: "awaiting_approval", refund_amount: plan.amount });
      w.refund_status = "awaiting_approval";
      w.refund_amount = String(plan.amount);
      await tellFounder(
        `Lucky Order ${w.order_name}: full refund of £${plan.amount.toFixed(2)} is over the £${s.refundAutoLimit} limit and needs your approval.`,
        { title: `Approve Lucky Order refund ${w.order_name} (£${plan.amount.toFixed(2)})`, notes: "The Business → Live offers → waiting for your approval." },
      );
    } else {
      const refunded = await doRefund(w.order_id, plan);
      await update(w.order_id, { refund_status: "done", refund_amount: refunded });
      w.refund_status = "done";
      w.refund_amount = String(refunded);
    }
  }

  if (w.code_status === "pending") {
    const code = await createSubscriptionCode(w, s);
    await update(w.order_id, { code_status: "done", discount_code: code });
    w.code_status = "done";
    w.discount_code = code;
  }

  // The email goes once the prize is in place — the gift added, the code
  // made. A refund still waiting for approval doesn't hold it up (the email
  // says it's on its way); a refund waiting for payment to settle does.
  const ready = !["pending", "approved"].includes(w.gift_status) && w.code_status !== "pending"
    && w.refund_status !== "pending" && w.refund_status !== "approved";
  if (w.email_status === "pending" && ready) {
    if (!w.customer_email) throw new Error("the order has no email address");
    await sendWinnerEmail({
      to: w.customer_email,
      firstName: w.customer_name?.split(" ")[0] ?? null,
      tier: w.tier,
      orderName: w.order_name,
      giftTitle: w.gift_status === "done" ? w.gift_title ?? s.giftTitle ?? null : null,
      refundAmount: w.refund_amount != null ? Number(w.refund_amount) : null,
      discountCode: w.discount_code,
      settings: s,
    });
    await update(w.order_id, { email_status: "done" });
  }
}

async function workWinners(offer: LuckyOffer): Promise<void> {
  const r = await db.execute<WinnerRow>(sql`
    SELECT order_id, order_name, order_number::text, tier, practice, customer_id, customer_email, customer_name,
           gift_status, gift_title, refund_status, refund_amount::text, code_status, discount_code, email_status, attempts
      FROM lucky_order_winners
     WHERE practice = FALSE AND attempts < ${MAX_ATTEMPTS}
       AND (gift_status = 'pending' OR refund_status IN ('pending', 'approved') OR code_status = 'pending' OR email_status = 'pending')
     ORDER BY detected_at
  `);
  for (const w of r.rows) {
    try {
      await workWinner(w, offer);
      await update(w.order_id, { last_error: null });
    } catch (err) {
      if (err instanceof ShopifyWritesBlockedError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      const attempts = w.attempts + 1;
      await update(w.order_id, { attempts, last_error: msg.slice(0, 500) });
      console.warn(`[lucky-order] ${w.order_name} attempt ${attempts} failed: ${msg}`);
      if (attempts >= MAX_ATTEMPTS) {
        await tellFounder(
          `Lucky Order ${w.order_name} needs a hand: ${msg.slice(0, 300)}`,
          { title: `Lucky Order ${w.order_name} got stuck`, notes: `${msg.slice(0, 400)}\n\nThe Business → Live offers shows what's done; "Try again" retries.` },
        );
      }
    }
  }
}

let running: Promise<void> | null = null;

/** One pass: detect new winners, then work outstanding steps. */
export function runLuckyOrderPass(): Promise<void> {
  if (!running) {
    running = (async () => {
      const offer = await loadOffer();
      if (!offer) return;
      if (offer.enabled) await detectWinners(offer);
      // Outstanding steps keep being worked after the offer ends — a winner
      // is owed their prize.
      await workWinners(offer);
    })().finally(() => { running = null; });
  }
  return running;
}

/** Founder's decision on a refund over the limit. */
export async function decideRefund(orderId: string, approve: boolean, by: string): Promise<boolean> {
  const r = await db.execute(sql`
    UPDATE lucky_order_winners
       SET refund_status = ${approve ? "approved" : "declined"}, refund_decided_by = ${by}, attempts = 0, last_error = NULL, updated_at = NOW()
     WHERE order_id = ${orderId} AND refund_status = 'awaiting_approval'
  `);
  if (!r.rowCount) return false;
  // Close the matching to-do now it's decided.
  const n = await db.execute<{ order_name: string }>(sql`SELECT order_name FROM lucky_order_winners WHERE order_id = ${orderId}`);
  const name = n.rows[0]?.order_name;
  if (name) {
    await db.execute(sql`UPDATE todo_tasks SET status = 'done'
      WHERE created_by_name = 'Lucky Order Number' AND status = 'open' AND title LIKE ${`Approve Lucky Order refund ${name} (%`}`);
  }
  if (approve) void runLuckyOrderPass().catch(err => console.warn("[lucky-order] pass after approval failed:", err));
  return true;
}

/** "Try again" on a stuck winner. */
export async function retryWinner(orderId: string): Promise<void> {
  await db.execute(sql`UPDATE lucky_order_winners SET attempts = 0, last_error = NULL, updated_at = NOW() WHERE order_id = ${orderId}`);
  void runLuckyOrderPass().catch(err => console.warn("[lucky-order] retry pass failed:", err));
}

export function startLuckyOrderJob(): void {
  if (isStaging()) {
    console.log("[lucky-order] staging: job disabled");
    return;
  }
  schedule("* * * * *", () => {
    runLuckyOrderPass().catch(err => {
      if (err instanceof ShopifyWritesBlockedError) return;
      console.warn("[lucky-order] pass failed:", err instanceof Error ? err.message : err);
    });
  }, { timezone: "Europe/London" });
  console.log("[lucky-order] checking for Lucky Order Number winners every minute");
}
