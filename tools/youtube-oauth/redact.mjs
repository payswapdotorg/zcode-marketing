// redact.mjs — token-hygiene utilities for WO-P1.
//
// Every log line, artifact, and export in this package passes through these
// helpers. The redaction test (token-hygiene suite) proves no plaintext
// credential reaches any stored artifact (WO-P1 scope item 2; handoff
// Section 8.3: redaction is verified by test).

export const REDACTED = '[REDACTED]';

/** Keys whose values are always credentials, whatever the nesting depth. */
const SECRET_KEY_PATTERN =
  /(access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|code[_-]?verifier|code[_-]?challenge|api[_-]?key|password|bearer)/i;

/**
 * Replaces every occurrence of each given secret substring with a marker.
 * @param {string} text
 * @param {string[]} secrets - literal secret strings (tokens, secrets, codes)
 * @param {string} [label] - name of the secret set for audit messages
 */
export function redactWithSecrets(text, secrets, label = 'secret') {
  let out = String(text);
  for (const s of secrets) {
    if (!s) continue;
    out = out.split(String(s)).join(REDACTED);
  }
  return out;
}

/**
 * Deep-clone a value with credential-looking keys and Authorization headers
 * replaced by [REDACTED]. Cycles are broken by redacting on second visit.
 */
export function redactDeep(value, seen = new WeakSet()) {
  if (typeof value === 'string') {
    if (SECRET_KEY_PATTERN.test(value)) return REDACTED;
    return value;
  }
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return REDACTED;
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, seen));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY_PATTERN.test(k) ? REDACTED : redactDeep(v, seen);
  }
  return out;
}

/**
 * Throw a loud, precise error if any secret appears verbatim in text.
 * Used by the token-hygiene tests to scan logs, files, and exports.
 * @param {string} text
 * @param {string[]} secrets
 * @param {string} where - description of the scanned surface
 */
export function assertNoSecrets(text, secrets, where) {
  const leaked = secrets.filter((s) => s && String(text).includes(String(s)));
  if (leaked.length > 0) {
    throw new Error(
      `TOKEN HYGIENE FAILURE in ${where}: ${leaked.length} plaintext credential(s) found `
      + `(${leaked.map((s) => `${String(s).slice(0, 6)}…(${String(s).length} chars)`).join(', ')}). `
      + 'Redact before storing.',
    );
  }
}

/**
 * Scan a list of files for plaintext secrets.
 * @param {{path: string, read: () => string}[]} files
 * @param {string[]} secrets
 */
export function scanFilesForSecrets(files, secrets) {
  for (const f of files) {
    assertNoSecrets(f.read(), secrets, f.path);
  }
}

/** The safe projection of a connection record for status/export output. */
export function projectConnection(record) {
  return {
    channelId: record.channelId,
    channelTitle: record.channel?.title ?? null,
    environment: record.environment,
    scopes: record.scopes,
    connectedAt: record.connectedAt,
    updatedAt: record.updatedAt,
    degraded: record.degraded ?? false,
    degradedReason: record.degradedReason ?? null,
  };
}
