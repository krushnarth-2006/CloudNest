import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// AES-256-GCM encryption for provider OAuth tokens at rest.
// TOKEN_ENCRYPTION_KEY can be any secret string; we derive a 32-byte key from it
// with SHA-256 so operators don't have to hand-generate raw key bytes.
function deriveKey(): Buffer {
  const secret = process.env.TOKEN_ENCRYPTION_KEY ?? process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY (or JWT_SECRET as a fallback) must be set to encrypt provider tokens.",
    );
  }
  return createHash("sha256").update(secret).digest();
}

const IV_LENGTH = 12; // recommended for GCM

/** Encrypts a plaintext string. Returns null when given null/undefined so callers can pass through optional tokens. */
export function encryptSecret(plaintext: string | null | undefined): string | undefined {
  if (!plaintext) return undefined;
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: iv.authTag.ciphertext, all base64url
  return [iv, authTag, encrypted].map((buf) => buf.toString("base64url")).join(".");
}

/** Decrypts a value produced by encryptSecret. Returns undefined on missing/malformed input rather than throwing,
 * so a corrupt or legacy plaintext token degrades to "not connected" instead of crashing a request. */
export function decryptSecret(payload: string | null | undefined): string | undefined {
  if (!payload) return undefined;
  const parts = payload.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const [ivB64, tagB64, dataB64] = parts;
    const key = deriveKey();
    const iv = Buffer.from(ivB64, "base64url");
    const authTag = Buffer.from(tagB64, "base64url");
    const data = Buffer.from(dataB64, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return undefined;
  }
}
