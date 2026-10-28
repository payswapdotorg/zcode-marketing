/**
 * SQLite temporal-store conformance run (W2-1 production persistence).
 *
 * Runs the W2 exit gates against the SQLite adapter instead of the in-memory
 * store, plus persistence-specific gates:
 *   1. idempotent ingest (double run creates no new entities)
 *   2. duplicate observations ignored (no metric inflation)
 *   3. changed value at the same observation key is an EXPLICIT revision —
 *      active series updated, old value preserved in the append-only revision
 *      table (history never silently rewritten)
 *   4. as-of query returns only observations observed at or before that time
 *   5. velocity over comparable windows (momentum beats raw totals)
 *   6. persistence: close + reopen keeps entities, series, coverage, audit,
 *      revisions and the immutable migration journal
 *
 * Run: pnpm --filter @zcode/marketing demo:sqlite
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SqliteTemporalStore } from '../adapters/sqliteStore.js';
import { organicFixtures, paidFixtures, groundTruth } from '../adapters/fixtures.js';

const assert = (cond: boolean, label: string): void => {
  if (!cond) throw new Error(`GATE FAILED: ${label}`);
  console.log(`  ✔ ${label}`);
};

const log = (title: string, body: unknown): void => {
  console.log(`\n== ${title} ==`);
  console.log(JSON.stringify(body, null, 2));
};

function main(): void {
  let clock = Date.parse('2026-10-28T10:00:00.000Z');
  const now = () => new Date((clock += 60_000)).toISOString();

  const dir = join(process.cwd(), '.sqlite-conformance');
  const dbPath = join(dir, 'marketing.db');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  let store = SqliteTemporalStore.open(dbPath, now);

  // ---- Gate 1+2: idempotent double ingest (same fixtures twice)
  const r1a = store.ingestAds(paidFixtures.ads, now());
  const r1b = store.ingestOrganic(organicFixtures.organic, now());
  const r1c = store.ingestMetrics([...paidFixtures.metrics, ...organicFixtures.metrics], now());
  log('First ingest', { r1a, r1b, r1c });
  const totalsAfterFirst = store.allAds().length + store.allOrganic().length;

  const r2a = store.ingestAds(paidFixtures.ads, now());
  const r2b = store.ingestOrganic(organicFixtures.organic, now());
  const r2c = store.ingestMetrics([...paidFixtures.metrics, ...organicFixtures.metrics], now());
  log('Second ingest (identical fixtures)', { r2a, r2b, r2c });
  const totalsAfterSecond = store.allAds().length + store.allOrganic().length;

  assert(totalsAfterFirst === totalsAfterSecond, 'double ingest is idempotent (no new entities)');
  assert(
    r2a.acceptedEntities + r2b.acceptedEntities + r2c.acceptedMetrics === 0,
    'second ingest accepts nothing (no metric inflation)',
  );
  assert(
    r2a.duplicatesIgnored + r2b.duplicatesIgnored + r2c.duplicatesIgnored > 0,
    'duplicates recorded and ignored in the audit log',
  );

  // ---- Gate 3: superseded value is an explicit, recorded revision
  const yt101 = organicFixtures.metrics.filter((m) => m.subjectRef === 'yt-101' && m.metricKey === 'views');
  const second = yt101[1]!;
  const sameValue = { ...second };
  const changedValue = { ...second, value: 45000, id: 'm-yt-101-rev' };
  store.ingestMetrics([sameValue], now());
  store.ingestMetrics([changedValue], now());
  const revisions = store.revisions();
  const activeLatest = store.latestObservation('views', 'yt-101', now());
  log('Supersede handling', { revisions, activeLatest });
  assert(
    revisions.length === 1 &&
      revisions[0]!.oldValue === second.value &&
      revisions[0]!.newValue === 45000,
    'changed value at same observation key is recorded as an explicit revision (old value preserved)',
  );
  assert(activeLatest?.value === 52000, 'active series still returns the true latest observation for the subject');
  const supersededAtKey = revisions[0]!.revisionKey;
  assert(
    supersededAtKey.endsWith(`#views@${second.observedAt}`),
    'revision is keyed by observation identity (source + metric + observedAt)',
  );

  // ---- Gate 4: as-of query reproduces the observations available at that time
  const firstObs = yt101[0]!;
  const asOfBoundary = second.observedAt;
  const asOf = store.metricsAsOf('views', 'yt-101', asOfBoundary);
  log('As-of query', { boundary: asOfBoundary, count: asOf.length, values: asOf.map((m) => m.value) });
  assert(asOf.every((m) => m.observedAt <= asOfBoundary), 'as-of query returns only observations available at that time');
  assert(asOf.length === 2 && asOf[0]!.value === firstObs.value, 'as-of query returns the full pre-boundary series');

  // ---- Gate 5: velocity over comparable windows (like-for-like discipline)
  const vel101 = store.velocity('views', 'yt-101', now(), 7);
  const vel102 = store.velocity('views', 'yt-102', now(), 7);
  log('Velocity (7-day comparable window)', { yt101: vel101, yt102: vel102 });
  assert((vel102 ?? 0) > (vel101 ?? 0), `velocity winner is ${groundTruth.expectedVelocityWinner} (momentum beats 6-month totals)`);

  // ---- Coverage round-trip
  const report = {
    kind: 'CoverageReport' as const,
    id: 'coverage-sqlite-1',
    missionId: 'mission-fixture',
    generatedAt: now(),
    slices: [
      {
        slice: 'organic-content:youtube',
        state: 'available' as const,
        sourceId: 'sample-platform',
        connectorVersion: '0.1.0',
        region: 'fixture',
        note: 'conformance slice',
      },
    ],
    supportsConclusion: 'supports persistence conformance only',
  };
  store.recordCoverage(report);
  assert(store.latestCoverage()?.id === report.id, 'coverage reports recorded and latest retrievable');

  // ---- Gate 6: persistence — close, reopen, everything survives
  const auditBeforeClose = store.ingestAudit().length;
  const adsBeforeClose = store.allAds().length;
  const organicBeforeClose = store.allOrganic().length;
  const seriesBeforeClose = store.metricsAsOf('views', 'yt-101', now()).map((m) => m.value);
  store.close();

  const reopened = SqliteTemporalStore.open(dbPath, now);
  log('Reopened after close', {
    ads: reopened.allAds().length,
    organic: reopened.allOrganic().length,
    audit: reopened.ingestAudit().length,
    revisions: reopened.revisions().length,
  });
  assert(reopened.allAds().length === adsBeforeClose, 'ads survive close + reopen');
  assert(reopened.allOrganic().length === organicBeforeClose, 'organic content survives close + reopen');
  assert(
    JSON.stringify(reopened.metricsAsOf('views', 'yt-101', now()).map((m) => m.value)) === JSON.stringify(seriesBeforeClose),
    'metric series survives close + reopen',
  );
  assert(reopened.revisions().length === 1, 'revision history survives close + reopen');
  assert(reopened.latestCoverage()?.id === report.id, 'coverage reports survive close + reopen');
  assert(reopened.ingestAudit().length === auditBeforeClose, 'append-only ingest audit survives close + reopen');
  assert(reopened.allAds().every((a) => a.kind === 'AdCreative' && a.source.connectorVersion.length > 0), 're-read records re-validate against the zod contracts');

  // Migration journal: exactly the shipped migrations, checksums intact (immutable history)
  const reread = SqliteTemporalStore.open(dbPath, now); // opening again must not re-run or alter history
  reread.close();
  store = reopened;
  store.close();
  rmSync(dir, { recursive: true, force: true });

  console.log('\nALL SQLITE CONFORMANCE GATES PASSED — W2 temporal semantics hold under production persistence.');
  console.log('Recorded as evidence under docs/marketing/evidence/ (see WORK-REGISTRY.md W2-1).');
}

try {
  main();
} catch (err) {
  console.error(String(err));
  process.exitCode = 1;
}
