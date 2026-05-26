import { posix } from "node:path";

export class PathValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathValidationError";
  }
}

function assertSafe(value: string, label: string): void {
  if (value.length === 0) {
    throw new PathValidationError(`${label} cannot be empty`);
  }
  if (value.startsWith("/")) {
    throw new PathValidationError(`${label} must be relative, not absolute: "${value}"`);
  }
  if (value.includes("\\")) {
    throw new PathValidationError(`${label} must use forward slashes: "${value}"`);
  }
  if (value.includes("\0")) {
    throw new PathValidationError(`${label} contains an illegal NUL byte`);
  }

  const segments = value.split("/");
  for (const seg of segments) {
    if (seg === "..") {
      throw new PathValidationError(`${label} cannot contain ".." segments: "${value}"`);
    }
  }

  const normalized = posix.normalize(value);
  if (normalized.startsWith("..") || normalized.startsWith("/")) {
    throw new PathValidationError(`${label} resolves outside repo root: "${value}"`);
  }
}

export function validateDockerfilePath(value: string): string {
  assertSafe(value, "Dockerfile path");
  return posix.normalize(value);
}

export function validateBuildContext(value: string): string {
  assertSafe(value, "Build context");
  return posix.normalize(value);
}

export function isSafeRelativePath(value: string): boolean {
  try {
    assertSafe(value, "path");
    return true;
  } catch {
    return false;
  }
}
