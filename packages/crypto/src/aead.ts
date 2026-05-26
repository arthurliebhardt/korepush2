import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const VERSION = 1;

function deriveKey(secret: string): Buffer {
  if (!secret || secret.length < 32) {
    throw new Error(
      "ENCRYPTION_KEY must be at least 32 chars. Generate one with: openssl rand -base64 48",
    );
  }
  return scryptSync(secret, "korepush:aead:v1", KEY_LEN);
}

/**
 * Encrypt arbitrary string data with AES-256-GCM.
 * Output format: v1.<iv-hex>.<tag-hex>.<ciphertext-hex>
 */
export function encrypt(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    `v${VERSION}`,
    iv.toString("hex"),
    tag.toString("hex"),
    enc.toString("hex"),
  ].join(".");
}

export function decrypt(ciphertext: string, secret: string): string {
  const parts = ciphertext.split(".");
  if (parts.length !== 4) {
    throw new Error("Malformed ciphertext");
  }
  const [version, ivHex, tagHex, dataHex] = parts as [string, string, string, string];
  if (version !== `v${VERSION}`) {
    throw new Error(`Unsupported ciphertext version: ${version}`);
  }

  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const data = Buffer.from(dataHex, "hex");

  if (iv.length !== IV_LEN) throw new Error("Invalid IV length");
  if (tag.length !== TAG_LEN) throw new Error("Invalid auth tag length");

  const key = deriveKey(secret);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString("utf8");
}

export function isEncrypted(value: string): boolean {
  return /^v\d+\.[0-9a-f]+\.[0-9a-f]+\.[0-9a-f]+$/.test(value);
}
