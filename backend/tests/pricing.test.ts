import { describe, expect, it } from "vitest";
import { PricingService } from "../src/services/pricing.service.js";

const service = new PricingService();

describe("PricingService", () => {
  it("calculates full price for several children", () => {
    expect(
      service.calculateOrder({ referralApplied: false, childrenCount: 3, paymentTestMode: false })
    ).toEqual({
      itemPriceKopecks: 60_000,
      realTotalKopecks: 180_000,
      chargedKopecks: 180_000
    });
  });

  it("calculates referral price", () => {
    expect(service.calculateOrder({ referralApplied: true, childrenCount: 2, paymentTestMode: false })).toEqual({
      itemPriceKopecks: 30_000,
      realTotalKopecks: 60_000,
      chargedKopecks: 60_000
    });
  });

  it("charges one ruble in test mode but keeps real total", () => {
    expect(service.calculateOrder({ referralApplied: false, childrenCount: 2, paymentTestMode: true })).toEqual({
      itemPriceKopecks: 60_000,
      realTotalKopecks: 120_000,
      chargedKopecks: 100
    });
  });
});
