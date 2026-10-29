/**
 * Marketing plugin tool-chain tests (W3-1).
 *
 * Runs the marketing MCP tools through an in-process McpServer against a temp
 * workspace — mission lifecycle, connector composition, idempotent research,
 * honest coverage, evidence reports — plus the live-mode paid-gap refusal.
 * No network: the YouTube connector runs on an injected fixture fetch.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMarketingServer } from '../src/server.js';
import { MarketingRuntime } from '../src/runtime.js';

/** Fixture fetch: channel resolution + uploads feed + oEmbed, keyless shapes. */
const fixtureFetch = async (url: string): Promise<{ status: number; body: string }> => {
  if (url.startsWith('https://www.youtube.com/@') || /^https:\/\/www\.youtube\.com\/[\w.-]{2,40}$/.test(url)) {
    return {
      status: 200,
      body: '<html><head><meta itemprop="channelId" content="UCfixture0000000000000Aa"><script>var ytInitialData = {"externalId":"UCfixture0000000000000Aa"};</script></head></html>',
    };
  }
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
    return { status: 200, body: JSON.stringify({ title: 'Fresh fixture upload', thumbnail_url: 'https://example.invalid/t.jpg' }) };
  }
  return { status: 404, body: '' };
};

/**
 * Google Ads Transparency Center wire fixtures — REAL recorded responses
 * (captured live 2026-10-29 against the public service, region US; see
 * docs/marketing/evidence/2026-10-29-w1-ad-source-google-atc.txt). Trimmed to
 * the first creatives; field numbers are the service's own wire format.
 */
const WACACO_SUGGESTIONS = {
  1: [
    { 1: { 1: 'Wacaco Company Limited', 2: 'AR14412319853346029569', 3: 'HK', 4: { 2: { 1: '100', 2: '200' } } } },
    { 2: { 1: 'wacaco.com' } },
  ],
};
const WACACO_CREATIVES_PAGE_1 = {
  1: [
    {
      1: 'AR14412319853346029569',
      2: 'CR15113976961002635265',
      3: { 3: { 2: '<img src="https://tpc.googlesyndication.com/archive/simgad/12660767253002200144" height="503" width="348">' }, 5: true },
      4: 1,
      6: { 1: '1698208917', 2: 503414000 },
      7: { 1: '1787606306', 2: 228676000 },
      12: 'Wacaco Company Limited',
      13: 670,
    },
    {
      1: 'AR14412319853346029569',
      2: 'CR01878771699185352705',
      3: { 3: { 2: '<img src="https://tpc.googlesyndication.com/archive/simgad/9430771652111319698" height="277" width="364">' } },
      4: 1,
      6: { 1: '1698209691', 2: 124888000 },
      7: { 1: '1787571022', 2: 961688000 },
      12: 'Wacaco Company Limited',
      13: 955,
    },
    {
      1: 'AR14412319853346029569',
      2: 'CR10768865612584189953',
      3: { 1: { 4: 'https://displayads-formats.googleusercontent.com/ads/preview/content.js?client=ads-integrity-transparency&obfuscatedCustomerId=3668818780&creativeId=700805243666&uiFeatures=12,54&adGroupId=161597968686&itemIds=17473667542164887519&sig=ACiVB_xhnf-pCPR4Ff1HpYe2w2TirxsL8Q' } },
      4: 2,
      6: { 1: '1716876239', 2: 331169000 },
      7: { 1: '1787569050', 2: 52049000 },
      12: 'Wacaco Company Limited',
      13: 770,
    },
  ],
  2: 'CgoAP7zmmCYkvBaDEhD-irPsdQf0UQ1IlgMAAAAAGhn8-Gwm-PuuTsA=',
  4: '97',
  5: '97',
};
const WACACO_CREATIVES_PAGE_2 = {
  1: [
    // Duplicate of page 1 entry — exercises local dedupe + store idempotency.
    {
      1: 'AR14412319853346029569',
      2: 'CR15113976961002635265',
      3: { 3: { 2: '<img src="https://tpc.googlesyndication.com/archive/simgad/12660767253002200144" height="503" width="348">' }, 5: true },
      4: 1,
      6: { 1: '1698208917', 2: 503414000 },
      7: { 1: '1787606306', 2: 228676000 },
      12: 'Wacaco Company Limited',
      13: 670,
    },
    {
      1: 'AR14412319853346029569',
      2: 'CR04109150251812651009',
      3: { 1: { 4: 'https://displayads-formats.googleusercontent.com/ads/preview/content.js?client=ads-integrity-transparency&obfuscatedCustomerId=3668818780&creativeId=700805243423&uiFeatures=12,54&adGroupId=161597966846&versionId=1&sig=ACiVB_ylsMl25_sn6QP8YBUbOv1C4Tk4AQ' } },
      4: 3,
      6: { 1: '1753546944', 2: 336710000 },
      7: { 1: '1787551993', 2: 271192000 },
      12: 'Wacaco Company Limited',
      13: 260,
    },
  ],
  4: '97',
  5: '97',
};

/** Transparency fixture fetch: recorded wire payloads; unknown names resolve to {} (honest empty). */
let atcCreativesCalls = 0;
const atcFixtureFetch = async (url: string, body: string): Promise<{ status: number; body: string }> => {
  const decoded = decodeURIComponent(body);
  if (url.includes('SearchSuggestions')) {
    if (decoded.includes('Wacaco')) return { status: 200, body: JSON.stringify(WACACO_SUGGESTIONS) };
    return { status: 200, body: '{}' }; // honest empty — no invented advertisers
  }
  if (url.includes('SearchCreatives')) {
    atcCreativesCalls += 1;
    return { status: 200, body: JSON.stringify(atcCreativesCalls === 1 ? WACACO_CREATIVES_PAGE_1 : WACACO_CREATIVES_PAGE_2) };
  }
  return { status: 404, body: '' };
};

describe('marketing plugin tool chain', () => {
  let root: string;
  let runtime: MarketingRuntime;
  let client: Client;
  let cleanupServer: (() => Promise<void>) | undefined;

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')?.text ?? '';
    return { isError: result.isError === true, text, structured: result.structuredContent as Record<string, unknown> };
  };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'marketing-plugin-'));
    runtime = new MarketingRuntime(root, { fetchLike: fixtureFetch, transparencyFetchLike: atcFixtureFetch });
    const server = createMarketingServer(runtime);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'marketing-test', version: '0.0.0' });
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

  it('lists zero tools state before missions exist and refuses unknown missions', async () => {
    const list = await call('marketing_mission_list', {});
    expect(list.isError).toBe(false);
    expect(list.text).toContain('No marketing missions yet');
    const unknown = await call('marketing_mission_report', { missionId: 'nope' });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain('unknown mission');
  });

  it('runs the full demo-mode chain: start -> discover -> research -> analyze -> rank -> report', async () => {
    const start = await call('marketing_mission_start', {
      product: 'portable espresso maker',
      audience: 'commuting coffee drinkers, 25-40',
      country: 'US',
      platform: 'youtube',
      offer: '30-day home trial, free shipping',
      objective: 'sales',
      researchMode: 'demo',
      missionId: 'mission-w3-test',
    });
    expect(start.isError).toBe(false);
    expect((start.structured as { missionId: string }).missionId).toBe('mission-w3-test');

    const discover = await call('marketing_discover_competitors', {
      missionId: 'mission-w3-test',
      hints: ['RivalOne', 'RivalTwo'],
      confirm: ['RivalOne'],
    });
    expect(discover.isError).toBe(false);
    const competitors = (discover.structured as { competitors: Array<{ displayName: string; userConfirmed: boolean }> }).competitors;
    expect(competitors.map((c) => c.displayName).sort()).toEqual(['RivalOne', 'RivalTwo']);
    expect(competitors.find((c) => c.displayName === 'RivalOne')?.userConfirmed).toBe(true);

    const research = await call('marketing_research_platform', { missionId: 'mission-w3-test' });
    expect(research.isError).toBe(false);
    const coverage = (research.structured as { coverage: { slices: Array<{ state: string; slice: string }> } }).coverage;
    // Honest coverage: sample fixture slices + real public connector slices.
    expect(coverage.slices.some((s) => s.slice.startsWith('organic-uploads:'))).toBe(true);
    expect(coverage.slices.some((s) => s.state === 'restricted')).toBe(true);
    const ingested = (research.structured as { ingested: { ads: number; organic: number; metrics: number } }).ingested;
    expect(ingested.ads).toBeGreaterThan(0);
    // 2 fixture organic + 1 real fixture-fetched upload.
    expect(ingested.organic).toBeGreaterThanOrEqual(3);

    // Idempotent research (W2 gate through the tool chain): entities never
    // duplicate and fixture metrics at the same observedAt are ignored as
    // duplicates. A live connector legitimately adds a fresh current-snapshot
    // observation per re-fetch (new observedAt = new evidence by design);
    // bounded here by the single fixture-fetched upload.
    const again = await call('marketing_research_platform', { missionId: 'mission-w3-test' });
    const againIngested = (again.structured as { ingested: { ads: number; organic: number; metrics: number } }).ingested;
    expect(againIngested.ads).toBe(ingested.ads);
    expect(againIngested.organic).toBe(ingested.organic);
    expect(againIngested.metrics - ingested.metrics).toBeLessThanOrEqual(1);

    const analyze = await call('marketing_analyze_creative', { missionId: 'mission-w3-test' });
    expect(analyze.isError).toBe(false);
    expect((analyze.structured as { adFeatures: unknown[] }).adFeatures.length).toBeGreaterThan(0);

    const rank = await call('marketing_rank_opportunities', { missionId: 'mission-w3-test' });
    expect(rank.isError).toBe(false);
    const opportunities = (rank.structured as { opportunities: Array<{ hypothesis: { supportedBy: Array<{ ref: string }> }; confidence: number }> }).opportunities;
    expect(opportunities.length).toBeGreaterThan(0);
    // Cross-source evidence discipline (Stage D gate).
    expect(
      opportunities[0]!.hypothesis.supportedBy.some((e) => e.ref.startsWith('ad-')),
    ).toBe(true);
    expect(
      opportunities[0]!.hypothesis.supportedBy.some((e) => e.ref.startsWith('yt-')),
    ).toBe(true);
    expect(opportunities[0]!.confidence).toBeGreaterThan(0);
    expect(opportunities[0]!.confidence).toBeLessThan(1);

    const report = await call('marketing_mission_report', { missionId: 'mission-w3-test' });
    expect(report.isError).toBe(false);
    expect(report.text).toContain('# Marketing intelligence report — mission-w3-test');
    expect(report.text).toContain('## Data coverage (explicit gaps, never silently filled)');
    expect(report.text).toContain('DEMO MODE');
    expect(report.text).toContain('## Limitations (honest)');
    // Evidence refs travel with the opportunities in the report.
    expect(report.text).toContain('ad-rivalone-v0');

    const evidence = await call('marketing_evidence_view', { missionId: 'mission-w3-test' });
    expect(evidence.isError).toBe(false);
    expect(evidence.text).toContain('ingest audit:');
    expect(evidence.text).toContain('duplicates ignored');
  });

  it('persists missions across runtime reopen (SQLite temporal store + JSON index)', async () => {
    const reopened = new MarketingRuntime(root, { fetchLike: fixtureFetch });
    const missions = await reopened.list();
    expect(missions.map((m) => m.missionId)).toContain('mission-w3-test');
    const loaded = await reopened.open('mission-w3-test');
    // W2 persistence gate, now through the plugin runtime: observations survive reopen.
    expect(loaded.mission.store.allAds().length).toBeGreaterThan(0);
    expect(loaded.mission.store.allMetrics().length).toBeGreaterThan(0);
    await reopened.close();
  });

  it('refuses ranking in live mode with an explicit paid-source gap (no invented ads)', async () => {
    const start = await call('marketing_mission_start', {
      product: 'portable espresso maker',
      audience: 'commuting coffee drinkers, 25-40',
      country: 'US',
      platform: 'youtube',
      offer: '30-day trial',
      objective: 'awareness',
      researchMode: 'live',
      missionId: 'mission-live-test',
    });
    expect(start.isError).toBe(false);
    await call('marketing_discover_competitors', { missionId: 'mission-live-test', hints: ['RivalOne'] });
    await call('marketing_research_platform', { missionId: 'mission-live-test' });
    const rank = await call('marketing_rank_opportunities', { missionId: 'mission-live-test' });
    expect(rank.isError).toBe(true);
    expect(rank.text).toContain('paid_source_gap');
    // The report still works and states the gap instead of inventing data.
    const report = await call('marketing_mission_report', { missionId: 'mission-live-test' });
    expect(report.isError).toBe(false);
    expect(report.text).toContain('No ranked opportunities');
    expect(report.text).toContain('W1-3(b)');
  });

  it('live mode ingests real transparency-center ads and ranks a REAL paid x organic intersection', async () => {
    // W1-3(b) closed: live youtube missions get their paid side from the
    // verified Google Ads Transparency Center connector (recorded wire
    // fixtures — no synthetic paid data anywhere in live mode).
    const start = await call('marketing_mission_start', {
      product: 'portable espresso maker',
      audience: 'commuting coffee drinkers, 25-40',
      country: 'US',
      platform: 'youtube',
      offer: '30-day trial',
      objective: 'awareness',
      researchMode: 'live',
      missionId: 'mission-atc-live-test',
    });
    expect(start.isError).toBe(false);
    await call('marketing_discover_competitors', { missionId: 'mission-atc-live-test', hints: ['Wacaco'] });

    const research = await call('marketing_research_platform', { missionId: 'mission-atc-live-test' });
    expect(research.isError).toBe(false);
    const coverage = (research.structured as { coverage: { slices: Array<{ state: string; slice: string }> } }).coverage;
    expect(coverage.slices.some((s) => s.slice === 'paid-ads:Wacaco' && s.state === 'available')).toBe(true);
    expect(
      coverage.slices.some((s) => s.slice === 'paid-delivery-metrics:google-ads-transparency' && s.state === 'unavailable'),
    ).toBe(true);
    const ingested = (research.structured as { ingested: { ads: number; organic: number } }).ingested;
    // 3 creatives on page 1 + 2 on page 2 with one duplicate → 4 unique REAL ads.
    expect(ingested.ads).toBe(4);
    expect(ingested.organic).toBeGreaterThanOrEqual(1);

    const loaded = await runtime.open('mission-atc-live-test');
    const ads = loaded.mission.store.allAds();
    expect(ads.every((a) => a.id.startsWith('atc:'))).toBe(true);
    expect(ads.every((a) => a.platform === 'other' && a.format.startsWith('google-ads:'))).toBe(true);
    expect(
      ads.every((a) => typeof a.availableMetadata.platformReportedFirstShown === 'string'),
    ).toBe(true);

    const rank = await call('marketing_rank_opportunities', { missionId: 'mission-atc-live-test' });
    expect(rank.isError).toBe(false);
    const opportunities = (rank.structured as { opportunities: Array<{ hypothesis: { supportedBy: Array<{ ref: string }> } }> }).opportunities;
    expect(opportunities.length).toBeGreaterThan(0);
    // The intersection references BOTH real paid (atc:*) and real organic (yt:*) evidence.
    expect(opportunities[0]!.hypothesis.supportedBy.some((e) => e.ref.startsWith('atc:'))).toBe(true);
    expect(opportunities[0]!.hypothesis.supportedBy.some((e) => e.ref.startsWith('yt:'))).toBe(true);

    const evidence = await call('marketing_evidence_view', { missionId: 'mission-atc-live-test' });
    expect(evidence.isError).toBe(false);
    expect(evidence.text).toContain('atc:');

    const report = await call('marketing_mission_report', { missionId: 'mission-atc-live-test' });
    expect(report.isError).toBe(false);
    expect(report.text).toContain('Google Ads Transparency Center');
  });

  it('refuses platforms without a verified connector (fail fast, honest)', async () => {
    const start = await call('marketing_mission_start', {
      product: 'test product',
      audience: 'test audience',
      country: 'US',
      platform: 'meta',
      offer: 'test offer',
      objective: 'awareness',
      researchMode: 'live',
      missionId: 'mission-meta-test',
    });
    expect(start.isError).toBe(true);
    expect(start.text).toContain('no verified connector');
  });
});
