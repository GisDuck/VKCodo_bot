import { describe, expect, it } from "vitest";
import { appendPublicPath, normalizePublicBaseUrl } from "../src/lib/public-url.js";

describe("public url helpers", () => {
  it("keeps full https base url and removes trailing slash", () => {
    expect(normalizePublicBaseUrl("https://bot.example.ru/")).toBe("https://bot.example.ru");
  });

  it("adds https for production-like host without scheme", () => {
    expect(normalizePublicBaseUrl("bot.example.ru")).toBe("https://bot.example.ru");
  });

  it("uses http for localhost without scheme", () => {
    expect(normalizePublicBaseUrl("localhost:3000")).toBe("http://localhost:3000");
  });

  it("builds T-Bank return paths from base url", () => {
    expect(appendPublicPath("https://bot.example.ru/", "/payment/success")).toBe(
      "https://bot.example.ru/payment/success"
    );
    expect(appendPublicPath("bot.example.ru", "payment/fail")).toBe("https://bot.example.ru/payment/fail");
  });
});
