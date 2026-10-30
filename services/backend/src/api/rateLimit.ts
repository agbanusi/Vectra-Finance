/** In-memory token bucket per key. Per-process only; put a shared limiter at the edge for multi-replica APIs. */
export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const MS_PER_MINUTE = 60_000;
const MAX_TRACKED_KEYS = 50_000;

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly refillPerMs: number;

  constructor(
    private readonly capacity: number,
    perMinute: number,
  ) {
    this.refillPerMs = perMinute / MS_PER_MINUTE;
  }

  take(key: string, now: number): RateLimitDecision {
    const bucket = this.refill(key, now);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const waitMs = (1 - bucket.tokens) / this.refillPerMs;
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
  }

  private refill(key: string, now: number): Bucket {
    const existing = this.buckets.get(key);
    if (!existing) {
      if (this.buckets.size >= MAX_TRACKED_KEYS) this.evictFull(now);
      const fresh = { tokens: this.capacity, updatedAt: now };
      this.buckets.set(key, fresh);
      return fresh;
    }
    const elapsed = Math.max(0, now - existing.updatedAt);
    existing.tokens = Math.min(this.capacity, existing.tokens + elapsed * this.refillPerMs);
    existing.updatedAt = now;
    return existing;
  }

  /** Drops buckets that have fully refilled; they carry no state worth keeping. */
  private evictFull(now: number): void {
    for (const [key, b] of this.buckets) {
      if (b.tokens + (now - b.updatedAt) * this.refillPerMs >= this.capacity) this.buckets.delete(key);
    }
  }
}
