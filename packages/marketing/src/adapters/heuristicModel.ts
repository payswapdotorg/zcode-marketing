/**
 * Heuristic model adapter — a deterministic ModelPort implementation so the
 * loop is runnable and testable without network or credentials. In production
 * this port is fulfilled by capability-routed models through the existing
 * ZCode provider system (MARKETING-CAPABILITY-MAP.md); the heuristic here is
 * explicitly labeled in every output as internalReasoning evidence.
 */
import type { ModelCapability, ModelPort, ModelTask } from '../app/ports.js';

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
            // Paid-side records: synthetic fixtures (ad-*) and real Google Ads
            // Transparency Center creatives (atc:*) share the ad feature shape.
            const isAd = s.id.startsWith('ad-') || s.id.startsWith('atc:');
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
        // Echo the ACTUAL subject refs the caller extracted — the deterministic
        // backend never invents evidence identities. Refusing an empty side
        // beats fabricating refs that exist nowhere in the temporal store.
        const req = input as {
          adFeatures?: Array<{ subject: string }>;
          organicFeatures?: Array<{ subject: string }>;
        };
        const adRefs = (req.adFeatures ?? []).map((f) => f.subject).slice(0, 2);
        const organicRefs = (req.organicFeatures ?? []).map((f) => f.subject).slice(0, 2);
        if (adRefs.length === 0 || organicRefs.length === 0) {
          throw new Error(
            `heuristic model refuses to synthesize the paid x organic intersection with an empty evidence side (ads: ${adRefs.length}, organic: ${organicRefs.length}) — research both sides first`,
          );
        }
        return {
          opportunities: [
            {
              problem: 'audience does not believe the benefit claim without proof',
              message: 'show the product delivering the promised benefit in the first 3 seconds',
              hook: 'creator-led personal benefit reveal',
              format: '9:16 creator demo, 30s',
              demonstration: 'side-by-side before/after within creator context',
              cta: 'single low-friction CTA aligned with objective',
              adEvidence: adRefs,
              organicEvidence: organicRefs,
              contradictedByRefs: [],
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
      case 'draftBrief': {
        // W4 handoff pack shape (deterministic): timed beats, thumbnail prompt,
        // title variants, CTA line — derived strictly from the hypothesis input.
        const req = input as {
          hypothesis?: { hook?: string; demonstration?: string; cta?: string };
          product?: string;
          ctaLine?: string;
        };
        const hook = req.hypothesis?.hook ?? 'creator-led personal benefit reveal';
        const demo = req.hypothesis?.demonstration ?? 'side-by-side before/after within creator context';
        const cta = req.hypothesis?.cta ?? 'single low-friction CTA aligned with objective';
        return {
          beats: [
            { startSec: 0, endSec: 3, line: hook, visual: 'creator-facing camera, benefit stated immediately', onScreenText: hook.slice(0, 40) },
            { startSec: 3, endSec: 15, line: `Watch what happens when ${req.product ?? 'the product'} does the work`, visual: 'handheld in-use demonstration, jump cuts' },
            { startSec: 15, endSec: 25, line: 'the proof moment, unedited', visual: demo },
            { startSec: 25, endSec: 30, line: cta, visual: 'product close-up with single CTA overlay', onScreenText: cta.slice(0, 40) },
          ],
          thumbnailPrompt: `close-up of ${req.product ?? 'the product'} mid-use, expressive creator face, high contrast, no text clutter`,
          titleVariants: [
            `I tested ${req.product ?? 'this'} so you don't have to`,
            `The honest ${req.product ?? 'product'} demo`,
          ],
          ctaLine: cta,
        };
      }
      case 'validateAsset': {
        // Deterministic stand-in: no qualitative issues manufactured — the
        // machine rubric's deterministic checks carry the validation; the
        // heuristic verdict is neutral so nothing is overstated.
        return { verdict: 'needs-review', issues: [] };
      }
      default:
        throw new Error(`heuristic model cannot perform ${task}`);
    }
  }
}
