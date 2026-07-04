import { describe, expect, it, vi } from "vitest";
import { isRetryableExternalError, withExternalApiRetry } from "../src/lib/external-retry.js";

describe("external api retry", () => {
  it("retries retryable 5xx errors three times", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("MoyKlass GET /lessons failed: 504 Gateway Time-out"))
      .mockRejectedValueOnce(new Error("MoyKlass GET /lessons failed: 504 Gateway Time-out"))
      .mockResolvedValue("ok");
    const onRetry = vi.fn();

    await expect(withExternalApiRetry(operation, { onRetry })).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable 4xx errors", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("MoyKlass POST /users failed: 400 bad request"));

    await expect(withExternalApiRetry(operation)).rejects.toThrow("400");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("recognizes network and 5xx errors as retryable", () => {
    expect(isRetryableExternalError(new Error("fetch failed"))).toBe(true);
    expect(isRetryableExternalError(new Error("T-Bank Init failed: 504"))).toBe(true);
    expect(isRetryableExternalError(new Error("MoyKlass failed: 400"))).toBe(false);
  });
});
