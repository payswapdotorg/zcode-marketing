/**
 * W4 creative-handoff tool-chain tests: the user takes a recommendation into
 * a creative platform (draft pack → prompt packs), produces an asset, and
 * brings it back into the SAME mission (import → record + rubric → compare),
 * with explicit review/approval gates and honest rubric reporting throughout.
 *
 * No network: fixtures drive the connectors; the heuristic model port stands
 * in for extraction/drafting (labeled, as in every prior wave's tests).
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMarketingServer } from '../src/server.js';
import { MarketingRuntime } from '../src/runtime.js';

const fixtureFetch = async (url: string): Promise<{ status: number; body: string }> => {
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

const atcCreatives = {
  1: [
    {
      1: 'AR14412319853346029569',
      2: 'CR15113976961002635265',
      3: { 3: { 2: '<img src="https://tpc.googlesyndication.com/archive/simgad/1.png" height="503" width="348">' }, 5: true },
      4: 1,
      6: { 1: '1698208917', 2: 503414000 },
      7: { 1: '1787606306', 2: 228676000 },
      12: 'Wacaco Company Limited',
      13: 670,
    },
  ],
};

let atcCalls = 0;
const atcFixtureFetch = (url: string, init?: { body?: string }) => {
  const body = init?.body ?? '';
  if (url.endsWith('SearchSuggestions')) {
    return Promise.resolve({
      status: 200,
      json: async () => [
        { 1: [{ 1: 'Wacaco Company Limited', 2: 'AR14412319853346029569', 3: 'HK', 4: { 2: { 1: '100', 2: '200' } } }] },
      ],
    });
  }
  atcCalls += 1;
  void body;
  return Promise.resolve({ status: 200, json: async () => atcCreatives });
};

describe('W4 creative handoff tool chain', () => {
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
    root = await mkdtemp(join(tmpdir(), 'marketing-w4-'));
    runtime = new MarketingRuntime(root, {
      fetchLike: fixtureFetch,
      transparencyFetchLike: atcFixtureFetch as never,
    });
    const server = createMarketingServer(runtime, { panelHtml: async () => '<!doctype html><html></html>' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'marketing-w4-test', version: '0.0.0' });
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

  it('runs research → rank → draft → review → produce → record → compare end to end', async () => {
    // Research chain (W3 tools, demo mode: labeled synthetic fixtures).
    await call('marketing_mission_start', {
      product: 'portable espresso maker',
      audience: 'commuting coffee drinkers',
      country: 'US',
      platform: 'youtube',
      offer: '30-day home trial, free shipping',
      objective: 'sales',
      constraints: ['no discount-first messaging'],
      researchMode: 'demo',
      missionId: 'mission-w4-test',
    });
    await call('marketing_discover_competitors', {
      missionId: 'mission-w4-test',
      hints: ['RivalOne', 'RivalTwo'],
      confirm: ['RivalOne'],
    });
    const research = await call('marketing_research_platform', { missionId: 'mission-w4-test' });
    expect(research.isError).toBe(false);

    // Rank: hypotheses persist for drafting.
    const rank = await call('marketing_rank_opportunities', { missionId: 'mission-w4-test' });
    expect(rank.isError).toBe(false);
    const opportunities = (rank.structured as { opportunities: Array<{ hypothesis: { id: string } }> }).opportunities;
    expect(opportunities.length).toBeGreaterThan(0);
    const hypothesisId = opportunities[0].hypothesis.id;

    // Draft the handoff pack (default = top-ranked hypothesis).
    const draft = await call('marketing_draft_creative', { missionId: 'mission-w4-test' });
    expect(draft.isError).toBe(false);
    const artifact = (draft.structured as { artifact: { id: string; kindOf: string; status: string; hypothesisId: string; brief: Record<string, unknown> } }).artifact;
    expect(artifact.kindOf).toBe('promptPack');
    expect(artifact.status).toBe('review');
    expect(artifact.hypothesisId).toBe(hypothesisId);
    const brief = artifact.brief as {
      script: Array<{ startSec: number; endSec: number; line: string }>;
      storyboard: Array<{ beat: string; visual: string }>;
      generatorPromptPacks: { videoGen: { prompt: string; negativeConstraints: string[] }; thumbnail: { prompt: string }; copy: { titleVariants: string[]; ctaLine: string } };
      experimentSpec: { hypothesisId: string; metric: string; windowDays: number };
      draftedBy: string;
    };
    // The W4 pack: timed script, storyboard, generator-specific prompts, spec.
    expect(brief.script.length).toBe(4);
    expect(brief.script[0].endSec).toBeLessThanOrEqual(3);
    expect(brief.storyboard.length).toBe(4);
    expect(brief.generatorPromptPacks.videoGen.prompt).toContain('Hook:');
    expect(brief.generatorPromptPacks.videoGen.negativeConstraints).toContain('no competitor trademarks');
    expect(brief.generatorPromptPacks.copy.titleVariants.length).toBeGreaterThanOrEqual(2);
    expect(brief.experimentSpec.metric).toBe('attributedConversions');
    expect(brief.experimentSpec.windowDays).toBe(14);
    expect(typeof brief.draftedBy).toBe('string');

    // Review: approval is explicit and gated.
    const approve = await call('marketing_review_artifact', {
      missionId: 'mission-w4-test',
      artifactId: artifact.id,
      decision: 'approve',
      reviewedBy: 'product owner',
    });
    expect(approve.isError).toBe(false);
    expect((approve.structured as { artifact: { status: string; approvedBy?: string } }).artifact.status).toBe('approved');
    expect((approve.structured as { artifact: { approvedBy?: string } }).artifact.approvedBy).toBe('product owner');
    // Double-approval is refused (invalid transition).
    const again = await call('marketing_review_artifact', {
      missionId: 'mission-w4-test',
      artifactId: artifact.id,
      decision: 'approve',
      reviewedBy: 'product owner',
    });
    expect(again.isError).toBe(true);
    expect(again.text).toContain('invalid_transition');

    // Produce + bring back: chunked import of a real (fixture) video file.
    const bytes = Buffer.from('fake-mp4-bytes-for-the-w4-gate');
    const begin = await call('marketing_asset_import_begin', {
      missionId: 'mission-w4-test',
      name: 'ad-v1.mp4',
      size: bytes.byteLength,
    });
    expect(begin.isError).toBe(false);
    const importId = (begin.structured as { id: string }).id;
    await call('marketing_asset_import_write', {
      id: importId,
      offset: 0,
      data: bytes.toString('base64'),
    });
    const finish = await call('marketing_asset_import_finish', { id: importId });
    expect(finish.isError).toBe(false);
    const file = finish.structured as { name: string; bytes: number; path: string };
    expect(file.bytes).toBe(bytes.byteLength);
    expect(file.path).toMatch(/^\.zcode\/marketing\/missions\/mission-w4-test\/assets\//);

    // Declared size mismatch aborts honestly.
    const bad = await call('marketing_asset_import_begin', {
      missionId: 'mission-w4-test',
      name: 'bad.bin',
      size: 128,
    });
    const badId = (bad.structured as { id: string }).id;
    await call('marketing_asset_import_write', { id: badId, offset: 0, data: Buffer.from('short').toString('base64') });
    const badFinish = await call('marketing_asset_import_finish', { id: badId });
    expect(badFinish.isError).toBe(true);
    expect(badFinish.text).toContain('declared 128 bytes');

    // Record the produced asset against the pack → the versioned rubric runs.
    const record = await call('marketing_record_asset', {
      missionId: 'mission-w4-test',
      artifactId: artifact.id,
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
    const rubric = (record.structured as { rubric: { rubricVersion: string; verdict: string; score: number; checks: Array<{ id: string; severity: string }>; assessedBy: string } }).rubric;
    expect(rubric.rubricVersion).toBe('v1');
    expect(rubric.verdict).toBe('ready');
    expect(rubric.score).toBe(1);
    expect(rubric.checks.some((c) => c.id === 'file-present' && c.severity === 'pass')).toBe(true);
    expect(rubric.assessedBy).toMatch(/^heuristic:/);

    // A discount-constrained brief + discount copy fails the rubric honestly.
    const badRecord = await call('marketing_record_asset', {
      missionId: 'mission-w4-test',
      artifactId: artifact.id,
      format: 'video',
      durationSec: 28,
      aspectRatio: '9:16',
      hookText: 'Espresso anywhere',
      proofText: 'before/after demo',
      ctaText: 'Buy now',
      transcriptOrCopy: 'Espresso anywhere. 50% off today only — limited offer. Buy now.',
    });
    expect(badRecord.isError).toBe(false);
    const badRubric = (badRecord.structured as { rubric: { verdict: string; checks: Array<{ id: string; severity: string }> } }).rubric;
    expect(badRubric.verdict).toBe('blocked');
    expect(badRubric.checks.some((c) => c.id.startsWith('brand-constraint:') && c.severity === 'fail')).toBe(true);

    // Compare: both recorded assets appear with their rubric outcomes.
    const compare = await call('marketing_compare_assets', { missionId: 'mission-w4-test' });
    expect(compare.isError).toBe(false);
    const comparisons = (compare.structured as { comparisons: Array<{ rubricVerdict: string; rubricScore: number }> }).comparisons;
    expect(comparisons.length).toBe(2);
    expect(comparisons.some((c) => c.rubricVerdict === 'ready')).toBe(true);
    expect(comparisons.some((c) => c.rubricVerdict === 'blocked')).toBe(true);
  });

  it('persists creative state across process restarts (artifacts file)', async () => {
    // Fresh runtime over the same workspace: hypotheses + artifacts survive.
    const reopened = new MarketingRuntime(root, { fetchLike: fixtureFetch });
    try {
      const server = createMarketingServer(reopened, { panelHtml: async () => '<!doctype html><html></html>' });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      const client2 = new Client({ name: 'marketing-w4-reopen', version: '0.0.0' });
      await client2.connect(clientTransport);
      try {
        const result = await client2.callTool({
          name: 'marketing_list_artifacts',
          arguments: { missionId: 'mission-w4-test' },
        });
        expect(result.isError === true).toBe(false);
        const structured = result.structuredContent as {
          hypotheses: Array<{ id: string }>;
          artifacts: Array<{ id: string; status: string; kindOf: string }>;
        };
        expect(structured.hypotheses.length).toBeGreaterThan(0);
        expect(structured.artifacts.some((a) => a.kindOf === 'promptPack' && a.status === 'approved')).toBe(true);
        expect(structured.artifacts.some((a) => a.kindOf === 'uploadedAsset')).toBe(true);
        // Drafting by persisted hypothesis id works after restart.
        const draft = await client2.callTool({
          name: 'marketing_draft_creative',
          arguments: { missionId: 'mission-w4-test', hypothesisId: structured.hypotheses[0].id },
        });
        expect(draft.isError === true).toBe(false);
      } finally {
        await client2.close();
        await server.close();
      }
    } finally {
      await reopened.close();
    }
    // The artifacts file is on disk, under the mission workspace, valid JSON.
    const raw = JSON.parse(
      await readFile(join(root, '.zcode', 'marketing', 'missions', 'mission-w4-test-artifacts.json'), 'utf8'),
    ) as { kind: string; version: number };
    expect(raw.kind).toBe('marketing-mission-artifacts');
    expect(raw.version).toBe(1);
  });

  it('refuses drafting before ranking and comparison before recording (honest gaps)', async () => {
    await call('marketing_mission_start', {
      product: 'cold brew concentrate',
      audience: 'iced coffee fans',
      country: 'US',
      platform: 'youtube',
      offer: 'summer bundle',
      objective: 'awareness',
      researchMode: 'demo',
      missionId: 'mission-w4-empty',
    });
    const draft = await call('marketing_draft_creative', { missionId: 'mission-w4-empty' });
    expect(draft.isError).toBe(true);
    expect(draft.text).toContain('nothing_to_draft');
    const compare = await call('marketing_compare_assets', { missionId: 'mission-w4-empty' });
    expect(compare.isError).toBe(true);
    expect(compare.text).toContain('nothing_to_compare');
  });
});
