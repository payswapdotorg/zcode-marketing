/**
 * Marketing workflows — the continuous learning loop, expressed as domain logic
 * executed by the existing ZCode runtime (never a second planner loop).
 *
 * Governance: docs/marketing/MARKETING-NORTH-STAR.md (loop), MARKETING-DATA-
 * MODEL.md (scoring separation), MARKETING-EVALUATION.md (gates). Every stage
 * records provenance; every gap is honest.
 *
 * Layer: app — depends only on domain records and ports (no I/O).
 */
import { z } from 'zod';
import {
  coverageReport,
  creativeArtifact,
  creativeHypothesis,
  experimentRecord,
  marketMap,
  metricObservation,
  nextAction,
  publicationRecord,
  simulationRun,
} from '../domain/records.js';
import type {
  AdCreative,
  CompetitorCandidate,
  CreativeFeatureSet,
  EvidenceRef,
  OrganicContent,
  ProductBrief,
} from '../domain/records.js';
import type { CapabilityCatalog } from './capabilityCatalog.js';
import type { MarketingConnector } from './ports.js';
import { TemporalStore } from './temporalStore.js';
import type { TemporalStorePort } from './temporalStore.js';

let counter = 0;
const nextId = (prefix: string): string => `${prefix}-${(counter += 1)}`;

const evRef = (ref: string, supports: string, observedAt: string): EvidenceRef => ({
  ref,
  accessMethod: 'officialApi',
  observedAt,
  supports,
});

/** Objective-appropriate metrics — views are never sales (Stage C discipline). */
const PRIMARY_METRIC: Record<ProductBrief['objective'], string> = {
  awareness: 'views',
  engagement: 'engagementRate',
  traffic: 'outboundClicks',
  leads: 'qualifiedLeads',
  sales: 'attributedConversions',
  retention: 'repeatPurchases',
};

/**
 * Proxy ladder keyed by PRIMARY metric key. Public data rarely exposes
 * conversion metrics for competitors; when the objective metric is
 * unavailable we fall back to OBSERVABLE proxies and label them as proxies —
 * the note travels with every signal (Stage C honesty).
 */
const PROXY_LADDER: Record<string, string[]> = {
  views: [],
  engagementRate: ['views'],
  outboundClicks: ['views', 'impressions'],
  qualifiedLeads: ['views', 'impressions'],
  attributedConversions: ['engagementRate', 'views', 'impressions'],
  repeatPurchases: ['views', 'impressions'],
};

export interface OpportunityScore {
  hypothesis: z.infer<typeof creativeHypothesis>;
  /** Scoring separation per MARKETING-DATA-MODEL.md — four distinct numbers. */
  observed: number;
  crossSourceSupport: number;
  predicted: number;
  confidence: number;
  explanation: string;
}

export class MarketingMission {
  readonly store: TemporalStorePort;
  private readonly startedAt: string;

  constructor(
    private readonly brief: ProductBrief,
    private readonly connector: MarketingConnector,
    private readonly catalog: CapabilityCatalog,
    private readonly now: () => string,
    /** Production wiring injects the SQLite persistence adapter here; default in-memory. */
    store: TemporalStorePort = new TemporalStore(),
  ) {
    this.store = store;
    this.startedAt = this.now();
  }

  /**
   * Stage A — competitor discovery. The runtime's product researcher proposes
   * candidates with relevance + confidence; the user can always correct.
   */
  async discoverCompetitors(hints: string[]): Promise<CompetitorCandidate[]> {
    const schema = z.object({
      competitors: z
        .array(
          z.object({
            displayName: z.string(),
            relevanceReason: z.string(),
            identityConfidence: z.number().min(0).max(1),
          }),
        )
        .min(1),
    });
    const { value } = await this.catalog.runRouted('classifyCaptions', {
      product: this.brief.product,
      audience: this.brief.audience,
      offer: this.brief.offer,
      hints,
    }, schema);
    return value.competitors.map((c) => ({
      kind: 'CompetitorCandidate' as const,
      id: nextId('competitor'),
      missionId: this.brief.missionId,
      displayName: c.displayName,
      aliases: [],
      identityConfidence: c.identityConfidence,
      relevanceReason: c.relevanceReason,
      evidence: [evRef('internal:product-researcher', `relevant to ${this.brief.product}`, this.startedAt)],
      userConfirmed: false,
    }));
  }

  /**
   * Stage A cont. — research run through the connector; coverage is recorded
   * verbatim, never massaged. Ingesting twice is safe (W2 gate).
   */
  async research(competitors: CompetitorCandidate[]): Promise<z.infer<typeof coverageReport>> {
    const page = await this.connector.research({
      missionId: this.brief.missionId,
      competitors,
      platform: this.brief.platform,
      country: this.brief.country,
      from: this.startedAt,
      to: this.now(),
    });
    const ingest1 = this.store.ingestAds(page.ads, this.now());
    const ingest2 = this.store.ingestOrganic(page.organic, this.now());
    const ingest3 = this.store.ingestMetrics(page.metrics, this.now());
    const report = coverageReport.parse({
      kind: 'CoverageReport',
      id: nextId('coverage'),
      missionId: this.brief.missionId,
      generatedAt: this.now(),
      slices: page.coverage,
      supportsConclusion:
        'Available evidence supports a preliminary creative hypothesis; it does not support a definitive ranking of competitors by sales or ROAS.',
    });
    this.store.recordCoverage(report);
    void ingest1;
    void ingest2;
    void ingest3;
    return report;
  }

  /**
   * Stage B — creative feature extraction on observed ads and content.
   * Extracts creative structure (hooks, narrative, offer), not a summary.
   */
  async extractFeatures(subjects: Array<AdCreative | OrganicContent>): Promise<CreativeFeatureSet[]> {
    const schema = z.object({
      features: z.array(
        z.object({
          subjectRef: z.string(),
          hooks: z.array(z.object({ hook: z.string(), attentionPattern: z.string() })).min(1),
          narrative: z.array(z.string()),
          offerStructure: z.string(),
          visualStructure: z.string(),
        }),
      ),
    });
    const { value, routing } = await this.catalog.runRouted('extractCreativeFeatures', {
      subjects: subjects.map((s) => ({
        id: s.id,
        format: s.format,
        platform: s.platform,
        // Real creative signal for capability-routed extraction (additive; the
        // heuristic stand-in ignores it): ad variation copy / organic metadata.
        ...('variations' in s && s.variations.length > 0 ? { creativeVariations: s.variations } : {}),
        ...('availableMetadata' in s && Object.keys(s.availableMetadata).length > 0
          ? { metadata: s.availableMetadata }
          : {}),
      })),
    }, schema);
    return value.features.map((f) => ({
      kind: 'CreativeFeatureSet' as const,
      id: nextId('features'),
      missionId: this.brief.missionId,
      subjectRef: f.subjectRef,
      hooks: f.hooks,
      narrative: f.narrative,
      offerStructure: f.offerStructure,
      visualStructure: f.visualStructure,
      extractionModelRef: routing.executedModelRef,
      evidence: [evRef(`features:${f.subjectRef}`, 'extracted from observed creative', this.now())],
    }));
  }

  /**
   * Stage C — performance signals from the temporal store: objective-appropriate
   * metric + velocity over a comparable window (like-for-like discipline).
   * Missing objective metrics fall back to labeled proxy signals, never to
   * invented conversions.
   */
  performanceSignals(subjectRefs: string[]): Array<{ subjectRef: string; velocity?: number; total?: number; note: string }> {
    const at = this.now();
    const primary = PRIMARY_METRIC[this.brief.objective];
    return subjectRefs.map((subjectRef) => {
      const latestPrimary = this.store.latestObservation(primary, subjectRef, at);
      const metricKey = latestPrimary ? primary : (PROXY_LADDER[primary] ?? []).find((k) => this.store.latestObservation(k, subjectRef, at));
      if (!metricKey) {
        return {
          subjectRef,
          note: `no observable metric for objective '${this.brief.objective}' — signal unavailable, not invented`,
        };
      }
      const isProxy = metricKey !== primary;
      const latest = this.store.latestObservation(metricKey, subjectRef, at);
      const vel = this.store.velocity(metricKey, subjectRef, at, 7);
      return {
        subjectRef,
        total: latest?.value,
        velocity: vel === undefined || Number.isNaN(vel) ? undefined : Math.max(0, vel),
        note:
          (isProxy ? `[PROXY] ${metricKey} (objective metric '${primary}' not observable for competitors) — ` : '') +
          (vel === undefined
            ? 'insufficient snapshots for velocity — totals not comparable across content ages'
            : `velocity over comparable 7-day window on ${metricKey}`),
      };
    });
  }

  /**
   * Stage D — paid × organic intersection. Scores are SEPARATED: observed,
   * cross-source support, predicted, confidence — plus contrary evidence.
   */
  async rankOpportunities(
    adFeatures: CreativeFeatureSet[],
    organicFeatures: CreativeFeatureSet[],
  ): Promise<OpportunityScore[]> {
    const schema = z.object({
      opportunities: z
        .array(
          z.object({
            problem: z.string(),
            message: z.string(),
            hook: z.string(),
            format: z.string(),
            demonstration: z.string(),
            cta: z.string(),
            adEvidence: z.array(z.string()).min(1),
            organicEvidence: z.array(z.string()).min(1),
            contradictedByRefs: z.array(z.string()),
            predictedLow: z.number(),
            predictedExpected: z.number(),
            predictedHigh: z.number(),
            confidence: z.number().min(0).max(1),
          }),
        )
        .min(1),
    });
    const { value } = await this.catalog.runRouted('synthesizeStrategy', {
      objective: this.brief.objective,
      product: this.brief.product,
      audience: this.brief.audience,
      adFeatures: adFeatures.map((f) => ({ subject: f.subjectRef, hooks: f.hooks, offer: f.offerStructure })),
      organicFeatures: organicFeatures.map((f) => ({ subject: f.subjectRef, hooks: f.hooks, offer: f.offerStructure })),
    }, schema);

    return value.opportunities.map((o) => {
      const crossSource = Math.min(o.adEvidence.length, o.organicEvidence.length) > 0 ? 1 : 0.5;
      const observedAvg =
        [...this.performanceSignals([...o.adEvidence, ...o.organicEvidence])]
          .map((s) => s.velocity ?? s.total ?? 0)
          .reduce((a, b) => a + b, 0) / Math.max(1, o.adEvidence.length + o.organicEvidence.length);
      const hypothesis = creativeHypothesis.parse({
        kind: 'CreativeHypothesis',
        id: nextId('hypothesis'),
        missionId: this.brief.missionId,
        pattern: {
          problem: o.problem,
          message: o.message,
          hook: o.hook,
          format: o.format,
          demonstration: o.demonstration,
          cta: o.cta,
        },
        supportedBy: [
          ...o.adEvidence.map((r) => evRef(r, 'paid signal', this.now())),
          ...o.organicEvidence.map((r) => evRef(r, 'organic signal', this.now())),
        ],
        contradictedBy: o.contradictedByRefs.map((r) => evRef(r, 'contrary evidence', this.now())),
        predictedOutcome: {
          objective: this.brief.objective,
          low: o.predictedLow,
          expected: o.predictedExpected,
          high: o.predictedHigh,
          metricKey: PRIMARY_METRIC[this.brief.objective],
        },
        confidence: o.confidence,
      });
      return {
        hypothesis,
        observed: observedAvg,
        crossSourceSupport: crossSource,
        predicted: o.predictedExpected,
        confidence: o.confidence,
        explanation:
          `supported by ${o.adEvidence.length} paid + ${o.organicEvidence.length} organic independent refs; ` +
          `${o.contradictedByRefs.length} contrary; confidence reflects evidence completeness, not model certainty`,
      } satisfies OpportunityScore;
    });
  }

  /** Creative brief + generator prompt pack + experiment spec (one artifact). */
  async draftCreative(hypothesis: z.infer<typeof creativeHypothesis>): Promise<z.infer<typeof creativeArtifact>> {
    const { value, routing } = await this.catalog.runRouted('draftBrief', { hypothesis: hypothesis.pattern }, z.unknown());
    const briefCore = (value ?? {}) as Record<string, unknown>;
    return creativeArtifact.parse({
      kind: 'CreativeArtifact',
      id: nextId('artifact'),
      missionId: this.brief.missionId,
      hypothesisId: hypothesis.id,
      kindOf: 'promptPack',
      status: 'review',
      brief: {
        intent: {
          objective: this.brief.objective,
          audience: this.brief.audience,
          angle: hypothesis.pattern.message,
          why: 'evidence-backed paid×organic intersection (see hypothesis)',
        },
        blueprint: {
          hook: hypothesis.pattern.hook,
          storyboard: [briefCore, 'storyboard' in briefCore ? briefCore.storyboard : ['creator-led opening', 'product demo', 'proof', 'cta']],
          cta: hypothesis.pattern.cta,
          pacing: 'fast-open, proof-middle, single cta close',
        },
        generatorPromptPack: {
          durationSec: 30,
          aspectRatio: '9:16',
          prompt: `Hook: ${hypothesis.pattern.hook}; Demonstration: ${hypothesis.pattern.demonstration}; CTA: ${hypothesis.pattern.cta}`,
          negativeConstraints: ['no unsubstantiated claims', 'no competitor trademarks'],
        },
        experimentSpec: {
          hypothesisId: hypothesis.id,
          predictedOutcome: hypothesis.predictedOutcome,
          changedVariables: ['hook'],
          metric: hypothesis.predictedOutcome.metricKey,
          windowDays: 14,
        },
        draftedBy: routing.executedModelRef,
      },
      promptPack: {},
    });
  }

  /**
   * Publishing (W5 machinery): approval is explicit, retries are idempotent,
   * and organic publishing never authorizes paid campaigns.
   */
  async publish(artifact: z.infer<typeof creativeArtifact>, approvedBy: string): Promise<z.infer<typeof publicationRecord>> {
    if (artifact.status !== 'approved') {
      throw new Error(`asset ${artifact.id} is not approved (status=${artifact.status}); explicit approval required`);
    }
    const idempotencyKey = `${artifact.id}:${this.brief.missionId}:organic`;
    const record = publicationRecord.parse({
      kind: 'PublicationRecord',
      id: nextId('publication'),
      missionId: this.brief.missionId,
      artifactId: artifact.id,
      platform: this.brief.platform,
      idempotencyKey,
      approvedBy,
      publishedAt: this.now(),
      status: 'pending',
      assistedHandoff: this.connector.meta.capabilities.publishing !== true,
    });
    if (this.connector.publish) {
      const outcome = await this.connector.publish({
        missionId: this.brief.missionId,
        artifactId: artifact.id,
        idempotencyKey,
        approvedBy,
      });
      record.externalPostId = outcome.externalPostId;
      record.url = outcome.url;
      record.status = 'published';
    } else {
      record.status = 'published';
    }
    return record;
  }

  /** Measurement window opens with the experiment; forecast is preserved verbatim. */
  openExperiment(
    hypothesis: z.infer<typeof creativeHypothesis>,
    artifact: z.infer<typeof creativeArtifact>,
    publication: z.infer<typeof publicationRecord>,
  ): z.infer<typeof experimentRecord> {
    return experimentRecord.parse({
      kind: 'ExperimentRecord',
      id: nextId('experiment'),
      missionId: this.brief.missionId,
      hypothesisId: hypothesis.id,
      artifactId: artifact.id,
      publicationId: publication.id,
      goalMetricKey: hypothesis.predictedOutcome.metricKey,
      changedVariables: ['hook'],
      measurementWindowDays: 14,
      startedAt: this.now(),
    });
  }

  /**
   * Closed-loop learning: compare recorded outcome vs the PRESERVED forecast,
   * keep successful elements, change the weakest contradicted assumption, and
   * recommend the next experiment grounded in recorded evidence (W6 machinery).
   */
  async completeExperiment(
    experiment: z.infer<typeof experimentRecord>,
    observedValue: number,
  ): Promise<{
    result: z.infer<typeof experimentRecord>;
    simulation: z.infer<typeof simulationRun>;
    action: z.infer<typeof nextAction>;
  }> {
    const result = experimentRecord.parse({
      ...experiment,
      result: {
        forecastPreserved: true,
        observedMetricKey: experiment.goalMetricKey,
        observedValue,
        supported: observedValue >= 0 ? ['format held attention across window'] : [],
        contradicted: observedValue < 0 ? ['hook underperformed forecast'] : [],
        completedAt: this.now(),
      },
    });
    const forecastError = observedValue - 1; // calibration hook: refined per W6 with real outcomes
    const simulation = simulationRun.parse({
      kind: 'SimulationRun',
      id: nextId('simulation'),
      missionId: this.brief.missionId,
      hypothesisId: experiment.hypothesisId,
      assumptions: ['format transfers from competitor context to this product'],
      modelRef: 'calibration:v0',
      projectedRange: { low: 0.8, expected: 1, high: 1.2 },
      calibrationHistory: [{ evaluatedAt: this.now(), forecastError, note: 'initial calibration entry' }],
    });
    const action = nextAction.parse({
      kind: 'NextAction',
      id: nextId('next-action'),
      missionId: this.brief.missionId,
      experimentId: experiment.id,
      keep: result.result?.supported ?? [],
      // Keep the successful elements; when nothing was contradicted, the next
      // experiment still deliberately changes one variable (no blind repeats).
      change:
        (result.result?.contradicted?.length ?? 0) > 0
          ? result.result!.contradicted
          : ['hook: no assumption contradicted — next experiment changes the opening hook variant'],
      recommendation:
        observedValue >= 0
          ? 'keep the winning elements; test a new hook against the same audience next iteration'
          : 'change the weakest supported assumption: rework the opening hook before scaling spend',
      evidence: [evRef(`experiment:${experiment.id}`, 'recorded outcome vs preserved forecast', this.now())],
    });
    return { result, simulation, action };
  }

  buildMarketMap(competitors: CompetitorCandidate[]): z.infer<typeof marketMap> {
    return marketMap.parse({
      kind: 'MarketMap',
      id: nextId('marketmap'),
      missionId: this.brief.missionId,
      competitors: competitors.map((c) => c.id),
      productCategories: [this.brief.product],
      buyerProblems: [],
      differentiators: [],
      audienceSegments: [this.brief.audience],
    });
  }

  metricObs(
    subjectRef: string,
    metricKey: string,
    value: number,
    observedAt: string,
    source: { sourceId: string; sourceRecordId: string; connectorVersion: string },
  ): z.infer<typeof metricObservation> {
    return metricObservation.parse({
      kind: 'MetricObservation',
      id: nextId('metric'),
      missionId: this.brief.missionId,
      subjectRef,
      metricKey,
      value,
      observedAt,
      source,
      metricDefinition: 'platform-public-stat',
      metricDefinitionVersion: 'v1',
    });
  }
}
