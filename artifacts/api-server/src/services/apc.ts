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
}

export interface ApcShipmentResult {
  consignmentNumber: string;
  labelPdfBase64: string;
  trackingUrl?: string;
  warnings?: string[];
}

interface PlaceOrderResult {
  waybill: string;
  warnings: string[];
}

interface NormalisedAddress {
  address1: string;
  address2?: string;
  city: string;
  warnings: string[];
}

function normaliseAddress(
  address1: string,
  address2: string | undefined,
  city: string,
): NormalisedAddress {
  const MAX = 35;
  const warnings: string[] = [];
  const originalA1 = (address1 ?? "").replace(/\s+/g, " ").trim();
  let a1 = originalA1;
  let a2 = (address2 ?? "").replace(/\s+/g, " ").trim();
  const rawCity = (city ?? "").replace(/\s+/g, " ").trim();

  let c = rawCity;
  if (c.length > MAX) {
    c = c.slice(0, MAX);
    warnings.push(`City truncated from "${rawCity}" to "${c}"`);
  }

  if (c && a1.toLowerCase().endsWith(c.toLowerCase())) {
    const stripped = a1.slice(0, a1.length - c.length).replace(/[,\s]+$/, "").trim();
    if (stripped) a1 = stripped;
  }
  if (c && a2.toLowerCase().endsWith(c.toLowerCase())) {
    a2 = a2.slice(0, a2.length - c.length).replace(/[,\s]+$/, "").trim();
  }

  if (a1.length > MAX) {
    const cutPoint = a1.lastIndexOf(" ", MAX);
    const overflow = cutPoint > 0
      ? a1.slice(cutPoint + 1).trim()
      : a1.slice(MAX).trim();
    a1 = cutPoint > 0
      ? a1.slice(0, cutPoint).trim()
      : a1.slice(0, MAX).trim();

    if (overflow) {
      a2 = a2 ? `${overflow}, ${a2}` : overflow;
    }
  }

  if (!a1) {
    a1 = originalA1.slice(0, MAX);
    if (originalA1.length > MAX) {
      warnings.push(`Address line 1 truncated from "${originalA1}" to "${a1}"`);
    }
  }

  if (a1.length > MAX) {
    const full = a1;
    a1 = a1.slice(0, MAX);
    warnings.push(`Address line 1 truncated from "${full}" to "${a1}"`);
  }

  if (a2 && a2.length > MAX) {
    const full = a2;
    a2 = a2.slice(0, MAX);
    warnings.push(`Address line 2 truncated from "${full}" to "${a2}"`);
  }

  return {
    address1: a1,
    ...(a2 ? { address2: a2 } : {}),
    city: c,
    warnings,
  };
}

async function placeOrder(req: ApcShipmentRequest): Promise<PlaceOrderResult> {
  if (!APC_USERNAME || !APC_PASSWORD || !APC_ACCOUNT_NUMBER) {
    throw new Error("APC credentials not configured.");
  }

  const apiBase = req.apiBase ?? APC_API_BASE;
  const totalWeightKg = req.parcels.reduce((sum, p) => sum + p.weight, 0);
  const firstParcel = req.parcels[0] ?? { weight: totalWeightKg };

  const addr = normaliseAddress(
    req.recipient.address1,
    req.recipient.address2,
    req.recipient.city,
  );

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
        Reference: (req.reference ?? "").replace(/[^a-zA-Z0-9\-\.]/g, "-").slice(0, 25),
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
          ...(req.specialInstructions ? { Instructions: req.specialInstructions.slice(0, 50) } : {}),
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
    const desc = json?.Orders?.Order?.Messages?.Description ?? json?.Orders?.Messages?.Description ?? "Unknown error";
    throw new Error(`APC order failed: ${desc}`);
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

async function fetchLabel(waybill: string, apiBase: string, retries = 4, delayMs = 3000): Promise<string[]> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    const url = `${apiBase}/Orders/${waybill}.json?searchtype=CarrierWaybill&labelformat=PDF&labels=True&markprinted=True`;

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

  const labels = await fetchLabel(waybill, apiBase);

  const trackingUrl = `https://apc.hypaship.com/tracking?waybill=${waybill}`;

  return {
    consignmentNumber: waybill,
    labelPdfBase64: labels[0],
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
 * postcode by calling the official ServiceAvailability endpoint.
 *
 * Per the APC API Integration Guide v3.1.2 (section 3), the correct
 * method is:
 *   POST /api/3.0/ServiceAvailability.json
 * with a JSON body containing collection/delivery postcodes, date,
 * weight, and shipment details. APC returns a list of available
 * services; we check if our target service code is in that list.
 *
 * The previous implementation called a non-existent
 * GET /PostcodeServiceCheck endpoint which returned HTML error pages.
 */
const COLLECTION_POSTCODE = "MK17 9FX"; // TCK factory

// Short-lived cache: postcode → list of available ProductCodes.
// Cleared after 5 minutes so the same batch of 80+ orders with
// overlapping postcodes doesn't hammer the APC API.
const availabilityCache = new Map<string, { codes: string[]; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function checkPostcodeService(
  postcode: string,
  serviceCode: string,
  apiBase?: string,
): Promise<PostcodeCheckResult> {
  if (!isConfigured()) {
    throw new Error("APC credentials not configured.");
  }

  const base = apiBase ?? APC_API_BASE;
  const url = `${base}/ServiceAvailability.json`;

  // APC requires postcodes WITH a space (e.g. "MK17 9FX" not "MK179FX")
  const cleanPostcode = postcode.replace(/\s+/g, "").toUpperCase();
  const formattedPostcode = cleanPostcode.length > 3
    ? `${cleanPostcode.slice(0, -3)} ${cleanPostcode.slice(-3)}`
    : cleanPostcode;

  // Use tomorrow as collection date (parcels are being dispatched, not
  // collected today in most cases). APC rejects past dates.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const collectionDate = `${String(tomorrow.getDate()).padStart(2, "0")}/${String(tomorrow.getMonth() + 1).padStart(2, "0")}/${tomorrow.getFullYear()}`;

  const payload = {
    Orders: {
      Order: {
        CollectionDate: collectionDate,
        ReadyAt: "09:00",
        ClosedAt: "17:00",
        Collection: {
          PostalCode: COLLECTION_POSTCODE,
          CountryCode: "GB",
        },
        Delivery: {
          PostalCode: formattedPostcode,
          CountryCode: "GB",
        },
        GoodsInfo: {
          GoodsValue: "1",
          Fragile: "False",
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

  // Check the cache first — avoids redundant APC calls when validating
  // 80+ orders with overlapping postcodes.
  const cacheKey = `${formattedPostcode}|${base}`;
  const cached = availabilityCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    const codeUpper = serviceCode.toUpperCase();
    const hit = cached.codes.some(pc => {
      const u = pc.toUpperCase();
      return u === codeUpper || u === `APC${codeUpper}` || (u.startsWith("APC") && u.slice(3) === codeUpper);
    });
    if (hit) return { available: true };
    const shortCodes = cached.codes.map(c => c.toUpperCase().startsWith("APC") ? c.slice(3) : c).join(", ");
    return { available: false, reason: `Service ${serviceCode} not available to ${formattedPostcode}. Available: ${shortCodes || "none"}` };
  }

  console.log(`[APC ServiceAvailability] POST ${url} — checking ${formattedPostcode} for service ${serviceCode}`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "remote-user": basicAuthHeader(base),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const rawText = await res.text();

  if (!res.ok) {
    console.error(`[APC ServiceAvailability] HTTP ${res.status}:`, rawText.slice(0, 500));
    let detail = `(HTTP ${res.status})`;
    try {
      const errJson = JSON.parse(rawText);
      const desc = errJson?.ServiceAvailability?.Messages?.Description
        ?? errJson?.Messages?.Description;
      if (desc) detail = desc;
    } catch { /* fall through */ }
    throw new Error(`APC service availability check failed ${detail}`);
  }

  let json: any;
  try {
    json = JSON.parse(rawText);
  } catch {
    console.error(`[APC ServiceAvailability] non-JSON response (HTTP ${res.status}):`, rawText.slice(0, 500));
    throw new Error(`APC returned invalid JSON (HTTP ${res.status}) — first 200 chars: ${rawText.slice(0, 200)}`);
  }

  // Check the top-level messages for errors
  const msgCode = json?.ServiceAvailability?.Messages?.Code;
  const msgDesc = json?.ServiceAvailability?.Messages?.Description;

  if (msgCode && msgCode !== "SUCCESS") {
    console.warn(`[APC ServiceAvailability] ${formattedPostcode}: ${msgCode} — ${msgDesc}`);
    return {
      available: false,
      reason: msgDesc ?? `APC error: ${msgCode}`,
    };
  }

  // Parse the list of available services and check if our target code
  // is among them. APC returns Services.Service as either an array or
  // a single object.
  const services = json?.ServiceAvailability?.Services?.Service;
  if (!services) {
    console.warn(`[APC ServiceAvailability] ${formattedPostcode}: no services returned`, JSON.stringify(json).slice(0, 300));
    return {
      available: false,
      reason: `No APC services available to ${formattedPostcode}`,
    };
  }

  const serviceList = Array.isArray(services) ? services : [services];

  // Cache the available codes for this postcode
  const allCodes = serviceList.map((s: { ProductCode?: string }) => s.ProductCode ?? "").filter(Boolean);
  availabilityCache.set(cacheKey, { codes: allCodes, ts: Date.now() });

  const codeUpper = serviceCode.toUpperCase();

  // APC returns ProductCodes with an "APC" prefix (e.g. "APCLW16" for
  // our configured "LW16"). Match both exact and prefix-stripped forms
  // so the validation works regardless of how the admin entered the
  // code in Settings.
  const matchingService = serviceList.find((s: { ProductCode?: string }) => {
    const pc = s.ProductCode?.toUpperCase() ?? "";
    return pc === codeUpper                                // exact: "WL16" === "WL16"
      || pc === `APC${codeUpper}`                          // prefixed: "APCWL16" === "APC" + "WL16"
      || (pc.startsWith("APC") && pc.slice(3) === codeUpper); // strip prefix: "APCLW16".slice(3) === "LW16"
  });

  if (matchingService) {
    console.log(`[APC ServiceAvailability] ${formattedPostcode} ✓ ${serviceCode} available (matched ${matchingService.ProductCode})`);
    return { available: true };
  }

  // Show short codes (strip APC prefix) in the error message so they
  // match what the admin sees in Settings.
  const availableCodes = serviceList
    .map((s: { ProductCode?: string }) => {
      const pc = s.ProductCode ?? "";
      return pc.toUpperCase().startsWith("APC") ? pc.slice(3) : pc;
    })
    .filter(Boolean)
    .join(", ");
  console.log(`[APC ServiceAvailability] ${formattedPostcode} ✗ ${serviceCode} NOT in [${availableCodes}]`);
  return {
    available: false,
    reason: `Service ${serviceCode} not available to ${formattedPostcode}. Available: ${availableCodes || "none"}`,
  };
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
