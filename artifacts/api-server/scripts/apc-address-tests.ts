/**
 * Regression checks for normaliseAddress, built from REAL TCK orders that
 * previously came out wrong or needed carving by hand. No network, no
 * booking — pure function in, expected fields out.
 *
 *   node --import tsx/esm ./scripts/apc-address-tests.ts
 *
 * Every case here is a real address that either (a) the old code mangled,
 * (b) Graeme had to fix by hand before a CSV upload, or (c) must keep
 * working exactly as it does now.
 */
import { normaliseAddress } from "../src/services/apc";

const MAX = 35;

type Case = {
  name: string;
  why: string;
  in: { a1: string; a2?: string; city: string; postcode?: string };
  expect: { a1: string; a2?: string; city?: string; instructions?: string; review?: string[] };
};

const cases: Case[] = [
  // ── Place names that end with the town name — the mangling bug ──────────
  {
    name: "#132466", why: "Lower Darwen is a locality, not a duplicate of Darwen",
    in: { a1: "5 Verbena Close", a2: "Lower Darwen", city: "Darwen", postcode: "BB3 0TB" },
    expect: { a1: "5 Verbena Close", a2: "Lower Darwen" },
  },
  {
    name: "#132417", why: "same, uppercase town",
    in: { a1: "2 BEGONIA VIEW", a2: "Lower Darwen", city: "DARWEN", postcode: "BB3 0TD" },
    expect: { a1: "2 BEGONIA VIEW", a2: "Lower Darwen" },
  },
  {
    name: "#132308", why: "Kingston upon Hull must not become 'Kingston upon'",
    in: { a1: "32 Stromness Way", a2: "Kingston upon Hull", city: "Hull", postcode: "HU8 9JQ" },
    expect: { a1: "32 Stromness Way", a2: "Kingston upon Hull" },
  },
  {
    name: "#132281", why: "mount bures must survive; splits on the comma",
    in: { a1: "Old Barn, Old Barn Road, mount bures", city: "Bures", postcode: "CO8 5AH" },
    expect: { a1: "Old Barn, Old Barn Road", a2: "mount bures" },
  },

  // ── Whole address crammed into the street line ─────────────────────────
  {
    name: "#132491", why: "postcode already has its own field — drop it, no split needed",
    in: { a1: "15 Oast Court, Sittingbourne, kent, ME10 4DZ", city: "Sittingbourne", postcode: "ME10 4DZ" },
    expect: { a1: "15 Oast Court, Sittingbourne, kent" },
  },
  {
    name: "#132143", why: "postcode at the START of the line",
    in: { a1: "ST4 4HB 28 Fielding Street, STOKE-ON-TRENT", city: "Stoke-on-Trent", postcode: "ST4 4HB" },
    expect: { a1: "28 Fielding Street" },
  },
  {
    name: "#132226", why: "country noise removed, mismatched postcode flagged not guessed",
    in: { a1: "London, United Kingdom, London, W3 2JH, United Kingdom", city: "London", postcode: "W5 2JH" },
    expect: { a1: "London, W3 2JH", review: ["conflicting-postcode"] },
  },

  // ── Splits that must not break a place name ────────────────────────────
  {
    name: "#132443", why: "must not leave the line dangling on 'in'",
    in: { a1: "120 Wotton drive Aston in makerfield", city: "Wigan", postcode: "WN4 8XZ" },
    expect: { a1: "120 Wotton drive", a2: "Aston in makerfield" },
  },
  {
    name: "#132388", why: "comma is a better split point than the 35-char mark",
    in: { a1: "The Carrige House, 83A Chittoe Heath", city: "Chippenham", postcode: "SN15 2EQ" },
    expect: { a1: "The Carrige House", a2: "83A Chittoe Heath" },
  },
  {
    name: "#132383", why: "plain word split, already correct — must not regress",
    in: { a1: "Bottom Flat 162 mian Street Lennoxtown", city: "Glasgow", postcode: "G66 7DG" },
    expect: { a1: "Bottom Flat 162 mian Street", a2: "Lennoxtown" },
  },
  {
    name: "#132436", why: "town typed after a full stop IS a duplicate — strip it",
    in: { a1: "137 westhorpe,newbiggin hall estate. Newcastle upon tyne 5", city: "Newcastle upon tyne 5", postcode: "NE5 4LX" },
    expect: { a1: "137 westhorpe", a2: "newbiggin hall estate" },
  },
  {
    name: "#132319", why: "trailing comma + duplicate town",
    in: { a1: "Algar Lodge Farm Shop, Sandwich Road, Deal,", city: "DEAL", postcode: "CT14 0AS" },
    expect: { a1: "Algar Lodge Farm Shop", a2: "Sandwich Road" },
  },

  // ── Repeated content across fields ─────────────────────────────────────
  {
    name: "#132373", why: "line 2 is exactly the town — drop it",
    in: { a1: "30 Bideford Close", a2: "Woodley", city: "Woodley", postcode: "RG5 3SE" },
    expect: { a1: "30 Bideford Close" },
  },
  {
    name: "#132385", why: "line 2 already inside line 1",
    in: { a1: "Unit 8, Honywood Road Bs Pk", a2: "Honywood Road", city: "Basildon" },
    expect: { a1: "Unit 8, Honywood Road Bs Pk" },
  },

  // ── Delivery notes in an address line ──────────────────────────────────
  {
    name: "#132229", why: "note belongs in Instructions, not truncated into line 2",
    in: { a1: "9a high street", a2: "above moathouse cafe can leave in cafe", city: "arundel", postcode: "BN18 9AD" },
    expect: { a1: "9a high street", instructions: "above moathouse cafe can leave in cafe" },
  },

  // ── Town too long for APC ──────────────────────────────────────────────
  {
    // The long string really is in Shopify's CITY field on this order.
    name: "#132449", why: "39-char town — truncate but flag for a human",
    in: { a1: "11 Hoprig Place", city: "Preston, Seton and Gosford, East Lothian", postcode: "EH32 9TA" },
    expect: { a1: "11 Hoprig Place", city: "Preston, Seton and Gosford, East Lo", review: ["town-too-long"] },
  },

  // ── Ordinary addresses must pass through untouched ─────────────────────
  {
    name: "#131249", why: "clean address — nothing should change",
    in: { a1: "Unit 1b Lower Rectory Farm", city: "Great Brickhill", postcode: "MK17 9FX" },
    expect: { a1: "Unit 1b Lower Rectory Farm", city: "Great Brickhill" },
  },
];

let passed = 0;
const failures: string[] = [];

for (const c of cases) {
  const got = normaliseAddress(c.in.a1, c.in.a2, c.in.city, { postcode: c.in.postcode });
  const problems: string[] = [];

  if (got.address1 !== c.expect.a1) problems.push(`address1\n      want "${c.expect.a1}"\n      got  "${got.address1}"`);
  if (c.expect.a2 !== undefined && got.address2 !== c.expect.a2) problems.push(`address2\n      want "${c.expect.a2}"\n      got  "${got.address2 ?? "(none)"}"`);
  if (c.expect.a2 === undefined && got.address2) problems.push(`address2 should be empty, got "${got.address2}"`);
  if (c.expect.city !== undefined && got.city !== c.expect.city) problems.push(`city want "${c.expect.city}" got "${got.city}"`);
  if (c.expect.instructions !== undefined && got.instructions !== c.expect.instructions) {
    problems.push(`instructions\n      want "${c.expect.instructions}"\n      got  "${got.instructions ?? "(none)"}"`);
  }
  for (const kind of c.expect.review ?? []) {
    if (!got.review.some(r => r.kind === kind)) problems.push(`expected a "${kind}" review flag, got [${got.review.map(r => r.kind).join(", ") || "none"}]`);
  }

  // Universal invariants — these must hold for every address, always.
  if (got.address1.length > MAX) problems.push(`address1 is ${got.address1.length} chars — over APC's ${MAX}`);
  if ((got.address2?.length ?? 0) > MAX) problems.push(`address2 is ${got.address2!.length} chars — over APC's ${MAX}`);
  if (got.city.length > MAX) problems.push(`city is ${got.city.length} chars — over APC's ${MAX}`);
  if (!got.address1.trim()) problems.push(`address1 is empty`);
  const trailing = got.address1.trim().split(" ").pop()?.toLowerCase() ?? "";
  if (["in", "on", "upon", "under", "by", "of", "the"].includes(trailing)) {
    problems.push(`address1 ends on the connector word "${trailing}" — place name split in half`);
  }

  if (problems.length === 0) {
    passed++;
    console.log(`\x1b[32m  PASS\x1b[0m ${c.name.padEnd(9)} ${c.why}`);
  } else {
    failures.push(c.name);
    console.log(`\x1b[31m  FAIL\x1b[0m ${c.name.padEnd(9)} ${c.why}`);
    for (const p of problems) console.log(`         ${p}`);
    console.log(`         in: 1:"${c.in.a1}"${c.in.a2 ? ` 2:"${c.in.a2}"` : ""} city:"${c.in.city}"`);
  }
}

console.log(`\n  ${passed}/${cases.length} passed${failures.length ? ` — failing: ${failures.join(", ")}` : ""}\n`);
process.exit(failures.length ? 1 : 0);
