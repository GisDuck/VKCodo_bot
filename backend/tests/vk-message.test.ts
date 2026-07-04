import { describe, expect, it, vi } from "vitest";

describe("VkMessageService", () => {
  it("builds only school and online payment buttons", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/db");
    vi.stubEnv("BASE_URL", "https://bot.example.ru");
    vi.stubEnv("MOYKLASS_API_KEY", "test");
    vi.stubEnv("TBANK_TERMINAL_KEY", "test");
    vi.stubEnv("TBANK_PASSWORD", "test");
    return import("../src/services/vk-message.service.js").then(({ VkMessageService }) => {
      const buttons = new VkMessageService().buildPaymentButtons("order-1");
      expect(buttons.map((button) => button.label)).toEqual(["В школе", "Карта/QR онлайн"]);
    });
  });
});
