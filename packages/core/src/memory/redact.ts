/**
 * Redact secret-shaped tokens before anything is written to logs, artifacts,
 * O2B, or Kanban comments. Conservative: masks well-known credential shapes and
 * `key: value` secrets, leaving ordinary prose untouched.
 */

const VALUE_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9]{16,}\b/g, // OpenAI-style keys
  /\bghp_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key ids
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

// `password = ...`, `api_key: ...`, etc. — mask the value, keep the key.
const KEYED_SECRET = /\b(password|passwd|secret|token|api[_-]?key)\b(\s*[:=]\s*)(\S+)/gi;

export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of VALUE_PATTERNS) out = out.replace(pattern, "[REDACTED]");
  out = out.replace(KEYED_SECRET, (_m, key: string, sep: string) => `${key}${sep}[REDACTED]`);
  return out;
}
