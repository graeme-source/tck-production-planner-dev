// Hypaship APC API v3 integration.
// Auth: Basic auth via `remote-user` header — base64(email:password).
// No token refresh needed — credentials are sent on every request.
//
// Training environment uses separate credentials: APC_TRAINING_USERNAME / APC_TRAINING_PASSWORD.
// If those are not set, production credentials are attempted but will likely fail on the
// training server (which rejects production accounts with a 419 Authentication Error).

const APC_API_BASE = process.env.APC_API_BASE ?? "https://apc.hypaship.com/api/3.0";
const APC_TRAINING_BASE = "https://apc-training.hypaship.com/api/3.0";
const APC_ACCOUNT_NUMBER = process.env.APC_ACCOUNT_NUMBER ?? "";
const APC_USERNAME = process.env.APC_USERNAME ?? "";
const APC_PASSWORD = process.env.APC_PASSWORD ?? "";
const APC_TRAINING_USERNAME = process.env.APC_TRAINING_USERNAME ?? "";
const APC_TRAINING_PASSWORD = process.env.APC_TRAINING_PASSWORD ?? "";

function isConfigured(): boolean {
  return !!(APC_USERNAME && APC_PASSWORD && APC_ACCOUNT_NUMBER);
}

function isTrainingConfigured(): boolean {
  return !!(APC_TRAINING_USERNAME && APC_TRAINING_PASSWORD && APC_ACCOUNT_NUMBER);
}

function basicAuthHeader(apiBase?: string): string {
  const isTraining = apiBase?.startsWith(APC_TRAINING_BASE);
  const user = isTraining && APC_TRAINING_USERNAME ? APC_TRAINING_USERNAME : APC_USERNAME;
  const pass = isTraining && APC_TRAINING_PASSWORD ? APC_TRAINING_PASSWORD : APC_PASSWORD;
  const encoded = Buffer.from(`${user}:${pass}`).toString("base64");
  return `Basic ${encoded}`;
}

export function trainingCredentialsConfigured(): boolean {
  return isTrainingConfigured();
}

function todayDDMMYYYY(date?: Date): string {
  const d = date ?? new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export interface ApcShipmentRequest {
  serviceCode: string;
  companyName?: string;
  recipient: {
    name: string;
    address1: string;
    address2?: string;
    city: string;
    postcode: string;
    country?: string;
    phone?: string;
    email?: string;
  };
  parcels: Array<{
    weight: number;
    length?: number;
    width?: number;
    height?: number;
  }>;
  reference?: string;
  specialInstructions?: string;
  collectionDate?: Date;
  apiBase?: string;
  /** Skip fetching the label PDF after booking. The fetch retries for up to
   *  ~12s when APC hasn't rendered the label yet, which dominates the cost of
   *  booking. Set this wherever the label isn't about to be printed — batch
   *  booking pulls each label live at print time instead. */
  skipLabel?: boolean;
  /** The address lines were cut to fit by a person, not by the normaliser —
   *  send them as written. Set only for a saved label-address override.
   *
   *  Without this the normaliser would re-shape a hand-corrected address and
   *  could undo the very fix that was made: someone who deliberately moved
   *  "Van 313 The Lawns" onto line 1 would watch it get shuffled back. A human
   *  who has looked at the order knows more about it than the parser does.
   *  Lines are still hard-capped at ADDRESS_LINE_MAX so a mistake can't send
   *  APC something it will reject. */
  addressAlreadyFitted?: boolean;
}

export interface ApcShipmentResult {
  consignmentNumber: string;
  /** Empty when the caller asked to skip the label fetch — see `skipLabel`. */
  labelPdfBase64: string;
  trackingUrl?: string;
  warnings?: string[];
}

interface PlaceOrderResult {
  waybill: string;
  warnings: string[];
}

/** Something the app could not resolve confidently. These stop an address
 *  being booked blind — they surface on the packing queue for a human. */
export interface AddressReviewFlag {
  kind: "conflicting-postcode" | "town-too-long" | "truncated";
  message: string;
  /** The exact text that will NOT appear on the label. This is the thing the
   *  operator actually needs to judge — "Van 313 The Lawns" being cut is a
   *  failed delivery, a dropped county is nothing. Carried separately from
   *  `message` so the screen can show it on its own rather than making
   *  someone find it inside a sentence (Graeme, 2026-08-26). */
  dropped?: string;
  /** How much the loss matters. `critical` means the dropped text carries a
   *  building identifier (a number, or a word like Flat/Unit/Van/Pitch) — the
   *  part a driver needs to find the door. `check` is everything else: it
   *  still wants human eyes, but it is usually a redundant place name. */
  severity: "critical" | "check";
}

export interface NormalisedAddress {
  address1: string;
  address2?: string;
  city: string;
  warnings: string[];
  /** Free text lifted out of an address line (delivery notes typed into
   *  address2). Callers should append it to the consignment Instructions
   *  rather than let it eat an address line. */
  instructions?: string;
  review: AddressReviewFlag[];
}

/** APC's per-line limit. Exported so the screen that lets an operator re-cut
 *  an address can show the same limit the booking will enforce, instead of
 *  letting them type a line that gets silently trimmed later. */
export const ADDRESS_LINE_MAX = 35;

/** Loose UK postcode matcher — good enough to spot a postcode typed into a
 *  street line. Deliberately permissive about the inner space. */
const UK_POSTCODE_RE = /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/gi;

/** Components that carry no delivery information because the field they
 *  belong to is sent separately. */
const COUNTRY_COMPONENTS = new Set([
  "unitedkingdom", "greatbritain", "england", "scotland", "wales",
  "northernireland", "uk", "gb", "u k",
]);

/** Counties, and their common abbreviations. A UK postcode already determines
 *  the county, so APC never needs it — but customers type it constantly, and
 *  it is usually the reason a line blows the 35-character limit. Dropping it
 *  BEFORE splitting is what a human does by hand, and it turns most
 *  "needs a look" rows into ones that simply fit (Graeme, 2026-08-26: "the
 *  courier doesn't need to know Lancashire").
 *
 *  Only ever removed as a separate trailing component — see
 *  `stripTrailingCounty`. Several of these are also town names (Durham,
 *  Lincoln, Cheshire East), so removing one mid-line would delete a real
 *  address. */
const COUNTY_COMPONENTS = new Set([
  // England — ceremonial counties and the abbreviations people actually type.
  "bedfordshire", "beds", "berkshire", "berks", "bristol", "buckinghamshire", "bucks",
  "cambridgeshire", "cambs", "cheshire", "cleveland", "cornwall", "cumbria",
  "derbyshire", "derbys", "devon", "dorset", "durham", "countydurham", "codurham",
  "eastriding", "eastridingofyorkshire", "eastsussex", "essex",
  "gloucestershire", "gloucs", "glos", "greatermanchester", "hampshire", "hants",
  "herefordshire", "hertfordshire", "herts", "isleofwight", "iow", "kent",
  "lancashire", "lancs", "leicestershire", "leics", "lincolnshire", "lincs",
  "merseyside", "middlesex", "middx", "norfolk", "northamptonshire", "northants",
  "northumberland", "northyorkshire", "nottinghamshire", "notts", "oxfordshire", "oxon",
  "rutland", "shropshire", "salop", "somerset", "southyorkshire", "staffordshire", "staffs",
  "suffolk", "surrey", "tyneandwear", "warwickshire", "warks", "westmidlands",
  "westsussex", "westyorkshire", "wiltshire", "wilts", "worcestershire", "worcs",
  // Wales.
  "clwyd", "dyfed", "gwent", "gwynedd", "powys", "southglamorgan", "midglamorgan",
  "westglamorgan", "monmouthshire", "pembrokeshire", "carmarthenshire", "ceredigion",
  "denbighshire", "flintshire", "wrexham", "conwy", "anglesey", "isleofanglesey",
  // Scotland.
  "aberdeenshire", "angus", "argyll", "argyllandbute", "ayrshire", "banffshire",
  "berwickshire", "caithness", "clackmannanshire", "dumfriesandgalloway",
  "dunbartonshire", "eastlothian", "fife", "inverness", "invernessshire", "lanarkshire",
  "midlothian", "moray", "perthshire", "renfrewshire", "rossshire", "roxburghshire",
  "stirlingshire", "sutherland", "westlothian", "wigtownshire",
  // Northern Ireland.
  "antrim", "coantrim", "armagh", "coarmagh", "down", "codown", "fermanagh",
  "cofermanagh", "londonderry", "colondonderry", "derry", "tyrone", "cotyrone",
]);

/** Marks text that identifies WHICH door — a number, or a dwelling word. If
 *  this is what got cut off the label, the parcel does not arrive. Used to
 *  separate a genuine problem from a dropped county. */
const BUILDING_IDENTIFIER_RE =
  /\d|\b(flat|apt|apartment|unit|van|pitch|plot|berth|caravan|lodge|chalet|block|suite|room|annexe|annex|floor|bungalow|cottage|barn|studio|penthouse|maisonette|mobile|static|park\s*home)\b/i;

/** Words a place name can end on ("Aston in Makerfield", "Newcastle upon
 *  Tyne", "Bourton on the Water"). Never leave a line dangling on one — that
 *  is how "Aston in Makerfield" became "Aston in". */
const CONNECTOR_WORDS = new Set([
  "in", "on", "upon", "under", "by", "le", "cum", "next", "super",
  "the", "of", "and", "at", "de", "la",
]);

/** Phrases that mean the customer typed a delivery note where an address
 *  line belongs. Kept tight on purpose: a false positive would delete part
 *  of a real address. */
const INSTRUCTION_HINTS = [
  /\bcan leave\b/i, /\bplease leave\b/i, /\bleave (it |in |with |at |by |round)/i,
  /\bif (out|no answer|nobody)\b/i, /\bsafe place\b/i, /\bknock\b/i,
  /\bring (the )?(bell|door)/i, /\bcall on arrival\b/i, /\bround the back\b/i,
];

const squash = (s: string | undefined) =>
  (s ?? "").replace(/\s+/g, " ").trim().replace(/^[,\s]+|[,\s]+$/g, "");
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const components = (line: string) => line.split(",").map(p => p.trim()).filter(Boolean);

/** Drop components that repeat an earlier one ("London, London, W3 2JH"). */
function dedupeComponents(line: string): string {
  const seen = new Set<string>();
  const kept = components(line).filter(part => {
    const k = key(part);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return kept.length > 0 ? kept.join(", ") : line;
}

/** Remove a town only when it is a SEPARATE trailing component — the line is
 *  exactly the town, or the town follows a comma or full stop. A town that
 *  merely ends the line is part of the place name ("Lower Darwen" ends with
 *  "Darwen" but is not a duplicate of it). */
function stripTrailingTown(line: string, town: string): string {
  if (!line || !town) return line;
  const l = line.trim(), t = town.trim();
  if (key(l) === key(t)) return "";
  if (!l.toLowerCase().endsWith(t.toLowerCase())) return line;
  const before = l.slice(0, l.length - t.length).trimEnd();
  if (before.endsWith(",") || before.endsWith(".")) {
    return before.replace(/[,.\s]+$/, "").trim();
  }
  return line;
}

/** Drop a trailing county component ("Thornton-Cleveleys, Fylde, Lancs." →
 *  "Thornton-Cleveleys, Fylde"). The postcode already carries the county, so
 *  nothing is lost — and the freed characters are usually what let the rest of
 *  the address survive intact.
 *
 *  Deliberately conservative. It only ever removes a SEPARATE trailing
 *  component, never a line that is nothing but a county: "Durham" alone is the
 *  town, and an address stripped to nothing is worse than one carrying a
 *  redundant word. Repeats so "…, Fylde, Lancashire, UK" unwinds fully. */
function stripTrailingCounty(line: string): string {
  let parts = components(line);
  while (parts.length > 1 && COUNTY_COMPONENTS.has(key(parts[parts.length - 1]!))) {
    parts = parts.slice(0, -1);
  }
  return parts.join(", ");
}

/** Does this dropped text carry the information a driver needs to find the
 *  door? Anything with a number or a dwelling word does. */
function severityOfLoss(dropped: string): "critical" | "check" {
  const meaningful = stripTrailingCounty(squash(dropped));
  if (!meaningful) return "check";
  return BUILDING_IDENTIFIER_RE.test(meaningful) ? "critical" : "check";
}

/** Split a line to fit, preferring a real boundary over an arbitrary word
 *  gap: comma first, then full stop, then a word break that does not leave a
 *  connector word dangling. */
function splitToFit(line: string): { head: string; tail: string } {
  if (line.length <= ADDRESS_LINE_MAX) return { head: line, tail: "" };

  const parts = components(line);
  if (parts.length > 1) {
    let head = "";
    let i = 0;
    for (; i < parts.length; i++) {
      const candidate = head ? `${head}, ${parts[i]}` : parts[i];
      if (candidate.length > ADDRESS_LINE_MAX) break;
      head = candidate;
    }
    if (head && i < parts.length) return { head, tail: parts.slice(i).join(", ") };
  }

  const dot = line.lastIndexOf(". ", ADDRESS_LINE_MAX);
  if (dot > 0) return { head: line.slice(0, dot + 1).trim(), tail: line.slice(dot + 2).trim() };

  // A connector binds the words on BOTH sides of it ("Aston in Makerfield"),
  // so a cut is only safe when neither the word before it nor the word after
  // it is a connector. Checking just the head would still strand "in
  // makerfield" on line 2.
  let cut = line.lastIndexOf(" ", ADDRESS_LINE_MAX);
  while (cut > 0) {
    const before = (line.slice(0, cut).trim().split(" ").pop() ?? "").toLowerCase();
    const after = (line.slice(cut + 1).trim().split(" ")[0] ?? "").toLowerCase();
    if (!CONNECTOR_WORDS.has(before) && !CONNECTOR_WORDS.has(after)) break;
    cut = line.lastIndexOf(" ", cut - 1);
  }
  if (cut > 0) return { head: line.slice(0, cut).trim(), tail: line.slice(cut + 1).trim() };

  return { head: line.slice(0, ADDRESS_LINE_MAX).trim(), tail: line.slice(ADDRESS_LINE_MAX).trim() };
}

/**
 * Reshape a Shopify address into APC's 35-character lines — the automated
 * version of carving an address up by hand before a CSV upload.
 *
 * Order matters: strip what is redundant BEFORE splitting, because most
 * over-long lines are only over-long because they repeat the postcode or
 * country we already send in their own fields. Removing those usually makes
 * the line fit with no split at all, which is what a human would do.
 *
 * Exported so address handling can be inspected and tested without booking
 * anything with APC — a wrong address only shows up as a failed delivery.
 */
export function normaliseAddress(
  address1: string,
  address2: string | undefined,
  city: string,
  opts: { postcode?: string; countryCode?: string } = {},
): NormalisedAddress {
  const warnings: string[] = [];
  const review: AddressReviewFlag[] = [];

  const originalA1 = squash(address1);
  let a1 = originalA1;
  let a2 = squash(address2);
  const rawCity = squash(city);
  const postcodeKey = key(opts.postcode ?? "");

  let c = rawCity;
  if (c.length > ADDRESS_LINE_MAX) {
    c = c.slice(0, ADDRESS_LINE_MAX).trim();
    warnings.push(`City truncated from "${rawCity}" to "${c}"`);
    review.push({
      kind: "town-too-long",
      message: `Town "${rawCity}" is ${rawCity.length} characters — APC allows ${ADDRESS_LINE_MAX}. Check the correct post town before booking.`,
      dropped: rawCity.slice(c.length).trim(),
      severity: "check",
    });
  }

  // ── 1. Lift delivery notes out of an address line ────────────────────────
  let instructions: string | undefined;
  const looksLikeNote = (s: string) =>
    s.length > ADDRESS_LINE_MAX && INSTRUCTION_HINTS.some(re => re.test(s));
  if (looksLikeNote(a2)) { instructions = a2; a2 = ""; }

  // ── 2. Remove what other fields already carry ────────────────────────────
  const stripRedundant = (line: string, label: string): string => {
    if (!line) return line;
    let out = line;

    // Postcodes: drop one that matches the order's postcode; flag one that
    // does not, because guessing between two postcodes ships to the wrong
    // address half the time.
    const found = out.match(UK_POSTCODE_RE) ?? [];
    for (const match of found) {
      if (postcodeKey && key(match) === postcodeKey) {
        out = out.replace(match, " ");
      } else if (postcodeKey) {
        review.push({
          kind: "conflicting-postcode",
          message: `${label} contains "${match}" but the order's postcode is "${opts.postcode}". Confirm which is right before booking.`,
          // Two postcodes means one of them ships the parcel to the wrong
          // place — never a judgement to make on the operator's behalf.
          severity: "critical",
        });
      }
    }

    out = components(out)
      .filter(part => !COUNTRY_COMPONENTS.has(key(part)))
      .join(", ");
    // A country name trailing without a comma ("… London United Kingdom").
    for (const word of ["United Kingdom", "Great Britain"]) {
      if (out.toLowerCase().endsWith(word.toLowerCase())) {
        out = out.slice(0, out.length - word.length).trim();
      }
    }

    // The postcode already carries the county, so a trailing one is dead
    // weight on a 35-character line. Removed here, alongside the country, for
    // the same reason: strip what other fields carry BEFORE splitting.
    out = stripTrailingCounty(squash(out));

    return squash(dedupeComponents(squash(out)));
  };

  a1 = stripRedundant(a1, "Address line 1");
  a2 = stripRedundant(a2, "Address line 2");

  // ── 3. Duplicate town / duplicate line ───────────────────────────────────
  a1 = stripTrailingTown(a1, c);
  a2 = stripTrailingTown(a2, c);
  if (a2 && key(a1).includes(key(a2)) && key(a2).length > 3) a2 = "";
  if (!a1 && a2) { a1 = a2; a2 = ""; }
  if (!a1) a1 = originalA1.slice(0, ADDRESS_LINE_MAX);

  // ── 4. Fit to 35 characters, overflow cascading down ─────────────────────
  const fitted = splitToFit(a1);
  a1 = fitted.head;
  if (fitted.tail) a2 = a2 ? `${fitted.tail}, ${a2}` : fitted.tail;

  if (a2) {
    a2 = squash(dedupeComponents(a2));
    if (a2.length > ADDRESS_LINE_MAX) {
      const full = a2;
      a2 = splitToFit(a2).head.slice(0, ADDRESS_LINE_MAX).trim();
      const lost = squash(full.slice(a2.length).replace(/^[,\s]+/, ""));
      warnings.push(`Address line 2 truncated from "${full}" to "${a2}"`);
      review.push({
        kind: "truncated",
        message: `Address line 2 was too long and lost "${lost}". Check the address before booking.`,
        dropped: lost,
        severity: severityOfLoss(lost),
      });
    }
  }

  return {
    address1: a1,
    ...(a2 ? { address2: a2 } : {}),
    city: c,
    warnings,
    ...(instructions ? { instructions } : {}),
    review,
  };
}

async function placeOrder(req: ApcShipmentRequest): Promise<PlaceOrderResult> {
  if (!APC_USERNAME || !APC_PASSWORD || !APC_ACCOUNT_NUMBER) {
    throw new Error("APC credentials not configured.");
  }

  const apiBase = req.apiBase ?? APC_API_BASE;
  const totalWeightKg = req.parcels.reduce((sum, p) => sum + p.weight, 0);
  const firstParcel = req.parcels[0] ?? { weight: totalWeightKg };

  // Postcode + country are passed in so the normaliser can drop them when a
  // customer has typed the whole address into the street line — they already
  // travel in their own fields.
  //
  // An address a person has already cut to fit bypasses all of that: see
  // `addressAlreadyFitted`. It still gets the hard 35-character cap, because
  // the cap is APC's rule rather than ours.
  const addr: NormalisedAddress = req.addressAlreadyFitted
    ? {
        address1: req.recipient.address1.slice(0, ADDRESS_LINE_MAX).trim(),
        ...(req.recipient.address2?.trim()
          ? { address2: req.recipient.address2.slice(0, ADDRESS_LINE_MAX).trim() }
          : {}),
        city: req.recipient.city.slice(0, ADDRESS_LINE_MAX).trim(),
        warnings: [],
        review: [],
      }
    : normaliseAddress(
        req.recipient.address1,
        req.recipient.address2,
        req.recipient.city,
        { postcode: req.recipient.postcode, countryCode: req.recipient.country },
      );

  // Anything the normaliser could not resolve confidently is a warning on the
  // booking, not a silent guess.
  for (const flag of addr.review) addr.warnings.push(flag.message);

  // Delivery notes typed into an address line belong in Instructions.
  const combinedInstructions = [req.specialInstructions, addr.instructions]
    .filter(Boolean)
    .join(" ")
    .trim();

  const rawCompanyName = (req.companyName ?? req.recipient.name);
  const companyName = rawCompanyName.slice(0, 35);
  if (rawCompanyName.length > 35) {
    addr.warnings.push(`Company name truncated from "${rawCompanyName}" to "${companyName}"`);
  }

  const payload = {
    Orders: {
      Order: {
        CollectionDate: todayDDMMYYYY(req.collectionDate),
        ReadyAt: "09:00",
        ClosedAt: "17:00",
        ProductCode: req.serviceCode,
        // Keep the "#" — the Shopify order name IS the reference everyone
        // searches Hypaship by, and stripping it produced "-131249", which
        // no one could find. APC accepts "#": the hand-raised consignments
        // uploaded from the spreadsheet have always carried it, which is why
        // reconcile-mode lookup tries the verbatim "#131249" form first.
        Reference: (req.reference ?? "").replace(/[^a-zA-Z0-9\-\.#]/g, "-").slice(0, 25),
        Delivery: {
          CompanyName: companyName,
          AddressLine1: addr.address1,
          ...(addr.address2 ? { AddressLine2: addr.address2 } : {}),
          PostalCode: req.recipient.postcode,
          City: addr.city,
          CountryCode: req.recipient.country ?? "GB",
          Contact: {
            PersonName: req.recipient.name.slice(0, 35),
            ...(req.recipient.phone ? { PhoneNumber: req.recipient.phone } : {}),
            ...(req.recipient.email ? { Email: req.recipient.email } : {}),
          },
          ...(combinedInstructions ? { Instructions: combinedInstructions.slice(0, 50) } : {}),
          Safeplace: "Allowed",
        },
        GoodsInfo: {
          GoodsValue: "1",
          GoodsDescription: "food",
          Fragile: "false",
        },
        ShipmentDetails: {
          NumberOfPieces: String(req.parcels.length),
          Items: {
            Item: req.parcels.length === 1
              ? {
                  Type: "PARCEL",
                  Weight: String(Math.max(0.01, firstParcel.weight).toFixed(3)),
                  Length: String(firstParcel.length ?? 0),
                  Width: String(firstParcel.width ?? 0),
                  Height: String(firstParcel.height ?? 0),
                }
              : req.parcels.map(p => ({
                  Type: "PARCEL",
                  Weight: String(Math.max(0.01, p.weight).toFixed(3)),
                  Length: String(p.length ?? 0),
                  Width: String(p.width ?? 0),
                  Height: String(p.height ?? 0),
                })),
          },
        },
      },
    },
  };

  const res = await fetch(`${apiBase}/Orders.json`, {
    method: "POST",
    headers: {
      "remote-user": basicAuthHeader(apiBase),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();

  if (!res.ok) {
    let errMsg = `APC order creation failed (${res.status})`;
    try {
      const json = JSON.parse(text);
      // APC auth errors come back as top-level {"Messages": ...} without the "Orders" wrapper
      const desc = json?.Orders?.Messages?.Description
        ?? json?.Orders?.Order?.Messages?.Description
        ?? json?.Messages?.Description;
      if (desc && desc !== "SUCCESS") errMsg = desc;
    } catch {
      if (text && !text.trim().startsWith("<")) errMsg = text.slice(0, 300);
    }
    throw new Error(errMsg);
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`APC returned invalid JSON: ${text.slice(0, 200)}`);
  }

  const topCode = json?.Orders?.Messages?.Code;
  const orderCode = json?.Orders?.Order?.Messages?.Code;
  if (topCode !== "SUCCESS" || orderCode !== "SUCCESS") {
    // APC's Description can be as terse as "104 ERROR". Pull out the
    // per-field detail it ships alongside (ErrorFields), and translate the
    // known terse codes so the batch report explains itself (2026-08-26:
    // an Isle of Wight order failed with a bare "104 ERROR" — no service
    // for the postcode on the chosen product code).
    const msgs = json?.Orders?.Order?.Messages ?? json?.Orders?.Messages ?? {};
    const desc: string = msgs?.Description ?? "Unknown error";
    const rawFields = msgs?.ErrorFields?.ErrorField ?? msgs?.ErrorFields;
    const fieldList = rawFields ? (Array.isArray(rawFields) ? rawFields : [rawFields]) : [];
    const details = fieldList
      .map((f: { FieldName?: string; ErrorMessage?: string; Message?: string }) =>
        [f?.FieldName, f?.ErrorMessage ?? f?.Message].filter(Boolean).join(": "))
      .filter(Boolean)
      .join("; ");
    let explained = details ? `${desc} — ${details}` : desc;
    if (/^104\b/i.test(desc)) {
      explained += " (APC rejected the booking data — most often the service code isn't offered for this postcode/route. Check which services APC's portal offers for this address.)";
    }
    throw new Error(`APC order failed: ${explained}`);
  }

  const waybill: string = json?.Orders?.Order?.WayBill;
  if (!waybill) {
    throw new Error("APC returned no WayBill number in order response");
  }

  const warnings: string[] = [...addr.warnings];
  const orderWarnings = json?.Orders?.Order?.Warnings;
  if (orderWarnings) {
    const warnList = Array.isArray(orderWarnings) ? orderWarnings : [orderWarnings];
    for (const w of warnList) {
      const msg = typeof w === "string" ? w : w?.Description ?? w?.Message ?? JSON.stringify(w);
      if (msg) warnings.push(msg);
    }
  }
  const topWarnings = json?.Orders?.Warnings;
  if (topWarnings) {
    const warnList = Array.isArray(topWarnings) ? topWarnings : [topWarnings];
    for (const w of warnList) {
      const msg = typeof w === "string" ? w : w?.Description ?? w?.Message ?? JSON.stringify(w);
      if (msg) warnings.push(msg);
    }
  }

  return { waybill, warnings };
}

/**
 * Pull the label PDF(s) for a waybill, as base64.
 *
 * `markPrinted` defaults to FALSE (changed 2026-08-20). It used to default to
 * true, which meant APC's printed flag was set the moment the app ASKED for a
 * label — so it was set by prints that failed, and by background pre-prints of
 * orders nobody had opened. The flag effectively meant "the app touched this
 * once", and nothing in this codebase reads it.
 *
 * If a meaningful printed state is ever wanted, set it at the point a physical
 * label is confirmed in hand (the bench label scan), not on fetch.
 */
async function fetchLabel(
  waybill: string,
  apiBaseIn?: string,
  retries = 4,
  delayMs = 3000,
  markPrinted = false,
): Promise<string[]> {
  const apiBase = apiBaseIn ?? APC_API_BASE;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    const url = `${apiBase}/Orders/${waybill}.json?searchtype=CarrierWaybill&labelformat=PDF&labels=True&markprinted=${markPrinted ? "True" : "False"}`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "remote-user": basicAuthHeader(apiBase),
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      if (attempt < retries) continue;
      const text = await res.text();
      throw new Error(`APC label fetch failed (${res.status}): ${text.slice(0, 200)}`);
    }

    let json: any;
    try {
      json = await res.json();
    } catch {
      if (attempt < retries) continue;
      throw new Error("APC label response was not valid JSON");
    }

    const item = json?.Orders?.Order?.ShipmentDetails?.Items?.Item;

    if (Array.isArray(item)) {
      const labels = item
        .map((it: any) => it?.Label?.Content as string | undefined)
        .filter((c: string | undefined): c is string => !!c);
      if (labels.length > 0) return labels;
    } else if (item?.Label?.Content) {
      return [item.Label.Content as string];
    }

    // Label not ready yet — retry
    if (attempt < retries) continue;
  }

  throw new Error("APC label was not available after multiple retries");
}

export async function createShipment(req: ApcShipmentRequest): Promise<ApcShipmentResult> {
  if (!isConfigured()) {
    throw new Error("APC credentials not configured. Set APC_USERNAME, APC_PASSWORD and APC_ACCOUNT_NUMBER environment variables.");
  }

  const apiBase = req.apiBase ?? APC_API_BASE;

  const { waybill, warnings } = await placeOrder(req);

  // Fetching the label is the SLOW half of booking: APC often isn't ready to
  // render one the instant the order is placed, so fetchLabel retries — up to
  // five attempts three seconds apart. That is fine when the label is about to
  // be printed, and pure waste when it isn't.
  //
  // Batch booking doesn't print anything; the packing screen pulls each label
  // live at print time. It was still paying that retry loop per order, which
  // is why booking 17 consignments took over five minutes (2026-08-21).
  const labels = req.skipLabel ? [] : await fetchLabel(waybill, apiBase);

  // The CUSTOMER-facing link — apcTrackingUrl, always. The Hypaship portal
  // URL (apc.hypaship.com/tracking?...) is a logged-in back-office page that
  // 404s for the public; booking with it here sent 200+ customers a dead
  // link between 2026-08-21 and 2026-08-25, because this value is stored on
  // apc_consignments and then wins over the fulfil-time URL.
  const trackingUrl = apcTrackingUrl(waybill, req.recipient.postcode);

  return {
    consignmentNumber: waybill,
    labelPdfBase64: labels[0] ?? "",
    trackingUrl,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export interface ApcServiceCodes {
  smallWeekday: string;
  largeWeekday: string;
  smallFriday: string;
  largeFriday: string;
  weightThresholdGrams: number;
}

function getDefaultServiceCodes(): ApcServiceCodes {
  return {
    smallWeekday: process.env.APC_SERVICE_CODE_SMALL_WEEKDAY ?? "",
    largeWeekday: process.env.APC_SERVICE_CODE_LARGE_WEEKDAY ?? "",
    smallFriday: process.env.APC_SERVICE_CODE_SMALL_FRIDAY ?? "",
    largeFriday: process.env.APC_SERVICE_CODE_LARGE_FRIDAY ?? "",
    weightThresholdGrams: Number(process.env.APC_WEIGHT_THRESHOLD_GRAMS ?? 5000),
  };
}

export interface PostcodeCheckResult {
  available: boolean;
  reason?: string;
}

/**
 * Check whether a specific APC service code can deliver to a given
 * postcode by attempting a test booking on APC's TRAINING server.
 *
 * APC's ServiceAvailability endpoint doesn't list depot-specific
 * product codes (like WL16, WD16) — only generic APC-prefixed codes.
 * The only reliable validation is to POST an order with the target
 * service code and postcode to the training API. If APC rejects it,
 * the postcode/code combo is invalid. If it accepts, we immediately
 * cancel the test order.
 *
 * Results are cached per (postcode, serviceCode) for 5 minutes so a
 * batch of 80+ orders with overlapping postcodes is fast.
 */

// Short-lived cache: (postcode|serviceCode) → result.
const validationCache = new Map<string, { result: PostcodeCheckResult; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function checkPostcodeService(
  postcode: string,
  serviceCode: string,
  _apiBase?: string, // ignored — always uses training for validation
): Promise<PostcodeCheckResult> {
  if (!APC_USERNAME || !APC_PASSWORD || !APC_ACCOUNT_NUMBER) {
    throw new Error("APC credentials not configured.");
  }

  const cleanPostcode = postcode.replace(/\s+/g, "").toUpperCase();
  const formattedPostcode = cleanPostcode.length > 3
    ? `${cleanPostcode.slice(0, -3)} ${cleanPostcode.slice(-3)}`
    : cleanPostcode;

  // Cache check — same (postcode, serviceCode) combo doesn't need
  // another round-trip within a 5-minute window.
  const cacheKey = `${formattedPostcode}|${serviceCode.toUpperCase()}`;
  const cached = validationCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.result;
  }

  // Use the next weekday as collection date (APC rejects past dates
  // and may reject weekends).
  const collDate = new Date();
  collDate.setDate(collDate.getDate() + 1);
  while (collDate.getDay() === 0 || collDate.getDay() === 6) {
    collDate.setDate(collDate.getDate() + 1);
  }
  const collectionDate = todayDDMMYYYY(collDate);

  // Training credentials — fall back to production creds if training-
  // specific ones aren't set (some APC accounts use the same login).
  const tUser = APC_TRAINING_USERNAME || APC_USERNAME;
  const tPass = APC_TRAINING_PASSWORD || APC_PASSWORD;
  const authHeader = `Basic ${Buffer.from(`${tUser}:${tPass}`).toString("base64")}`;

  const payload = {
    Orders: {
      Order: {
        CollectionDate: collectionDate,
        ReadyAt: "09:00",
        ClosedAt: "17:00",
        ProductCode: serviceCode,
        Reference: `VALIDATE-${cleanPostcode.slice(0, 15)}`,
        Delivery: {
          CompanyName: "Validation Check",
          AddressLine1: "1 Test Street",
          PostalCode: formattedPostcode,
          City: "Test",
          CountryCode: "GB",
          Contact: { PersonName: "Validation" },
        },
        GoodsInfo: {
          GoodsValue: "1",
          GoodsDescription: "validation",
          Fragile: "false",
        },
        ShipmentDetails: {
          NumberOfPieces: "1",
          Items: {
            Item: {
              Type: "PARCEL",
              Weight: "1",
              Length: "30",
              Width: "20",
              Height: "15",
              Value: "15",
            },
          },
        },
      },
    },
  };

  const url = `${APC_TRAINING_BASE}/Orders.json`;
  console.log(`[APC Validate] POST ${url} — testing ${serviceCode} → ${formattedPostcode}`);

  let res: globalThis.Response;
  let rawText: string;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "remote-user": authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    rawText = await res.text();
  } catch (err) {
    throw new Error(`APC training API unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }

  let json: any;
  try {
    json = JSON.parse(rawText);
  } catch {
    console.error(`[APC Validate] non-JSON (HTTP ${res.status}):`, rawText.slice(0, 500));
    throw new Error(`APC training returned non-JSON (HTTP ${res.status}) — check training credentials`);
  }

  // SYSTEM failures must THROW, never masquerade as a postcode rejection.
  // On 2026-08-20 the training login expired (HTTP 419, code 100019) and
  // every order on the despatch screen went red with "Service LW16
  // rejected for <postcode>" — a fleet of phantom postcode issues that
  // were really one auth problem. Auth errors come back with a TOP-LEVEL
  // Messages node and no Orders node at all.
  const systemMsg = json?.Messages;
  if (res.status === 401 || res.status === 419 || systemMsg?.Code === "Authentication Error" || !json?.Orders) {
    const desc = systemMsg?.Description ?? `HTTP ${res.status}`;
    throw new Error(`APC training auth/system error (not a postcode problem): ${desc}`);
  }

  const topCode = json?.Orders?.Messages?.Code;
  const orderCode = json?.Orders?.Order?.Messages?.Code;
  const orderDesc = json?.Orders?.Order?.Messages?.Description
    ?? json?.Orders?.Messages?.Description;

  if (topCode === "SUCCESS" && orderCode === "SUCCESS") {
    // Test booking accepted → postcode + service is valid.
    // Cancel immediately so training doesn't accumulate junk orders.
    const waybill = json?.Orders?.Order?.WayBill;
    if (waybill) {
      // Fixed 2026-08-20: this passed an OBJECT into a string parameter, so
      // the DELETE hit /Orders/[object Object].json and every validation
      // booking stayed in the training account forever.
      cancelShipment(waybill, APC_TRAINING_BASE).catch(err =>
        console.warn(`[APC Validate] cancel ${waybill} failed:`, err),
      );
    }
    console.log(`[APC Validate] ${formattedPostcode} ✓ ${serviceCode}`);
    const result: PostcodeCheckResult = { available: true };
    validationCache.set(cacheKey, { result, ts: Date.now() });
    return result;
  }

  // APC rejected — extract the reason (e.g. "Service WL16 is not
  // available to KY11 2NS").
  const reason = orderDesc && orderDesc !== "SUCCESS"
    ? orderDesc
    : `Service ${serviceCode} rejected for ${formattedPostcode}`;
  console.log(`[APC Validate] ${formattedPostcode} ✗ ${serviceCode} — ${reason}`);
  const result: PostcodeCheckResult = { available: false, reason };
  validationCache.set(cacheKey, { result, ts: Date.now() });
  return result;
}

export interface AddParcelRequest {
  waybill: string;
  parcel: {
    weight: number;
    length?: number;
    width?: number;
    height?: number;
  };
  apiBase?: string;
}

export interface AddParcelResult {
  labelPdfs: string[];
  warnings: string[];
}

export async function addParcel(req: AddParcelRequest): Promise<AddParcelResult> {
  if (!isConfigured()) {
    throw new Error("APC credentials not configured.");
  }

  const apiBase = req.apiBase ?? APC_API_BASE;

  const payload = {
    Orders: {
      Order: {
        WayBill: req.waybill,
        ShipmentDetails: {
          Items: {
            Item: {
              Type: "PARCEL",
              Weight: String(Math.max(0.01, req.parcel.weight).toFixed(3)),
              Length: String(req.parcel.length ?? 0),
              Width: String(req.parcel.width ?? 0),
              Height: String(req.parcel.height ?? 0),
            },
          },
        },
      },
    },
  };

  const res = await fetch(`${apiBase}/Orders.json`, {
    method: "PUT",
    headers: {
      "remote-user": basicAuthHeader(apiBase),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();

  if (!res.ok) {
    let errMsg = `APC add parcel failed (${res.status})`;
    try {
      const json = JSON.parse(text);
      const desc = json?.Orders?.Messages?.Description ?? json?.Orders?.Order?.Messages?.Description;
      if (desc && desc !== "SUCCESS") errMsg = desc;
    } catch {
      errMsg = text || errMsg;
    }
    throw new Error(errMsg);
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`APC returned invalid JSON: ${text.slice(0, 200)}`);
  }

  const body = json as Record<string, any>;
  const topCode = body?.Orders?.Messages?.Code;
  const orderCode = body?.Orders?.Order?.Messages?.Code;
  if (topCode !== "SUCCESS" || (orderCode && orderCode !== "SUCCESS")) {
    const desc = body?.Orders?.Order?.Messages?.Description
      ?? body?.Orders?.Messages?.Description ?? "Unknown error";
    throw new Error(`APC add parcel failed: ${desc}`);
  }

  const warnings: string[] = [];
  const orderWarnings = body?.Orders?.Order?.Warnings;
  if (orderWarnings) {
    const warnList = Array.isArray(orderWarnings) ? orderWarnings : [orderWarnings];
    for (const w of warnList) {
      const msg = typeof w === "string" ? w : w?.Description ?? w?.Message ?? JSON.stringify(w);
      if (msg) warnings.push(msg);
    }
  }

  const labelPdfs = await fetchLabel(req.waybill, apiBase);

  return { labelPdfs, warnings };
}

// ── Label-barcode ↔ waybill matching ───────────────────────────────────────
// An APC label carries TWO barcodes: the long item barcode, and a short
// depot/route code (e.g. "080"). Only the long one identifies the parcel, so a
// short scan must be reported as "wrong barcode on the label", never as
// "wrong label for this order".
//
// The two long forms share a 14-digit core (see the identifier glossary in the
// APC API v3 guide):
//   item barcode   (17) = <14-digit core><3-digit item no>   03036990014368 + 001
//   consignment id (22) = <8-digit send date><14-digit core> 20260728 + 03036990014368
//
// Matching on the core therefore works whichever barcode the scanner reads,
// and every parcel of a multi-box consignment matches the same consignment —
// which is what we want for the add-parcel flow.
//
// The send date lives ONLY in the 22-digit form, so a scanned item barcode can
// never be turned into a waybill on its own. Always take the waybill from the
// API (lookupOrderByReference) and use the scan purely to verify it.

export type ApcBarcodeParse =
  | { ok: true; core: string; itemNumber: string | null; format: "item" | "consignment" | "core"; digits: string }
  | { ok: false; reason: "empty" | "too-short" | "unrecognised-length"; digits: string };

/** Reduce a raw scanner string to the 14-digit consignment core. */
export function parseApcBarcode(scanned: string): ApcBarcodeParse {
  const digits = (scanned ?? "").replace(/\D/g, "");
  if (!digits) return { ok: false, reason: "empty", digits };
  // The depot/route barcode is far too short to be a parcel identifier.
  if (digits.length < 14) return { ok: false, reason: "too-short", digits };
  if (digits.length === 14) return { ok: true, core: digits, itemNumber: null, format: "core", digits };
  if (digits.length === 17) return { ok: true, core: digits.slice(0, 14), itemNumber: digits.slice(14), format: "item", digits };
  if (digits.length === 22) return { ok: true, core: digits.slice(8), itemNumber: null, format: "consignment", digits };
  return { ok: false, reason: "unrecognised-length", digits };
}

/** The 14-digit core of a 22-digit APC waybill (or of a bare core). */
export function waybillCore(waybill: string): string | null {
  const digits = (waybill ?? "").replace(/\D/g, "");
  if (digits.length === 22) return digits.slice(8);
  if (digits.length === 14) return digits;
  return null;
}

/** True when a scanned label barcode belongs to the given consignment. */
export function barcodeMatchesWaybill(scanned: string, waybill: string): boolean {
  const parsed = parseApcBarcode(scanned);
  const core = waybillCore(waybill);
  return parsed.ok && core !== null && parsed.core === core;
}

/** APC's Reference field allows only letters, numbers and dashes, so a Shopify
 *  order name like "#131377" has to be reduced before it can be sent or
 *  looked up. Leading/trailing dashes are trimmed so "#131377" resolves to
 *  "131377" rather than "-131377". */
export function sanitiseApcReference(reference: string): string {
  return (reference ?? "")
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 25);
}

export interface ApcOrderLookup {
  /** 22-digit consignment identifier — the number Shopify wants. */
  waybill: string | null;
  reference: string | null;
  consigneeName: string | null;
  consigneeCompany: string | null;
  consigneePostcode: string | null;
  productCode: string | null;
  /** Per-parcel item barcodes, when APC returns them. */
  itemNumbers: string[];
}

/**
 * Look up a consignment by OUR reference (the Shopify order number).
 *
 * Read-only: passes labels=False and markprinted=False explicitly so a lookup
 * can never mark a label as printed — `markprinted` defaults to "Conditional"
 * in the API, and fetchLabel() deliberately sets it True, so being explicit
 * here matters.
 *
 * Returns null when APC has no consignment for that reference — which is the
 * signal that the reference was mistyped during the manual upload.
 */
/**
 * Look up a consignment by OUR reference (the Shopify order number).
 *
 * Tries the reference VERBATIM first. The API guide says the Reference field
 * allows "only letters, numbers, or - (dash)", but that isn't enforced on the
 * CSV bulk-import path: verified 2026-07-28 against a live consignment, where
 * APC had stored "#131377" complete with the hash. Sanitising first therefore
 * produced a false "not found". The "#" is percent-encoded into the path by
 * encodeURIComponent, so it queries cleanly.
 *
 * The sanitised form is tried as a fallback because createShipment() strips
 * the reference before booking, so consignments raised through the API carry a
 * different string from the ones uploaded by hand.
 */
export async function lookupOrderByReference(
  reference: string,
  apiBase?: string,
): Promise<(ApcOrderLookup & { matchedReferenceForm: string }) | null> {
  const all = await lookupOrdersByReference(reference, apiBase);
  return all[0] ?? null;
}

/**
 * All consignments APC holds for a reference, newest first (the waybill's
 * leading 8 digits are the send date, so a plain descending sort orders by
 * date raised).
 *
 * One reference can genuinely match several consignments: an order that was
 * skipped and later re-tagged gets uploaded to Hypaship twice, and APC keeps
 * both. The API then returns Orders.Order as an ARRAY — callers that assume a
 * single object silently read "not found" (this blocked packing of #132045 /
 * #132031 on 2026-08-06).
 */
export async function lookupOrdersByReference(
  reference: string,
  apiBase?: string,
): Promise<Array<ApcOrderLookup & { matchedReferenceForm: string }>> {
  const verbatim = (reference ?? "").trim();
  const sanitised = sanitiseApcReference(reference);
  if (!verbatim && !sanitised) throw new Error("Reference is empty.");

  // Deduped, verbatim first.
  const candidates = Array.from(new Set([verbatim, sanitised].filter(Boolean)));

  for (const candidate of candidates) {
    const hits = await lookupOrders(candidate, "Reference", apiBase);
    if (hits.length) {
      return hits
        .sort((a, b) => (b.waybill ?? "").localeCompare(a.waybill ?? ""))
        .map(h => ({ ...h, matchedReferenceForm: candidate }));
    }
  }
  return [];
}

/** Look up a consignment by its 22-digit APC waybill. Read-only, same
 *  no-side-effects guarantees as lookupOrderByReference — useful for asking
 *  "what reference does APC actually hold for this parcel?" when a lookup by
 *  our own reference comes back empty. */
export async function lookupOrderByWaybill(
  waybill: string,
  apiBase?: string,
): Promise<ApcOrderLookup | null> {
  const digits = (waybill ?? "").replace(/\D/g, "");
  if (digits.length !== 22) throw new Error("Waybill must be 22 digits.");
  return lookupOrder(digits, "CarrierWaybill", apiBase);
}

async function lookupOrder(
  key: string,
  searchtype: "Reference" | "CarrierWaybill" | "OrderNumber",
  apiBase?: string,
): Promise<ApcOrderLookup | null> {
  const hits = await lookupOrders(key, searchtype, apiBase);
  return hits[0] ?? null;
}

async function lookupOrders(
  key: string,
  searchtype: "Reference" | "CarrierWaybill" | "OrderNumber",
  apiBase?: string,
): Promise<ApcOrderLookup[]> {
  if (!isConfigured()) {
    throw new Error("APC credentials not configured.");
  }

  const base = apiBase ?? APC_API_BASE;

  const url = `${base}/Orders/${encodeURIComponent(key)}.json`
    + `?searchtype=${searchtype}&labels=False&markprinted=False`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "remote-user": basicAuthHeader(base),
      "Content-Type": "application/json",
    },
  });

  const text = await res.text();

  if (!res.ok) {
    // A reference APC doesn't know is a normal, expected outcome — not an
    // error the caller should have to catch.
    if (res.status === 404) return [];
    let errMsg = `APC ${searchtype} lookup failed (${res.status})`;
    try {
      const json = JSON.parse(text);
      const desc = json?.Orders?.Messages?.Description ?? json?.Messages?.Description;
      if (desc && desc !== "SUCCESS") errMsg = desc;
    } catch {
      if (text && !text.trim().startsWith("<")) errMsg = text.slice(0, 300);
    }
    throw new Error(errMsg);
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`APC returned invalid JSON: ${text.slice(0, 200)}`);
  }

  // One order comes back as an object, several as an array — a reference
  // uploaded twice (skip → re-tag → re-upload) matches multiple consignments.
  const rawOrder = json?.Orders?.Order;
  const orders: any[] = Array.isArray(rawOrder) ? rawOrder : rawOrder ? [rawOrder] : [];

  return orders.flatMap((order: any) => {
    // Some "not found" responses come back 200 with a non-SUCCESS message.
    const waybill: string | null = order?.WayBill ?? null;
    if (!waybill) return [];

    const rawItem = order?.ShipmentDetails?.Items?.Item;
    const items = rawItem ? (Array.isArray(rawItem) ? rawItem : [rawItem]) : [];

    return [{
      waybill,
      reference: order?.Reference ?? null,
      consigneeName: order?.Delivery?.Contact?.PersonName ?? null,
      consigneeCompany: order?.Delivery?.CompanyName ?? null,
      consigneePostcode: order?.Delivery?.PostalCode ?? null,
      productCode: order?.ProductCode ?? null,
      itemNumbers: items
        .map((it: any) => it?.ItemNumber)
        .filter((n: unknown): n is string => typeof n === "string"),
    }];
  });
}

/** Customer-facing tracking link. APC's WordPress site (apc.co.uk) prefills
 *  the parcel-tracker widget from `consignment` + `postcode` query params and
 *  its JS auto-submits the search when BOTH are present — so this link lands
 *  the customer straight on their parcel's status. The old
 *  apc-overnight.com/track-parcel.php URL now 301s to the apc.co.uk homepage
 *  and DROPS its params (verified 2026-08-03), so it must not be used. */
export function apcTrackingUrl(waybill: string, postcode: string | null | undefined): string {
  const wb = encodeURIComponent(waybill);
  const pc = (postcode ?? "").toUpperCase().replace(/\s+/g, "");
  if (!pc) return `https://apc.co.uk/?consignment=${wb}`;
  // Inward code is always the last 3 characters of a UK postcode; APC's
  // widget expects the two halves space-separated ("DY12 1RB"), and "+"
  // encodes a space in a query string.
  const formatted = pc.length > 3
    ? `${pc.slice(0, pc.length - 3)}+${pc.slice(-3)}`
    : pc;
  return `https://apc.co.uk/?consignment=${wb}&postcode=${formatted}`;
}

export async function cancelShipment(waybill: string, apiBase?: string): Promise<void> {
  if (!isConfigured()) {
    throw new Error("APC credentials not configured.");
  }

  const base = apiBase ?? APC_API_BASE;
  const url = `${base}/Orders/${encodeURIComponent(waybill)}.json`;

  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      "remote-user": basicAuthHeader(base),
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    let errMsg = `APC cancel failed (${res.status})`;
    try {
      const json = JSON.parse(text);
      const desc = json?.Orders?.Messages?.Description ?? json?.Orders?.Order?.Messages?.Description;
      if (desc && desc !== "SUCCESS") errMsg = desc;
    } catch {
      errMsg = text || errMsg;
    }
    throw new Error(errMsg);
  }

  let body: Record<string, any> | undefined;
  try {
    body = (await res.json()) as Record<string, any>;
  } catch {
    return;
  }

  const topCode: string | undefined = body?.Orders?.Messages?.Code;
  if (topCode && topCode !== "SUCCESS" && topCode !== "CANCELLED") {
    const desc: string = body?.Orders?.Messages?.Description ?? "Unknown error";
    throw new Error(`APC cancel failed: ${desc}`);
  }
}

export { isConfigured, getDefaultServiceCodes, APC_TRAINING_BASE, fetchLabel };
