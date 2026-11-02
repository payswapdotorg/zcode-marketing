/**
 * WO-P5 wave-2 — exported as-of snapshots (gate-P5 closure evidence).
 *
 * Exports the canonical synthetic fixture history as as-of snapshots at six
 * pinned as-of times (including one BEFORE coverage and one BETWEEN
 * observations) through BOTH engines (in-memory TemporalStore and the SQLite
 * production adapter), plus the workflow-level signal evaluations at those
 * times — the pre-coverage case carries the pinned noObservation contract
 * field (reason before_coverage), the never-observed subject carries
 * not_observed, and post-coverage signals carry values and never the field.
 *
 * All data is synthetic and labeled as such (`fixture:` source ids, 2026-01
 * fixture timestamps); it proves temporal semantics, never market facts.
 * Zero network; the SQLite adapter runs against a temp-dir database only.
 *
 * Outputs (when run with the export flag):
 *   docs/marketing/evidence-artifacts/p5-snapshots/as-of-snapshots.json
 *   docs/marketing/evidence-artifacts/p5-snapshots/as-of-snapshots.txt
 *
 * Run: pnpm --filter @zcode/marketing demo:p5-snapshots
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CapabilityCatalog,
  HeuristicModel,
  MarketingMission,
  SqliteTemporalStore,
  TemporalStore,
  metricObservation,
  productBrief,
} from '../index.js';
import type { MetricObservation } from '../index.js';
import { SampleConnector } from '../adapters/sampleConnector.js';

// ---- Synthetic fixture timeline (identical to test/historicalIntegrity.test.ts) ----
const T1 = '2026-01-05T10:00:00.000Z'; // series' first observation
const T2 = '2026-01-12T10:00:00.000Z';
const T3 = '2026-01-19T10:00:00.000Z';
const BETWEEN = '2026-01-08T10:00:00.000Z'; // between T1 and T2 — no observation exists here
const BEFORE_COVERAGE = '2026-01-02T10:00:00.000Z'; // precedes the series' first observation
const AFTER_ALL = '2026-01-25T10:00:00.000Z';
const INGESTED_AT = '2026-01-20T10:00:00.000Z'; // wall-clock when the fixture history was ingested

const SUBJECT = 'yt-fixture-201';
const METRIC = 'views';
const NEVER_OBSERVED = 'yt-fixture-404';

const AS_OF_TIMES: Array<{ label: string; at: string }> = [
  { label: 'before_coverage', at: BEFORE_COVERAGE },
  { label: 'first_observation', at: T1 },
  { label: 'between_observations', at: BETWEEN },
  { label: 'second_observation', at: T2 },
  { label: 'third_observation', at: T3 },
  { label: 'after_all', at: AFTER_ALL },
];

const obs = (over: Record<string, unknown> = {}): MetricObservation =>
  metricObservation.parse({
    kind: 'MetricObservation',
    id: 'fixture-obs',
    missionId: 'mission-fixture-p5',
    subjectRef: SUBJECT,
    metricKey: METRIC,
    value: 1000,
    observedAt: T1,
    source: { sourceId: 'fixture:p5', sourceRecordId: SUBJECT, connectorVersion: '0.1.0' },
    metricDefinition: 'fixture-public-stat',
    metricDefinitionVersion: 'v1',
    ...over,
  });

const history = (): MetricObservation[] => [
  obs({ id: 'p5-a', observedAt: T1, value: 1000 }),
  obs({ id: 'p5-b', observedAt: T2, value: 1500 }),
  obs({ id: 'p5-c', observedAt: T3, value: 2200 }),
];

const brief = productBrief.parse({
  kind: 'ProductBrief',
  id: 'brief-p5',
  missionId: 'mission-fixture-p5',
  product: 'synthetic fixture product',
  audience: 'fixture audience',
  country: 'US',
  platform: 'youtube',
  offer: 'fixture offer',
  objective: 'awareness', // primary metric 'views', no proxy ladder
  constraints: [],
  createdAt: '2026-01-01T00:00:00Z',
});

type SnapshotRow = { asOf: string; asOfLabel: string; values: number[]; raw: string };

const storeSnapshots = (store: { metricsAsOf(k: string, s: string, at: string): MetricObservation[] }): SnapshotRow[] =>
  AS_OF_TIMES.map(({ label, at }) => {
    const series = store.metricsAsOf(METRIC, SUBJECT, at);
    return { asOf: at, asOfLabel: label, values: series.map((m) => m.value), raw: JSON.stringify(series) };
  });

type SignalRow = {
  asOf: string;
  asOfLabel: string;
  subjectRef: string;
  total?: number;
  velocity?: number;
  noObservation?: { reason: string; detail: string };
};

const run = (): void => {
  console.log('WO-P5 wave-2 — exported as-of snapshots (synthetic fixtures, zero network)\n');

  // Engine 1: in-memory TemporalStore.
  const memory = new TemporalStore();
  memory.ingestMetrics(history(), INGESTED_AT);
  const memorySnapshots = storeSnapshots(memory);

  // Engine 2: SQLite production adapter (temp dir).
  const dir = mkdtempSync(join(tmpdir(), 'marketing-p5-export-'));
  const sqlite = SqliteTemporalStore.open(join(dir, 'marketing.db'), () => AFTER_ALL);
  sqlite.ingestMetrics(history(), INGESTED_AT);
  const sqliteSnapshots = storeSnapshots(sqlite);
  sqlite.close();

  // AT-P5.1 gates: cross-engine parity and no-interpolation semantics.
  let parity = true;
  for (let i = 0; i < memorySnapshots.length; i += 1) {
    if (memorySnapshots[i]!.raw !== sqliteSnapshots[i]!.raw) parity = false;
  }
  const betweenRow = memorySnapshots.find((r) => r.asOfLabel === 'between_observations')!;
  const firstRow = memorySnapshots.find((r) => r.asOfLabel === 'first_observation')!;
  const beforeRow = memorySnapshots.find((r) => r.asOfLabel === 'before_coverage')!;
  const afterRow = memorySnapshots.find((r) => r.asOfLabel === 'after_all')!;
  if (betweenRow.values.join(',') !== firstRow.values.join(',')) {
    throw new Error('GATE FAILED: as-of between observations must reproduce the earlier snapshot (no interpolation)');
  }
  if (beforeRow.values.length !== 0) {
    throw new Error('GATE FAILED: pre-coverage as-of query must return the explicit empty series');
  }
  if (afterRow.values.join(',') !== '1000,1500,2200') {
    throw new Error('GATE FAILED: post-coverage as-of query must return the full ingested series');
  }
  if (!parity) {
    throw new Error('GATE FAILED: in-memory and SQLite as-of snapshots diverge');
  }
  console.log('  ✔ AT-P5.1 as-of snapshots reproducible: 6 as-of times × 2 engines, byte-identical cross-engine');
  console.log('  ✔ AT-P5.1 between-observations as-of (2026-01-08) reproduces the 2026-01-05 snapshot — no interpolation');
  console.log('  ✔ AT-P5.2 pre-coverage as-of (2026-01-02) returns the explicit empty series');

  // Workflow-level signal evaluations at each as-of time (noObservation contract field).
  const missionAt = (now: string, store: TemporalStore) =>
    new MarketingMission(brief, new SampleConnector(), new CapabilityCatalog(new HeuristicModel()), () => now, store);
  const signals = AS_OF_TIMES.flatMap(({ label, at }) => {
    const store = new TemporalStore();
    store.ingestMetrics(history(), INGESTED_AT);
    return [SUBJECT, NEVER_OBSERVED].map((subjectRef) => {
      const [signal] = missionAt(at, store).performanceSignals([subjectRef]);
      return {
        asOf: at,
        asOfLabel: label,
        subjectRef,
        total: signal?.total,
        velocity: signal?.velocity,
        noObservation: signal?.noObservation,
      } satisfies SignalRow;
    });
  });
  const beforeCoverageSignal = signals.find((s) => s.subjectRef === SUBJECT && s.asOfLabel === 'before_coverage')!;
  const neverObservedSignal = signals.find((s) => s.subjectRef === NEVER_OBSERVED && s.asOfLabel === 'after_all')!;
  if (beforeCoverageSignal.noObservation?.reason !== 'before_coverage') {
    throw new Error('GATE FAILED: pre-coverage signal must carry noObservation reason before_coverage');
  }
  if (neverObservedSignal.noObservation?.reason !== 'not_observed') {
    throw new Error('GATE FAILED: never-observed subject must carry noObservation reason not_observed');
  }
  if (beforeCoverageSignal.total !== undefined || neverObservedSignal.total !== undefined) {
    throw new Error('GATE FAILED: a no-observation signal must not carry values');
  }
  const afterAllSignal = signals.find((s) => s.subjectRef === SUBJECT && s.asOfLabel === 'after_all')!;
  if (afterAllSignal.total !== 2200 || afterAllSignal.velocity !== 600 || afterAllSignal.noObservation !== undefined) {
    throw new Error('GATE FAILED: post-coverage signal must carry values (total 2200, velocity 600) and never noObservation');
  }
  console.log('  ✔ AT-P5.2 workflow level: before_coverage / not_observed reasons carried; valued signals never carry the field');
  console.log('  ✔ post-coverage signal: total 2200, velocity 600, no noObservation field');

  const payload = {
    kind: 'WO-P5 as-of snapshot export',
    generatedAt: new Date().toISOString(),
    dataProvenance: 'synthetic fixtures only (fixture:p5 source ids, 2026-01 fixture timestamps) — proves temporal semantics, not market facts',
    fixtureHistory: { subjectRef: SUBJECT, metricKey: METRIC, observations: history().map((m) => ({ id: m.id, value: m.value, observedAt: m.observedAt })) },
    engines: {
      inMemory: memorySnapshots.map(({ asOf, asOfLabel, values }) => ({ asOf, asOfLabel, values })),
      sqlite: sqliteSnapshots.map(({ asOf, asOfLabel, values }) => ({ asOf, asOfLabel, values })),
      crossEngineByteIdentical: parity,
    },
    workflowSignals: signals,
  };

  const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../../..');
  const outDir = join(repoRoot, 'docs/marketing/evidence-artifacts/p5-snapshots');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'as-of-snapshots.json'), `${JSON.stringify(payload, null, 2)}\n`);

  const lines = [
    'WO-P5 wave-2 — exported as-of snapshots (gate-P5 closure evidence)',
    `generated: ${payload.generatedAt}`,
    'data: synthetic fixtures only (fixture:p5, 2026-01 timestamps) — temporal semantics evidence, not market facts',
    '',
    'Fixture history (subject yt-fixture-201, metric views):',
    ...payload.fixtureHistory.observations.map((o) => `  ${o.observedAt}  value=${o.value}  (${o.id})`),
    '',
    'As-of snapshots — in-memory TemporalStore and SQLite adapter (byte-identical cross-engine):',
    ...memorySnapshots.map(
      (r) => `  as-of ${r.asOf} [${r.asOfLabel}]  values=[${r.values.join(', ')}]  (sqlite identical: ${sqliteSnapshots.find((s) => s.asOf === r.asOf)!.values.join(',') === r.values.join(',')})`,
    ),
    '',
    'Workflow-level signal evaluations (noObservation contract field):',
    ...signals.map(
      (s) =>
        `  as-of ${s.asOf} [${s.asOfLabel}]  ${s.subjectRef}  ` +
        (s.noObservation
          ? `noObservation: reason=${s.noObservation.reason} — ${s.noObservation.detail}`
          : `total=${s.total} velocity=${s.velocity}`),
    ),
    '',
    'Gates: AT-P5.1 reproducibility (cross-engine, between-observations no-interpolation) PASS; AT-P5.2 explicit absence (before_coverage / not_observed) PASS.',
  ];
  writeFileSync(join(outDir, 'as-of-snapshots.txt'), `${lines.join('\n')}\n`);
  rmSync(dir, { recursive: true, force: true });
  console.log(`\nwritten: ${join(outDir, 'as-of-snapshots.json')}`);
  console.log(`written: ${join(outDir, 'as-of-snapshots.txt')}`);
};

run();
