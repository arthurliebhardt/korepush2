import { randomBytes } from "node:crypto";

/**
 * Short-prefixed unique IDs. Not a strict standard (KSUID/ULID would be nicer),
 * but timestamp-prefixed for cheap chronological ordering when debugging.
 */
export function newId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = randomBytes(9).toString("base64url");
  return `${prefix}_${ts}${rand}`;
}
