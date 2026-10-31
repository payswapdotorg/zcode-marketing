/**
 * WO-P5 fixture tests — historical intelligence integrity (research lane).
 *
 * All data is synthetic and labeled as such (2026-01 fixture timestamps,
 * `fixture:` source ids): it exists to prove temporal semantics, not to claim
 * market facts. Zero network; the SQLite adapter runs against a temp-dir
 * database only.
 *
 * Coverage (work-order acceptance tests):
 *  - AT-P5.1 as-of reproducibility: identical ingestion history → identical
 *    as-of snapshots, including an as-of time BETWEEN observations (no
 *    interpolation), across two in-memory stores and across the two engines.
 *  - AT-P5.2 explicit absence: pre-coverage as-of queries are distinguishable
 *    from never-observed subjects at the store level, and carry the pinned
 *    noObservation contract field at the workflow level; post-coverage
 *    queries return values and valued signals never carry noObservation.
 *  - AT-P5.3 record-type separation: recordType/reportedAt present, parsed,
 *    and filterable; records shaped before the fields existed parse unchanged
 *    with the schema default.
 *  - AT-P5.5 anti-fabrication floor: a record whose observedAt precedes the
 *    series floor is rejected loudly and audited, the series is unchanged,
 *    and the honest earliest record re-ingests as an ordinary duplicate.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CapabilityCatalog,
  HeuristicModel,
  MarketingMission,
  metricObservation,
  productBrief,
  SampleConnector,
  SqliteTemporalStore,
  TemporalStore,
} from '../src/index.js';
import type { MetricObservation } from '../src/index.js';

// ---- Synthetic fixture timeline (internally consistent, clearly synthetic) ----
const T1 = '2026-01-05T10:00:00.000Z'; // series' first observation
const T2 = '2026-01-12T10:00:00.000Z';
const T3 = '2026-01-19T10:00:00.000Z';
const BETWEEN = '2026-01-08T10:00:00.000Z'; // between T1 and T2 — no observation exists here
const BEFORE_COVERAGE = '2026-01-02T10:00:00.000Z'; // precedes the series' first observation
const AFTER_ALL = '2026-01-25T10:00:00.000Z';
const INGESTED_AT = '2026-01-20T10:00:00.000Z'; // wall-clock when the fixture history was ingested

const SUBJECT = 'yt-fixture-201';
const METRIC = 'views';

/** Builds a fixture observation through the schema (the honest record path). */
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

/** The canonical three-point history (fresh objects per call, like fresh fetches). */
const history = (): MetricObservation[] => [
  obs({ id: 'p5-a', observedAt: T1, value: 1000 }),
  obs({ id: 'p5-b', observedAt: T2, value: 1500 }),
  obs({ id: 'p5-c', observedAt: T3, value: 2200 }),
];

const snapshot = (store: { metricsAsOf(k: string, s: string, at: string): MetricObservation[] }, at: string): string =>
  JSON.stringify(store.metricsAsOf(METRIC, SUBJECT, at));

const AS_OF_TIMES = [BEFORE_COVERAGE, T1, BETWEEN, T2, T3, AFTER_ALL];

/** Runs the body with a temp-dir SQLite store (cleaned up afterwards). */
const withSqlite = (body: (open: () => SqliteTemporalStore) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'marketing-wo-p5-'));
  const dbPath = join(dir, 'marketing.db');
  try {
    body(() => SqliteTemporalStore.open(dbPath, () => AFTER_ALL));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe('WO-P5 historical integrity — as-of reproducibility (AT-P5.1)', () => {
  it('two in-memory stores with identical ingestion history produce identical as-of snapshots', () => {
    const storeA = new TemporalStore();
    const storeB = new TemporalStore();
    expect(storeA.ingestMetrics(history(), INGESTED_AT).acceptedMetrics).toBe(3);
    expect(storeB.ingestMetrics(history(), INGESTED_AT).acceptedMetrics).toBe(3);
    for (const at of AS_OF_TIMES) {
      expect(snapshot(storeA, at)).toBe(snapshot(storeB, at));
    }
  });

  it('an as-of time between observations reproduces the earlier snapshot exactly — never an interpolated value', () => {
    const store = new TemporalStore();
    store.ingestMetrics(history(), INGESTED_AT);
    const atT1 = store.metricsAsOf(METRIC, SUBJECT, T1);
    const between = store.metricsAsOf(METRIC, SUBJECT, BETWEEN);
    expect(between).toHaveLength(1);
    expect(JSON.stringify(between)).toBe(JSON.stringify(atT1));
    expect(between[0]?.value).toBe(1000); // the T1 value, not something invented for 2026-01-08
  });

  it('the in-memory store and the SQLite adapter produce identical as-of snapshots from the same history', () => {
    const memory = new TemporalStore();
    memory.ingestMetrics(history(), INGESTED_AT);
    withSqlite((open) => {
      const sqlite = open();
      expect(sqlite.ingestMetrics(history(), INGESTED_AT).acceptedMetrics).toBe(3);
      for (const at of AS_OF_TIMES) {
        expect(snapshot(sqlite, at)).toBe(snapshot(memory, at));
      }
      sqlite.close();
    });
  });
});

describe('WO-P5 historical integrity — explicit absence (AT-P5.2)', () => {
  it('store level: a pre-coverage as-of query is distinguishable from a never-observed subject', () => {
    const store = new TemporalStore();
    store.ingestMetrics(history(), INGESTED_AT);
    // Pre-coverage: empty as-of series, but the series exists and starts at T1.
    expect(store.metricsAsOf(METRIC, SUBJECT, BEFORE_COVERAGE)).toEqual([]);
    expect(store.firstObservation(METRIC, SUBJECT)?.observedAt).toBe(T1);
    // Never observed: empty as-of series AND no first observation at all.
    expect(store.metricsAsOf(METRIC, 'yt-fixture-404', AFTER_ALL)).toEqual([]);
    expect(store.firstObservation(METRIC, 'yt-fixture-404')).toBeUndefined();
    // Post-coverage: values are returned.
    expect(store.metricsAsOf(METRIC, SUBJECT, T2).map((m) => m.value)).toEqual([1000, 1500]);
  });

  it('SQLite adapter: same pre-coverage distinction as the in-memory store', () => {
    withSqlite((open) => {
      const sqlite = open();
      sqlite.ingestMetrics(history(), INGESTED_AT);
      expect(sqlite.metricsAsOf(METRIC, SUBJECT, BEFORE_COVERAGE)).toEqual([]);
      expect(sqlite.firstObservation(METRIC, SUBJECT)?.observedAt).toBe(T1);
      expect(sqlite.firstObservation(METRIC, 'yt-fixture-404')).toBeUndefined();
      sqlite.close();
    });
  });

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
  const missionAt = (now: string, store: TemporalStore) =>
    new MarketingMission(brief, new SampleConnector(), new CapabilityCatalog(new HeuristicModel()), () => now, store);

  it('workflow level: a pre-coverage evaluation carries the noObservation contract field with reason before_coverage', () => {
    const store = new TemporalStore();
    store.ingestMetrics(history(), INGESTED_AT);
    const [signal] = missionAt(BEFORE_COVERAGE, store).performanceSignals([SUBJECT]);
    expect(signal).toBeDefined();
    expect(signal?.velocity).toBeUndefined();
    expect(signal?.total).toBeUndefined();
    expect(signal?.noObservation).toEqual({
      reason: 'before_coverage',
      detail: `first observation of this entity is ${T1} — the window begins after it`,
    });
  });

  it('workflow level: a subject never observed carries reason not_observed', () => {
    const store = new TemporalStore();
    store.ingestMetrics(history(), INGESTED_AT);
    const [signal] = missionAt(AFTER_ALL, store).performanceSignals(['yt-fixture-404']);
    expect(signal?.noObservation?.reason).toBe('not_observed');
    expect(signal?.noObservation?.detail).toContain('views');
    expect(signal?.noObservation?.detail).toContain('yt-fixture-404');
  });

  it('workflow level: post-coverage signals carry values and never carry noObservation', () => {
    const store = new TemporalStore();
    store.ingestMetrics(history(), INGESTED_AT);
    const [signal] = missionAt(AFTER_ALL, store).performanceSignals([SUBJECT]);
    // (2200 - 1000) over the 14-day T1→T3 span, scaled to the 7-day window.
    expect(signal?.total).toBe(2200);
    expect(signal?.velocity).toBe(600);
    expect(signal?.noObservation).toBeUndefined();
  });

  it('workflow level: a single observation still yields a valued total (velocity absent, noObservation absent)', () => {
    const store = new TemporalStore();
    store.ingestMetrics([obs({ id: 'p5-single', observedAt: T2, value: 1500 })], INGESTED_AT);
    const [signal] = missionAt(AFTER_ALL, store).performanceSignals([SUBJECT]);
    expect(signal?.total).toBe(1500);
    expect(signal?.velocity).toBeUndefined(); // one snapshot cannot define a window
    expect(signal?.noObservation).toBeUndefined(); // a signal with a value never carries noObservation
  });
});

describe('WO-P5 historical integrity — record-type separation (AT-P5.3)', () => {
  it('old-shaped records (no recordType/reportedAt) parse unchanged and default to first_party_observation', () => {
    const parsed = metricObservation.parse({
      kind: 'MetricObservation',
      id: 'p5-old',
      missionId: 'mission-fixture-p5',
      subjectRef: SUBJECT,
      metricKey: METRIC,
      value: 1000,
      observedAt: T1,
      source: { sourceId: 'fixture:p5', sourceRecordId: SUBJECT, connectorVersion: '0.1.0' },
      metricDefinition: 'fixture-public-stat',
      metricDefinitionVersion: 'v1',
    });
    expect(parsed.recordType).toBe('first_party_observation');
    expect(parsed.reportedAt).toBeUndefined();
    expect(parsed.value).toBe(1000);
    expect(parsed.observedAt).toBe(T1);
    expect(parsed.source).toEqual({ sourceId: 'fixture:p5', sourceRecordId: SUBJECT, connectorVersion: '0.1.0' });
  });

  it('new-shaped records carry recordType and a reportedAt distinct from observedAt', () => {
    const parsed = obs({
      id: 'p5-reported',
      observedAt: T2,
      value: 1500,
      reportedAt: T1, // platform says the value was current for the T1 period
      recordType: 'source_reported',
    });
    expect(parsed.recordType).toBe('source_reported');
    expect(parsed.reportedAt).toBe(T1);
    expect(parsed.observedAt).toBe(T2);
  });

  const mixedHistory = (): MetricObservation[] => [
    obs({ id: 'p5-fp', observedAt: T1, value: 1000, recordType: 'first_party_observation' }),
    obs({ id: 'p5-sr', observedAt: T2, value: 1500, recordType: 'source_reported', reportedAt: T1 }),
    obs({ id: 'p5-est', observedAt: T3, value: 2200, recordType: 'estimate' }),
  ];

  it('metricsAsOf/latestObservation filter on record type; absent options return the whole series', () => {
    const store = new TemporalStore();
    store.ingestMetrics(mixedHistory(), INGESTED_AT);
    // Unfiltered — existing callers see every record.
    expect(store.metricsAsOf(METRIC, SUBJECT, AFTER_ALL).map((m) => m.id)).toEqual(['p5-fp', 'p5-sr', 'p5-est']);
    // Single-type filter.
    expect(store.metricsAsOf(METRIC, SUBJECT, AFTER_ALL, { recordTypes: ['source_reported'] }).map((m) => m.id)).toEqual(['p5-sr']);
    expect(store.latestObservation(METRIC, SUBJECT, AFTER_ALL, { recordTypes: ['source_reported'] })?.id).toBe('p5-sr');
    // Multi-type filter.
    expect(
      store.metricsAsOf(METRIC, SUBJECT, AFTER_ALL, { recordTypes: ['first_party_observation', 'estimate'] }).map((m) => m.id),
    ).toEqual(['p5-fp', 'p5-est']);
    // The filter composes with the as-of bound (estimate only exists at T3).
    expect(store.metricsAsOf(METRIC, SUBJECT, BETWEEN, { recordTypes: ['estimate'] })).toEqual([]);
  });

  it('a legacy-shaped record (persisted before WO-P5, no recordType key) defaults into the first_party filter', () => {
    const store = new TemporalStore();
    // Simulates a record recorded before the field existed — it bypassed the
    // schema on its way in, exactly like rows persisted by older store builds.
    const legacy = {
      kind: 'MetricObservation',
      id: 'p5-legacy',
      missionId: 'mission-fixture-p5',
      subjectRef: SUBJECT,
      metricKey: METRIC,
      value: 900,
      observedAt: T1,
      source: { sourceId: 'fixture:p5', sourceRecordId: SUBJECT, connectorVersion: '0.1.0' },
      metricDefinition: 'fixture-public-stat',
      metricDefinitionVersion: 'v1',
    } as unknown as MetricObservation;
    store.ingestMetrics([legacy, ...mixedHistory().slice(1)], INGESTED_AT);
    const firstParty = store.metricsAsOf(METRIC, SUBJECT, AFTER_ALL, { recordTypes: ['first_party_observation'] });
    expect(firstParty.map((m) => m.id)).toEqual(['p5-legacy']);
  });

  it('SQLite adapter: same parse, default, and filter semantics', () => {
    withSqlite((open) => {
      const sqlite = open();
      sqlite.ingestMetrics(mixedHistory(), INGESTED_AT);
      expect(sqlite.metricsAsOf(METRIC, SUBJECT, AFTER_ALL, { recordTypes: ['source_reported'] }).map((m) => m.id)).toEqual([
        'p5-sr',
      ]);
      expect(sqlite.latestObservation(METRIC, SUBJECT, AFTER_ALL, { recordTypes: ['estimate'] })?.id).toBe('p5-est');
      expect(sqlite.metricsAsOf(METRIC, SUBJECT, AFTER_ALL).map((m) => m.id)).toEqual(['p5-fp', 'p5-sr', 'p5-est']);
      // Records read back satisfy the schema output (recordType defaulted on old rows).
      expect(sqlite.metricsAsOf(METRIC, SUBJECT, AFTER_ALL).every((m) => m.recordType)).toBe(true);
      sqlite.close();
    });
  });
});

describe('WO-P5 historical integrity — anti-fabrication floor (AT-P5.5)', () => {
  it('a later record with observedAt before the series floor is rejected, audited, and the series is unchanged', () => {
    const store = new TemporalStore();
    // Introducing batch fixes the floor at T2 (its minimum).
    expect(store.ingestMetrics([obs({ id: 'p5-b', observedAt: T2, value: 1500 }), obs({ id: 'p5-c', observedAt: T3, value: 2200 })], INGESTED_AT).acceptedMetrics).toBe(2);
    const before = JSON.stringify(store.metricsAsOf(METRIC, SUBJECT, AFTER_ALL));
    // A later ingest claims an observation at T1 — before the system started
    // observing this series. Fabrication: rejected loudly, never inserted.
    const result = store.ingestMetrics([obs({ id: 'p5-fake', observedAt: T1, value: 800 })], INGESTED_AT);
    expect(result.rejectedBeforeFloor).toBe(1);
    expect(result.acceptedMetrics).toBe(0);
    expect(result.duplicatesIgnored).toBe(0);
    expect(store.ingestAudit().some((e) => e.outcome === 'rejected_before_floor' && e.key.includes(`#${METRIC}@${T1}`))).toBe(true);
    expect(JSON.stringify(store.metricsAsOf(METRIC, SUBJECT, AFTER_ALL))).toBe(before); // series unchanged
    expect(store.firstObservation(METRIC, SUBJECT)?.observedAt).toBe(T2);
    expect(store.allMetrics()).toHaveLength(2);
  });

  it('re-offering the same rejected record is rejected again — never miscounted as a duplicate', () => {
    const store = new TemporalStore();
    store.ingestMetrics([obs({ id: 'p5-b', observedAt: T2, value: 1500 })], INGESTED_AT);
    store.ingestMetrics([obs({ id: 'p5-fake', observedAt: T1, value: 800 })], INGESTED_AT);
    const again = store.ingestMetrics([obs({ id: 'p5-fake', observedAt: T1, value: 800 })], INGESTED_AT);
    expect(again.rejectedBeforeFloor).toBe(1);
    expect(again.duplicatesIgnored).toBe(0);
    expect(store.ingestAudit().filter((e) => e.outcome === 'rejected_before_floor')).toHaveLength(2);
  });

  it('re-ingesting the honest earliest record is an ordinary duplicate, not a violation', () => {
    const store = new TemporalStore();
    store.ingestMetrics(history(), INGESTED_AT);
    const result = store.ingestMetrics(history(), INGESTED_AT);
    expect(result.rejectedBeforeFloor).toBe(0);
    expect(result.acceptedMetrics).toBe(0);
    expect(result.duplicatesIgnored).toBe(3);
    expect(store.allMetrics()).toHaveLength(3);
  });

  it('the introducing batch sets the floor to its own minimum, even when offered out of order', () => {
    const store = new TemporalStore();
    const result = store.ingestMetrics(
      [obs({ id: 'p5-c', observedAt: T3, value: 2200 }), obs({ id: 'p5-a', observedAt: T1, value: 1000 }), obs({ id: 'p5-b', observedAt: T2, value: 1500 })],
      INGESTED_AT,
    );
    expect(result.acceptedMetrics).toBe(3); // the whole introducing batch counts
    expect(result.rejectedBeforeFloor).toBe(0);
    expect(store.firstObservation(METRIC, SUBJECT)?.observedAt).toBe(T1); // floor = batch minimum
    // Anything earlier than the batch minimum is fabrication.
    const rejected = store.ingestMetrics([obs({ id: 'p5-fake', observedAt: BEFORE_COVERAGE, value: 500 })], INGESTED_AT);
    expect(rejected.rejectedBeforeFloor).toBe(1);
  });

  it('the floor is fixed by the FIRST batch — a later honest-looking earlier record is still rejected (pinned rule)', () => {
    const store = new TemporalStore();
    // The plan pins the floor as "the floor of the first batch that
    // introduced the series": a series introduced at T3 cannot later claim T2.
    store.ingestMetrics([obs({ id: 'p5-c', observedAt: T3, value: 2200 })], INGESTED_AT);
    const result = store.ingestMetrics([obs({ id: 'p5-b', observedAt: T2, value: 1500 })], INGESTED_AT);
    expect(result.rejectedBeforeFloor).toBe(1);
    expect(store.metricsAsOf(METRIC, SUBJECT, AFTER_ALL).map((m) => m.observedAt)).toEqual([T3]);
  });

  it('the floor is per (metricKey, subjectRef) — other series are unaffected', () => {
    const store = new TemporalStore();
    store.ingestMetrics(
      [
        obs({ id: 'p5-b', observedAt: T2, value: 1500 }),
        obs({ id: 'p5-other', observedAt: T2, value: 42, subjectRef: 'yt-fixture-202' }),
      ],
      INGESTED_AT,
    );
    // A pre-floor record for a DIFFERENT subject is a normal new observation.
    const result = store.ingestMetrics([obs({ id: 'p5-other-early', observedAt: T1, value: 30, subjectRef: 'yt-fixture-202' })], INGESTED_AT);
    expect(result.rejectedBeforeFloor).toBe(0);
    expect(result.acceptedMetrics).toBe(1);
    // The original series still rejects its own pre-floor record.
    expect(store.ingestMetrics([obs({ id: 'p5-fake', observedAt: T1, value: 800 })], INGESTED_AT).rejectedBeforeFloor).toBe(1);
  });

  it('SQLite adapter: same floor rule, audit, and persistence across close + reopen', () => {
    withSqlite((open) => {
      const sqlite = open();
      sqlite.ingestMetrics([obs({ id: 'p5-b', observedAt: T2, value: 1500 }), obs({ id: 'p5-c', observedAt: T3, value: 2200 })], INGESTED_AT);
      const rejected = sqlite.ingestMetrics([obs({ id: 'p5-fake', observedAt: T1, value: 800 })], INGESTED_AT);
      expect(rejected.rejectedBeforeFloor).toBe(1);
      expect(sqlite.ingestAudit().some((e) => e.outcome === 'rejected_before_floor')).toBe(true);
      expect(sqlite.metricsAsOf(METRIC, SUBJECT, AFTER_ALL).map((m) => m.observedAt)).toEqual([T2, T3]);
      // The honest earliest record re-ingests as an ordinary duplicate.
      expect(sqlite.ingestMetrics([obs({ id: 'p5-b', observedAt: T2, value: 1500 })], INGESTED_AT).duplicatesIgnored).toBe(1);
      sqlite.close();

      // The floor survives persistence: derived from the recorded data, so a
      // reopened store still refuses the fabricated earlier record.
      const reopened = open();
      const afterReopen = reopened.ingestMetrics([obs({ id: 'p5-fake2', observedAt: T1, value: 700 })], INGESTED_AT);
      expect(afterReopen.rejectedBeforeFloor).toBe(1);
      expect(reopened.metricsAsOf(METRIC, SUBJECT, AFTER_ALL).map((m) => m.observedAt)).toEqual([T2, T3]);
      reopened.close();
    });
  });
});
