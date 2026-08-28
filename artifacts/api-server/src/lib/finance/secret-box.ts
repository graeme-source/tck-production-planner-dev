import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

// App-layer encryption for the finance mailbox password (AES-256-GCM).
// Railway's daily volume backups copy the database, so credentials are never
// stored plaintext — a leaked backup is inert without the key.
//
// Key source: FINANCE_ENC_KEY env var if set; otherwise derived from the
// (mandatory) SESSION_SECRET so no new Railway variable is required for the
// MVP. If SESSION_SECRET is ever rotated, the stored password must simply be
// re-entered on the finance settings page — surfaced as a clear error, not a
// crash.

const VERSION = "v1";

function key(): Buffer {
  const raw = process.env["FINANCE_ENC_KEY"] || process.env["SESSION_SECRET"];
  if (!raw) throw new Error("No FINANCE_ENC_KEY or SESSION_SECRET set");
  return scryptSync(raw, "tck-finance-mailbox", 32);
}

export function sealSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export class SecretUnreadableError extends Error {}

export function openSecret(sealed: string): string {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new SecretUnreadableError("Stored credential has an unknown format");
  }
  try {
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const enc = Buffer.from(parts[3], "base64");
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretUnreadableError(
      "Stored credential cannot be decrypted (encryption key changed?) — re-enter the mailbox password in finance settings"
    );
  }
}
