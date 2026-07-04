export type RetryOptions = {
  attempts?: number;
  onRetry?: (attempt: number, error: unknown) => Promise<void> | void;
};

export async function withExternalApiRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const attempts = options.attempts ?? 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableExternalError(error)) break;
      await options.onRetry?.(attempt, error);
    }
  }

  throw lastError;
}

export function isRetryableExternalError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return (
    /\b5\d\d\b/.test(message) ||
    /fetch failed|network|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket/i.test(message)
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
