/**
 * SQLite temporal store — the production persistence adapter for the W2 data
 * plane, implementing TemporalStorePort exactly like the in-memory store.
 *
 * Governance: docs/marketing/MARKETING-DATA-MODEL.md (temporal semantics),
 * MARKETING-ARCHITECTURE-LOCK.md (marketing mirrors the repo's storage layering
 * and migration rules). Migrations mirror packages/shared/src/sqlite-migrations
 * conventions — immutable versioned SQL, checksum computed over the trimmed
 * SQL, append-only applied history, never re-run — but stay self-contained
 * because the marketing module is registered with `requires: []` in
 * architecture-policy.yaml (it must not import packages/shared).
 *
 * Semantics parity with `app/temporalStore.ts` (the port is the contract):
 *  - ingest by source identity is idempotent (entities + observations);
 *  - the same observation key with the same value is a duplicate;
 *  - the same observation key with a changed value is an explicit revision:
 *    the active row is replaced AND the old value is preserved in the
 *    append-only `marketing_metric_revision` table (history is never silently
 *    rewritten);
 *  - as-of queries filter the active series by observed_at (exactly like the
 *    in-memory implementation);
 *  - velocity is computed from the same as-of series.
 *
 * Layer: adapters (the only place file I/O lives, per the CLI's external-I/O
 * convergence rules).
 */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  adCreative,
  coverageReport,
  type AdCreative,
  type CoverageReport,
  type MetricObservation,
  type OrganicContent,
  metricObservation,
  organicContent,
} from '../domain/records.js';
import type { IngestResult, TemporalStorePort } from '../app/temporalStore.js';

/** Immutable versioned migration — mirrors the shared runner's shape. */
interface MarketingMigration {
  id: string;
  /** Every SQL statement this migration writes must declare its tables here. */
  touchedTables: string[];
  sql: string;
}

const MIGRATIONS: MarketingMigration[] = [
  {
    id: '0001-initial',
    touchedTables: [
      'marketing_entity',
      'marketing_metric_observation',
      'marketing_metric_revision',
      'marketing_coverage',
      'marketing_ingest_audit',
    ],
    sql: `
      CREATE TABLE IF NOT EXISTS marketing_entity (
        kind TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_record_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        PRIMARY KEY (kind, source_id, source_record_id)
      );
      CREATE TABLE IF NOT EXISTS marketing_metric_observation (
        id TEXT NOT NULL,
        mission_id TEXT NOT NULL,
        metric_key TEXT NOT NULL,
        subject_ref TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        value REAL NOT NULL,
        source_id TEXT NOT NULL,
        source_record_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        PRIMARY KEY (source_id, source_record_id, metric_key, observed_at)
      );
      CREATE INDEX IF NOT EXISTS marketing_metric_asof
        ON marketing_metric_observation (metric_key, subject_ref, observed_at);
      CREATE TABLE IF NOT EXISTS marketing_metric_revision (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        revision_key TEXT NOT NULL,
        old_value REAL NOT NULL,
        new_value REAL NOT NULL,
        revised_at TEXT NOT NULL,
        old_record_json TEXT NOT NULL,
        new_record_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS marketing_coverage (
        id TEXT PRIMARY KEY,
        generated_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS marketing_ingest_audit (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        key TEXT NOT NULL,
        outcome TEXT NOT NULL
      );
    `,
  },
];

const APP_VERSION = 'zcode-marketing/0.1.0';
const checksumOf = (sql: string): string => createHash('sha256').update(sql.trim()).digest('hex');

export class SqliteTemporalStore implements TemporalStorePort {
  private constructor(private readonly db: DatabaseSync) {}

  /** Opens (creating if needed) a marketing temporal store and applies migrations. */
  static open(path: string, now: () => string = () => new Date().toISOString()): SqliteTemporalStore {
    const db = new DatabaseSync(path);
    db.exec('pragma busy_timeout = 5000');
    db.exec('pragma journal_mode = wal');
    const store = new SqliteTemporalStore(db);
    store.applyMigrations(now);
    return store;
  }

  close(): void {
    this.db.close();
  }

  ingestAds(ads: AdCreative[], now: string): IngestResult {
    return this.ingestEntities('AdCreative', ads, now);
  }

  ingestOrganic(items: OrganicContent[], now: string): IngestResult {
    return this.ingestEntities('OrganicContent', items, now);
  }

  ingestMetrics(observations: MetricObservation[], now: string): IngestResult {
    let accepted = 0;
    let dupes = 0;
    this.db.exec('begin');
    try {
      for (const obs of observations) {
        const key = `${obs.source.sourceId}/${obs.source.sourceRecordId}#${obs.metricKey}@${obs.observedAt}`;
        const existing = this.db
          .prepare(
            'SELECT record_json FROM marketing_metric_observation WHERE source_id = ? AND source_record_id = ? AND metric_key = ? AND observed_at = ?',
          )
          .get(obs.source.sourceId, obs.source.sourceRecordId, obs.metricKey, obs.observedAt) as
          | { record_json: string }
          | undefined;
        if (existing) {
          const current = (JSON.parse(existing.record_json) as MetricObservation).value;
          if (current === obs.value) {
            this.audit(now, key, 'duplicate');
            dupes += 1;
            continue;
          }
          // Changed value at the same observation key: an explicit revision.
          // History is preserved in the append-only revision table, and the
          // active series is updated in place (port parity with in-memory).
          this.db
            .prepare(
              'INSERT INTO marketing_metric_revision (revision_key, old_value, new_value, revised_at, old_record_json, new_record_json) VALUES (?, ?, ?, ?, ?, ?)',
            )
            .run(key, current, obs.value, now, existing.record_json, JSON.stringify(obs));
          this.db
            .prepare(
              'UPDATE marketing_metric_observation SET id = ?, mission_id = ?, subject_ref = ?, value = ?, record_json = ? WHERE source_id = ? AND source_record_id = ? AND metric_key = ? AND observed_at = ?',
            )
            .run(obs.id, obs.missionId, obs.subjectRef, obs.value, JSON.stringify(obs), obs.source.sourceId, obs.source.sourceRecordId, obs.metricKey, obs.observedAt);
          this.audit(now, key, 'superseded');
          continue;
        }
        this.db
          .prepare(
            'INSERT INTO marketing_metric_observation (id, mission_id, metric_key, subject_ref, observed_at, value, source_id, source_record_id, record_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(obs.id, obs.missionId, obs.metricKey, obs.subjectRef, obs.observedAt, obs.value, obs.source.sourceId, obs.source.sourceRecordId, JSON.stringify(obs));
        this.audit(now, key, 'new');
        accepted += 1;
      }
      this.db.exec('commit');
    } catch (err) {
      this.db.exec('rollback');
      throw err;
    }
    return { acceptedEntities: 0, acceptedMetrics: accepted, duplicatesIgnored: dupes };
  }

  recordCoverage(report: CoverageReport): void {
    this.db
      .prepare('INSERT INTO marketing_coverage (id, generated_at, record_json) VALUES (?, ?, ?)')
      .run(report.id, report.generatedAt, JSON.stringify(report));
  }

  metricsAsOf(metricKey: string, subjectRef: string, at: string): MetricObservation[] {
    const rows = this.db
      .prepare(
        'SELECT record_json FROM marketing_metric_observation WHERE metric_key = ? AND subject_ref = ? AND observed_at <= ? ORDER BY observed_at',
      )
      .all(metricKey, subjectRef, at) as Array<{ record_json: string }>;
    return rows.map((r) => JSON.parse(r.record_json) as MetricObservation);
  }

  latestObservation(metricKey: string, subjectRef: string, at: string): MetricObservation | undefined {
    return this.metricsAsOf(metricKey, subjectRef, at).at(-1);
  }

  velocity(metricKey: string, subjectRef: string, at: string, windowDays: number): number | undefined {
    const series = this.metricsAsOf(metricKey, subjectRef, at);
    if (series.length < 2) return undefined;
    const first = series[0]!;
    const last = series.at(-1)!;
    const spanMs = new Date(last.observedAt).getTime() - new Date(first.observedAt).getTime();
    if (spanMs <= 0) return undefined;
    const perDay = (last.value - first.value) / (spanMs / 86_400_000);
    return perDay * windowDays;
  }

  allAds(): AdCreative[] {
    return this.rows('AdCreative').map((r) => adCreative.parse(JSON.parse(r)));
  }

  allOrganic(): OrganicContent[] {
    return this.rows('OrganicContent').map((r) => organicContent.parse(JSON.parse(r)));
  }

  allMetrics(): MetricObservation[] {
    const rows = this.db
      .prepare('SELECT record_json FROM marketing_metric_observation ORDER BY observed_at')
      .all() as Array<{ record_json: string }>;
    return rows.map((r) => metricObservation.parse(JSON.parse(r.record_json)));
  }

  latestCoverage(): CoverageReport | undefined {
    const row = this.db
      .prepare('SELECT record_json FROM marketing_coverage ORDER BY generated_at DESC LIMIT 1')
      .get() as { record_json: string } | undefined;
    return row ? (coverageReport.parse(JSON.parse(row.record_json)) as CoverageReport) : undefined;
  }

  ingestAudit(): ReadonlyArray<{ at: string; key: string; outcome: 'new' | 'duplicate' | 'superseded' }> {
    const rows = this.db
      .prepare('SELECT at, key, outcome FROM marketing_ingest_audit ORDER BY seq')
      .all() as Array<{ at: string; key: string; outcome: string }>;
    return rows.map((r) => ({ at: r.at, key: r.key, outcome: r.outcome as 'new' | 'duplicate' | 'superseded' }));
  }

  /** Append-only supersede history (explicit revisions, never silent rewrites). */
  revisions(): ReadonlyArray<{
    seq: number;
    revisionKey: string;
    oldValue: number;
    newValue: number;
    revisedAt: string;
  }> {
    const rows = this.db
      .prepare('SELECT seq, revision_key, old_value, new_value, revised_at FROM marketing_metric_revision ORDER BY seq')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      seq: r['seq'] as number,
      revisionKey: r['revision_key'] as string,
      oldValue: r['old_value'] as number,
      newValue: r['new_value'] as number,
      revisedAt: r['revised_at'] as string,
    }));
  }

  private rows(kind: 'AdCreative' | 'OrganicContent'): string[] {
    return (
      this.db
        .prepare('SELECT record_json FROM marketing_entity WHERE kind = ?')
        .all(kind) as Array<{ record_json: string }>
    ).map((r) => r.record_json);
  }

  private ingestEntities<T extends { source: { sourceId: string; sourceRecordId: string } }>(
    kind: 'AdCreative' | 'OrganicContent',
    items: T[],
    now: string,
  ): IngestResult {
    let accepted = 0;
    let dupes = 0;
    this.db.exec('begin');
    try {
      for (const item of items) {
        const key = `${item.source.sourceId}/${item.source.sourceRecordId}`;
        const res = this.db
          .prepare(
            'INSERT INTO marketing_entity (kind, source_id, source_record_id, record_json) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
          )
          .run(kind, item.source.sourceId, item.source.sourceRecordId, JSON.stringify(item));
        if (res.changes === 0) {
          this.audit(now, key, 'duplicate');
          dupes += 1;
        } else {
          this.audit(now, key, 'new');
          accepted += 1;
        }
      }
      this.db.exec('commit');
    } catch (err) {
      this.db.exec('rollback');
      throw err;
    }
    return { acceptedEntities: accepted, acceptedMetrics: 0, duplicatesIgnored: dupes };
  }

  private audit(at: string, key: string, outcome: 'new' | 'duplicate' | 'superseded'): void {
    this.db
      .prepare('INSERT INTO marketing_ingest_audit (at, key, outcome) VALUES (?, ?, ?)')
      .run(at, key, outcome);
  }

  /**
   * Migration admission mirrors the shared runner's discipline: applied IDs are
   * immutable (checksum mismatch is an error), history is never re-run, and
   * every migration declares its touched tables before any SQL executes.
   */
  private applyMigrations(now: () => string): void {
    this.db.exec('begin immediate');
    try {
      this.db.exec(`CREATE TABLE IF NOT EXISTS marketing_schema_migration (
        id TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        app_version TEXT NOT NULL
      )`);
      const applied = new Map(
        (
          this.db
            .prepare('SELECT id, checksum FROM marketing_schema_migration')
            .all() as Array<{ id: string; checksum: string }>
        ).map((r) => [r.id, r.checksum]),
      );
      for (const m of MIGRATIONS) {
        const checksum = checksumOf(m.sql);
        const done = applied.get(m.id);
        if (done !== undefined) {
          if (done !== checksum) {
            throw new Error(`migration ${m.id} checksum mismatch — applied history is immutable`);
          }
          continue;
        }
        this.db.exec(m.sql);
        this.db
          .prepare('INSERT INTO marketing_schema_migration (id, checksum, applied_at, app_version) VALUES (?, ?, ?, ?)')
          .run(m.id, checksum, now(), APP_VERSION);
      }
      this.db.exec('commit');
    } catch (err) {
      this.db.exec('rollback');
      throw err;
    }
  }
}
