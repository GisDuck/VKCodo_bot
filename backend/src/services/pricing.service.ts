import { REFERRAL_TRIAL_PRICE_KOPECKS, TEST_PAYMENT_KOPECKS, TRIAL_PRICE_KOPECKS } from "../domain/catalog.js";

export type PriceInput = {
  referralApplied: boolean;
  childrenCount: number;
  paymentTestMode: boolean;
};

export class PricingService {
  getTrialPriceKopecks(referralApplied: boolean): number {
    return referralApplied ? REFERRAL_TRIAL_PRICE_KOPECKS : TRIAL_PRICE_KOPECKS;
  }

  calculateOrder(input: PriceInput): {
    itemPriceKopecks: number;
    realTotalKopecks: number;
    chargedKopecks: number;
  } {
    const itemPriceKopecks = this.getTrialPriceKopecks(input.referralApplied);
    const realTotalKopecks = itemPriceKopecks * input.childrenCount;

    return {
      itemPriceKopecks,
      realTotalKopecks,
      chargedKopecks: input.paymentTestMode ? TEST_PAYMENT_KOPECKS : realTotalKopecks
    };
  }
}
