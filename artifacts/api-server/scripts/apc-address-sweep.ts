/**
 * READ-ONLY: run recent Shopify orders through the app's APC address
 * normaliser and report every order whose address would be altered,
 * truncated, or is missing data APC needs. Books nothing.
 */
import { shopifyGraphQL } from "../src/services/shopify";
import { normaliseAddress } from "../src/services/apc";

const HOW_MANY = Number(process.argv[2] ?? 250);

type Node = {
  name: string;
  shippingAddress: {
    name: string | null; company: string | null;
    address1: string | null; address2: string | null;
    city: string | null; zip: string | null; countryCodeV2: string | null; phone: string | null;
  } | null;
  customer: { phone: string | null; email: string | null } | null;
};

const nodes: Node[] = [];
let cursor: string | null = null;
while (nodes.length < HOW_MANY) {
  const page: any = await shopifyGraphQL(
    `query ($n: Int!, $after: String) {
      orders(first: $n, after: $after, reverse: true, query: "status:any") {
        edges { cursor node {
          name
          shippingAddress { name company address1 address2 city zip countryCodeV2 phone }
          customer { phone email }
        } }
        pageInfo { hasNextPage }
      }
    }`,
    { n: Math.min(100, HOW_MANY - nodes.length), after: cursor },
  );
  const edges = page.orders.edges as Array<{ cursor: string; node: Node }>;
  if (edges.length === 0) break;
  nodes.push(...edges.map(e => e.node));
  cursor = edges[edges.length - 1].cursor;
  if (!page.orders.pageInfo.hasNextPage) break;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

type Issue = { order: string; kind: string; detail: string };
const issues: Issue[] = [];
let noAddress = 0, clean = 0;

for (const n of nodes) {
  const sa = n.shippingAddress;
  if (!sa) { noAddress++; continue; }

  const a = normaliseAddress(sa.address1 ?? "", sa.address2 ?? undefined, sa.city ?? "");
  const before = [sa.address1, sa.address2, sa.city].filter(Boolean).join(" | ");
  const after = [a.address1, a.address2, a.city].filter(Boolean).join(" | ");
  let flagged = false;

  for (const w of a.warnings) {
    issues.push({ order: n.name, kind: "TRUNCATED", detail: w });
    flagged = true;
  }
  if (norm(before) !== norm(after)) {
    issues.push({ order: n.name, kind: "CONTENT CHANGED", detail: `"${before}"  →  "${after}"` });
    flagged = true;
  }
  if (!sa.zip?.trim()) { issues.push({ order: n.name, kind: "NO POSTCODE", detail: "APC will reject" }); flagged = true; }
  if (!sa.address1?.trim()) { issues.push({ order: n.name, kind: "NO ADDRESS1", detail: "APC will reject" }); flagged = true; }
  if (!sa.city?.trim()) { issues.push({ order: n.name, kind: "NO CITY", detail: `addr1="${sa.address1 ?? ""}"` }); flagged = true; }
  if (!sa.phone?.trim() && !n.customer?.phone?.trim()) {
    issues.push({ order: n.name, kind: "NO PHONE", detail: "no delivery-day contact number" }); flagged = true;
  }
  if ((sa.countryCodeV2 ?? "GB") !== "GB") {
    issues.push({ order: n.name, kind: "NON-GB", detail: String(sa.countryCodeV2) }); flagged = true;
  }
  // Address2 that looks like it holds the real street (common macro failure)
  if (!sa.address1?.trim() && sa.address2?.trim()) {
    issues.push({ order: n.name, kind: "ADDR1 EMPTY/ADDR2 SET", detail: `addr2="${sa.address2}"` }); flagged = true;
  }
  if (!flagged) clean++;
}

const byKind = new Map<string, Issue[]>();
for (const i of issues) byKind.set(i.kind, [...(byKind.get(i.kind) ?? []), i]);

console.log(`\n═══ APC ADDRESS SWEEP — ${nodes.length} most recent orders ═══\n`);
console.log(`  clean:        ${clean}`);
console.log(`  with issues:  ${nodes.length - clean - noAddress}`);
console.log(`  no address:   ${noAddress}  (digital/local pickup etc.)\n`);

for (const [kind, list] of [...byKind.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\x1b[1m${kind}\x1b[0m — ${list.length}`);
  for (const i of list.slice(0, 12)) console.log(`   ${i.order.padEnd(10)} ${i.detail}`);
  if (list.length > 12) console.log(`   …and ${list.length - 12} more`);
  console.log("");
}
