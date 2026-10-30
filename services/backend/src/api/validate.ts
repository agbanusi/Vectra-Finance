import { getAddress, isAddress, type Address } from "viem";
import { RequestStatus } from "@vectra/sdk";
import { RISK_TIERS, type IndexMetadata, type RiskTier } from "../db/metadata.js";
import { badRequest } from "./errors.js";

export function parseAddress(value: string | undefined, name: string): Address {
  if (value === undefined || !isAddress(value, { strict: false })) throw badRequest(`${name} must be a 20-byte hex address`);
  return getAddress(value);
}

export function parseIntParam(
  value: string | undefined,
  name: string,
  opts: { min: number; max: number; fallback: number },
): number {
  if (value === undefined || value === "") return opts.fallback;
  if (!/^\d+$/.test(value)) throw badRequest(`${name} must be a non-negative integer`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < opts.min || n > opts.max) {
    throw badRequest(`${name} must be between ${opts.min} and ${opts.max}`);
  }
  return n;
}

const STATUS_FILTERS: Record<string, readonly RequestStatus[] | undefined> = {
  all: undefined,
  open: [RequestStatus.Pending, RequestStatus.PartiallyFilled],
  pending: [RequestStatus.Pending],
  partially_filled: [RequestStatus.PartiallyFilled],
  fulfilled: [RequestStatus.Fulfilled],
  cancelled: [RequestStatus.Cancelled],
  expired: [RequestStatus.Expired],
};

export function parseStatusFilter(value: string | undefined): readonly RequestStatus[] | undefined {
  const key = value ?? "all";
  if (!(key in STATUS_FILTERS)) {
    throw badRequest(`status must be one of ${Object.keys(STATUS_FILTERS).join(", ")}`);
  }
  return STATUS_FILTERS[key];
}

export const METADATA_LIMITS = { description: 2_000, category: 64, tag: 32, tags: 12 } as const;

function optionalString(body: Record<string, unknown>, key: string, max: number): string | null {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > max) throw badRequest(`${key} must be a string of at most ${max} chars`);
  return value.trim();
}

function riskTier(body: Record<string, unknown>): RiskTier | null {
  const value = body.riskTier;
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !RISK_TIERS.includes(value as RiskTier)) {
    throw badRequest(`riskTier must be one of ${RISK_TIERS.join(", ")}`);
  }
  return value as RiskTier;
}

function tags(body: Record<string, unknown>): string[] {
  const value = body.tags;
  if (value === undefined || value === null) return [];
  const valid =
    Array.isArray(value) &&
    value.length <= METADATA_LIMITS.tags &&
    value.every((t) => typeof t === "string" && t.length > 0 && t.length <= METADATA_LIMITS.tag);
  if (!valid) throw badRequest(`tags must be up to ${METADATA_LIMITS.tags} non-empty strings of at most ${METADATA_LIMITS.tag} chars`);
  return [...new Set(value as string[])];
}

const METADATA_KEYS = new Set(["description", "category", "riskTier", "tags"]);

export function parseMetadataBody(raw: unknown): Omit<IndexMetadata, "updatedAt"> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw badRequest("body must be a JSON object");
  const body = raw as Record<string, unknown>;
  const unknown = Object.keys(body).filter((k) => !METADATA_KEYS.has(k));
  if (unknown.length > 0) throw badRequest("unknown fields", { fields: unknown });
  return {
    description: optionalString(body, "description", METADATA_LIMITS.description),
    category: optionalString(body, "category", METADATA_LIMITS.category),
    riskTier: riskTier(body),
    tags: tags(body),
  };
}
