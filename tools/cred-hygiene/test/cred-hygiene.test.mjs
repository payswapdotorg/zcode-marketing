// cred-hygiene.test.mjs — credentials-free test suite for the canary redaction scanner.
//
// WO-P1 Phase 3 tooling tests (CH-n identifiers; mapping to the plan in
// tools/cred-hygiene/README.md). Self-contained: temp fixtures only, no network,
// no real credentials — every secret-looking string below is either a generated
// CANARY value or an obviously fake pattern probe.
//
// Run: node --test --test-reporter=spec "tools/cred-hygiene/test/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PATTERN_CLASSES, MIN_CANARY_LENGTH, CANARY_CLASSES, UsageError,
  loadCanaries, parseCanaryFile, generateCanaries, scanText, scanPaths,
  collectFiles, buildReport, renderReport,
} from '../cred-hygiene.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'cli.mjs');

function tmp() { return mkdtempSync(join(tmpdir(), 'cred-hygiene-test-')); }
function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', ...opts });
}

// Shared fixture: five canaries (one per class), a dirty capture set, a clean set.
function makeFixture() {
  const dir = tmp();
  const canaries = generateCanaries({ seed: 2026, count: 1 });
  const access = canaries.find(c => c.class === 'access-token');
  const refresh = canaries.find(c => c.class === 'refresh-token');
  const secret = canaries.find(c => c.class === 'client-secret');
  const apikey = canaries.find(c => c.class === 'api-key');
  const opaque = canaries.find(c => c.class === 'opaque');

  const dirty = join(dir, 'dirty');
  mkdirSync(dirty);
  writeFileSync(join(dirty, 'run.log'), [
    '=== token exchange ===',
    `Authorization: Bearer ${access.value}`,
    `refresh_token=${refresh.value}`,
    `client_secret=${secret.value}`,
    `POST /upload?access_token=${access.value}&key=${apikey.value}`,
  ].join('\n') + '\n');
  writeFileSync(join(dir, 'dirty', 'state.json'), JSON.stringify({
    token: access.value, refresh: refresh.value, opaque_marker: opaque.value,
  }, null, 2) + '\n');
  writeFileSync(join(dir, 'dirty', 'unknown.log'),
    `unregistered shape must still trip the pattern layer: ya29.aUnKnOwNsEcReTtOkEnNoBoDyReGiStErEd987654\n`);
  writeFileSync(join(dir, 'dirty', 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0x00]));

  const clean = join(dir, 'clean');
  mkdirSync(clean);
  writeFileSync(join(dir, 'clean', 'run.log'), 'exchange ok status=200 expires_in=3599\n');
  writeFileSync(join(dir, 'clean', 'note.md'), 'No credential values in this file.\n');

  return { dir, canaries, access, refresh, secret, apikey, opaque, dirty, clean };
}

// ---------------------------------------------------------------------------

test('CH-1 — canary exact-value detection finds every registered value with location', () => {
  const f = makeFixture();
  try {
    const result = scanPaths([f.dirty], { canaries: f.canaries });
    const classes = new Set(result.findings.filter(x => x.class.startsWith('canary:')).map(x => x.class));
    assert.ok(classes.has('canary:access-token'), 'access-token canary detected');
    assert.ok(classes.has('canary:refresh-token'), 'refresh-token canary detected');
    assert.ok(classes.has('canary:client-secret'), 'client-secret canary detected');
    assert.ok(classes.has('canary:api-key'), 'api-key canary detected');
    assert.ok(classes.has('canary:opaque'), 'opaque canary detected');
    // exact location: the Bearer line is line 2 of run.log
    const bearer = result.findings.find(x => x.class === 'canary:access-token' && x.line === 2);
    assert.ok(bearer, 'Bearer-line access-token canary reported at line 2');
    assert.equal(bearer.col, 'Authorization: Bearer '.length + 1); // token starts right after the prefix
    assert.equal(result.filesScanned, 3, 'three text files scanned');
    assert.deepEqual(result.skipped.map(s => s.reason), ['binary'], 'binary skipped');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('CH-2 — pattern classes detect unregistered credential shapes', () => {
  const f = makeFixture();
  try {
    // no canaries registered for this scan? The exact-value layer is authoritative,
    // so the API requires canaries — but pattern findings still fire for unknown shapes.
    const canaries = [{ value: 'CANARY-placeholder-value', class: 'placeholder' }];
    const result = scanPaths([join(f.dirty, 'unknown.log')], { canaries });
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].class, 'access-token');
    assert.equal(result.findings[0].preview, 'ya2…');
    assert.ok(result.findings[0].length > 20);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('CH-3 — clean path: exit 0, zero stdout (silent)', () => {
  const f = makeFixture();
  try {
    const p = runCli(['scan', '--canary', f.access.value, f.clean]);
    assert.equal(p.status, 0, `stderr: ${p.stderr}`);
    assert.equal(p.stdout, '', 'clean scan must be silent');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('CH-4 — findings: exit 3 and a REFUSED report on stdout', () => {
  const f = makeFixture();
  try {
    const p = runCli(['scan', '--canary-file', writeCanaryFile(f.dir, f.canaries), f.dirty]);
    assert.equal(p.status, 3);
    assert.ok(p.stdout.includes('REFUSED'), 'report headline present');
    assert.ok(p.stdout.includes('redaction failure'));
    assert.ok(p.stdout.includes('run.log:2'), 'file:line reference present');
    assert.ok(p.stdout.includes('skipped') && p.stdout.includes('blob.bin'), 'binary skip noted');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('CH-5 — meta-redaction: the report file itself scans clean (R9 core invariant)', () => {
  const f = makeFixture();
  try {
    const out = join(f.dir, 'report.json');
    const p = runCli(['scan', '--canary-file', writeCanaryFile(f.dir, f.canaries), '--out', out, f.dirty]);
    assert.equal(p.status, 3);
    // re-scan the report with the same canaries: must be clean
    const q = runCli(['scan', '--canary-file', writeCanaryFile(f.dir, f.canaries), out]);
    assert.equal(q.status, 0, `report leaked a value: ${q.stdout}`);
    assert.equal(q.stdout, '');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('CH-6 — report text contains no canary value and no full pattern value', () => {
  const f = makeFixture();
  try {
    const out = join(f.dir, 'report.json');
    const p = runCli(['scan', '--canary-file', writeCanaryFile(f.dir, f.canaries), '--out', out, f.dirty]);
    assert.equal(p.status, 3);
    const text = p.stdout + readFileSync(out, 'utf8');
    for (const c of f.canaries) assert.ok(!text.includes(c.value), `report contains canary value of class ${c.class}`);
    assert.ok(!text.includes('ya29.aUnKnOwNsEcReTtOkEn'), 'report contains the unregistered pattern value');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('CH-7 — canary generation: deterministic, CANARY-marked, class-shaped', () => {
  const a = generateCanaries({ seed: 7, count: 2 });
  const b = generateCanaries({ seed: 7, count: 2 });
  assert.deepEqual(a, b, 'same seed -> same values');
  assert.equal(a.length, CANARY_CLASSES.length * 2);
  for (const c of a) {
    assert.ok(c.value.includes('CANARY'), `${c.class} value carries the CANARY marker`);
    assert.ok(c.value.length >= MIN_CANARY_LENGTH);
  }
  const byClass = Object.fromEntries(a.map(c => [c.class, c]));
  assert.ok(byClass['access-token'].value.startsWith('ya29.'));
  assert.ok(byClass['refresh-token'].value.startsWith('1//'));
  assert.ok(byClass['client-secret'].value.startsWith('GOCSPX-'));
  assert.ok(byClass['api-key'].value.startsWith('AIza'));
  const other = generateCanaries({ seed: 8, count: 1 });
  assert.notDeepEqual(a.slice(0, 5), other, 'different seed -> different values');
  assert.throws(() => generateCanaries({ classes: ['nope'] }), UsageError);
});

test('CH-8 — binary and oversized files are skipped with notes, not crashed', () => {
  const f = makeFixture();
  try {
    const big = join(f.dir, 'big.log');
    writeFileSync(big, 'x'.repeat(4096));
    // threshold chosen above the fixture text files (~120–300 bytes) but below big.log
    const result = scanPaths([f.dirty, big], { canaries: f.canaries, maxBytes: 1024 });
    const reasons = result.skipped.map(s => s.reason).sort();
    assert.deepEqual(reasons, ['binary', 'large']);
    assert.equal(result.filesScanned, 3);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('CH-9 — directory recursion with default ignores and --exclude', () => {
  const f = makeFixture();
  try {
    mkdirSync(join(f.dir, 'node_modules'));
    writeFileSync(join(f.dir, 'node_modules', 'dep.log'), `${f.access.value}\n`);
    mkdirSync(join(f.dir, 'vendor'));
    writeFileSync(join(f.dir, 'vendor', 'vendored.log'), `${f.refresh.value}\n`);
    // vendor excluded by name; node_modules ignored by default
    let files = collectFiles([f.dir], { excludes: ['vendor'] });
    assert.ok(!files.some(p => p.includes('node_modules')), 'node_modules ignored');
    assert.ok(!files.some(p => p.includes('vendor')), 'vendor excluded');
    // without the exclude, vendor is walked and its canary is found
    const result = scanPaths([f.dir], { canaries: f.canaries });
    assert.ok(result.findings.some(x => x.class === 'canary:refresh-token' && x.source.includes('vendored.log')));
    assert.ok(!result.findings.some(x => x.source.includes('node_modules')), 'ignored dir never scanned');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('CH-10 — canary loading forms and validation', () => {
  assert.deepEqual(loadCanaries(['abcdefgh', { class: 'k', value: 'ijklmnop' }]).map(c => c.class), ['canary', 'k']);
  assert.equal(loadCanaries(['abcdefgh', 'abcdefgh']).length, 1, 'duplicates deduped');
  assert.throws(() => loadCanaries(['short']), UsageError);
  assert.throws(() => loadCanaries([]), UsageError);
  assert.throws(() => loadCanaries([{ nope: 1 }]), UsageError);
  const parsed = parseCanaryFile('{"class":"a","value":"abcdefgh"}');
  assert.equal(parsed.length, 1);
  const lines = parseCanaryFile('# comment\nabcdefgh\nijklmnop\n');
  assert.deepEqual(lines, ['abcdefgh', 'ijklmnop']);
});

test('CH-11 — usage errors exit 2', () => {
  assert.equal(runCli([]).status, 2);
  assert.equal(runCli(['nope']).status, 2);
  assert.equal(runCli(['scan']).status, 2);                       // no paths
  assert.equal(runCli(['scan', '/definitely/not/here']).status, 2); // no canaries
  assert.equal(runCli(['scan', '--canary', 'x', '.']).status, 2);  // canary too short
  assert.equal(runCli(['scan', '--canary', 'abcdefgh', '--bogus', '.']).status, 2);
  assert.equal(runCli(['canary', '--count', 'x']).status, 2);
});

test('CH-12 — structured report schema is stable and complete', () => {
  const f = makeFixture();
  try {
    const out = join(f.dir, 'report.json');
    const p = runCli(['scan', '--canary-file', writeCanaryFile(f.dir, f.canaries), '--out', out, f.dirty]);
    assert.equal(p.status, 3);
    const r = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(r.tool, 'cred-hygiene');
    assert.equal(r.clean, false);
    assert.equal(typeof r.generated, 'string');
    for (const k of ['filesTotal', 'filesScanned', 'filesSkipped', 'canaryValues', 'patternClasses', 'findings']) {
      assert.ok(k in r.counts, `counts.${k} present`);
    }
    assert.ok(Array.isArray(r.findings) && r.findings.length > 0);
    for (const x of r.findings) {
      assert.ok('source' in x && 'line' in x && 'col' in x && 'class' in x && 'length' in x);
      assert.ok(!('value' in x), 'findings never carry the matched value');
    }
    assert.equal(r.skipped.length, 1);
    assert.equal(r.skipped[0].reason, 'binary');
    assert.equal(typeof r.skipped[0].file, 'string');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('CH-13 — clean run with --out writes a clean report and stays silent on stdout', () => {
  const f = makeFixture();
  try {
    const out = join(f.dir, 'nested', 'clean-report.json');
    const p = runCli(['scan', '--canary', f.access.value, '--out', out, f.clean]);
    assert.equal(p.status, 0);
    assert.equal(p.stdout, '');
    const r = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(r.clean, true);
    assert.equal(r.counts.findings, 0);
    assert.equal(r.counts.canaryValues, 1);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('CH-14 — selfcheck passes end-to-end', () => {
  const p = runCli(['selfcheck']);
  assert.equal(p.status, 0, `stderr: ${p.stderr}`);
  assert.ok(p.stdout.includes('selfcheck PASS'));
  assert.ok(p.stdout.includes('meta-clean'));
});

test('CH-15 — verbose clean scan prints the summary; pattern list is documented', () => {
  const f = makeFixture();
  try {
    const p = runCli(['scan', '--canary', f.access.value, '--verbose', f.clean]);
    assert.equal(p.status, 0);
    assert.ok(p.stdout.includes('scan clean'));
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
  assert.equal(PATTERN_CLASSES.length, 5);
  const ids = PATTERN_CLASSES.map(c => c.id);
  for (const id of ['access-token', 'refresh-token', 'client-secret', 'api-key', 'id-token-jwt']) {
    assert.ok(ids.includes(id), `pattern class ${id} defined`);
  }
});

// helper: write a canary JSON file (the form the manual-run protocol uses)
function writeCanaryFile(dir, canaries) {
  const p = join(dir, 'canaries.json');
  writeFileSync(p, JSON.stringify(canaries, null, 2) + '\n');
  return p;
}
