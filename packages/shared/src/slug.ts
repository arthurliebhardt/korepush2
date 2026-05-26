const SLUG_RE = /^[a-z][a-z0-9-]{0,61}[a-z0-9]$|^[a-z]$/;

export function isValidSlug(value: string): boolean {
  return SLUG_RE.test(value);
}

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40);

  if (!base) return "app";
  if (!/^[a-z]/.test(base)) return `a-${base}`.slice(0, 41);
  return base;
}

export function assertValidSlug(value: string): void {
  if (!isValidSlug(value)) {
    throw new Error(
      `Invalid slug "${value}". Must match DNS label rules: lowercase letters, digits, hyphens; starts with letter.`,
    );
  }
}

const ENV_VAR_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;

export function isValidEnvVarKey(value: string): boolean {
  return ENV_VAR_KEY_RE.test(value);
}

const HOSTNAME_RE =
  /^(?=.{1,253}$)(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)\.)+[a-zA-Z]{2,63}$/;

export function isValidHostname(value: string): boolean {
  return HOSTNAME_RE.test(value);
}
