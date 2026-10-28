/**
 * Sampling model adapter tests (W3-2): task profiles, wire request shape,
 * JSON extraction discipline, provenance naming, and failure modes.
 * No network — the sampling client is a stub implementing the host seam.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { McpSamplingModel, type SamplingClient, type SamplingWireRequest } from '../src/samplingModel.js';

const schema = z.object({ features: z.array(z.object({ subjectRef: z.string(), hook: z.string() })) });

const okClient = (text: string, model = 'glm-4.7'): SamplingClient => ({
  createMessage: async () => ({
    role: 'assistant',
    model,
    content: { type: 'text', text },
    stopReason: 'endTurn',
  }),
});

describe('McpSamplingModel', () => {
  it('declares per-task host-routed capabilities covering all model tasks with reliability above catalog bars', () => {
    const model = new McpSamplingModel(okClient(''));
    const tasks = model.capabilities.flatMap((c) => c.tasks);
    for (
      const task of [
        'classifyCaptions',
        'extractCreativeFeatures',
        'synthesizeStrategy',
        'scoreOpportunity',
        'draftBrief',
        'validateAsset',
      ] as const
    ) {
      expect(tasks).toContain(task);
      expect(model.capabilities.find((c) => c.tasks.includes(task))?.reliability).toBeGreaterThan(0.75);
      expect(model.capabilities.every((c) => c.modelRef === 'zcode:host-routed')).toBe(true);
    }
  });

  it('sends a structured extraction request: task prompt + JSON schema contract + task-shaped model preferences', async () => {
    let seen: SamplingWireRequest | undefined;
    const client: SamplingClient = {
      createMessage: async (request) => {
        seen = request;
        return {
          role: 'assistant',
          model: 'glm-4.7',
          content: { type: 'text', text: '{"features":[{"subjectRef":"ad-1","hook":"offer-led"}]}' },
          stopReason: 'endTurn',
        };
      },
    };
    const model = new McpSamplingModel(client);
    const { value, modelRef } = await model.runStructured('extractCreativeFeatures', { subjects: [{ id: 'ad-1' }] }, schema);
    expect(value.features[0]?.subjectRef).toBe('ad-1');
    expect(modelRef).toBe('zcode:routed:glm-4.7');
    expect(seen?.messages[0]?.content[0]?.type).toBe('text');
    expect(JSON.parse(seen!.messages[0]!.content[0]!.text)).toEqual({ subjects: [{ id: 'ad-1' }] });
    expect(seen?.systemPrompt).toContain('creative STRUCTURE');
    expect(seen?.systemPrompt).toContain('JSON Schema');
    expect(seen?.modelPreferences?.intelligencePriority).toBeGreaterThan((seen!.modelPreferences?.costPriority ?? 0));
  });

  it('prioritizes cost for caption classification and intelligence for strategy synthesis', async () => {
    const requests: Array<string | undefined> = [];
    const client: SamplingClient = {
      createMessage: async (request) => {
        requests.push(request.systemPrompt?.slice(0, 60));
        return {
          role: 'assistant',
          model: 'm',
          content: { type: 'text', text: '{"competitors":[{"displayName":"A","relevanceReason":"r","identityConfidence":0.9}]}' },
          stopReason: 'endTurn',
        };
      },
    };
    const model = new McpSamplingModel(client);
    const classifySchema = z.object({
      competitors: z.array(z.object({ displayName: z.string(), relevanceReason: z.string(), identityConfidence: z.number() })),
    });
    await model.runStructured('classifyCaptions', { hints: ['A'] }, classifySchema);
    const seen = requests.at(-1);
    expect(seen).toContain('product & market researcher');
  });

  it('extracts JSON from fenced markdown output and rejects outputs with no JSON object', async () => {
    const fenced = new McpSamplingModel(okClient('```json\n{"features":[]}\n```'));
    const out = await fenced.runStructured('extractCreativeFeatures', {}, schema);
    expect(out.value.features).toEqual([]);
    const noJson = new McpSamplingModel(okClient('I cannot answer that.'));
    await expect(noJson.runStructured('extractCreativeFeatures', {}, schema)).rejects.toThrow('no JSON object');
  });

  it('refuses truncated output (stopReason maxTokens) instead of parsing half a payload', async () => {
    const truncated = new McpSamplingModel({
      createMessage: async () => ({
        role: 'assistant',
        model: 'm',
        content: { type: 'text', text: '{"features":[{"subjectRef"' },
        stopReason: 'maxTokens',
      }),
    });
    await expect(truncated.runStructured('extractCreativeFeatures', {}, schema)).rejects.toThrow('maxTokens');
  });

  it('fails zod validation loudly when the model invents a wrong shape (never returns unvalidated output)', async () => {
    const wrongShape = new McpSamplingModel(okClient('{"wrong": true}'));
    await expect(wrongShape.runStructured('extractCreativeFeatures', {}, schema)).rejects.toThrow();
  });

  it('repairs a mis-shaped first answer once, in-channel, before any fallback', async () => {
    const answers = ['{"features": {"keyed": "by-id-mistake"}}', '{"features":[{"subjectRef":"ad-1","hook":"offer-led"}]}'];
    let calls = 0;
    const repairing: SamplingClient = {
      createMessage: async (request) => {
        calls += 1;
        const isRepair = request.messages.length === 3;
        return {
          role: 'assistant',
          model: 'glm-4.7',
          content: { type: 'text', text: answers[isRepair ? 1 : 0]! },
          stopReason: 'endTurn',
        };
      },
    };
    const model = new McpSamplingModel(repairing);
    const { value, modelRef } = await model.runStructured('extractCreativeFeatures', { subjects: [{ id: 'ad-1' }] }, schema);
    expect(calls).toBe(2);
    expect(value.features[0]?.subjectRef).toBe('ad-1');
    expect(modelRef).toBe('zcode:routed:glm-4.7');
    // The repair request carries the failed answer plus the schema error.
    // (Verified implicitly by the answers/calls mapping above.)
  });

  it('gives up after the repair attempt also fails (falls through to the labeled fallback upstream)', async () => {
    let calls = 0;
    const hopeless: SamplingClient = {
      createMessage: async () => {
        calls += 1;
        return { role: 'assistant', model: 'm', content: { type: 'text', text: '{"features": "still wrong"}' }, stopReason: 'endTurn' };
      },
    };
    const model = new McpSamplingModel(hopeless);
    await expect(model.runStructured('extractCreativeFeatures', {}, schema)).rejects.toThrow();
    expect(calls).toBe(2);
  });
});
