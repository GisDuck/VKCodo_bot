export function normalizePublicBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "http://localhost";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed === "localhost" || trimmed.startsWith("localhost:")) return `http://${trimmed}`;
  return `https://${trimmed}`;
}

export function appendPublicPath(baseUrl: string, path: string): string {
  const normalizedBase = normalizePublicBaseUrl(baseUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}
