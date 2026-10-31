/**
 * Sample research fixtures — labeled ground truth for the conformance and
 * loop-demo runs (docs/marketing/MARKETING-EVALUATION.md). Zero network.
 * Data is synthetic and labeled as such; it exists to prove temporal semantics,
 * idempotency, coverage honesty, and loop mechanics — not to claim market facts.
 */
import type { AdCreative, MetricObservation, OrganicContent } from '../domain/records.js';

export interface FixtureSet {
  ads: AdCreative[];
  organic: OrganicContent[];
  metrics: MetricObservation[];
}

const mk = {
  ad(id: string, advertiserId: string, days: number, variations: string[]): AdCreative[] {
    return variations.map((v, i) => ({
      kind: 'AdCreative' as const,
      id: `${id}-v${i}`,
      missionId: 'mission-fixture',
      advertiserId,
      source: { sourceId: 'sample-adlib', sourceRecordId: `${id}-v${i}`, connectorVersion: '0.1.0' },
      platform: 'meta' as const,
      format: '9:16 video',
      firstObservedAt: new Date(Date.now() - (days + i) * 86_400_000).toISOString(),
      lastObservedAt: new Date(Date.now() - i * 86_400_000).toISOString(),
      variations: [v],
      availableMetadata: { synthetic: true, note: 'labeled fixture creative (not real market data)' },
    }));
  },
  organic(id: string, authorId: string, format: string, daysOld: number): OrganicContent {
    return {
      kind: 'OrganicContent',
      id,
      missionId: 'mission-fixture',
      source: { sourceId: 'sample-platform', sourceRecordId: id, connectorVersion: '0.1.0' },
      platform: 'youtube',
      authorId,
      format,
      publishedAt: new Date(Date.now() - daysOld * 86_400_000).toISOString(),
      availableMetadata: { title: `organic ${id}` },
    };
  },
  metric(subjectRef: string, metricKey: string, values: number[], daysStep: number): MetricObservation[] {
    return values.map((value, i) => ({
      kind: 'MetricObservation' as const,
      id: `m-${subjectRef}-${metricKey}-${i}`,
      missionId: 'mission-fixture',
      subjectRef,
      metricKey,
      value,
      observedAt: new Date(Date.now() - (values.length - i) * daysStep * 86_400_000).toISOString(),
      // WO-P5 (AT-P5.3): fixture models a current-snapshot public stat read at
      // observedAt — a first-party observation (synthetic, labeled as such).
      recordType: 'first_party_observation' as const,
      source: { sourceId: subjectRef.startsWith('ad-') ? 'sample-adlib' : 'sample-platform', sourceRecordId: subjectRef, connectorVersion: '0.1.0' },
      metricDefinition: 'platform-public-stat',
      metricDefinitionVersion: 'v1',
    }));
  },
};

/** Two competitors, paid side: benefit-demo pattern + urgency offer pattern. */
export const paidFixtures: FixtureSet = {
  ads: [
    ...mk.ad('ad-rivalone', 'comp-rivalone', 90, ['benefit-demo-30s']),
    ...mk.ad('ad-rivaltwo', 'comp-rivaltwo', 45, ['urgency-discount-15s']),
  ],
  organic: [],
  metrics: [
    ...mk.metric('ad-rivalone-v0', 'impressions', [12000, 18000, 26000, 31000], 30),
    ...mk.metric('ad-rivaltwo-v0', 'impressions', [8000, 9500, 11000], 30),
  ],
};

/** Organic side: creator-led demonstration pattern gaining momentum. */
export const organicFixtures: FixtureSet = {
  ads: [],
  organic: [
    mk.organic('yt-101', 'creator-a', 'creator-led demo', 180),
    mk.organic('yt-102', 'creator-b', 'creator-led demo', 12),
  ],
  metrics: [
    ...mk.metric('yt-101', 'views', [40000, 46000, 52000], 60),
    ...mk.metric('yt-102', 'views', [3000, 9000, 21000], 4),
  ],
};

/** Ground-truth labels used by evaluation assertions. */
export const groundTruth = {
  expectedTopIntersection: 'benefit-demonstration × creator-led style',
  expectedCoverageGaps: ['competitor ad library: restricted by source/country/date/advertiser access'],
  /** The 12-day-old video must win on velocity despite fewer total views. */
  expectedVelocityWinner: 'yt-102',
} as const;
