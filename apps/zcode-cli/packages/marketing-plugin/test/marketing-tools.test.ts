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
    runtime = new MarketingRuntime(root, { fetchLike: fixtureFetch });
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
