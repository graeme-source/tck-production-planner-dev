const APC_API_BASE = process.env.APC_API_BASE ?? "https://apc.co.uk/api/2.0";
const APC_ACCOUNT_NUMBER = process.env.APC_ACCOUNT_NUMBER ?? "";
const APC_USERNAME = process.env.APC_USERNAME ?? "";
const APC_PASSWORD = process.env.APC_PASSWORD ?? "";

interface ApcToken {
  token: string;
  expiresAt: number;
}

let cachedApcToken: ApcToken | null = null;

async function getApcToken(): Promise<string> {
  const now = Date.now();
  if (cachedApcToken && now < cachedApcToken.expiresAt - 60_000) {
    return cachedApcToken.token;
  }

  if (!APC_USERNAME || !APC_PASSWORD || !APC_ACCOUNT_NUMBER) {
    throw new Error("APC credentials not configured. Set APC_USERNAME, APC_PASSWORD and APC_ACCOUNT_NUMBER environment variables.");
  }

  const res = await fetch(`${APC_API_BASE}/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: APC_USERNAME,
      password: APC_PASSWORD,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`APC authentication failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { token: string; expires_in?: number };
  cachedApcToken = {
    token: data.token,
    expiresAt: now + (data.expires_in ?? 3600) * 1000,
  };
  return cachedApcToken.token;
}

function isConfigured(): boolean {
  return !!(APC_USERNAME && APC_PASSWORD && APC_ACCOUNT_NUMBER);
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
}

export interface ApcShipmentResult {
  consignmentNumber: string;
  labelPdfBase64: string;
  trackingUrl?: string;
}

export async function createShipment(req: ApcShipmentRequest): Promise<ApcShipmentResult> {
  const token = await getApcToken();

  const payload = {
    account_number: APC_ACCOUNT_NUMBER,
    service_code: req.serviceCode,
    reference: req.reference ?? "",
    special_instructions: req.specialInstructions ?? "",
    recipient: {
      name: req.recipient.name,
      address_line1: req.recipient.address1,
      address_line2: req.recipient.address2 ?? "",
      town: req.recipient.city,
      postcode: req.recipient.postcode,
      country_code: req.recipient.country ?? "GB",
      telephone: req.recipient.phone ?? "",
      email: req.recipient.email ?? "",
    },
    parcels: req.parcels.map(p => ({
      weight: p.weight,
      length: p.length ?? 0,
      width: p.width ?? 0,
      height: p.height ?? 0,
    })),
    label_format: "PDF",
  };

  const res = await fetch(`${APC_API_BASE}/shipments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    let errMsg = `APC shipment creation failed (${res.status})`;
    try {
      const json = JSON.parse(text);
      errMsg = json.message ?? json.error ?? text;
      if (res.status === 422 && json.errors) {
        const fieldErrors = Object.entries(json.errors as Record<string, string[]>)
          .map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`)
          .join("; ");
        errMsg = fieldErrors || errMsg;
      }
    } catch {
      errMsg = text || errMsg;
    }
    if (res.status === 401) {
      cachedApcToken = null;
    }
    throw new Error(errMsg);
  }

  const data = (await res.json()) as {
    consignment_number?: string;
    tracking_number?: string;
    label?: string;
    label_pdf?: string;
    tracking_url?: string;
  };

  const consignmentNumber = data.consignment_number ?? data.tracking_number ?? "";
  const labelPdfBase64 = data.label ?? data.label_pdf ?? "";

  if (!consignmentNumber) {
    throw new Error("APC returned no consignment number");
  }
  if (!labelPdfBase64) {
    throw new Error("APC returned no label PDF");
  }

  return {
    consignmentNumber,
    labelPdfBase64,
    trackingUrl: data.tracking_url,
  };
}

export interface ApcServiceCodes {
  smallWeekday: string;
  largeWeekday: string;
  smallFriday: string;
  largeFriday: string;
  weightThresholdGrams: number;
}

// Reads current APC service codes from env/config. Callers that need the live
// DB-backed codes should call the fulfilment route instead; this is a
// lightweight helper for code that only needs env-level defaults.
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
