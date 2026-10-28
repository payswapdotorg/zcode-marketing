/**
 * Heuristic model adapter — a deterministic ModelPort implementation so the
 * loop is runnable and testable without network or credentials. In production
 * this port is fulfilled by capability-routed models through the existing
 * ZCode provider system (MARKETING-CAPABILITY-MAP.md); the heuristic here is
 * explicitly labeled in every output as internalReasoning evidence.
 */
import type { ModelCapability, ModelPort, ModelTask } from '../app/ports.js';
import { paidFixtures, organicFixtures } from './fixtures.js';

const capabilities: ModelCapability[] = [
  {
    modelRef: 'heuristic:light',
    tasks: ['classifyCaptions', 'scoreOpportunity'],
    relativeCost: 0.1,
    reliability: 0.7,
    structuredOutput: true,
  },
  {
    modelRef: 'heuristic:multimodal',
    tasks: ['extractCreativeFeatures', 'validateAsset'],
    relativeCost: 0.5,
    reliability: 0.8,
    structuredOutput: true,
  },
  {
    modelRef: 'heuristic:reasoner',
    tasks: ['synthesizeStrategy', 'draftBrief', 'scoreOpportunity', 'extractCreativeFeatures', 'validateAsset'],
    relativeCost: 0.9,
    reliability: 0.95,
    structuredOutput: true,
  },
];

export class HeuristicModel implements ModelPort {
  readonly capabilities = capabilities;

  async runStructured<T>(
    task: ModelTask,
    input: unknown,
    outputSchema: { parse: (v: unknown) => T },
  ): Promise<{ value: T; modelRef: string }> {
    const modelRef = task === 'classifyCaptions' ? 'heuristic:light' : task === 'extractCreativeFeatures' ? 'heuristic:multimodal' : 'heuristic:reasoner';
    const raw = this.compute(task, input);
    return { value: outputSchema.parse(raw), modelRef };
  }

  private compute(task: ModelTask, input: unknown): unknown {
    switch (task) {
      case 'classifyCaptions': {
        const req = input as { hints: string[] };
        return {
          competitors: (req.hints.length > 0 ? req.hints : ['RivalOne', 'RivalTwo']).map((name) => ({
            displayName: name,
            relevanceReason: `overlapping product category and audience with the described offer`,
            identityConfidence: 0.8,
          })),
        };
      }
      case 'extractCreativeFeatures': {
        const req = input as { subjects: Array<{ id: string }> };
        return {
          features: req.subjects.map((s) => {
            const isAd = s.id.startsWith('ad-');
            const isMomentum = s.id === 'yt-102';
            return {
              subjectRef: s.id,
              hooks: [
                isAd
                  ? { hook: 'price-first urgency opening', attentionPattern: 'offer-led' }
                  : { hook: isMomentum ? 'creator-led personal benefit reveal' : 'creator-led demonstration', attentionPattern: 'identity-led' },
              ],
              narrative: isAd ? ['offer', 'proof', 'discount-close'] : ['problem', 'in-use demo', 'results'],
              offerStructure: isAd ? 'percentage discount with deadline' : 'implicit value, soft cta',
              visualStructure: isAd ? 'studio product closeups' : 'handheld creator footage, jump cuts',
            };
          }),
        };
      }
      case 'synthesizeStrategy': {
        const hasPaid = paidFixtures.ads.length > 0;
        const hasOrganic = organicFixtures.organic.length > 0;
        return {
          opportunities: [
            {
              problem: 'audience does not believe the benefit claim without proof',
              message: 'show the product delivering the promised benefit in the first 3 seconds',
              hook: 'creator-led personal benefit reveal',
              format: '9:16 creator demo, 30s',
              demonstration: 'side-by-side before/after within creator context',
              cta: 'single low-friction CTA aligned with objective',
              adEvidence: ['ad-rivalone-v0'],
              organicEvidence: ['yt-102', 'yt-101'],
              contradictedByRefs: hasPaid && hasOrganic ? [] : ['coverage-gap: ad library restricted'],
              predictedLow: 8000,
              predictedExpected: 14000,
              predictedHigh: 22000,
              confidence: 0.6,
            },
          ],
        };
      }
      case 'scoreOpportunity':
        return { score: 0.72, rationale: 'cross-source support from paid duration signal + organic velocity' };
      case 'draftBrief':
        return { storyboard: ['creator-led opening with benefit reveal', 'in-use demonstration', 'proof moment', 'single CTA'] };
      case 'validateAsset':
        return { verdict: 'needs-review', issues: [] };
      default:
        throw new Error(`heuristic model cannot perform ${task}`);
    }
  }
}
