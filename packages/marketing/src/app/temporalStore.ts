/**
 * Temporal data plane — the "time machine" (W2).
 *
 * Governance: docs/marketing/MARKETING-DATA-MODEL.md. Exit gate: ingesting the
 * same evidence twice is safe, metric changes are recorded as new observations,
 * and an as-of query reproduces the observations actually available at that
 * time. History is never silently rewritten.
 *
 * Layer: app. `TemporalStore` is the in-memory implementation; the SQLite
 * persistence adapter (production wiring, `adapters/sqliteStore.ts`) implements
 * the same `TemporalStorePort` — domain and workflows never know the
 * difference. Superseded values are recorded as explicit revisions in the
 * adapter's append-only revision table; the active series semantics below are
 * identical across implementations.
 */
import type {
  AdCreative,
  CoverageReport,
  MetricObservation,
  MetricRecordType,
  OrganicContent,
  SourceIdentity,
} from '../domain/records.js';

const sourceKey = (s: SourceIdentity): string => `${s.sourceId}/${s.sourceRecordId}`;

/**
 * WO-P5 (AT-P5.3): as-of queries can filter the series by record type.
 * Absent options return every record — existing callers unchanged.
 */
export interface AsOfQueryOptions {
  /** Restrict the series to these record types (see metricRecordType). */
  recordTypes?: MetricRecordType[];
}

/** Ingest audit outcome — the append-only record of what ingestion did. */
export type IngestAuditOutcome = 'new' | 'duplicate' | 'superseded' | 'rejected_before_floor';

export interface IngestResult {
  acceptedEntities: number;
  acceptedMetrics: number;
  duplicatesIgnored: number;
  /**
   * WO-P5 (AT-P5.5): observations rejected by the anti-fabrication floor —
   * their observedAt precedes the earliest observation ever ingested for the
   * (metricKey, subjectRef) series. Rejections are also audited per record
   * ('rejected_before_floor'); never silently accepted, never inserted.
   */
  rejectedBeforeFloor?: number;
}

/**
 * The port every temporal store implementation satisfies (in-memory and
 * SQLite persistence alike). MarketingMission depends on this interface only.
 */
export interface TemporalStorePort {
  ingestAds(ads: AdCreative[], now: string): IngestResult;
  ingestOrganic(items: OrganicContent[], now: string): IngestResult;
  ingestMetrics(observations: MetricObservation[], now: string): IngestResult;
  recordCoverage(report: CoverageReport): void;
  /** As-of query: only observations actually available at `at` are returned. */
  metricsAsOf(metricKey: string, subjectRef: string, at: string, options?: AsOfQueryOptions): MetricObservation[];
  latestObservation(metricKey: string, subjectRef: string, at: string, options?: AsOfQueryOptions): MetricObservation | undefined;
  /**
   * WO-P5 (AT-P5.2): the series' first observation ever ingested (as-of
   * agnostic). Lets callers distinguish a pre-coverage as-of query (series
   * exists but starts after `at`) from a never-observed subject (no series)
   * instead of seeing both as an empty list.
   */
  firstObservation(metricKey: string, subjectRef: string): MetricObservation | undefined;
  /** Velocity over a comparable window (like-for-like discipline). */
  velocity(metricKey: string, subjectRef: string, at: string, windowDays: number): number | undefined;
  allAds(): AdCreative[];
  allOrganic(): OrganicContent[];
  /** Full observation read model for evidence/provenance viewers (W3-1 contract addition). */
  allMetrics(): MetricObservation[];
  latestCoverage(): CoverageReport | undefined;
  ingestAudit(): ReadonlyArray<{ at: string; key: string; outcome: IngestAuditOutcome }>;
}

export class TemporalStore implements TemporalStorePort {
  private readonly ads = new Map<string, AdCreative>();
  private readonly organic = new Map<string, OrganicContent>();
  /** metricKey -> subjectRef -> ascending-by-observedAt observation list. */
  private readonly metrics = new Map<string, Map<string, MetricObservation[]>>();
  private readonly coverageReports: CoverageReport[] = [];
  private readonly ingestLog: Array<{
    at: string;
    key: string;
    outcome: IngestAuditOutcome;
  }> = [];

  /** Idempotent ingest: same source identity + same observation window is a no-op. */
  ingestAds(ads: AdCreative[], now: string): IngestResult {
    return this.ingestEntities(ads, this.ads, now, (a) => sourceKey(a.source));
  }

  ingestOrganic(items: OrganicContent[], now: string): IngestResult {
    return this.ingestEntities(items, this.organic, now, (o) => sourceKey(o.source));
  }

  ingestMetrics(observations: MetricObservation[], now: string): IngestResult {
    let accepted = 0;
    let dupes = 0;
    let rejected = 0;
    // WO-P5 (AT-P5.5) anti-fabrication floor, per (metricKey, subjectRef)
    // series: the earliest observedAt ever ingested. Computed for the whole
    // batch before any record is processed, because the batch that introduces
    // a series sets its floor to the BATCH minimum (an unordered introducing
    // batch must not reject its own earlier records). For an existing series
    // the floor is the head of the ascending series — records are never
    // removed and observedAt never mutates, so that head IS the earliest
    // observation ever ingested.
    const floorFor = new Map<string, string>();
    for (const obs of observations) {
      const seriesKey = `${obs.metricKey} ${obs.subjectRef}`;
      if (floorFor.has(seriesKey)) continue;
      const series = this.metrics.get(obs.metricKey)?.get(obs.subjectRef);
      floorFor.set(
        seriesKey,
        series
          ? series[0]!.observedAt
          : observations
              .filter((o) => o.metricKey === obs.metricKey && o.subjectRef === obs.subjectRef)
              .reduce((min, o) => (o.observedAt < min ? o.observedAt : min), obs.observedAt),
      );
    }
    for (const obs of observations) {
      const key = `${obs.source.sourceId}/${obs.source.sourceRecordId}#${obs.metricKey}@${obs.observedAt}`;
      // The system did not observe before it started observing: a record
      // claiming an earlier observedAt than the series floor is fabrication.
      // Checked BEFORE the duplicate paths so a repeated violation attempt is
      // rejected again, never miscounted as an ordinary duplicate.
      const floor = floorFor.get(`${obs.metricKey} ${obs.subjectRef}`);
      if (floor !== undefined && obs.observedAt < floor) {
        this.ingestLog.push({ at: now, key, outcome: 'rejected_before_floor' });
        rejected += 1;
        continue;
      }
      const log = this.ingestLog.find((e) => e.key === key);
      if (log) {
        dupes += 1;
        continue;
      }
      const bySubject = this.metrics.get(obs.metricKey) ?? new Map<string, MetricObservation[]>();
      const series = bySubject.get(obs.subjectRef) ?? [];
      // Same value at same observedAt → duplicate (no metric inflation);
      // changed value at same observedAt → superseded revision, recorded.
      const existingIdx = series.findIndex((m) => m.observedAt === obs.observedAt);
      if (existingIdx >= 0) {
        if (series[existingIdx]!.value === obs.value) {
          this.ingestLog.push({ at: now, key, outcome: 'duplicate' });
          dupes += 1;
          continue;
        }
        this.ingestLog.push({ at: now, key, outcome: 'superseded' });
        series[existingIdx] = obs;
        continue;
      }
      series.push(obs);
      series.sort((a, b) => a.observedAt.localeCompare(b.observedAt));
      bySubject.set(obs.subjectRef, series);
      this.metrics.set(obs.metricKey, bySubject);
      this.ingestLog.push({ at: now, key, outcome: 'new' });
      accepted += 1;
    }
    return { acceptedEntities: 0, acceptedMetrics: accepted, duplicatesIgnored: dupes, rejectedBeforeFloor: rejected };
  }

  recordCoverage(report: CoverageReport): void {
    this.coverageReports.push(report);
    this.coverageReports.sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
  }

  /** As-of query: only observations actually available at `at` are returned. */
  metricsAsOf(metricKey: string, subjectRef: string, at: string, options?: AsOfQueryOptions): MetricObservation[] {
    const series = this.metrics.get(metricKey)?.get(subjectRef);
    if (!series) return [];
    const types = options?.recordTypes;
    return series.filter(
      (m) =>
        m.observedAt <= at &&
        // `??` applies the schema default to hand-built records that bypassed
        // zod (parsed records always carry the defaulted field).
        (!types || types.includes(m.recordType ?? 'first_party_observation')),
    );
  }

  latestObservation(metricKey: string, subjectRef: string, at: string, options?: AsOfQueryOptions): MetricObservation | undefined {
    const series = this.metricsAsOf(metricKey, subjectRef, at, options);
    return series.at(-1);
  }

  firstObservation(metricKey: string, subjectRef: string): MetricObservation | undefined {
    return this.metrics.get(metricKey)?.get(subjectRef)?.[0];
  }

  /**
   * Velocity over comparable windows — never rank a 2-day-old video's totals
   * against a 6-month-old one (MARKETING-DATA-MODEL.md measurement discipline).
   */
  velocity(
    metricKey: string,
    subjectRef: string,
    at: string,
    windowDays: number,
  ): number | undefined {
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
    return [...this.ads.values()];
  }

  allOrganic(): OrganicContent[] {
    return [...this.organic.values()];
  }

  allMetrics(): MetricObservation[] {
    return [...this.metrics.values()]
      .flatMap((bySubject) => [...bySubject.values()].flat())
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  }

  latestCoverage(): CoverageReport | undefined {
    return this.coverageReports.at(-1);
  }

  ingestAudit(): ReadonlyArray<{ at: string; key: string; outcome: IngestAuditOutcome }> {
    return this.ingestLog;
  }

  private ingestEntities<T extends { source: SourceIdentity }>(
    items: T[],
    table: Map<string, T>,
    now: string,
    keyOf: (item: T) => string,
  ): IngestResult {
    let accepted = 0;
    let dupes = 0;
    for (const item of items) {
      const key = keyOf(item);
      if (table.has(key)) {
        this.ingestLog.push({ at: now, key, outcome: 'duplicate' });
        dupes += 1;
        continue;
      }
      table.set(key, item);
      this.ingestLog.push({ at: now, key, outcome: 'new' });
      accepted += 1;
    }
    return { acceptedEntities: accepted, acceptedMetrics: 0, duplicatesIgnored: dupes };
  }
}
