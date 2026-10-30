import { createHash, timingSafeEqual } from "node:crypto";

const BEARER_PREFIX = "Bearer ";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time bearer check (hashing first equalises lengths so timing leaks nothing). */
export function isAuthorized(header: string | undefined, expectedToken: string | undefined): boolean {
  if (!expectedToken || !header?.startsWith(BEARER_PREFIX)) return false;
  return timingSafeEqual(digest(header.slice(BEARER_PREFIX.length)), digest(expectedToken));
}
