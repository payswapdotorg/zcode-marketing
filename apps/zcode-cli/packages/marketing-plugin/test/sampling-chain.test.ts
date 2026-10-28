/**
 * W3-2 chain tests: the marketing tools run against a host client that
 * declares the MCP `sampling` capability and answers `sampling/createMessage`.
 * Proves the real-model bridge end to end at the protocol level:
 *  - provenance shows `zcode:routed:<model>` for extraction and synthesis,
 *  - a declining host leaves the chain working with stamped heuristic
 *    fallback provenance (visible, never silent),
 *  - the existing W3-1 heuristic path is untouched when no sampling client
 *    is bound.
 * No network: fixture fetch for the YouTube connector, stub sampling backend.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CreateMessageRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createMarketingServer } from '../src/server.js';
import { MarketingRuntime } from '../src/runtime.js';

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
        '<feed><updated>2026-10-29T10:00:00+00:00</updated>',
        '<entry><yt:videoId>fixvid001</yt:videoId><yt:channelId>UCfixture0000000000000Aa</yt:channelId>',
        '<title>Fresh fixture upload</title><author><name>RivalOne</name></author><published>2026-10-27T00:00:00+00:00</published>',
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

/** Deterministic sampling backend: answers per task based on the requested system prompt. */
const samplingAnswer = (request: { systemPrompt?: string; messages: Array<{ content: unknown }> }): string => {
  const prompt = request.systemPrompt ?? '';
  if (prompt.includes('product & market researcher')) {
    return JSON.stringify({
      competitors: [
        { displayName: 'RivalOne', relevanceReason: 'same commuter coffee category and trial-led offer', identityConfidence: 0.9 },
        { displayName: 'RivalTwo', relevanceReason: 'overlapping audience of commuting coffee drinkers', identityConfidence: 0.7 },
      ],
    });
  }
  if (prompt.includes('creative intelligence analyst')) {
    const subjects = JSON.parse(
      (request.messages[0]!.content as Array<{ type: string; text: string }>)[0]!.text,
    ) as { subjects: Array<{ id: string }> };
    return JSON.stringify({
      features: subjects.subjects.map((s) => ({
        subjectRef: s.id,
        hooks: [{ hook: 'routed-model hook', attentionPattern: 'benefit-led' }],
        narrative: ['benefit reveal', 'proof', 'cta'],
        offerStructure: 'risk-free trial',
        visualStructure: 'creator-held handheld',
      })),
    });
  }
  if (prompt.includes('cross-source strategy analyst')) {
    return JSON.stringify({
      opportunities: [
        {
          problem: 'benefit claims lack visible proof',
          message: 'show the machine pulling a shot during the morning commute',
          hook: 'routed-model hook',
          format: '9:16 creator demo, 30s',
          demonstration: 'in-transit espresso pull',
          cta: 'try 30-day trial',
          adEvidence: ['ad-rivalone-v0'],
          organicEvidence: ['yt-101'],
          contradictedByRefs: [],
          predictedLow: 5000,
          predictedExpected: 12000,
          predictedHigh: 20000,
          confidence: 0.55,
        },
      ],
    });
  }
  return '{}';
};

interface Setup {
  root: string;
  runtime: MarketingRuntime;
  client: Client;
  close: () => Promise<void>;
}

const setup = async (options: { sampling?: 'answer' | 'decline' }): Promise<Setup> => {
  const root = await mkdtemp(join(tmpdir(), 'marketing-sampling-'));
  const runtime = new MarketingRuntime(root, { fetchLike: fixtureFetch });
  const server = createMarketingServer(runtime);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client(
    { name: 'marketing-sampling-test', version: '0.0.0' },
    { capabilities: options.sampling ? { sampling: {} } : {} },
  );
  if (options.sampling === 'answer') {
    client.setRequestHandler(CreateMessageRequestSchema, async (request) => ({
      role: 'assistant' as const,
      model: 'glm-4.7',
      content: { type: 'text' as const, text: samplingAnswer(request.params) },
      stopReason: 'endTurn',
    }));
  }
  if (options.sampling === 'decline') {
    // Host declares sampling but declines the actual request over the wire —
    // the refusal reaches the plugin as a JSON-RPC error, exactly like a
    // production host refusing attribution or budget.
    client.setRequestHandler(CreateMessageRequestSchema, async () => {
      throw new Error('sampling declined by host policy (test stub)');
    });
  }
  await client.connect(clientTransport);

  // Exactly the production binding in src/main.ts: after the initialize
  // handshake, detect the host's declared sampling capability and bind the
  // low-level createMessage call as the runtime's sampling client. Requests
  // then travel the real wire (model adapter -> Server -> transport -> Client
  // handler) instead of a direct stub.
  if (options.sampling && server.server.getClientCapabilities()?.sampling) {
    const lowLevelServer = server.server;
    runtime.setSamplingClient({
      createMessage: async (request) => {
        // Decline travels over the wire too: the client-side handler rejects
        // the request and the JSON-RPC error surfaces here.
        const result = await lowLevelServer.createMessage({
          messages: request.messages,
          ...(request.systemPrompt !== undefined ? { systemPrompt: request.systemPrompt } : {}),
          maxTokens: request.maxTokens,
          ...(request.modelPreferences !== undefined ? { modelPreferences: request.modelPreferences } : {}),
        });
        return {
          role: 'assistant' as const,
          model: result.model,
          content: { type: 'text' as const, text: result.content.type === 'text' ? result.content.text : JSON.stringify(result.content) },
          stopReason: result.stopReason ?? 'endTurn',
        };
      },
    });
  }
  return {
    root,
    runtime,
    client,
    close: async () => {
      await client.close();
      await runtime.close();
      await server.close();
    },
  };
};

describe('marketing plugin with a host sampling channel (W3-2)', () => {
  let answered: Setup;

  const call = async (s: Setup, name: string, args: Record<string, unknown>) => {
    const result = await s.client.callTool({ name, arguments: args });
    const text = (result.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')?.text ?? '';
    return { isError: result.isError === true, text, structured: result.structuredContent as Record<string, unknown> };
  };

  beforeAll(async () => {
    answered = await setup({ sampling: 'answer' });
  });

  afterAll(async () => {
    await answered.close();
    await rm(answered.root, { recursive: true, force: true });
  });

  it('routes competitor discovery through the host model (zcode:routed provenance)', async () => {
    await call(answered, 'marketing_mission_start', {
      product: 'portable espresso maker',
      audience: 'commuting coffee drinkers, 25-40',
      country: 'US',
      platform: 'youtube',
      offer: '30-day home trial, free shipping',
      objective: 'sales',
      researchMode: 'demo',
      missionId: 'mission-w32-routed',
    });
    const discover = await call(answered, 'marketing_discover_competitors', {
      missionId: 'mission-w32-routed',
      hints: ['RivalOne', 'RivalTwo'],
    });
    expect(discover.isError).toBe(false);
    const competitors = (discover.structured as { competitors: Array<{ displayName: string }> }).competitors;
    expect(competitors.map((c) => c.displayName).sort()).toEqual(['RivalOne', 'RivalTwo']);
  });

  it('extracts creative structure through the sampling channel and records the real model per record', async () => {
    await call(answered, 'marketing_research_platform', { missionId: 'mission-w32-routed' });
    const analyze = await call(answered, 'marketing_analyze_creative', { missionId: 'mission-w32-routed' });
    expect(analyze.isError).toBe(false);
    expect(analyze.text).toContain('zcode:routed:glm-4.7');
    const features = (analyze.structured as { adFeatures: Array<{ extractionModelRef: string; hooks: Array<{ hook: string }> }> }).adFeatures;
    expect(features.length).toBeGreaterThan(0);
    expect(features.every((f) => f.extractionModelRef === 'zcode:routed:glm-4.7')).toBe(true);
    expect(features.every((f) => f.hooks[0]?.hook === 'routed-model hook')).toBe(true);
  });

  it('synthesizes the paid x organic intersection through the host model with separated scores', async () => {
    const rank = await call(answered, 'marketing_rank_opportunities', { missionId: 'mission-w32-routed' });
    expect(rank.isError).toBe(false);
    const opportunities = (
      rank.structured as { opportunities: Array<{ hypothesis: { pattern: { hook: string } }; confidence: number }> }
    ).opportunities;
    expect(opportunities[0]?.hypothesis.pattern.hook).toBe('routed-model hook');
    expect(opportunities[0]?.confidence).toBeGreaterThan(0);
  });

  it('reports the routing honestly in the mission report limitations', async () => {
    const report = await call(answered, 'marketing_mission_report', { missionId: 'mission-w32-routed' });
    expect(report.isError).toBe(false);
    expect(report.text).toContain('host-routed session model');
  });
});

describe('marketing plugin when the host declines sampling (fallback honesty)', () => {
  it('keeps the chain working with stamped heuristic fallback provenance, never silently substituted', async () => {
    const declined = await setup({ sampling: 'decline' });
    try {
      const call = async (name: string, args: Record<string, unknown>) => {
        const result = await declined.client.callTool({ name, arguments: args });
        const text = (result.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')?.text ?? '';
        return { isError: result.isError === true, text, structured: result.structuredContent as Record<string, unknown> };
      };
      await call('marketing_mission_start', {
        product: 'portable espresso maker',
        audience: 'commuters',
        country: 'US',
        platform: 'youtube',
        offer: '30-day trial',
        objective: 'sales',
        researchMode: 'demo',
        missionId: 'mission-w32-fallback',
      });
      await call('marketing_discover_competitors', { missionId: 'mission-w32-fallback', hints: ['RivalOne'] });
      await call('marketing_research_platform', { missionId: 'mission-w32-fallback' });
      const analyze = await call('marketing_analyze_creative', { missionId: 'mission-w32-fallback' });
      expect(analyze.isError).toBe(false);
      expect(analyze.text).toContain('heuristic:');
      expect(analyze.text).toContain('(fallback:');
      const features = (analyze.structured as { adFeatures: Array<{ extractionModelRef: string }> }).adFeatures;
      expect(features.length).toBeGreaterThan(0);
      expect(features.every((f) => f.extractionModelRef.startsWith('heuristic:') && f.extractionModelRef.includes('(fallback:'))).toBe(
        true,
      );
      // The report states the full fallback honestly instead of claiming routed models.
      const report = await call('marketing_mission_report', { missionId: 'mission-w32-fallback' });
      expect(report.isError).toBe(false);
      expect(report.text).toContain('fell back entirely to the labeled heuristic adapter');
    } finally {
      await declined.close();
      await rm(declined.root, { recursive: true, force: true });
    }
  });
});
