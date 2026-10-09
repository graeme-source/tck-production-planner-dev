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
 * What a 4xx toast should say: the server's own reason when it sent one as
 * JSON { error } (e.g. "There are no extra packs to take off."), otherwise
 * "400 Bad Request". Before this, every guardedFetch failure toasted only the
 * status line, so a refusal never said why (oven Extra Packs, 9 Oct 2026).
 */
export function clientErrorMessage(status: number, statusText: string, bodyText: string | null | undefined): string {
  const fallback = `${status} ${statusText}`.trim();
  if (!bodyText) return fallback;
  try {
    const body = JSON.parse(bodyText) as unknown;
    const error = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
    return typeof error === "string" && error.trim() ? error.trim() : fallback;
  } catch {
    return fallback;
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
