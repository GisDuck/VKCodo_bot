const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 60;
const NAME_CHARS_PATTERN = /^[\p{L}\s'-]+$/u;
const LETTER_PATTERN = /\p{L}/u;
const REPEATED_CHAR_PATTERN = /(.)\1{5,}/u;

const DANGEROUS_NAME_PATTERNS = [
  /\bdelete\s+(database|db|table|from)\b/i,
  /\bdrop\s+(database|db|table|schema)\b/i,
  /\btruncate\s+(database|db|table)\b/i,
  /\balter\s+table\b/i,
  /\bcreate\s+(database|db|table|schema)\b/i,
  /\binsert\s+into\b/i,
  /\bupdate\s+\S+\s+set\b/i,
  /\bselect\s+(\*|.+\s+from)\b/i,
  /\bunion\s+select\b/i,
  /\bshutdown\b/i,
  /\bformat\s+c\b/i,
  /\brm\s+-rf\b/i,
  /\bscript\b/i,
  /\bjavascript\b/i,
  /\badmin\b/i,
  /\broot\b/i,
  /\bnull\b/i,
  /\bundefined\b/i,
  /https?:\/\//i,
  /www\./i,
  /@/
];

export type PersonNameValidationResult =
  | { ok: true; value: string }
  | { ok: false; reason: string };

export function validatePersonName(value: string, fieldLabel = "Имя"): PersonNameValidationResult {
  const normalized = normalizePersonName(value);

  if (normalized.length < MIN_NAME_LENGTH) {
    return { ok: false, reason: `${fieldLabel} должно быть не короче ${MIN_NAME_LENGTH} букв` };
  }

  if (normalized.length > MAX_NAME_LENGTH) {
    return { ok: false, reason: `${fieldLabel} слишком длинное` };
  }

  if (!LETTER_PATTERN.test(normalized)) {
    return { ok: false, reason: `${fieldLabel} должно содержать буквы` };
  }

  if (!NAME_CHARS_PATTERN.test(normalized)) {
    return { ok: false, reason: `${fieldLabel} может содержать только буквы, пробел, дефис или апостроф` };
  }

  if (REPEATED_CHAR_PATTERN.test(normalized)) {
    return { ok: false, reason: `${fieldLabel} выглядит некорректно` };
  }

  if (DANGEROUS_NAME_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { ok: false, reason: `${fieldLabel} похоже не на имя` };
  }

  return { ok: true, value: normalized };
}

export function assertPersonName(value: string, fieldLabel = "Имя"): string {
  const result = validatePersonName(value, fieldLabel);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

function normalizePersonName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[’`]/g, "'")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}
