import crypto from "node:crypto";
import { env } from "../config/env.js";

export type TBankReceiptItem = {
  Name: string;
  Price: number;
  Quantity: number;
  Amount: number;
  Tax: "none" | "vat0" | "vat10" | "vat20" | "vat110" | "vat120";
};

export type InitPaymentInput = {
  orderId: string;
  amountKopecks: number;
  description: string;
  receiptItems: TBankReceiptItem[];
  customerPhone?: string | null;
};

type TBankInitResponse = {
  Success: boolean;
  ErrorCode?: string;
  Message?: string;
  Details?: string;
  PaymentId?: string;
  PaymentURL?: string;
  OrderId?: string;
};

export class TBankService {
  constructor(
    private readonly baseUrl = env.TBANK_BASE_URL,
    private readonly terminalKey = env.TBANK_TERMINAL_KEY,
    private readonly password = env.TBANK_PASSWORD
  ) {}

  async initPayment(input: InitPaymentInput): Promise<{
    paymentId: string;
    paymentUrl: string;
    orderId: string;
  }> {
    if (!this.terminalKey || !this.password) {
      throw new Error("TBANK_TERMINAL_KEY or TBANK_PASSWORD is not configured");
    }

    const payload: Record<string, unknown> = {
      TerminalKey: this.terminalKey,
      Amount: input.amountKopecks,
      OrderId: input.orderId,
      Description: input.description,
      NotificationURL: env.TBANK_NOTIFICATION_URL || undefined,
      SuccessURL: env.TBANK_SUCCESS_URL || undefined,
      FailURL: env.TBANK_FAIL_URL || undefined,
      Receipt: {
        Taxation: "usn_income",
        Phone: input.customerPhone ?? undefined,
        Items: input.receiptItems
      }
    };

    payload.Token = this.createToken(payload);

    const response = await fetch(`${this.baseUrl}/Init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    const data = parseTBankBody(responseText) as TBankInitResponse;
    if (!response.ok || !data.Success || !data.PaymentId || !data.PaymentURL) {
      throw new Error(
        `T-Bank Init failed: ${response.status} ${data.ErrorCode ?? ""} ${data.Message ?? ""} ${
          data.Details ?? responseText
        }`.trim()
      );
    }

    return {
      paymentId: data.PaymentId,
      paymentUrl: data.PaymentURL,
      orderId: data.OrderId ?? input.orderId
    };
  }

  validateNotification(payload: Record<string, unknown>): boolean {
    if (!this.password) return false;
    const expected = this.createToken(payload);
    return payload.Token === expected;
  }

  isPaidStatus(status: unknown): boolean {
    return status === "CONFIRMED" || status === "AUTHORIZED";
  }

  private createToken(payload: Record<string, unknown>): string {
    const flat: Record<string, string> = {};

    for (const [key, value] of Object.entries(payload)) {
      if (key === "Token" || key === "Receipt" || value === undefined || value === null) continue;
      if (typeof value === "object") continue;
      flat[key] = String(value);
    }

    flat.Password = this.password;

    const source = Object.keys(flat)
      .sort()
      .map((key) => flat[key])
      .join("");

    return crypto.createHash("sha256").update(source).digest("hex");
  }
}

function parseTBankBody(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
