import { describe, expect, it, vi } from "vitest";

describe("job auth", () => {
  it("accepts only the configured job token", async () => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/db");
    vi.stubEnv("JOB_SECRET", "secret-job-token");

    const { verifyJobToken } = await import("../src/lib/job-auth.js");

    expect(verifyJobToken("secret-job-token")).toBe(true);
    expect(verifyJobToken("wrong")).toBe(false);
    expect(verifyJobToken(undefined)).toBe(false);
  });
});
