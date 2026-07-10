import { describe, expect, it } from "vitest";
import { validatePersonName } from "../src/lib/person-name.js";

describe("person name validation", () => {
  it("accepts regular names", () => {
    expect(validatePersonName("Анна-Мария").ok).toBe(true);
    expect(validatePersonName("О'Connor").ok).toBe(true);
    expect(validatePersonName("  Иван   Петров  ")).toEqual({ ok: true, value: "Иван Петров" });
  });

  it("rejects database and script-like input", () => {
    for (const value of [
      "Delete database",
      "DROP TABLE users",
      "select * from Parent",
      "<script>alert(1)</script>",
      "https://example.com",
      "test@example.com"
    ]) {
      expect(validatePersonName(value).ok).toBe(false);
    }
  });

  it("rejects symbols, numbers, and obvious junk", () => {
    expect(validatePersonName("12345").ok).toBe(false);
    expect(validatePersonName("Иван!!!").ok).toBe(false);
    expect(validatePersonName("Ааааааа").ok).toBe(false);
  });
});
