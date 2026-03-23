// Hypaship APC API v3 integration.
// Auth: Basic auth via `remote-user` header — base64(email:password).
// No token refresh needed — credentials are sent on every request.

const APC_API_BASE = process.env.APC_API_BASE ?? "https://apc.hypaship.com/api/3.0";
const APC_ACCOUNT_NUMBER = process.env.APC_ACCOUNT_NUMBER ?? "";
const APC_USERNAME = process.env.APC_USERNAME ?? "";
const APC_PASSWORD = process.env.APC_PASSWORD ?? "";

function isConfigured(): boolean {
  return !!(APC_USERNAME && APC_PASSWORD && APC_ACCOUNT_NUMBER);
}

function basicAuthHeader(): string {
  const encoded = Buffer.from(`${APC_USERNAME}:${APC_PASSWORD}`).toString("base64");
  return `Basic ${encoded}`;
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
}

export interface ApcShipmentResult {
  consignmentNumber: string;
  labelPdfBase64: string;
  trackingUrl?: string;
}

async function placeOrder(req: ApcShipmentRequest): Promise<string> {
  if (!APC_USERNAME || !APC_PASSWORD || !APC_ACCOUNT_NUMBER) {
    throw new Error("APC credentials not configured.");
  }

  const totalWeightKg = req.parcels.reduce((sum, p) => sum + p.weight, 0);
  const firstParcel = req.parcels[0] ?? { weight: totalWeightKg };

  const payload = {
    Orders: {
      Order: {
        CollectionDate: todayDDMMYYYY(req.collectionDate),
        ReadyAt: "09:00",
        ClosedAt: "17:00",
        ProductCode: req.serviceCode,
        Reference: (req.reference ?? "").replace(/[^a-zA-Z0-9\-\.]/g, "-").slice(0, 25),
        // Omitting Collection forces Hypaship to use TCK's operational address
        Delivery: {
          CompanyName: req.recipient.name.slice(0, 35),
          AddressLine1: req.recipient.address1.slice(0, 35),
          ...(req.recipient.address2 ? { AddressLine2: req.recipient.address2.slice(0, 35) } : {}),
          PostalCode: req.recipient.postcode,
          City: req.recipient.city.slice(0, 35),
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

  const res = await fetch(`${APC_API_BASE}/Orders.json`, {
    method: "POST",
    headers: {
      "remote-user": basicAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();

  if (!res.ok) {
    let errMsg = `APC order creation failed (${res.status})`;
    try {
      const json = JSON.parse(text);
      const desc = json?.Orders?.Messages?.Description ?? json?.Orders?.Order?.Messages?.Description;
      if (desc && desc !== "SUCCESS") errMsg = desc;
    } catch {
      errMsg = text || errMsg;
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

  return waybill;
}

async function fetchLabel(waybill: string, retries = 4, delayMs = 3000): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    const url = `${APC_API_BASE}/Orders/${waybill}.json?searchtype=CarrierWaybill&labelformat=PDF&labels=True&markprinted=True`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "remote-user": basicAuthHeader(),
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

    // Label content is nested under Order.ShipmentDetails.Items.Item.Label.Content
    const item = json?.Orders?.Order?.ShipmentDetails?.Items?.Item;
    const content = item?.Label?.Content ?? (Array.isArray(item) ? item[0]?.Label?.Content : undefined);

    if (content) return content as string;

    // Label not ready yet — retry
    if (attempt < retries) continue;
  }

  throw new Error("APC label was not available after multiple retries");
}

export async function createShipment(req: ApcShipmentRequest): Promise<ApcShipmentResult> {
  if (!isConfigured()) {
    throw new Error("APC credentials not configured. Set APC_USERNAME, APC_PASSWORD and APC_ACCOUNT_NUMBER environment variables.");
  }

  // Step 1: Place the order and get WayBill
  const waybill = await placeOrder(req);

  // Step 2: Wait briefly then retrieve the label (guide recommends 3-5 seconds)
  const labelPdfBase64 = await fetchLabel(waybill);

  const trackingUrl = `https://apc.hypaship.com/tracking?waybill=${waybill}`;

  return {
    consignmentNumber: waybill,
    labelPdfBase64,
    trackingUrl,
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

export { isConfigured, getDefaultServiceCodes };
