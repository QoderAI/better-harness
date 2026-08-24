export const DEFAULT_MAX_ATTEMPTS = 3;

export class RetryExhaustedError extends Error {
  constructor(attempts, cause) {
    super(`Operation failed after ${attempts} attempts`, { cause });
    this.name = "RetryExhaustedError";
    this.attempts = attempts;
  }
}

export async function retry(operation, options = {}) {
  const {
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    backoffMs = 0,
    signal,
  } = options;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError("maxAttempts must be a positive integer");
  }
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    signal?.throwIfAborted();
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts && backoffMs > 0) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, backoffMs);
          signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(signal.reason);
          }, { once: true });
        });
      }
    }
  }
  throw new RetryExhaustedError(maxAttempts, lastError);
}
