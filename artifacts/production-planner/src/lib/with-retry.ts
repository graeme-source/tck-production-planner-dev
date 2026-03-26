/**
 * Error subclass thrown when the server returns a 4xx status.
 * withRetry treats these as non-retryable and re-throws immediately.
 */
export class ClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ClientError";
  }
}

/**
 * Retry up to `maxRetries` times, but ONLY on network failures or 5xx errors.
 * 4xx responses should be thrown as ClientError — those are never retried.
 *
 * Usage in callers:
 *   if (!res.ok) {
 *     if (res.status >= 400 && res.status < 500) throw new ClientError(res.status, ...);
 *     throw new Error(`Server error ${res.status}`);
 *   }
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  backoffs: number[] = [1000, 2000]
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      // Never retry 4xx client errors
      if (err instanceof ClientError) throw err;
      if (attempt >= maxRetries) throw err;
      await new Promise(r => setTimeout(r, backoffs[attempt] ?? 1000));
    }
  }
  throw new Error("withRetry: exhausted");
}
