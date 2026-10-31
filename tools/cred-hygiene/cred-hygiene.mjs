// cred-hygiene.mjs — canary-based credential redaction scanner.
//
// WO-P1 Phase 3 tooling (execution plan item: "Redaction test with canary values").
// Zero dependencies. Node >= 18. Credentials-free by construction: it only ever sees
// canary values and pattern shapes, never real credentials.
//
// Exit-code contract shared with tools/sandbox-guard (documented in cli.mjs):
//   0 = clean (silent) · 2 = usage error · 3 = findings (refusal) · 1 = internal error
//
// Two detection layers:
//   1. Canary exact-value matching — authoritative. The caller registers the exact
//      secret values injected into a run; any occurrence anywhere is a finding.
//   2. Pattern classes — heuristic depth for values nobody registered (ya29., 1//,
//      GOCSPX-, AIza, JWT shape). Pattern findings are a safety net, not proof.
//
// Output discipline (enforced by test CH-5/CH-6): the report NEVER contains a matched
// value. Canary findings show no preview at all; pattern findings show at most the
// first three characters, which are the class prefix.

import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const TOOL = 'cred-hygiene';
export const VERSION = '1.0.0';

export class UsageError extends Error {
  constructor(message) { super(message); this.name = 'UsageError'; }
}

/** Heuristic pattern classes for Google-family credentials. */
export const PATTERN_CLASSES = Object.freeze([
  { id: 'access-token',  regex: /\bya29\.[A-Za-z0-9._-]{20,}/g,                      note: 'Google OAuth access token (ya29. prefix)' },
  { id: 'refresh-token', regex: /\b1\/\/[A-Za-z0-9._-]{20,}/g,                       note: 'Google OAuth refresh token (1// prefix)' },
  { id: 'client-secret', regex: /\bGOCSPX-[A-Za-z0-9._-]{20,}/g,                     note: 'Google OAuth client secret (GOCSPX- prefix)' },
  { id: 'api-key',       regex: /\bAIza[A-Za-z0-9_-]{30,}/g,                         note: 'Google API key (AIza prefix)' },
  { id: 'id-token-jwt',  regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./g, note: 'JWT / OpenID Connect ID token' },
]);

export const DEFAULT_IGNORES = new Set(['.git', 'node_modules']);
export const MIN_CANARY_LENGTH = 8;
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
export const CANARY_CLASSES = Object.freeze(['access-token', 'refresh-token', 'client-secret', 'api-key', 'opaque']);

// ---------------------------------------------------------------------------
// Canary loading
// ---------------------------------------------------------------------------

/** Accepts: array of strings, or {class, value} objects, or nested arrays of either. */
export function loadCanaries(spec) {
  if (!Array.isArray(spec)) throw new UsageError('canaries must be an array of strings or {class, value} objects');
  const out = [];
  const seen = new Set();
  const push = (value, cls) => {
    if (typeof value !== 'string' || value.length < MIN_CANARY_LENGTH) {
      throw new UsageError(`canary value must be a string of at least ${MIN_CANARY_LENGTH} characters (got ${typeof value}, len ${value?.length ?? 'n/a'})`);
    }
    if (seen.has(value)) return; // duplicates are harmless; dedupe silently
    seen.add(value);
    out.push({ value, class: cls || 'canary' });
  };
  for (const item of spec) {
    if (typeof item === 'string') push(item, 'canary');
    else if (Array.isArray(item)) {
      for (const sub of item) {
        if (typeof sub === 'string') push(sub, 'canary');
        else if (sub && typeof sub === 'object' && typeof sub.value === 'string') push(sub.value, sub.class);
        else throw new UsageError('canary entries must be strings or {class, value} objects');
      }
    }
    else if (item && typeof item === 'object' && typeof item.value === 'string') push(item.value, item.class);
    else throw new UsageError('canary entries must be strings or {class, value} objects');
  }
  if (out.length === 0) throw new UsageError('no canary values provided');
  return out;
}

/** Parse a --canary-file payload: a JSON array (strings or {class,value}) or newline-separated values (# comments allowed). */
export function parseCanaryFile(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  return trimmed.split('\n').map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith('#'));
}

// ---------------------------------------------------------------------------
// Canary generation (deterministic, seeded)
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const B62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function randStr(rnd, n) { let s = ''; for (let i = 0; i < n; i++) s += B62[Math.floor(rnd() * B62.length)]; return s; }

/**
 * Deterministic canary values shaped like the real classes and unmistakably marked:
 * every value contains the substring "CANARY" so a human seeing one knows its nature.
 * Same seed -> same values; tests and the repo integration rely on this.
 */
export function generateCanaries({ classes = CANARY_CLASSES, count = 1, seed = 1 } = {}) {
  if (!Number.isInteger(count) || count < 1) throw new UsageError('--count must be a positive integer');
  if (!Number.isInteger(seed)) throw new UsageError('--seed must be an integer');
  const rnd = mulberry32(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    for (const cls of classes) {
      switch (cls) {
        case 'access-token':  out.push({ class: cls, value: `ya29.a0CANARY${randStr(rnd, 24)}` }); break;
        case 'refresh-token': out.push({ class: cls, value: `1//0CANARY${randStr(rnd, 24)}` }); break;
        case 'client-secret': out.push({ class: cls, value: `GOCSPX-CANARY${randStr(rnd, 24)}` }); break;
        case 'api-key':       out.push({ class: cls, value: `AIzaCANARY${randStr(rnd, 28)}` }); break;
        case 'opaque':        out.push({ class: cls, value: `CANARY-${randStr(rnd, 32)}` }); break;
        default: throw new UsageError(`unknown canary class "${cls}" (known: ${CANARY_CLASSES.join(', ')})`);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

function lineCol(text, index) {
  let line = 1, col = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) { line++; col = 1; } else col++;
  }
  return { line, col };
}

/** Scan one text buffer. Returns findings sorted by source, then position. */
export function scanText(text, canaries, source = '<text>') {
  const findings = [];
  for (const c of canaries) {
    let idx = text.indexOf(c.value);
    while (idx !== -1) {
      const { line, col } = lineCol(text, idx);
      findings.push({ source, line, col, class: `canary:${c.class}`, length: c.value.length });
      idx = text.indexOf(c.value, idx + 1);
    }
  }
  for (const pc of PATTERN_CLASSES) {
    pc.regex.lastIndex = 0;
    let m;
    while ((m = pc.regex.exec(text)) !== null) {
      const { line, col } = lineCol(text, m.index);
      findings.push({ source, line, col, class: pc.id, length: m[0].length, preview: m[0].slice(0, 3) + '…' });
    }
  }
  findings.sort((a, b) => (a.source === b.source)
    ? ((a.line - b.line) || (a.col - b.col))
    : (a.source < b.source ? -1 : 1));
  return findings;
}

/**
 * Collect files under the given paths. Directories are walked recursively;
 * .git and node_modules are always skipped; excludes match by name or path substring.
 */
export function collectFiles(paths, { ignores = DEFAULT_IGNORES, excludes = [] } = {}) {
  const files = [];
  const seen = new Set();
  const excluded = (p, name) => excludes.some(ex => name === ex || p.includes(ex));
  const walk = (p) => {
    let st;
    try { st = statSync(p); } catch { throw new UsageError(`path not found: ${p}`); }
    if (st.isFile()) {
      if (!seen.has(p)) { seen.add(p); files.push(p); }
      return;
    }
    if (st.isDirectory()) {
      for (const name of readdirSync(p).sort()) {
        if (ignores.has(name)) continue;
        const child = join(p, name);
        if (excluded(child, name)) continue;
        walk(child);
      }
      return;
    }
    // sockets, devices, other types: skipped silently
  };
  for (const p of paths) walk(p);
  return files;
}

/** Scan files under paths. Skips binaries (NUL byte) and files over maxBytes, with notes. */
export function scanPaths(paths, { canaries, ignores, excludes = [], maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (!Array.isArray(canaries) || canaries.length === 0) throw new UsageError('scan requires canary values (the exact-value layer is authoritative)');
  const files = collectFiles(paths, { ignores, excludes });
  const findings = [];
  const skipped = [];
  for (const f of files) {
    const st = statSync(f);
    if (st.size > maxBytes) { skipped.push({ file: f, reason: 'large', bytes: st.size }); continue; }
    const text = readFileSync(f, 'utf8');
    if (text.includes('\0')) { skipped.push({ file: f, reason: 'binary', bytes: st.size }); continue; }
    findings.push(...scanText(text, canaries, f));
  }
  return { findings, skipped, filesTotal: files.length, filesScanned: files.length - skipped.length };
}

// ---------------------------------------------------------------------------
// Reporting (never contains a matched value)
// ---------------------------------------------------------------------------

export function buildReport(result, { canaryCount = 0, argv = [] } = {}) {
  return {
    tool: TOOL,
    version: VERSION,
    generated: new Date().toISOString(),
    clean: result.findings.length === 0,
    counts: {
      filesTotal: result.filesTotal,
      filesScanned: result.filesScanned,
      filesSkipped: result.skipped.length,
      canaryValues: canaryCount,
      patternClasses: PATTERN_CLASSES.length,
      findings: result.findings.length,
    },
    findings: result.findings,
    skipped: result.skipped.map(s => ({ file: s.file, reason: s.reason })),
    command: argv.join(' '),
  };
}

export function renderReport(report) {
  const c = report.counts;
  if (report.clean) {
    return `scan clean: ${c.filesScanned} file(s) scanned, ${c.filesSkipped} skipped, 0 findings`;
  }
  const lines = [`REFUSED: ${c.findings} finding(s) — redaction failure (exit 3)`];
  for (const f of report.findings) {
    lines.push(`  ${f.source}:${f.line}:${f.col}  class=${f.class}  len=${f.length}${f.preview ? `  preview=${f.preview}` : ''}`);
  }
  for (const s of report.skipped) {
    lines.push(`  skipped: ${s.file} (${s.reason})`);
  }
  lines.push(`scan: ${c.filesScanned} file(s) scanned, ${c.filesSkipped} skipped, ${c.canaryValues} canary value(s), ${c.patternClasses} pattern class(es)`);
  return lines.join('\n');
}
