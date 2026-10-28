/**
 * FallbackModelPort tests (W3-2): production-primary routing honesty rules —
 * the fallback never appears as a production capability, failures stamp the
 * reason into provenance, and both-failed surfaces the primary error.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FallbackModelPort, HeuristicModel, type ModelCapability, type ModelPort } from '@zcode/marketing';

const schema = z.object({ features: z.array(z.object({ subjectRef: z.string() })) });

const port = (behavior: {
  capabilities: ModelPort['capabilities'];
  value?: unknown;
  fail?: Error;
}): ModelPort => ({
  capabilities: behavior.capabilities,
  runStructured: async () => {
    if (behavior.fail) throw behavior.fail;
    return { value: schema.parse(behavior.value), modelRef: 'stub:model' };
  },
});

/** A minimal declared production capability so the composite accepts the primary. */
const declared: ModelCapability[] = [
  { modelRef: 'zcode:host-routed', tasks: ['extractCreativeFeatures'], relativeCost: 0.6, reliability: 0.85, structuredOutput: true },
];

const input = { subjects: [{ id: 'ad-1' }, { id: 'ad-2' }] };

describe('FallbackModelPort', () => {
  it('exposes ONLY the primary port capabilities — the stand-in never competes for production routes', () => {
    const primary = port({ capabilities: declared, value: { features: [] } });
    const composite = new FallbackModelPort(primary, new HeuristicModel());
    expect(composite.capabilities).toEqual(primary.capabilities);
    expect(composite.capabilities.some((c) => c.modelRef.startsWith('heuristic:'))).toBe(false);
  });

  it('routes to the primary and records the real modelRef on success', async () => {
    const primary = port({ capabilities: declared, value: { features: [{ subjectRef: 'ad-1' }] } });
    const composite = new FallbackModelPort(primary, new HeuristicModel());
    const out = await composite.runStructured('extractCreativeFeatures', input, schema);
    expect(out.modelRef).toBe('stub:model');
    expect(out.value.features[0]?.subjectRef).toBe('ad-1');
  });

  it('falls back with the reason stamped into provenance — visible, never silent', async () => {
    const failing = port({ capabilities: declared, fail: new Error('host declined sampling for marketing') });
    const composite = new FallbackModelPort(failing, new HeuristicModel());
    const out = await composite.runStructured('extractCreativeFeatures', input, schema);
    expect(out.modelRef).toContain('heuristic:');
    expect(out.modelRef).toContain('(fallback: host declined sampling for marketing)');
  });

  it('keeps working end-to-end with the real heuristic adapter behind a failing primary', async () => {
    const failing = port({ capabilities: declared, fail: new Error('channel down') });
    const composite = new FallbackModelPort(failing, new HeuristicModel());
    const out = await composite.runStructured('extractCreativeFeatures', input, schema);
    // Real heuristic output for two subjects — the W3-1 behavior, now as fallback.
    expect(out.value.features.length).toBe(2);
  });

  it('surfaces the primary failure when BOTH channels fail (no masking)', async () => {
    const failing = port({ capabilities: declared, fail: new Error('primary unavailable') });
    const alsoFailing = port({ capabilities: declared, fail: new Error('stand-in broken') });
    const composite = new FallbackModelPort(failing, alsoFailing);
    await expect(composite.runStructured('extractCreativeFeatures', input, schema)).rejects.toThrow(
      /primary unavailable.*stand-in broken/s,
    );
  });

  it('requires a primary with declared capabilities (empty production declarations are a wiring bug)', () => {
    expect(() => new FallbackModelPort(port({ capabilities: [], value: {} }), new HeuristicModel())).toThrow(
      /primary with declared capabilities/,
    );
  });
});
