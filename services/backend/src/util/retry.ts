/** Exponential backoff with full jitter. All side effects (sleep, randomness) are injectable. */

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface RetryDeps {
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

export const defaultRetryDeps: RetryDeps = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

export class RetryExhaustedError extends Error {
  constructor(
    readonly attempts: number,
    readonly lastError: unknown,
  ) {
    super(`gave up after ${attempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    this.name = "RetryExhaustedError";
  }
}

/** Errors marked non-retryable abort immediately (e.g. an on-chain revert after inclusion). */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}

export function backoffDelay(attempt: number, policy: RetryPolicy, random: () => number): number {
  const exp = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  return Math.floor(exp * random());
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  deps: RetryDeps = defaultRetryDeps,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (err instanceof NonRetryableError) throw err;
      lastError = err;
      if (attempt < policy.maxAttempts) await deps.sleep(backoffDelay(attempt, policy, deps.random));
    }
  }
  throw new RetryExhaustedError(policy.maxAttempts, lastError);
}
