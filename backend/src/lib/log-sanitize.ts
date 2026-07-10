const REDACTED = "[redacted]";
const REDACTED_KEYS = new Set([
  "authorization",
  "password",
  "phone",
  "payload",
  "secret",
  "text",
  "token",
  "vk_group_token"
]);

export function sanitizeLogPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeLogPayload(item));
  if (!value || typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (shouldRedactKey(key)) {
      result[key] = REDACTED;
    } else {
      result[key] = sanitizeLogPayload(entry);
    }
  }
  return result;
}

function shouldRedactKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    REDACTED_KEYS.has(normalized) ||
    normalized.includes("name") ||
    normalized.includes("phone") ||
    normalized.includes("password") ||
    normalized.includes("secret") ||
    normalized.includes("token")
  );
}
