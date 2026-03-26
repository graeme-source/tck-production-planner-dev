export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  backoffs: number[] = [1000, 2000]
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxRetries) throw err;
      await new Promise(r => setTimeout(r, backoffs[attempt] ?? 1000));
    }
  }
  throw new Error("withRetry: exhausted");
}
