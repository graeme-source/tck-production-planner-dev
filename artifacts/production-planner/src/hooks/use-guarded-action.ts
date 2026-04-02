import { useState, useCallback, useRef } from "react";
import { useToast } from "./use-toast";
import { withRetry, ClientError } from "../lib/with-retry";

/**
 * Hook that wraps an async action with:
 * - Double-tap prevention (busy guard)
 * - Automatic retry on network/5xx errors (2 retries, 1s/2s backoff)
 * - Fetch timeout (10s default)
 * - Toast notification on failure
 * - Optional success callback
 *
 * Usage:
 *   const [run, busy] = useGuardedAction();
 *   <button disabled={busy} onClick={() => run(async () => { await fetch(...) })} />
 */
export function useGuardedAction(options?: {
  timeoutMs?: number;
  retries?: number;
  silentOn409?: boolean;
  onSuccess?: () => void;
  onError?: (err: unknown) => void;
}) {
  const { timeoutMs = 10_000, retries = 2, silentOn409 = false, onSuccess, onError } = options ?? {};
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // Ref to prevent stale closure issues
  const { toast } = useToast();

  const run = useCallback(
    async <T>(action: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
      if (busyRef.current) return undefined;
      busyRef.current = true;
      setBusy(true);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const result = await withRetry(
          () => action(controller.signal),
          retries,
        );
        onSuccess?.();
        return result;
      } catch (err) {
        if (err instanceof ClientError && err.status === 409 && silentOn409) {
          // Expected 409 (e.g., target already met) — don't show error toast
          return undefined;
        }

        const message =
          err instanceof Error
            ? controller.signal.aborted
              ? "Request timed out. Check your connection and try again."
              : err.message
            : "Something went wrong. Please try again.";

        toast({ title: "Action failed", description: message, variant: "destructive" });
        onError?.(err);
        return undefined;
      } finally {
        clearTimeout(timeout);
        busyRef.current = false;
        setBusy(false);
      }
    },
    [timeoutMs, retries, silentOn409, onSuccess, onError, toast],
  );

  return [run, busy] as const;
}

/**
 * Helper to make a guarded fetch that throws ClientError on 4xx and Error on 5xx.
 * Compatible with withRetry (retries only 5xx/network errors).
 */
export async function guardedFetch(
  url: string,
  init?: RequestInit & { signal?: AbortSignal },
): Promise<Response> {
  const res = await fetch(url, { credentials: "include", ...init });
  if (!res.ok) {
    if (res.status >= 400 && res.status < 500) {
      throw new ClientError(res.status, `${res.status} ${res.statusText}`);
    }
    throw new Error(`Server error ${res.status}`);
  }
  return res;
}
