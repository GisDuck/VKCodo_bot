import "dotenv/config";
import { z } from "zod";
import { appendPublicPath, normalizePublicBaseUrl } from "../lib/public-url.js";

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  BASE_URL: z.string().default("http://localhost"),
  DATABASE_URL: z.string().min(1),

  VK_GROUP_TOKEN: z.string().default(""),
  VK_CONFIRMATION_CODE: z.string().default(""),
  VK_SECRET: z.string().default(""),
  VK_USE_LONG_POLL: z
    .string()
    .default("false")
    .transform((value) => value === "true"),

  MOYKLASS_API_KEY: z.string().default(""),
  MOYKLASS_BASE_URL: z.string().url().default("https://api.moyklass.com/v1/company"),
  MOYKLASS_MANAGER_ID: z.coerce.number().int().positive().default(221231),

  TBANK_TERMINAL_KEY: z.string().default(""),
  TBANK_PASSWORD: z.string().default(""),
  TBANK_BASE_URL: z.string().url().default("https://securepay.tinkoff.ru/v2"),
  TBANK_NOTIFICATION_URL: z.string().default(""),
  TBANK_SUCCESS_URL: z.string().default(""),
  TBANK_FAIL_URL: z.string().default(""),

  PAYMENT_TEST_MODE: z
    .string()
    .default("true")
    .transform((value) => value === "true"),
  PAYMENT_EXPIRES_MINUTES: z.coerce.number().int().positive().default(30),

  ADMIN_USERNAME: z.string().default("admin"),
  ADMIN_PASSWORD: z.string().default("change-me")
});

const rawEnv = rawEnvSchema.parse(process.env);
const baseUrl = normalizePublicBaseUrl(rawEnv.BASE_URL);

export const env = {
  ...rawEnv,
  BASE_URL: baseUrl,
  TBANK_NOTIFICATION_URL: rawEnv.TBANK_NOTIFICATION_URL || appendPublicPath(baseUrl, "/webhooks/tbank"),
  TBANK_SUCCESS_URL: rawEnv.TBANK_SUCCESS_URL || appendPublicPath(baseUrl, "/payment/success"),
  TBANK_FAIL_URL: rawEnv.TBANK_FAIL_URL || appendPublicPath(baseUrl, "/payment/fail")
};
