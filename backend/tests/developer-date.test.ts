import { describe, expect, it } from "vitest";
import { parseDeveloperToday, resolveTodayForDeveloperMode } from "../src/lib/developer-date.js";

describe("developer date", () => {
  it("uses real today when developer mode is disabled", () => {
    const realToday = new Date("2026-07-03T12:00:00.000Z");
    expect(resolveTodayForDeveloperMode(false, "2026-04-01", realToday)).toBe(realToday);
  });

  it("uses configured date when developer mode is enabled", () => {
    expect(resolveTodayForDeveloperMode(true, "2026-04-01").toISOString().slice(0, 10)).toBe("2026-04-01");
  });

  it("falls back to real today for invalid configured dates", () => {
    const realToday = new Date("2026-07-03T12:00:00.000Z");
    expect(resolveTodayForDeveloperMode(true, "2026-99-99", realToday)).toBe(realToday);
    expect(parseDeveloperToday("2026-02-31")).toBeNull();
  });
});
