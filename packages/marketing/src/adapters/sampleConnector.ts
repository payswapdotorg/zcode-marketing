/**
 * Sample connector — the conformance reference for
 * docs/marketing/PLATFORM-CONNECTOR-CONTRACT.md. Fixture-driven, zero network.
 * Real connectors (YouTube public data first) must reach parity with this
 * implementation before becoming foundational (MARKETING-DATA-SOURCES.md).
 */
import type {
  AdCreative,
  MetricObservation,
  OrganicContent,
} from '../domain/records.js';
import type {
  ConnectorCapabilities,
  ConnectorMeta,
  MarketingConnector,
  ResearchPage,
  ResearchRequest,
} from '../app/ports.js';
import { organicFixtures, paidFixtures } from './fixtures.js';

const meta: ConnectorMeta = {
  id: 'connector:sample',
  version: '0.1.0',
  platform: 'youtube',
  capabilities: {
    research: true,
    analytics: false,
    publishing: false,
    scheduling: false,
    paidAds: false,
  },
  authModel: 'public',
  verificationRef: 'MARKETING-DATA-SOURCES.md#sample (reference only — synthetic fixtures)',
  supportedRegions: ['fixture'],
  expectedFreshness: 'static fixtures',
  retentionNote: 'synthetic data; no platform terms apply',
};

export class SampleConnector implements MarketingConnector {
  readonly meta = meta;
  /** Controls whether a second research call replays identical pages (idempotency tests). */
  private replayCount = 0;

  private readonly capabilitiesDecl: ConnectorCapabilities = meta.capabilities;

  async research(request: ResearchRequest): Promise<ResearchPage> {
    this.replayCount += 1;
    const remap = <T extends { missionId: string }>(items: T[]): T[] =>
      items.map((item) => ({ ...item, missionId: request.missionId }));
    const ads: AdCreative[] = remap(paidFixtures.ads);
    const organic: OrganicContent[] = remap(organicFixtures.organic);
    const metrics: MetricObservation[] = [...remap(paidFixtures.metrics), ...remap(organicFixtures.metrics)];
    return {
      ads,
      organic,
      metrics,
      // Honest per-slice coverage for THIS response — mandatory, never empty.
      coverage: [
        {
          slice: 'organic-content:youtube',
          state: 'available',
          sourceId: 'sample-platform',
          connectorVersion: meta.version,
          region: 'fixture',
          dateWindow: 'fixtures',
          note: 'publicly accessible posts, observable engagement and timestamps',
        },
        {
          slice: 'competitor-ad-library:meta',
          state: 'restricted',
          sourceId: 'sample-adlib',
          connectorVersion: meta.version,
          region: 'fixture',
          dateWindow: 'fixtures',
          note: 'coverage restricted by source, country, date and advertiser access',
        },
        {
          slice: 'private-conversion-performance',
          state: 'not_connected',
          sourceId: 'sample-adlib',
          connectorVersion: meta.version,
          note: 'requires advertiser account access, measurement integrations or supplied reports',
        },
      ],
      accessMethod: 'officialApi',
    };
  }

  // publish() is intentionally NOT implemented: capabilities.publishing is false
  // and the contract forbids implementing operations that are not declared.

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: `fixture connector, research calls served: ${this.replayCount}` };
  }

  get replayCountValue(): number {
    return this.replayCount;
  }
}
