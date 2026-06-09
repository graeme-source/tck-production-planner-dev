import QRCode from "qrcode";
import { objectStorageClient } from "./objectStorage";

const BUCKET_PATH = process.env.PRIVATE_OBJECT_DIR || "";

function getBucketAndPrefix(): { bucketName: string; prefix: string } {
  let path = BUCKET_PATH;
  if (!path) {
    throw new Error("PRIVATE_OBJECT_DIR not set");
  }
  if (!path.startsWith("/")) path = `/${path}`;
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 1) throw new Error("Invalid PRIVATE_OBJECT_DIR");
  return {
    bucketName: parts[0],
    prefix: parts.slice(1).join("/"),
  };
}

export type QrSourceType = "ingredient" | "recipe" | "sub_recipe";

const QR_OPTIONS = {
  type: "png" as const,
  width: 300,
  margin: 2,
  errorCorrectionLevel: "M" as const,
};

// Generate the QR PNG directly in-memory. The payload is a tiny deterministic
// {type,id} blob, so there's no benefit to persisting it — we regenerate on
// demand. This has no external dependency (unlike generateQrCode, which needs
// Replit object storage and so only works on Replit, not Railway).
export async function generateQrPngBuffer(
  sourceType: QrSourceType,
  id: number,
): Promise<Buffer> {
  const payload = JSON.stringify({ type: sourceType, id });
  return QRCode.toBuffer(payload, QR_OPTIONS);
}

export async function generateQrCode(
  sourceType: "ingredient" | "recipe" | "sub_recipe",
  id: number,
): Promise<string> {
  const payload = JSON.stringify({ type: sourceType, id });
  const pngBuffer = await QRCode.toBuffer(payload, {
    type: "png",
    width: 300,
    margin: 2,
    errorCorrectionLevel: "M",
  });

  const { bucketName, prefix } = getBucketAndPrefix();
  const objectName = `${prefix ? prefix + "/" : ""}qr-codes/${sourceType}-${id}.png`;

  const bucket = objectStorageClient.bucket(bucketName);
  const file = bucket.file(objectName);

  await file.save(pngBuffer, {
    contentType: "image/png",
    resumable: false,
  });

  return `/${bucketName}/${objectName}`;
}

export async function getQrCodeBuffer(storedPath: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    let path = storedPath;
    if (!path.startsWith("/")) path = `/${path}`;
    const parts = path.split("/").filter(Boolean);
    if (parts.length < 2) return null;

    const bucketName = parts[0];
    const objectName = parts.slice(1).join("/");

    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);

    const [exists] = await file.exists();
    if (!exists) return null;

    const [contents] = await file.download();
    return { buffer: contents, contentType: "image/png" };
  } catch {
    return null;
  }
}
