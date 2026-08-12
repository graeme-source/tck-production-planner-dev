/**
 * READ-ONLY diagnostic: show exactly what the planner would send to APC as the
 * delivery address for a given Shopify order. Books nothing, writes nothing.
 *
 *   pnpm exec node --env-file=.env --import tsx/esm <this file> 131249
 *
 * Uses the app's own normaliseAddress() and mirrors the recipient mapping in
 * routes/fulfilment.ts POST /shipments, so this is the real payload shape.
 */
import { shopifyGraphQL } from "../src/services/shopify";
import { normaliseAddress } from "../src/services/apc";

const orderNumber = process.argv[2] ?? "131249";

type Node = {
  id: string;
  name: string;
  note: string | null;
  tags: string[];
  createdAt: string;
  totalWeight: string | null;
  email: string | null;
  phone: string | null;
  customer: { firstName: string | null; lastName: string | null; email: string | null; phone: string | null } | null;
  shippingAddress: {
    name: string | null; firstName: string | null; lastName: string | null;
    company: string | null; address1: string | null; address2: string | null;
    city: string | null; province: string | null; zip: string | null;
    countryCodeV2: string | null; phone: string | null;
  } | null;
  billingAddress: { address1: string | null; address2: string | null; city: string | null; zip: string | null; company: string | null } | null;
};

const data = await shopifyGraphQL<{ orders: { edges: Array<{ node: Node }> } }>(
  `query ($q: String!) {
    orders(first: 5, query: $q) {
      edges { node {
        id name note tags createdAt totalWeight email phone
        customer { firstName lastName email phone }
        shippingAddress {
          name firstName lastName company address1 address2 city province zip countryCodeV2 phone
        }
        billingAddress { address1 address2 city zip company }
      } }
    }
  }`,
  { q: `name:#${orderNumber}` },
);

const node = data.orders.edges.map(e => e.node).find(n => n.name.replace("#", "") === orderNumber)
  ?? data.orders.edges[0]?.node;

if (!node) {
  console.error(`No Shopify order found for #${orderNumber}`);
  process.exit(1);
}

const sa = node.shippingAddress;
if (!sa) {
  console.error(`Order ${node.name} has no shipping address.`);
  process.exit(1);
}

const line = (s: string) => console.log(s);
const show = (label: string, v: unknown) => {
  const str = v === null || v === undefined || v === "" ? "\x1b[2m(empty)\x1b[0m" : String(v);
  console.log(`  ${label.padEnd(18)} ${str}`);
};

line("");
line(`\x1b[1m═══ RAW FROM SHOPIFY — ${node.name} ═══\x1b[0m`);
line("shipping_address:");
show("name", sa.name);
show("first/last", `${sa.firstName ?? ""} ${sa.lastName ?? ""}`.trim());
show("company", sa.company);
show("address1", sa.address1);
show("address2", sa.address2);
show("city", sa.city);
show("province", sa.province);
show("zip", sa.zip);
show("country_code", sa.countryCodeV2);
show("phone (addr)", sa.phone);
line("customer:");
show("email", node.customer?.email ?? node.email);
show("phone", node.customer?.phone ?? node.phone);
line("order:");
show("note", node.note);
show("total_weight(g)", node.totalWeight);
show("tags", node.tags.join(", "));
line("");
line("billing_address (for comparison — NOT sent to APC):");
show("address1", node.billingAddress?.address1);
show("address2", node.billingAddress?.address2);
show("city", node.billingAddress?.city);
show("zip", node.billingAddress?.zip);

// ── Mirror routes/fulfilment.ts POST /shipments ────────────────────────────
const customerName = sa.name || `${node.customer?.firstName ?? ""} ${node.customer?.lastName ?? ""}`.trim();
const companyName = (sa.company?.trim() || "Home Delivery").slice(0, 35);
const addr = normaliseAddress(sa.address1 ?? "", sa.address2 ?? undefined, sa.city ?? "");

let specialInstructions = "X227 - PERISHABLE";
if (node.note?.trim()) specialInstructions = `${specialInstructions} ${node.note.trim()}`.slice(0, 50);

const reference = node.name.replace(/[^a-zA-Z0-9\-\.]/g, "-").slice(0, 25);
const weightKg = Math.max(0.1, (Number(node.totalWeight ?? 500) || 500) / 1000);

const deliveryPayload = {
  CompanyName: companyName,
  AddressLine1: addr.address1,
  ...(addr.address2 ? { AddressLine2: addr.address2 } : {}),
  PostalCode: sa.zip,
  City: addr.city,
  CountryCode: sa.countryCodeV2 ?? "GB",
  Contact: {
    PersonName: customerName.slice(0, 35),
    ...(sa.phone || node.customer?.phone ? { PhoneNumber: sa.phone ?? node.customer?.phone } : {}),
    ...(node.customer?.email ? { Email: node.customer.email } : {}),
  },
  Instructions: specialInstructions.slice(0, 50),
  Safeplace: "Allowed",
};

line("");
line(`\x1b[1m═══ WHAT THE APP WOULD SEND TO APC ═══\x1b[0m`);
line(`(Order.Reference: "${reference}"  ·  weight ${weightKg.toFixed(3)} kg)`);
line("");
console.log(JSON.stringify({ Orders: { Order: { Reference: reference, Delivery: deliveryPayload } } }, null, 2));

line("");
line(`\x1b[1m═══ FIELD-BY-FIELD (35-char limit each) ═══\x1b[0m`);
const check = (label: string, value: string | null | undefined) => {
  const v = value ?? "";
  const len = v.length;
  const flag = len === 0 ? "\x1b[31mEMPTY\x1b[0m" : len > 35 ? `\x1b[31m${len} OVER\x1b[0m` : `\x1b[32m${len}\x1b[0m`;
  console.log(`  ${label.padEnd(14)} ${flag.padEnd(20)} ${v}`);
};
check("CompanyName", deliveryPayload.CompanyName);
check("AddressLine1", deliveryPayload.AddressLine1);
check("AddressLine2", (deliveryPayload as { AddressLine2?: string }).AddressLine2);
check("City", deliveryPayload.City);
check("PostalCode", deliveryPayload.PostalCode);
check("PersonName", deliveryPayload.Contact.PersonName);

if (addr.warnings.length) {
  line("");
  line(`\x1b[33m═══ WARNINGS THE APP WOULD RAISE ═══\x1b[0m`);
  for (const w of addr.warnings) console.log(`  ⚠ ${w}`);
}

// What got dropped between Shopify and APC?
line("");
line(`\x1b[1m═══ DATA LOSS CHECK ═══\x1b[0m`);
const rawJoined = [sa.address1, sa.address2, sa.city].filter(Boolean).join(" | ");
const sentJoined = [deliveryPayload.AddressLine1, (deliveryPayload as { AddressLine2?: string }).AddressLine2, deliveryPayload.City].filter(Boolean).join(" | ");
console.log(`  Shopify: ${rawJoined}`);
console.log(`  To APC : ${sentJoined}`);
const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
if (normalise(rawJoined) === normalise(sentJoined)) {
  console.log(`  \x1b[32m✓ No characters lost (only reformatting)\x1b[0m`);
} else {
  const rawChars = normalise(rawJoined);
  const sentChars = normalise(sentJoined);
  console.log(`  \x1b[31m✗ CONTENT DIFFERS — ${rawChars.length} chars in Shopify vs ${sentChars.length} sent\x1b[0m`);
}
if (!sa.province) console.log(`  \x1b[2mNote: no county/province on this order (APC doesn't take one — fine)\x1b[0m`);
line("");
