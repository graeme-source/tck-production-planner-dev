#!/usr/bin/env node
/**
 * APC label-PDF probe — proves, in isolation, whether a label PDF can be
 * retrieved for a Shopify order number.
 *
 * The production flow is: consignments are bulk-uploaded to APC each morning
 * from a Shopify CSV export, with the APC Reference set to the Shopify order
 * number. The app never creates consignments — it looks them up by that
 * reference and pulls the label. This script exercises exactly that leg and
 * nothing else, so a print failure can be attributed to (or cleared of) the
 * label-retrieval step without involving a printer.
 *
 * READ-ONLY. Every request sends markprinted=False, so it cannot mark a label
 * printed, book anything, or cancel anything. (Note: the app's fetchLabel()
 * sends markprinted=True — that difference is deliberate and called out in the
 * output, because it is one of the few behavioural differences between this
 * probe and the real path.)
 *
 * Usage:
 *   node tools/apc-label-probe.mjs '#133003' '#133050'
 *   node tools/apc-label-probe.mjs --env=training '#133003'
 *   node tools/apc-label-probe.mjs --save '#133003'     # write the PDF to disk
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.resolve(HERE, "../artifacts/api-server/.env");

// Minimal .env reader — avoids adding a dependency to a diagnostic tool.
function loadEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

const fileEnv = loadEnv(ENV_FILE);
const env = { ...fileEnv, ...process.env };

const LIVE_BASE = env.APC_API_BASE ?? "https://apc.hypaship.com/api/3.0";
const TRAINING_BASE = "https://apc-training.hypaship.com/api/3.0";

const args = process.argv.slice(2);
const envArg = (args.find(a => a.startsWith("--env=")) ?? "--env=live").slice(6);
const SAVE = args.includes("--save");
const orders = args.filter(a => !a.startsWith("--"));

if (orders.length === 0) {
  console.error("Usage: node tools/apc-label-probe.mjs [--env=live|training] [--save] '#133003' ['#133050' …]");
  process.exit(2);
}

const BASE = envArg === "training" ? TRAINING_BASE : LIVE_BASE;
const isTraining = envArg === "training";

const user = isTraining && env.APC_TRAINING_USERNAME ? env.APC_TRAINING_USERNAME : env.APC_USERNAME;
const pass = isTraining && env.APC_TRAINING_PASSWORD ? env.APC_TRAINING_PASSWORD : env.APC_PASSWORD;

if (!user || !pass || !env.APC_ACCOUNT_NUMBER) {
  console.error(`APC credentials missing. Looked in ${ENV_FILE} and the process environment.`);
  process.exit(2);
}
if (isTraining && !env.APC_TRAINING_USERNAME) {
  console.error("! No APC_TRAINING_USERNAME set — sending PRODUCTION credentials to the training server.");
  console.error("  The training server rejects those with 'Authentication Failed … (100019)'.\n");
}

const AUTH = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");

/** Same reduction the app applies before querying APC by reference. */
function sanitiseApcReference(reference) {
  return (reference ?? "").replace(/[^a-zA-Z0-9-]/g, "").replace(/^-+|-+$/g, "").slice(0, 25);
}

function hr(char = "─") { console.log(char.repeat(78)); }

async function call(label, url) {
  console.log(`\n▸ ${label}`);
  console.log(`  REQUEST : GET ${url}`);
  console.log(`  HEADERS : remote-user: Basic <redacted>, Content-Type: application/json`);
  let res, bodyText;
  const started = Date.now();
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { "remote-user": AUTH, "Content-Type": "application/json" },
    });
    bodyText = await res.text();
  } catch (err) {
    console.log(`  RESULT  : TRANSPORT FAILURE after ${Date.now() - started}ms — ${err.message}`);
    return { ok: false, transportError: err.message };
  }
  console.log(`  STATUS  : ${res.status} ${res.statusText} (${Date.now() - started}ms)`);
  console.log(`  CTYPE   : ${res.headers.get("content-type") ?? "(none)"}`);
  console.log(`  BYTES   : ${bodyText.length}`);

  let json = null;
  try { json = JSON.parse(bodyText); } catch { /* reported below */ }

  if (!json) {
    console.log(`  BODY    : (not JSON) ${bodyText.slice(0, 800)}`);
    return { ok: false, status: res.status, bodyText };
  }

  // Print the whole envelope EXCEPT label blobs, which would drown the output.
  const redacted = JSON.parse(JSON.stringify(json, (k, v) =>
    k === "Content" && typeof v === "string" && v.length > 120
      ? `<${v.length} chars of base64 — withheld from this dump>`
      : v));
  console.log("  BODY    :");
  console.log(JSON.stringify(redacted, null, 2).split("\n").map(l => "    " + l).join("\n"));

  return { ok: res.ok, status: res.status, json, bodyText };
}

function messagesOf(json) {
  const top = json?.Orders?.Messages;
  const order = json?.Orders?.Order?.Messages;
  return {
    topCode: top?.Code ?? null,
    topDesc: top?.Description ?? null,
    orderCode: order?.Code ?? null,
    orderDesc: order?.Description ?? null,
  };
}

function ordersArray(json) {
  const o = json?.Orders?.Order;
  if (!o) return [];
  return Array.isArray(o) ? o : [o];
}

function labelsFrom(order) {
  const item = order?.ShipmentDetails?.Items?.Item;
  if (!item) return [];
  const list = Array.isArray(item) ? item : [item];
  return list.map(it => it?.Label?.Content).filter(c => typeof c === "string" && c.length > 0);
}

console.log(`APC label probe — ${new Date().toISOString()}`);
console.log(`Environment : ${isTraining ? "TRAINING" : "LIVE"}  (${BASE})`);
console.log(`Account     : ${env.APC_ACCOUNT_NUMBER}`);
console.log(`Credentials : ${user.replace(/(.{2}).*(@.*)/, "$1***$2")}`);
console.log(`Mode        : READ-ONLY (markprinted=False on every call; the app sends markprinted=True)`);

const summary = [];

for (const orderName of orders) {
  hr("═");
  console.log(`ORDER ${orderName}`);
  hr("═");

  const verbatim = orderName.trim();
  const sanitised = sanitiseApcReference(orderName);
  const candidates = [...new Set([verbatim, sanitised].filter(Boolean))];
  console.log(`Reference forms to try, in the app's own order: ${candidates.map(c => JSON.stringify(c)).join(" then ")}`);

  let found = null;
  let matchedForm = null;

  // ── Step 1: find the consignment by REFERENCE ──────────────────────────
  for (const candidate of candidates) {
    const url = `${BASE}/Orders/${encodeURIComponent(candidate)}.json?searchtype=Reference&labels=False&markprinted=False`;
    const r = await call(`Lookup by Reference ${JSON.stringify(candidate)}`, url);
    if (!r.json) continue;

    const msgs = messagesOf(r.json);
    console.log(`  VERDICT : Messages.Code=${msgs.topCode} / Order.Messages.Code=${msgs.orderCode}` +
      (msgs.topDesc || msgs.orderDesc ? ` — ${msgs.orderDesc ?? msgs.topDesc}` : ""));

    const hits = ordersArray(r.json).filter(o => o?.WayBill);
    if (hits.length) {
      console.log(`  FOUND   : ${hits.length} consignment(s): ${hits.map(h => h.WayBill).join(", ")}`);
      found = hits.sort((a, b) => String(b.WayBill).localeCompare(String(a.WayBill)));
      matchedForm = candidate;
      break;
    }
    console.log(`  FOUND   : no consignment for reference ${JSON.stringify(candidate)}`);
  }

  if (!found) {
    console.log(`\n✗ ${orderName}: APC returned no consignment for any reference form. Label cannot be fetched.`);
    summary.push({ orderName, outcome: "NO CONSIGNMENT FOR REFERENCE" });
    continue;
  }

  // ── Step 2: fetch the LABEL by waybill ─────────────────────────────────
  const waybill = found[0].WayBill;
  console.log(`\nUsing waybill ${waybill} (matched on reference form ${JSON.stringify(matchedForm)}).`);
  console.log(`APC holds Reference=${JSON.stringify(found[0].Reference ?? null)} for it.`);

  const labelUrl = `${BASE}/Orders/${waybill}.json?searchtype=CarrierWaybill&labelformat=PDF&labels=True&markprinted=False`;
  const lr = await call(`Fetch label PDF by CarrierWaybill ${waybill}`, labelUrl);

  if (!lr.json) {
    summary.push({ orderName, waybill, outcome: `LABEL FETCH RETURNED NON-JSON (HTTP ${lr.status})` });
    continue;
  }

  const lmsgs = messagesOf(lr.json);
  console.log(`  VERDICT : Messages.Code=${lmsgs.topCode} / Order.Messages.Code=${lmsgs.orderCode}` +
    (lmsgs.topDesc || lmsgs.orderDesc ? ` — ${lmsgs.orderDesc ?? lmsgs.topDesc}` : ""));

  const pdfs = ordersArray(lr.json).flatMap(labelsFrom);
  if (pdfs.length === 0) {
    console.log(`\n✗ ${orderName}: consignment found, but APC returned NO Label.Content.`);
    console.log(`  This is the exact condition that makes the app's fetchLabel() retry 5× and then throw.`);
    summary.push({ orderName, waybill, outcome: "CONSIGNMENT FOUND BUT NO LABEL CONTENT" });
    continue;
  }

  console.log(`\n  LABELS  : ${pdfs.length} PDF(s) returned`);
  let allValid = true;
  pdfs.forEach((b64, i) => {
    const buf = Buffer.from(b64, "base64");
    const magic = buf.subarray(0, 5).toString("latin1");
    const valid = magic === "%PDF-";
    if (!valid) allValid = false;
    console.log(`    [${i + 1}] base64 ${b64.length} chars → ${buf.length} bytes, magic ${JSON.stringify(magic)} ${valid ? "✓ valid PDF" : "✗ NOT a PDF"}`);
    if (SAVE) {
      const out = path.resolve(HERE, `../${sanitiseApcReference(orderName)}-${waybill}-${i + 1}.pdf`);
      fs.writeFileSync(out, buf);
      console.log(`        saved → ${out}`);
    }
  });

  console.log(`\n${allValid ? "✓" : "✗"} ${orderName}: label PDF retrieval ${allValid ? "SUCCEEDED" : "returned non-PDF data"}.`);
  summary.push({
    orderName,
    waybill,
    outcome: allValid ? `OK — ${pdfs.length} valid PDF(s)` : "RETURNED NON-PDF DATA",
  });
}

hr("═");
console.log("SUMMARY");
hr("═");
for (const s of summary) {
  console.log(`  ${s.orderName.padEnd(10)} ${(s.waybill ?? "—").padEnd(24)} ${s.outcome}`);
}
