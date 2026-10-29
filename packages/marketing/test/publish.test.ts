/**
 * W5/W6 domain tests — the connected-account publishing connector and the
 * closed-loop comparison engine.
 *
 * Connector tests are fixture-driven (conformance rule 1: no network). The
 * fixtures speak the REAL YouTube Data API v3 wire shapes (resumable upload
 * session + videos.list + the Analytics API v2 report), so the adapter's
 * protocol handling is verified offline while the evidence run
 * (demo:w5/demo:w6) exercises the same code path against the sandbox test
 * account.
 *
 * Honesty gates: idempotent retries never duplicate a post; the access token
 * never leaks into errors or records; a sandbox connection is labeled as such;
 * research on the publishing connector is a typed refusal.
 */
import { describe, expect, it } from 'vitest';
import {
  ConnectorFailure,
  YoutubePublishConnector,
  publicationRecord,
  creativeArtifact,
  creativeHypothesis,
  productBrief,
} from '../src/index.js';
import type { PublishFetchLike, PublishingConnection } from '../src/index.js';
import { MarketingMission } from '../src/index.js';
import { SampleConnector } from '../src/index.js';
import { HeuristicModel } from '../src/index.js';
import { CapabilityCatalog } from '../src/index.js';
import { TemporalStore } from '../src/index.js';

const connection: PublishingConnection = {
  connectionId: 'conn-test-1',
  label: 'sandbox test channel',
  platform: 'youtube',
  dataBase: 'https://youtube.example.test',
  analyticsBase: 'https://ytanalytics.example.test',
  accessToken: 'SECRETTOKEN-test-0001',
  accountRef: 'UCsandbox00000000000000AA',
  environment: 'sandbox',
};

/** Stateful wire fixture speaking the real protocol shapes. */
function wireFixture(opts: { failInitWith?: number } = {}): {
  fetchLike: PublishFetchLike;
  calls: Array<{ method: string; url: string; auth?: string; idem?: string }>;
  uploads: number;
} {
  const calls: Array<{ method: string; url: string; auth?: string; idem?: string }> = [];
  const state = { uploads: 0, videos: 0 };
  const fetchLike: PublishFetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    calls.push({
      method,
      url,
      ...(init?.headers?.authorization ? { auth: init.headers.authorization } : {}),
      ...(init?.headers?.['x-idempotency-key'] ? { idem: init.headers['x-idempotency-key'] } : {}),
    });
    if (opts.failInitWith && method === 'POST') {
      return { status: opts.failInitWith, headers: {}, body: '' };
    }
    if (method === 'POST' && url.includes('/upload/youtube/v3/videos')) {
      state.videos += 1;
      return {
        status: 200,
        headers: { location: `https://youtube.example.test/upload/resumable/session-${state.videos}` },
        body: '',
      };
    }
    if (method === 'PUT' && url.includes('/upload/resumable/')) {
      state.uploads += 1;
      const id = `sbvid${String(state.uploads).padStart(3, '0')}`;
      return {
        status: 201,
        headers: {},
        body: JSON.stringify({
          id,
          snippet: { title: 'uploaded test video', publishedAt: '2026-10-29T12:00:00.000Z' },
          status: { uploadStatus: 'processed', privacyStatus: 'public' },
        }),
      };
    }
    if (method === 'GET' && url.includes('/youtube/v3/videos')) {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          items: [
            {
              id: 'sbvid001',
              snippet: { title: 'uploaded test video', publishedAt: '2026-10-29T12:00:00.000Z' },
              status: { uploadStatus: 'processed', privacyStatus: 'public' },
            },
          ],
        }),
      };
    }
    if (method === 'GET' && url.includes('/v2/reports')) {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          columnHeaders: [
            { name: 'day', columnType: 'DIMENSION', dataType: 'STRING' },
            { name: 'views', columnType: 'METRIC', dataType: 'INTEGER' },
          ],
          rows: [
            ['2026-10-23', '1200'],
            ['2026-10-24', '3100'],
            ['2026-10-25', '5400'],
          ],
        }),
      };
    }
    return { status: 404, headers: {}, body: '' };
  };
  return { fetchLike, calls, get uploads() { return state.uploads; } };
}

const asset = (bytes: Uint8Array) => ({
  bytes,
  mimeType: 'video/mp4',
  title: 'Portable espresso, real pressure',
  description: 'Hook + demo + CTA',
  tags: ['espresso', 'travel'],
  privacyStatus: 'public' as const,
});

describe('youtube publish connector (W5)', () => {
  it('publishes through the resumable-upload protocol and returns the post identity', async () => {
    const wire = wireFixture();
    const connector = new YoutubePublishConnector(connection, wire.fetchLike);
    const outcome = await connector.publish({
      missionId: 'm1',
      artifactId: 'a1',
      idempotencyKey: 'a1:m1:organic',
      approvedBy: 'user-1',
      asset: asset(new Uint8Array([1, 2, 3, 4])),
    });
    expect(outcome.externalPostId).toBe('sbvid001');
    expect(outcome.url).toBe('https://www.youtube.com/watch?v=sbvid001');
    expect(outcome.assistedHandoff).toBe(false);
    // The wire sequence is the real protocol: init (metadata+Bearer+idem key) then PUT bytes.
    expect(wire.calls[0]?.method).toBe('POST');
    expect(wire.calls[0]?.auth).toBe('Bearer SECRETTOKEN-test-0001');
    expect(wire.calls[0]?.idem).toBe('a1:m1:organic');
    expect(wire.calls[1]?.method).toBe('PUT');
    expect(wire.calls[1]?.url).toContain('/upload/resumable/session-1');
  });

  it('retries with the same idempotency key never create a duplicate post', async () => {
    const wire = wireFixture();
    const connector = new YoutubePublishConnector(connection, wire.fetchLike);
    const first = await connector.publish({
      missionId: 'm1', artifactId: 'a1', idempotencyKey: 'k1', approvedBy: 'u', asset: asset(new Uint8Array([9])),
    });
    const second = await connector.publish({
      missionId: 'm1', artifactId: 'a1', idempotencyKey: 'k1', approvedBy: 'u', asset: asset(new Uint8Array([9])),
    });
    expect(second.externalPostId).toBe(first.externalPostId);
    expect(wire.uploads).toBe(1);
  });

  it('declares publishing+analytics only, and research is a typed refusal', async () => {
    const wire = wireFixture();
    const connector = new YoutubePublishConnector(connection, wire.fetchLike);
    expect(connector.meta.capabilities).toEqual({
      research: false, analytics: true, publishing: true, scheduling: false, paidAds: false,
    });
    await expect(
      connector.research({ missionId: 'm', competitors: [], platform: 'youtube', country: 'US', from: '', to: '' }),
    ).rejects.toMatchObject({ error: { kind: 'permission_denied', operation: 'research' } });
  });

  it('maps auth failures to the typed error and never leaks the token', async () => {
    const wire = wireFixture({ failInitWith: 401 });
    const connector = new YoutubePublishConnector(connection, wire.fetchLike);
    try {
      await connector.publish({
        missionId: 'm1', artifactId: 'a1', idempotencyKey: 'k', approvedBy: 'u', asset: asset(new Uint8Array([1])),
      });
      expect.unreachable('publish must fail');
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectorFailure);
      const failure = err as ConnectorFailure;
      expect(failure.error.kind).toBe('auth_required');
      expect(String(failure.message)).not.toContain(connection.accessToken);
      expect(JSON.stringify(failure.error)).not.toContain(connection.accessToken);
    }
  });

  it('verifies the resulting post through the connected account (videos.list)', async () => {
    const wire = wireFixture();
    const connector = new YoutubePublishConnector(connection, wire.fetchLike);
    const verification = await connector.verifyPublication({ externalPostId: 'sbvid001' });
    expect(verification.exists).toBe(true);
    expect(verification.uploadStatus).toBe('processed');
    expect(verification.detail).toContain('connected account');
  });

  it('collects permitted analytics as daily observations with provenance and honest coverage', async () => {
    const wire = wireFixture();
    const connector = new YoutubePublishConnector(connection, wire.fetchLike);
    const page = await connector.analytics({
      missionId: 'm1',
      subjectExternalIds: ['sbvid001'],
      metrics: ['views'],
      from: '2026-10-23T00:00:00.000Z',
      to: '2026-10-25T00:00:00.000Z',
    });
    expect(page.accessMethod).toBe('authorizedAccount');
    expect(page.observations).toHaveLength(3);
    expect(page.observations[0]).toMatchObject({
      subjectRef: 'yt:sbvid001',
      metricKey: 'views',
      value: 1200,
      source: { sourceId: 'connected-account:conn-test-1', sourceRecordId: 'sbvid001' },
      metricDefinition: 'connected-account-analytics',
    });
    expect(page.coverage[0]?.state).toBe('available');
    // The sandbox label travels with the coverage note — never presented as production.
    expect(page.coverage[0]?.note).toContain('sandbox environment');
  });
});

describe('closed-loop comparison engine (W6)', () => {
  const brief = productBrief.parse({
    kind: 'ProductBrief',
    id: 'brief-t', missionId: 'mission-t', product: 'p', audience: 'a', country: 'US',
    platform: 'youtube', offer: 'o', objective: 'sales', constraints: [], createdAt: '2026-10-29T00:00:00Z',
  });
  const hypothesis = creativeHypothesis.parse({
    kind: 'CreativeHypothesis',
    id: 'hyp-1', missionId: 'mission-t',
    pattern: { problem: 'x', message: 'm', hook: 'h', format: 'f', demonstration: 'd', cta: 'c' },
    supportedBy: [
      { ref: 'ad-1', accessMethod: 'officialApi', observedAt: '2026-10-29T00:00:00Z', supports: 'paid signal' },
    ],
    contradictedBy: [],
    predictedOutcome: { objective: 'sales', low: 100, expected: 200, high: 400, metricKey: 'attributedConversions' },
    confidence: 0.5,
  });
  const artifact = creativeArtifact.parse({
    kind: 'CreativeArtifact',
    id: 'artifact-1', missionId: 'mission-t', hypothesisId: 'hyp-1', kindOf: 'uploadedAsset',
    status: 'approved', approvedBy: 'reviewer', brief: { experimentSpec: { changedVariables: ['hook'], windowDays: 14 } },
    promptPack: {},
  });
  const publication = publicationRecord.parse({
    kind: 'PublicationRecord',
    id: 'pub-1', missionId: 'mission-t', artifactId: 'artifact-1', platform: 'youtube',
    idempotencyKey: 'k', approvedBy: 'u', publishedAt: '2026-10-29T00:00:00Z',
    status: 'published', assistedHandoff: false, connectionId: 'conn-1', environment: 'sandbox',
  });

  const mission = () =>
    new MarketingMission(
      brief,
      new SampleConnector(),
      new CapabilityCatalog(new HeuristicModel()),
      () => '2026-10-29T10:00:00.000Z',
      new TemporalStore(),
    );

  it('compares an in-range outcome on the goal metric and records the calibration correction', async () => {
    const m = mission();
    const experiment = m.openExperiment(hypothesis, artifact, publication);
    const { result, simulation, action, comparison } = await m.completeExperiment(experiment, 250, {
      observedMetricKey: 'attributedConversions',
      forecast: { low: 100, expected: 200, high: 400, metricKey: 'attributedConversions' },
    });
    expect(comparison.isProxy).toBe(false);
    expect(comparison.withinForecastRange).toBe(true);
    expect(comparison.direction).toBe('within');
    expect(comparison.forecastErrorRatio).toBeCloseTo(1.25);
    expect(result.result?.forecastPreserved).toBe(true);
    expect(result.result?.supported[0]).toContain('met or exceeded');
    expect(simulation.calibrationHistory[0]?.note).toContain('1.25x');
    expect(action.evidence[0]?.ref).toBe(`experiment:${experiment.id}`);
    expect(action.change[0]).toContain('no assumption contradicted');
  });

  it('labels a below-range outcome, contradicts the hook, and recommends the rework before scaling', async () => {
    const m = mission();
    const experiment = m.openExperiment(hypothesis, artifact, publication);
    const { result, action, comparison } = await m.completeExperiment(experiment, 40, {
      observedMetricKey: 'attributedConversions',
      forecast: { low: 100, expected: 200, high: 400, metricKey: 'attributedConversions' },
    });
    expect(comparison.direction).toBe('below');
    expect(result.result?.contradicted[0]).toContain('below the preserved forecast range');
    expect(action.recommendation).toContain('below');
    expect(action.recommendation).toContain('before scaling');
  });

  it('carries the [PROXY] label when the goal metric is unobservable and a proxy is compared', async () => {
    const m = mission();
    const experiment = m.openExperiment(hypothesis, artifact, publication);
    const { result, comparison } = await m.completeExperiment(experiment, 5000, {
      observedMetricKey: 'views',
      forecast: { low: 3000, expected: 4000, high: 8000, metricKey: 'views' },
    });
    expect(comparison.isProxy).toBe(true);
    expect(comparison.note).toContain('[PROXY]');
    expect(result.result?.contradicted.some((c) => c.includes('proxy conclusion only'))).toBe(true);
  });

  it('keeps the experiment window and changed variables from the artifact spec', () => {
    const m = mission();
    const experiment = m.openExperiment(hypothesis, artifact, publication);
    expect(experiment.changedVariables).toEqual(['hook']);
    expect(experiment.measurementWindowDays).toBe(14);
    expect(experiment.goalMetricKey).toBe('attributedConversions');
  });
});
