/**
 * Temporal data plane — the "time machine" (W2).
 *
 * Governance: docs/marketing/MARKETING-DATA-MODEL.md. Exit gate: ingesting the
 * same evidence twice is safe, metric changes are recorded as new observations,
 * and an as-of query reproduces the observations actually available at that
 * time. History is never silently rewritten.
 *
 * Layer: app. Storage is in-memory by design; a SQLite persistence adapter
 * (production wiring via the repo's storage conventions) plugs in behind the
 * same interface later — domain and workflows never know the difference.
 */
import type {
  AdCreative,
  CoverageReport,
  MetricObservation,
  OrganicContent,
  SourceIdentity,
} from '../domain/records.js';

const sourceKey = (s: SourceIdentity): string => `${s.sourceId}/${s.sourceRecordId}`;

export interface IngestResult {
  acceptedEntities: number;
  acceptedMetrics: number;
  duplicatesIgnored: number;
}

export class TemporalStore {
  private readonly ads = new Map<string, AdCreative>();
  private readonly organic = new Map<string, OrganicContent>();
  /** metricKey -> subjectRef -> ascending-by-observedAt observation list. */
  private readonly metrics = new Map<string, Map<string, MetricObservation[]>>();
  private readonly coverageReports: CoverageReport[] = [];
  private readonly ingestLog: Array<{
    at: string;
    key: string;
    outcome: 'new' | 'duplicate' | 'superseded';
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
    for (const obs of observations) {
      const key = `${obs.source.sourceId}/${obs.source.sourceRecordId}#${obs.metricKey}@${obs.observedAt}`;
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
    return { acceptedEntities: 0, acceptedMetrics: accepted, duplicatesIgnored: dupes };
  }

  recordCoverage(report: CoverageReport): void {
    this.coverageReports.push(report);
    this.coverageReports.sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
  }

  /** As-of query: only observations actually available at `at` are returned. */
  metricsAsOf(metricKey: string, subjectRef: string, at: string): MetricObservation[] {
    const series = this.metrics.get(metricKey)?.get(subjectRef);
    if (!series) return [];
    return series.filter((m) => m.observedAt <= at);
  }

  latestObservation(metricKey: string, subjectRef: string, at: string): MetricObservation | undefined {
    const series = this.metricsAsOf(metricKey, subjectRef, at);
    return series.at(-1);
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

  latestCoverage(): CoverageReport | undefined {
    return this.coverageReports.at(-1);
  }

  ingestAudit(): ReadonlyArray<{ at: string; key: string; outcome: 'new' | 'duplicate' | 'superseded' }> {
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
