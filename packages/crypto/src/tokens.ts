import { randomBytes } from "node:crypto";

/**
 * Generate a strong random secret suitable for BETTER_AUTH_SECRET, ENCRYPTION_KEY,
 * etc. Base64url-encoded 48 bytes ~= 64 char string.
 */
export function generateSecret(bytes = 48): string {
  return randomBytes(bytes).toString("base64url");
}
