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
  ADMIN_PASSWORD: z.string().default("change-me"),
  ADMIN_CSRF_SECRET: z.string().default(""),

  JOB_SECRET: z.string().default(""),
  LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(14),
  WORKER_ID: z.string().default("")
});

const rawEnv = rawEnvSchema.parse(process.env);
const baseUrl = normalizePublicBaseUrl(rawEnv.BASE_URL);
validateProductionEnv(rawEnv);

export const env = {
  ...rawEnv,
  BASE_URL: baseUrl,
  WORKER_ID: rawEnv.WORKER_ID || `worker-${process.pid}`,
  TBANK_NOTIFICATION_URL: rawEnv.TBANK_NOTIFICATION_URL || appendPublicPath(baseUrl, "/webhooks/tbank"),
  TBANK_SUCCESS_URL: rawEnv.TBANK_SUCCESS_URL || appendPublicPath(baseUrl, "/payment/success"),
  TBANK_FAIL_URL: rawEnv.TBANK_FAIL_URL || appendPublicPath(baseUrl, "/payment/fail")
};

function validateProductionEnv(value: z.infer<typeof rawEnvSchema>) {
  if (value.NODE_ENV !== "production") return;

  const missing = [
    ["VK_GROUP_TOKEN", value.VK_GROUP_TOKEN],
    ["VK_CONFIRMATION_CODE", value.VK_CONFIRMATION_CODE],
    ["VK_SECRET", value.VK_SECRET],
    ["MOYKLASS_API_KEY", value.MOYKLASS_API_KEY],
    ["TBANK_TERMINAL_KEY", value.TBANK_TERMINAL_KEY],
    ["TBANK_PASSWORD", value.TBANK_PASSWORD],
    ["JOB_SECRET", value.JOB_SECRET],
    ["ADMIN_CSRF_SECRET", value.ADMIN_CSRF_SECRET]
  ]
    .filter(([, envValue]) => !envValue)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Missing required production env vars: ${missing.join(", ")}`);
  }

  if (value.ADMIN_PASSWORD === "change-me") {
    throw new Error("ADMIN_PASSWORD must be changed in production");
  }

  if (value.PAYMENT_TEST_MODE) {
    throw new Error("PAYMENT_TEST_MODE must be false in production");
  }
}
