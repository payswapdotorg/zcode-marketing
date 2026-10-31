#!/usr/bin/env node
// cli.mjs — cred-hygiene command line.
//
// Commands:
//   scan       — scan paths for canary values and credential patterns
//   canary     — generate deterministic, CANARY-marked test values
//   selfcheck  — end-to-end internal check (detection, meta-redaction, binary skip)
//   help
//
// Exit codes: 0 clean/success (silent on the clean scan path) · 2 usage error ·
//             3 findings (refusal — the scan report is the artifact) · 1 internal error
//
// The scan report goes to stdout (not stderr) deliberately: the manual-run protocol
// stores the scan output as evidence (execution plan Phase 4 step 4).

import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  TOOL, VERSION, UsageError, PATTERN_CLASSES, DEFAULT_MAX_BYTES, CANARY_CLASSES,
  loadCanaries, parseCanaryFile, generateCanaries, scanPaths, scanText,
  buildReport, renderReport,
} from './cred-hygiene.mjs';

const USAGE = `cred-hygiene ${VERSION} — canary-based credential redaction scanner (WO-P1 Phase 3 tooling)

Usage:
  node tools/cred-hygiene/cli.mjs scan [--canary V ...] [--canary-file F]
                                       [--out REPORT.json] [--exclude X ...]
                                       [--verbose] PATH ...
  node tools/cred-hygiene/cli.mjs canary [--class access-token,refresh-token,client-secret,api-key,opaque|all]
                                         [--count N] [--seed S]
  node tools/cred-hygiene/cli.mjs selfcheck
  node tools/cred-hygiene/cli.mjs help

scan:
  --canary V        register an exact canary value (repeatable)
  --canary-file F   JSON array (strings or {class,value}) or newline-separated values
  --out F           also write the structured report as JSON (parent dirs are created)
  --exclude X       skip entries whose path contains X (repeatable)
  --verbose         print the summary even on a clean scan
  At least one canary value is required: the exact-value layer is authoritative.
  Pattern classes are always active: ${PATTERN_CLASSES.map(c => c.id).join(', ')}.
  .git/ and node_modules/ are always skipped; binaries (NUL byte) and files over
  ${DEFAULT_MAX_BYTES} bytes are skipped with a note. Exit 3 on any finding.

canary:
  Deterministic (seeded) values shaped like the real classes; every value contains
  the substring CANARY so it can never be mistaken for a live credential.

Exit codes: 0 ok (silent on clean scan) · 2 usage · 3 findings · 1 internal error`;

function fail(msg, code = 2) {
  process.stderr.write(`${TOOL}: ${msg}\n`);
  process.stderr.write(`Run "node tools/cred-hygiene/cli.mjs help" for usage.\n`);
  process.exit(code);
}

function parseArgs(rest) {
  const opts = { canaries: [], canaryFiles: [], excludes: [], paths: [], out: null, verbose: false, classes: [], count: 1, seed: 1 };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    switch (a) {
      case '--canary':        opts.canaries.push(requireValue(rest, ++i, a)); break;
      case '--canary-file':   opts.canaryFiles.push(requireValue(rest, ++i, a)); break;
      case '--out':           opts.out = requireValue(rest, ++i, a); break;
      case '--exclude':       opts.excludes.push(requireValue(rest, ++i, a)); break;
      case '--verbose':       opts.verbose = true; break;
      case '--class':         opts.classes.push(...requireValue(rest, ++i, a).split(',').map(s => s.trim()).filter(Boolean)); break;
      case '--count':         opts.count = intArg(requireValue(rest, ++i, a), a); break;
      case '--seed':          opts.seed = intArg(requireValue(rest, ++i, a), a); break;
      default:
        if (a.startsWith('--')) fail(`unknown option "${a}"`);
        opts.paths.push(a);
    }
  }
  return opts;
}

function requireValue(rest, i, flag) {
  if (i >= rest.length || rest[i].startsWith('--')) fail(`option ${flag} requires a value`);
  return rest[i];
}

function intArg(v, flag) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) fail(`option ${flag} requires an integer (got "${v}")`);
  return n;
}

function loadAllCanaries(opts) {
  const specs = [...opts.canaries];
  for (const f of opts.canaryFiles) {
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { fail(`cannot read canary file: ${f}`); }
    try { specs.push(...parseCanaryFile(text)); } catch (e) { fail(`invalid canary file ${f}: ${e.message}`); }
  }
  try { return loadCanaries(specs); } catch (e) { if (e instanceof UsageError) fail(e.message); throw e; }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdScan(rest) {
  const opts = parseArgs(rest);
  if (opts.paths.length === 0) fail('scan requires at least one PATH');
  const canaries = loadAllCanaries(opts);
  const argv = [process.argv[1], 'scan', ...rest];
  const result = scanPaths(opts.paths, { canaries, excludes: opts.excludes });
  const report = buildReport(result, { canaryCount: canaries.length, argv });
  if (opts.out) {
    mkdirSync(dirname(opts.out), { recursive: true });
    writeFileSync(opts.out, JSON.stringify(report, null, 2) + '\n');
  }
  if (report.clean) {
    if (opts.verbose) process.stdout.write(renderReport(report) + '\n');
    process.exit(0);
  }
  process.stdout.write(renderReport(report) + '\n');
  process.exit(3);
}

function cmdCanary(rest) {
  const opts = parseArgs(rest);
  if (opts.paths.length > 0) fail('canary takes no PATH arguments');
  let classes = opts.classes.length > 0 ? opts.classes : ['all'];
  if (classes.includes('all')) classes = [...CANARY_CLASSES];
  let generated;
  try {
    generated = generateCanaries({ classes, count: opts.count, seed: opts.seed });
  } catch (e) {
    if (e instanceof UsageError) fail(e.message); throw e;
  }
  process.stdout.write(JSON.stringify(generated, null, 2) + '\n');
  process.exit(0);
}

function cmdSelfcheck() {
  const t0 = process.hrtime.bigint();
  const dir = mkdtempSync(join(tmpdir(), 'cred-hygiene-selfcheck-'));
  try {
    const canaries = generateCanaries({ seed: 42, count: 1 });
    const access = canaries.find(c => c.class === 'access-token');
    const secret = canaries.find(c => c.class === 'client-secret');
    writeFileSync(join(dir, 'clean.log'), 'request ok status=200 nothing interesting\n');
    writeFileSync(join(dir, 'run.log'),
      `token_exchange ok\nAuthorization: Bearer ${access.value}\nclient_secret=${secret.value}\n`);
    writeFileSync(join(dir, 'unknown.log'),
      `pattern-only leak: ya29.aBXnOtAReAlSeCrEtToKeNvAlUeNoBoDyReGiStErEd1234\n`);
    writeFileSync(join(dir, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0x00]));

    const result = scanPaths([dir], { canaries });
    const canaryHits = result.findings.filter(f => f.class.startsWith('canary:')).length;
    const patternHits = result.findings.filter(f => !f.class.startsWith('canary:')).length;
    if (canaryHits !== 2) throw new Error(`selfcheck: expected 2 canary findings, got ${canaryHits}`);
    if (patternHits < 3) throw new Error(`selfcheck: expected >=3 pattern findings (incl. the CANARY-shaped ones), got ${patternHits}`);
    if (result.skipped.length !== 1 || result.skipped[0].reason !== 'binary') throw new Error('selfcheck: binary skip failed');

    const report = buildReport(result, { canaryCount: canaries.length, argv: ['selfcheck'] });
    const reportPath = join(dir, 'report.json');
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

    // Meta-redaction: the report itself must be clean under the same canaries.
    const reportText = readFileSync(reportPath, 'utf8');
    const meta = scanText(reportText, canaries, reportPath);
    const metaCanary = meta.filter(f => f.class.startsWith('canary:')).length;
    const metaPatterns = meta.length - metaCanary;
    if (metaCanary !== 0) throw new Error(`selfcheck: report leaked ${metaCanary} canary value(s)`);
    if (metaPatterns !== 0) throw new Error(`selfcheck: report leaked ${metaPatterns} pattern value(s)`);

    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    process.stdout.write(`selfcheck: detection ok (2 canary + ${patternHits} pattern findings), binary skip ok, report meta-clean\n`);
    process.stdout.write(`selfcheck PASS: ${ms.toFixed(1)} ms\n`);
    process.exit(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const [cmd, ...rest] = process.argv.slice(2);
try {
  switch (cmd) {
    case 'scan':      cmdScan(rest); break;
    case 'canary':    cmdCanary(rest); break;
    case 'selfcheck': cmdSelfcheck(); break;
    case 'help': case '--help': case undefined:
      process.stdout.write(USAGE + '\n');
      process.exit(cmd === undefined ? 2 : 0);
      break;
    default:
      fail(`unknown command "${cmd}"`);
  }
} catch (err) {
  if (err instanceof UsageError) fail(err.message);
  process.stderr.write(`${TOOL}: internal error: ${err?.stack || err}\n`);
  process.exit(1);
}
