/**
 * W5/W6 tool-chain tests — authorized publishing and closed-loop learning.
 *
 * Connected-account publishing runs against a wire fixture speaking the REAL
 * YouTube Data API v3 / Analytics API v2 protocol shapes (resumable upload
 * session → PUT bytes → videos.list → analytics report), pointed at by a
 * SANDBOX-labeled test connection — exactly how a real test account points
 * dataBase at a test endpoint. No network: fixtures drive everything; the
 * keyless oEmbed route (manual publications) is fixture-driven here and
 * exercised live in the evidence run (demo:w5).
 *
 * Honesty gates under test: idempotent retries never duplicate a post; the
 * access token never leaves the credential area (grep-enforced); a sandbox
 * publication is labeled as such; unresolvable manual URLs are user-attested,
 * never verified; the forecast is compared verbatim; proxy observations carry
 * the [PROXY] label; calibration history is appended, never overwritten.
 */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMarketingServer } from '../src/server.js';
import { MarketingRuntime } from '../src/runtime.js';

const TOKEN = 'SECRETTOKEN-test-0001';

/** Research fixture: RSS uploads + per-URL oEmbed (resolvable vs not). */
const researchFixtureFetch = async (url: string): Promise<{ status: number; body: string }> => {
  if (url.includes('feeds/videos.xml')) {
    return {
      status: 200,
      body: [
        '<feed><updated>2026-10-28T10:00:00+00:00</updated>',
        '<entry><yt:videoId>fixvid001</yt:videoId><yt:channelId>UCfixture0000000000000Aa</yt:channelId>',
        '<title>Fresh fixture upload</title><author><name>RivalOne</name></author><published>2026-10-26T00:00:00+00:00</published>',
        '<media:statistics views="15400"/><link rel="alternate" href="https://www.youtube.com/watch?v=fixvid001"/></entry>',
        '</feed>',
      ].join(''),
    };
  }
  if (url.startsWith('https://www.youtube.com/oembed')) {
    const target = decodeURIComponent(/[?&]url=([^&]+)/.exec(url)?.[1] ?? '');
    if (target.includes('v=fixvid001')) {
      return {
        status: 200,
        body: JSON.stringify({ title: 'Fresh fixture upload', author_name: 'RivalOne', thumbnail_url: 'https://example.invalid/t.jpg' }),
      };
    }
    return { status: 404, body: '' };
  }
  return { status: 404, body: '' };
};

/**
 * Sandbox test-endpoint wire fixture — the real Data API v3 shapes. A bad
 * bearer token fails the health check exactly like a real revoked credential.
 */
function sandboxWireFixture(): {
  fetchLike: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array }) => Promise<{ status: number; headers: Record<string, string>; body: string }>;
  uploads: () => number;
  initCalls: () => number;
  analyticsCalls: () => number;
} {
  const state = { sessions: 0, uploads: 0, inits: 0, analytics: 0 };
  const fetchLike = async (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array },
  ) => {
    const method = init?.method ?? 'GET';
    const auth = init?.headers?.authorization ?? '';
    if (auth === 'Bearer BADTOKEN') {
      return { status: 401, headers: {}, body: '' };
    }
    if (method === 'POST' && url.includes('/upload/youtube/v3/videos')) {
      state.inits += 1;
      state.sessions += 1;
      return {
        status: 200,
        headers: { location: `https://youtube.example.test/upload/resumable/session-${state.sessions}` },
        body: '',
      };
    }
    if (method === 'PUT' && url.includes('/upload/resumable/')) {
      state.uploads += 1;
      return {
        status: 201,
        headers: {},
        body: JSON.stringify({
          id: 'sbvid001',
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
      state.analytics += 1;
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
  return {
    fetchLike,
    uploads: () => state.uploads,
    initCalls: () => state.inits,
    analyticsCalls: () => state.analytics,
  };
}

describe('W5 authorized publishing + W6 closed-loop tool chain', () => {
  let root: string;
  let runtime: MarketingRuntime;
  let client: Client;
  let cleanupServer: (() => Promise<void>) | undefined;
  let wire: ReturnType<typeof sandboxWireFixture>;
  const toolOutput: string[] = [];

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')?.text ?? '';
    const structured = result.structuredContent as Record<string, unknown>;
    toolOutput.push(text, JSON.stringify(structured));
    return { isError: result.isError === true, text, structured };
  };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'marketing-w5-'));
    wire = sandboxWireFixture();
    runtime = new MarketingRuntime(root, {
      fetchLike: researchFixtureFetch,
      publishFetchLike: wire.fetchLike,
    });
    const server = createMarketingServer(runtime, { panelHtml: async () => '<!doctype html><html></html>' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'marketing-w5-test', version: '0.0.0' });
    await client.connect(clientTransport);
    cleanupServer = async () => {
      await client.close();
      await server.close();
    };
  });

  afterAll(async () => {
    await cleanupServer?.();
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  });

  it('runs the assisted handoff path honestly before any account is connected', async () => {
    // Mission + creative chain up to an APPROVED produced asset.
    await call('marketing_mission_start', {
      product: 'portable espresso maker',
      audience: 'commuting coffee drinkers',
      country: 'US',
      platform: 'youtube',
      offer: '30-day home trial, free shipping',
      objective: 'sales',
      constraints: ['no discount-first messaging'],
      researchMode: 'demo',
      missionId: 'mission-w5-test',
    });
    await call('marketing_discover_competitors', { missionId: 'mission-w5-test', hints: ['RivalOne', 'RivalTwo'], confirm: ['RivalOne'] });
    const research = await call('marketing_research_platform', { missionId: 'mission-w5-test' });
    expect(research.isError).toBe(false);
    await call('marketing_rank_opportunities', { missionId: 'mission-w5-test' });
    const draft = await call('marketing_draft_creative', { missionId: 'mission-w5-test' });
    expect(draft.isError).toBe(false);
    const pack = (draft.structured as { artifact: { id: string } }).artifact;
    await call('marketing_review_artifact', { missionId: 'mission-w5-test', artifactId: pack.id, decision: 'approve', reviewedBy: 'product owner' });
    const bytes = Buffer.from('fake-mp4-bytes-for-the-w5-gate');
    const begin = await call('marketing_asset_import_begin', { missionId: 'mission-w5-test', name: 'ad-v1.mp4', size: bytes.byteLength });
    const importId = (begin.structured as { id: string }).id;
    await call('marketing_asset_import_write', { id: importId, offset: 0, data: bytes.toString('base64') });
    await call('marketing_asset_import_finish', { id: importId });
    const record = await call('marketing_record_asset', {
      missionId: 'mission-w5-test',
      artifactId: pack.id,
      importedAssetId: importId,
      format: 'video',
      durationSec: 28,
      aspectRatio: '9:16',
      hookText: 'Cafe-grade espresso on your commute — no machine needed',
      proofText: 'unedited before/after of the extraction',
      ctaText: 'Get yours with the 30-day trial',
      transcriptOrCopy:
        'Cafe-grade espresso on your commute. Watch the portable espresso maker pull a real shot, tested in our survey. Get yours with the 30-day trial.',
    });
    expect(record.isError).toBe(false);
    const asset = (record.structured as { artifact: { id: string } }).artifact;
    const approveAsset = await call('marketing_review_artifact', { missionId: 'mission-w5-test', artifactId: asset.id, decision: 'approve', reviewedBy: 'product owner' });
    expect(approveAsset.isError).toBe(false);

    // Without a connected account, direct publishing refuses honestly.
    const noConn = await call('marketing_publish_asset', { missionId: 'mission-w5-test', artifactId: asset.id, approvedBy: 'product owner' });
    expect(noConn.isError).toBe(true);
    expect(noConn.text).toContain('auth_required');
    expect(noConn.text).toContain('assisted handoff');

    // The assisted package carries the metadata + steps out.
    const handoff = await call('marketing_assisted_handoff', { missionId: 'mission-w5-test', artifactId: asset.id });
    expect(handoff.isError).toBe(false);
    const pkg = (handoff.structured as {
      package: { title: string; description: string; tags: string[]; file?: { name: string; bytes: number; path: string }; steps: string[] };
    }).package;
    expect(pkg.title.length).toBeGreaterThan(0);
    expect(pkg.description).toContain('30-day trial');
    expect(pkg.file?.bytes).toBe(bytes.byteLength);
    expect(pkg.steps.some((s) => s.includes('marketing_record_manual_publication'))).toBe(true);

    // The pack itself (not a produced asset) is refused for direct publishing.
    const packPublish = await call('marketing_publish_asset', { missionId: 'mission-w5-test', artifactId: pack.id, approvedBy: 'product owner' });
    expect(packPublish.isError).toBe(true);
    expect(packPublish.text).toContain('invalid_input');
    expect(packPublish.text).toContain('assisted handoff');

    // A resolvable manual publication verifies through the keyless public route.
    const manual = await call('marketing_record_manual_publication', {
      missionId: 'mission-w5-test',
      artifactId: asset.id,
      url: 'https://www.youtube.com/watch?v=fixvid001',
      publishedBy: 'product owner',
    });
    expect(manual.isError).toBe(false);
    const manualPub = (manual.structured as { publication: { status: string; environment: string; assistedHandoff: boolean; verification?: { method: string } } }).publication;
    expect(manualPub.status).toBe('verified');
    expect(manualPub.assistedHandoff).toBe(true);
    expect(manualPub.environment).toBe('production');
    expect(manualPub.verification?.method).toBe('public-oembed');

    // One publication per artifact — a second manual record is refused.
    const manualAgain = await call('marketing_record_manual_publication', {
      missionId: 'mission-w5-test',
      artifactId: asset.id,
      url: 'https://www.youtube.com/watch?v=fixvid001',
      publishedBy: 'product owner',
    });
    expect(manualAgain.isError).toBe(true);
    expect(manualAgain.text).toContain('one publication per artifact');
  });

  it('records a user-attested (unresolvable) manual publication honestly', async () => {
    // Second produced asset for the manual-publication measurement chain.
    const draft = await call('marketing_list_artifacts', { missionId: 'mission-w5-test' });
    expect(draft.isError).toBe(false);
    const artifacts = (draft.structured as { artifacts: Array<{ id: string; kindOf: string; status: string }> }).artifacts;
    const pack = artifacts.find((a) => a.kindOf === 'promptPack');
    expect(pack).toBeDefined();
    const bytes = Buffer.from('second-asset-bytes-for-attested-path');
    const begin = await call('marketing_asset_import_begin', { missionId: 'mission-w5-test', name: 'ad-v2.mp4', size: bytes.byteLength });
    const importId = (begin.structured as { id: string }).id;
    await call('marketing_asset_import_write', { id: importId, offset: 0, data: bytes.toString('base64') });
    await call('marketing_asset_import_finish', { id: importId });
    const record = await call('marketing_record_asset', {
      missionId: 'mission-w5-test',
      artifactId: pack!.id,
      importedAssetId: importId,
      format: 'video',
      durationSec: 28,
      aspectRatio: '9:16',
      hookText: 'Cafe-grade espresso on your commute — no machine needed',
      proofText: 'unedited before/after of the extraction',
      ctaText: 'Get yours with the 30-day trial',
      transcriptOrCopy:
        'Cafe-grade espresso on your commute. Watch the portable espresso maker pull a real shot, tested in our survey. Get yours with the 30-day trial.',
    });
    const asset = (record.structured as { artifact: { id: string } }).artifact;
    await call('marketing_review_artifact', { missionId: 'mission-w5-test', artifactId: asset.id, decision: 'approve', reviewedBy: 'product owner' });

    const attested = await call('marketing_record_manual_publication', {
      missionId: 'mission-w5-test',
      artifactId: asset.id,
      url: 'https://www.youtube.com/watch?v=zznope99',
      publishedBy: 'product owner',
      notes: 'unlisted post shared by DM',
    });
    expect(attested.isError).toBe(false);
    const attestedPub = (attested.structured as { publication: { status: string; verification: { method: string; detail: string } } }).publication;
    expect(attestedPub.status).toBe('published');
    expect(attestedPub.verification.method).toBe('user-attested');
    expect(attestedPub.verification.detail).toContain('user-attested only');

    // The assisted path's measurement chain: no connected analytics for it.
    const experiment = await call('marketing_open_experiment', {
      missionId: 'mission-w5-test',
      publicationId: (attested.structured as { publication: { id: string } }).publication.id,
    });
    expect(experiment.isError).toBe(false);
    const noAnalytics = await call('marketing_collect_analytics', {
      missionId: 'mission-w5-test',
      publicationId: (attested.structured as { publication: { id: string } }).publication.id,
    });
    expect(noAnalytics.isError).toBe(true);
    expect(noAnalytics.text).toContain('auth_required');
    expect(noAnalytics.text).toContain('marketing_record_outcome');
  });

  it('connects a sandbox test account only after its health check passes', async () => {
    // A revoked/bad credential fails the health check and is NOT persisted.
    const bad = await call('marketing_connect_publish_account', {
      label: 'broken test channel',
      accessToken: 'BADTOKEN',
      dataBase: 'https://youtube.example.test',
      accountRef: 'UCsandbox00000000000000AA',
      environment: 'sandbox',
      connectedBy: 'worker a',
    });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('auth_required');
    const afterBad = await call('marketing_list_connections', {});
    expect((afterBad.structured as { connections: unknown[] }).connections).toHaveLength(0);

    // An unverified platform connector is a typed refusal (data-sources ledger).
    const wrongPlatform = await call('marketing_connect_publish_account', {
      platform: 'tiktok',
      label: 'tiktok brand',
      accessToken: 'whatever-token',
      dataBase: 'https://tiktok.example.test',
      accountRef: '@brand',
      environment: 'production',
      connectedBy: 'worker a',
    });
    expect(wrongPlatform.isError).toBe(true);
    expect(wrongPlatform.text).toContain('invalid_input');

    // The healthy sandbox account connects and never echoes the token.
    const connect = await call('marketing_connect_publish_account', {
      label: 'sandbox test channel',
      accessToken: TOKEN,
      dataBase: 'https://youtube.example.test',
      accountRef: 'UCsandbox00000000000000AA',
      environment: 'sandbox',
      connectedBy: 'worker a',
    });
    expect(connect.isError).toBe(false);
    const view = (connect.structured as { connection: Record<string, unknown> }).connection;
    expect(view.environment).toBe('sandbox');
    expect(Object.keys(view)).not.toContain('accessToken');
  });

  it('publishes an approved asset through the connected account, idempotently, and verifies the post', async () => {
    // Third produced asset for the connected-account path.
    const list = await call('marketing_list_artifacts', { missionId: 'mission-w5-test' });
    const pack = ((list.structured as { artifacts: Array<{ id: string; kindOf: string }> }).artifacts).find((a) => a.kindOf === 'promptPack');
    const bytes = Buffer.from('third-asset-bytes-for-connected-publish');
    const begin = await call('marketing_asset_import_begin', { missionId: 'mission-w5-test', name: 'ad-v3.mp4', size: bytes.byteLength });
    const importId = (begin.structured as { id: string }).id;
    await call('marketing_asset_import_write', { id: importId, offset: 0, data: bytes.toString('base64') });
    await call('marketing_asset_import_finish', { id: importId });
    const record = await call('marketing_record_asset', {
      missionId: 'mission-w5-test',
      artifactId: pack!.id,
      importedAssetId: importId,
      format: 'video',
      durationSec: 28,
      aspectRatio: '9:16',
      hookText: 'Cafe-grade espresso on your commute — no machine needed',
      proofText: 'unedited before/after of the extraction',
      ctaText: 'Get yours with the 30-day trial',
      transcriptOrCopy:
        'Cafe-grade espresso on your commute. Watch the portable espresso maker pull a real shot, tested in our survey. Get yours with the 30-day trial.',
    });
    const asset = (record.structured as { artifact: { id: string } }).artifact;
    await call('marketing_review_artifact', { missionId: 'mission-w5-test', artifactId: asset.id, decision: 'approve', reviewedBy: 'product owner' });

    const published = await call('marketing_publish_asset', {
      missionId: 'mission-w5-test',
      artifactId: asset.id,
      approvedBy: 'product owner',
      privacyStatus: 'public',
    });
    expect(published.isError).toBe(false);
    const pub = (published.structured as { publication: Record<string, unknown>; idempotentReplay: boolean }).publication;
    expect(pub.externalPostId).toBe('sbvid001');
    expect(pub.status).toBe('published');
    expect(pub.environment).toBe('sandbox');
    expect(pub.assistedHandoff).toBe(false);
    expect((published.structured as { idempotentReplay: boolean }).idempotentReplay).toBe(false);
    expect(wire.uploads()).toBe(1);

    // Idempotent replay: same publication, no second wire upload.
    const replay = await call('marketing_publish_asset', {
      missionId: 'mission-w5-test',
      artifactId: asset.id,
      approvedBy: 'product owner',
    });
    expect(replay.isError).toBe(false);
    expect((replay.structured as { idempotentReplay: boolean }).idempotentReplay).toBe(true);
    expect((replay.structured as { publication: { id: string } }).publication.id).toBe(pub.id);
    expect(wire.uploads()).toBe(1);

    // Post-status verification through the connected account.
    const verify = await call('marketing_verify_publication', { missionId: 'mission-w5-test', publicationId: String(pub.id) });
    expect(verify.isError).toBe(false);
    const verified = (verify.structured as { publication: { status: string; verification: { method: string; detail: string } } }).publication;
    expect(verified.status).toBe('verified');
    expect(verified.verification.method).toBe('connected-account');
    expect(verified.verification.detail).toContain('uploadStatus processed');

    // The artifact now carries the published state.
    const after = await call('marketing_list_artifacts', { missionId: 'mission-w5-test' });
    const statuses = ((after.structured as { artifacts: Array<{ id: string; status: string }> }).artifacts)
      .filter((a) => a.id === asset.id);
    expect(statuses[0]?.status).toBe('published');
  });

  it('measures the connected publication and closes the loop with a grounded recommendation', async () => {
    const pubs = await call('marketing_list_publications', { missionId: 'mission-w5-test' });
    const connected = ((pubs.structured as { publications: Array<{ id: string; externalPostId?: string }> }).publications)
      .find((p) => p.externalPostId === 'sbvid001');
    expect(connected).toBeDefined();

    const opened = await call('marketing_open_experiment', { missionId: 'mission-w5-test', publicationId: connected!.id });
    expect(opened.isError).toBe(false);
    const experiment = (opened.structured as { experiment: { id: string; goalMetricKey: string; changedVariables: string[]; measurementWindowDays: number } }).experiment;
    expect(experiment.goalMetricKey).toBe('attributedConversions');
    expect(experiment.changedVariables).toEqual(['hook']);
    expect(experiment.measurementWindowDays).toBe(14);

    // Idempotent re-open: the same experiment, not a second window.
    const reopened = await call('marketing_open_experiment', { missionId: 'mission-w5-test', publicationId: connected!.id });
    expect((reopened.structured as { experiment: { id: string } }).experiment.id).toBe(experiment.id);

    // Permitted analytics: daily observations into the temporal store, idempotently.
    const collected = await call('marketing_collect_analytics', {
      missionId: 'mission-w5-test',
      publicationId: connected!.id,
      metrics: ['views'],
    });
    expect(collected.isError).toBe(false);
    const page = (collected.structured as { observations: unknown[]; latest: Array<{ metricKey: string; value: number }>; coverage: Array<{ state: string; note: string }> });
    expect(page.observations).toHaveLength(3);
    expect(page.latest.find((l) => l.metricKey === 'views')?.value).toBe(5400);
    expect(page.coverage[0]?.note).toContain('sandbox environment');
    const recollect = await call('marketing_collect_analytics', {
      missionId: 'mission-w5-test',
      publicationId: connected!.id,
      metrics: ['views'],
    });
    expect(recollect.isError).toBe(false);
    expect(recollect.text).toContain('duplicates ignored');
    expect(wire.analyticsCalls()).toBe(2);

    // A proxy observation without its declared baseline is refused (no
    // silent unit-mixing against the goal metric's range).
    const noBaseline = await call('marketing_record_outcome', {
      missionId: 'mission-w5-test',
      experimentId: experiment.id,
      observedValue: 5400,
      observedMetricKey: 'views',
    });
    expect(noBaseline.isError).toBe(true);
    expect(noBaseline.text).toContain('proxyForecast');

    // Closed-loop: observed on a PROXY metric with its declared baseline
    // → labeled, calibrated, grounded.
    const outcome = await call('marketing_record_outcome', {
      missionId: 'mission-w5-test',
      experimentId: experiment.id,
      observedValue: 5400,
      observedMetricKey: 'views',
      proxyForecast: { low: 3000, expected: 5000, high: 9000 },
      sourceNote: 'connected-account analytics (sandbox test channel, daily views total)',
    });
    expect(outcome.isError).toBe(false);
    const result = (outcome.structured as {
      result: { result?: { forecastPreserved: boolean; observedMetricKey: string; observedValue: number } };
      simulation: { calibrationHistory: Array<{ note: string }>; modelRef: string };
      nextAction: { recommendation: string; evidence: Array<{ ref: string }> };
      comparison: { isProxy: boolean; note: string; direction: string; observedMetricKey: string };
    });
    expect(result.comparison.isProxy).toBe(true);
    expect(result.comparison.note).toContain('[PROXY]');
    expect(result.comparison.withinForecastRange).toBe(true);
    expect(result.result.result?.forecastPreserved).toBe(true);
    expect(result.result.result?.observedMetricKey).toBe('views');
    expect(result.simulation.calibrationHistory).toHaveLength(1);
    expect(result.simulation.modelRef).toBe('calibration:v1');
    expect(result.nextAction.recommendation.length).toBeGreaterThan(0);
    expect(result.nextAction.evidence.some((e) => e.ref.startsWith('outcome-source:'))).toBe(true);

    // One outcome per experiment — the loop's next iteration comes from the recommendation.
    const again = await call('marketing_record_outcome', {
      missionId: 'mission-w5-test',
      experimentId: experiment.id,
      observedValue: 1,
    });
    expect(again.isError).toBe(true);
    expect(again.text).toContain('already completed');
  });

  it('keeps the access token inside the credential area (grep-enforced auth hygiene)', async () => {
    // No tool output ever carried the token.
    const leaked = toolOutput.filter((chunk) => chunk.includes(TOKEN));
    expect(leaked).toEqual([]);
    // No mission file ever carries it either — only connections.json may.
    const walk = async (dir: string): Promise<string[]> => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      const files: string[] = [];
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) files.push(...(await walk(full)));
        else files.push(full);
      }
      return files;
    };
    for (const file of await walk(join(root, '.zcode'))) {
      if (file.endsWith('connections.json')) continue; // the credential area, by design
      const raw = await readFile(file, 'utf8');
      expect(raw.includes(TOKEN)).toBe(false);
    }
  });

  it('persists the loop state across process restarts', async () => {
    const reopened = new MarketingRuntime(root, {
      fetchLike: researchFixtureFetch,
      publishFetchLike: wire.fetchLike,
    });
    try {
      const list = await reopened.connections.views();
      expect(list).toHaveLength(1);
      expect(list[0]?.environment).toBe('sandbox');
      const pubs = await reopened.open('mission-w5-test');
      expect(pubs.artifacts.publications.length).toBe(3);
      expect(pubs.artifacts.experiments.length).toBe(2);
      expect(pubs.artifacts.experiments.filter((e) => e.result).length).toBe(1);
      expect(pubs.artifacts.simulations.length).toBe(1);
      expect(pubs.artifacts.nextActions.length).toBe(1);
    } finally {
      await reopened.close();
    }
  });
});
