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
  MetricObservation,
  OrganicContent,
  ProductBrief,
} from '../domain/records.js';
import { buildRubricReport } from './rubric.js';
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

/**
 * WO-P5 §2 pinned integration contract (frozen — name, reason enum and
 * optionality; any change is a TL decision recorded in the plan first): why a
 * performance signal carries no values. Present exactly when `velocity` and
 * `total` are both undefined; a signal with a value never carries it.
 */
export interface SignalNoObservation {
  reason: 'before_coverage' | 'insufficient_window' | 'not_observed';
  /** Honest, self-contained statement of the series' actual state. */
  detail: string;
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
  performanceSignals(subjectRefs: string[]): Array<{
    subjectRef: string;
    velocity?: number;
    total?: number;
    note: string;
    /** WO-P5 §2 contract: present exactly when velocity and total are both undefined. */
    noObservation?: SignalNoObservation;
  }> {
    const at = this.now();
    const primary = PRIMARY_METRIC[this.brief.objective];
    return subjectRefs.map((subjectRef) => {
      const latestPrimary = this.store.latestObservation(primary, subjectRef, at);
      const metricKey = latestPrimary ? primary : (PROXY_LADDER[primary] ?? []).find((k) => this.store.latestObservation(k, subjectRef, at));
      if (!metricKey) {
        return {
          subjectRef,
          note: `no observable metric for objective '${this.brief.objective}' — signal unavailable, not invented`,
          noObservation: this.noObservationFor(subjectRef, primary, at),
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
   * WO-P5 (AT-P5.2): compose the no-observation reason honestly from the
   * candidate series' actual state — never interpolated, never invented.
   * Precedence: no candidate metric ever observed for the subject →
   * not_observed; the as-of time precedes the subject's first observation →
   * before_coverage; coverage has started but the as-of series is too thin to
   * support the signal → insufficient_window (defensive: the ladder walk in
   * performanceSignals selects a metric whenever an as-of observation exists,
   * so this fires only if that selection and this derivation ever disagree).
   */
  private noObservationFor(subjectRef: string, primary: string, at: string): SignalNoObservation {
    const candidates = [primary, ...(PROXY_LADDER[primary] ?? [])];
    const earliest = candidates
      .map((k) => this.store.firstObservation(k, subjectRef))
      .filter((o): o is MetricObservation => o !== undefined)
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt))[0];
    if (!earliest) {
      return {
        reason: 'not_observed',
        detail: `no observation of ${candidates.join(', ')} has ever been recorded for ${subjectRef}`,
      };
    }
    if (at < earliest.observedAt) {
      return {
        reason: 'before_coverage',
        detail: `first observation of this entity is ${earliest.observedAt} — the window begins after it`,
      };
    }
    return {
      reason: 'insufficient_window',
      detail: `observations exist from ${earliest.observedAt} onward but the series as of ${at} has fewer than two snapshots — not enough to support a comparable signal window`,
    };
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

  /**
   * W4 creative handoff: the full production pack for a hypothesis — creative
   * brief, timed script, storyboard beats, generator-specific prompt packs
   * (video-gen / thumbnail / copy variants), and the testable experiment spec.
   * Routed through `draftBrief` when a model is available (provenance recorded
   * in brief.draftedBy); the labeled heuristic produces the same shape.
   */
  async draftCreative(hypothesis: z.infer<typeof creativeHypothesis>): Promise<z.infer<typeof creativeArtifact>> {
    const scriptSchema = z.object({
      beats: z
        .array(
          z.object({
            startSec: z.number(),
            endSec: z.number(),
            line: z.string().min(1),
            visual: z.string().min(1),
            onScreenText: z.string().optional(),
          }),
        )
        .min(2),
      thumbnailPrompt: z.string().min(1),
      titleVariants: z.array(z.string().min(1)).min(2),
      ctaLine: z.string().min(1),
    });
    const { value, routing } = await this.catalog.runRouted('draftBrief', {
      hypothesis: hypothesis.pattern,
      objective: this.brief.objective,
      product: this.brief.product,
      audience: this.brief.audience,
      offer: this.brief.offer,
      constraints: this.brief.constraints ?? [],
    }, scriptSchema);
    const timedBeats = (value.beats.length === 4 ? value.beats : [
      { startSec: 0, endSec: 3, line: hypothesis.pattern.hook, visual: 'creator-led opening with the benefit reveal', onScreenText: value.beats[0]?.onScreenText },
      { startSec: 3, endSec: 15, line: value.beats[1]?.line ?? `demonstrate ${hypothesis.pattern.demonstration}`, visual: value.beats[1]?.visual ?? 'in-use demonstration, handheld creator footage' },
      { startSec: 15, endSec: 25, line: value.beats[2]?.line ?? 'show the proof moment', visual: value.beats[2]?.visual ?? 'side-by-side before/after within creator context' },
      { startSec: 25, endSec: 30, line: value.beats[3]?.line ?? value.ctaLine, visual: value.beats[3]?.visual ?? 'product close-up with single CTA overlay' },
    ]).map((beat) => ({ ...beat, onScreenText: beat.onScreenText ?? '' }));
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
          hypothesisId: hypothesis.id,
          predictedOutcome: hypothesis.predictedOutcome,
        },
        blueprint: {
          hook: hypothesis.pattern.hook,
          format: hypothesis.pattern.format,
          demonstration: hypothesis.pattern.demonstration,
          cta: hypothesis.pattern.cta,
          pacing: 'fast-open, proof-middle, single cta close',
        },
        script: timedBeats,
        storyboard: timedBeats.map((beat) => ({
          beat: `${beat.startSec}-${beat.endSec}s`,
          visual: beat.visual,
          ...(beat.onScreenText ? { onScreenText: beat.onScreenText } : {}),
        })),
        generatorPromptPacks: {
          videoGen: {
            prompt: `Hook: ${hypothesis.pattern.hook}; Demonstration: ${hypothesis.pattern.demonstration}; CTA: ${hypothesis.pattern.cta}`,
            negativeConstraints: ['no unsubstantiated claims', 'no competitor trademarks', ...(this.brief.constraints ?? [])],
            durationSec: 30,
            aspectRatio: hypothesis.pattern.format.includes('9:16') ? '9:16' : '16:9',
          },
          thumbnail: { prompt: value.thumbnailPrompt, textOverlay: hypothesis.pattern.hook },
          copy: { titleVariants: value.titleVariants, ctaLine: value.ctaLine },
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
   * W4 asset validation: the machine rubric (deterministic rule checks) plus
   * the routed qualitative assessment (`validateAsset` task) with provenance.
   * Suggests corrections; never edits the creative or auto-approves anything.
   */
  async validateAsset(input: {
    declaration: import('./rubric.js').AssetDeclaration;
    competitors: CompetitorCandidate[];
  }): Promise<import('./rubric.js').RubricReport> {
    const schema = z.object({
      verdict: z.enum(['ready', 'needs-review', 'blocked']),
      issues: z.array(z.object({ aspect: z.string(), message: z.string(), suggestion: z.string().optional() })),
    });
    const { value, routing } = await this.catalog.runRouted('validateAsset', {
      objective: this.brief.objective,
      product: this.brief.product,
      offer: this.brief.offer,
      declaration: input.declaration,
    }, schema);
    return buildRubricReport({
      declaration: input.declaration,
      brief: this.brief,
      competitors: input.competitors,
      qualitative: { issues: value.issues, executedModelRef: routing.executedModelRef },
    });
  }

  /**
   * Publishing (W5): approval is explicit, retries are idempotent,
   * and organic publishing never authorizes paid campaigns. When the mission's
   * connector declares publishing (a connected account), the asset bytes and
   * platform metadata travel through the connector contract; the publication
   * record inherits the connection's honesty labels (connectionId, environment).
   */
  async publish(
    artifact: z.infer<typeof creativeArtifact>,
    approvedBy: string,
    opts: {
      connectionId?: string;
      environment?: 'production' | 'sandbox';
      /** W5: asset bytes + platform metadata for a connected-account upload. */
      asset?: import('./ports.js').PublishAsset;
    } = {},
  ): Promise<z.infer<typeof publicationRecord>> {
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
      ...(opts.connectionId ? { connectionId: opts.connectionId } : {}),
      environment: opts.environment ?? 'production',
    });
    if (this.connector.publish) {
      const outcome = await this.connector.publish({
        missionId: this.brief.missionId,
        artifactId: artifact.id,
        idempotencyKey,
        approvedBy,
        ...(opts.asset ? { asset: opts.asset } : {}),
      });
      record.externalPostId = outcome.externalPostId;
      record.url = outcome.url;
      record.status = 'published';
    } else {
      record.status = 'published';
    }
    return record;
  }

  /**
   * Measurement window opens with the experiment; forecast is preserved
   * verbatim. The changed variables and window come from the artifact's
   * experiment spec (W4) when present — the experiment tests exactly what the
   * pack declared it would test.
   */
  openExperiment(
    hypothesis: z.infer<typeof creativeHypothesis>,
    artifact: z.infer<typeof creativeArtifact>,
    publication: z.infer<typeof publicationRecord>,
  ): z.infer<typeof experimentRecord> {
    const spec = (artifact.brief as { experimentSpec?: { changedVariables?: string[]; windowDays?: number } })
      .experimentSpec;
    return experimentRecord.parse({
      kind: 'ExperimentRecord',
      id: nextId('experiment'),
      missionId: this.brief.missionId,
      hypothesisId: hypothesis.id,
      artifactId: artifact.id,
      publicationId: publication.id,
      goalMetricKey: hypothesis.predictedOutcome.metricKey,
      changedVariables: spec?.changedVariables?.length ? spec.changedVariables : ['hook'],
      measurementWindowDays: typeof spec?.windowDays === 'number' && spec.windowDays > 0 ? spec.windowDays : 14,
      startedAt: this.now(),
    });
  }

  /**
   * Closed-loop learning (W6): compare recorded outcomes against the PRESERVED
   * forecast, keep successful elements, change the weakest contradicted
   * assumption, and recommend the next experiment grounded in recorded
   * evidence. When the observed metric is a proxy for the goal metric (the
   * permitted analytics route could not observe the objective metric itself),
   * the comparison carries the [PROXY] label — the Stage C honesty discipline
   * applied to experiments. Calibration history is appended, never overwritten.
   */
  async completeExperiment(
    experiment: z.infer<typeof experimentRecord>,
    observedValue: number,
    opts: {
      /** Metric actually observed (defaults to the goal metric key). */
      observedMetricKey?: string;
      /** The preserved forecast compared against (defaults: the goal metric's record). */
      forecast?: { low: number; expected: number; high: number; metricKey: string };
    } = {},
  ): Promise<{
    result: z.infer<typeof experimentRecord>;
    simulation: z.infer<typeof simulationRun>;
    action: z.infer<typeof nextAction>;
    comparison: {
      observedMetricKey: string;
      isProxy: boolean;
      withinForecastRange: boolean | null;
      direction: 'above' | 'below' | 'within' | 'unknown';
      forecastErrorRatio: number | null;
      note: string;
    };
  }> {
    const observedMetricKey = opts.observedMetricKey ?? experiment.goalMetricKey;
    const forecast =
      opts.forecast ?? { low: 0, expected: observedValue || 1, high: Number.POSITIVE_INFINITY, metricKey: experiment.goalMetricKey };
    const isProxy = observedMetricKey !== experiment.goalMetricKey;
    const withinRange =
      Number.isFinite(forecast.high) ? observedValue >= forecast.low && observedValue <= forecast.high : null;
    const direction: 'above' | 'below' | 'within' | 'unknown' =
      withinRange === null ? 'unknown' : observedValue > forecast.high ? 'above' : observedValue < forecast.low ? 'below' : 'within';
    const forecastErrorRatio = forecast.expected !== 0 ? observedValue / forecast.expected : null;
    const proxyNote = isProxy
      ? `[PROXY] compared on '${observedMetricKey}' — the goal metric '${experiment.goalMetricKey}' is not observable through permitted analytics for this publication; `
      : '';
    const rangeNote =
      withinRange === null
        ? 'forecast range not comparable on this metric (open-ended forecast preserved verbatim)'
        : `observed ${observedValue} vs preserved forecast [${forecast.low}..${forecast.high}] (expected ${forecast.expected}) — ${direction}`;
    const note = proxyNote + rangeNote;

    const supported: string[] = [];
    const contradicted: string[] = [];
    if (direction === 'within' || direction === 'above') {
      supported.push(`${observedMetricKey} met or exceeded the preserved forecast (${observedValue} vs expected ${forecast.expected})`);
      supported.push('format held attention across the measurement window');
    } else if (direction === 'below') {
      contradicted.push(`${observedMetricKey} landed below the preserved forecast range (${observedValue} vs low ${forecast.low})`);
      contradicted.push('hook underperformed forecast — the opening assumption is the weakest link');
    } else {
      supported.push(`${observedMetricKey} observed at ${observedValue}; forecast comparison unavailable on this metric`);
    }
    if (isProxy) {
      contradicted.push(`goal metric '${experiment.goalMetricKey}' remained unobservable — proxy conclusion only, never reported as the objective metric`);
    }

    const result = experimentRecord.parse({
      ...experiment,
      result: {
        forecastPreserved: true,
        observedMetricKey,
        observedValue,
        supported,
        contradicted,
        completedAt: this.now(),
      },
    });
    const calibrationNote =
      forecastErrorRatio !== null
        ? `multiplicative correction ${forecastErrorRatio.toFixed(2)}x on '${observedMetricKey}'; apply to the next forecast for this audience/format${isProxy ? ' (proxy-calibrated)' : ''}`
        : `forecast expectation was zero — next forecast must establish a non-zero baseline on '${observedMetricKey}'`;
    const simulation = simulationRun.parse({
      kind: 'SimulationRun',
      id: nextId('simulation'),
      missionId: this.brief.missionId,
      hypothesisId: experiment.hypothesisId,
      assumptions: [
        'format transfers from competitor context to this product',
        ...(isProxy ? ['proxy metric tracks the objective metric directionally'] : []),
      ],
      modelRef: 'calibration:v1',
      projectedRange: { low: forecast.low, expected: forecast.expected, high: forecast.high },
      calibrationHistory: [{ evaluatedAt: this.now(), forecastError: forecastErrorRatio ?? 0, note: calibrationNote }],
    });
    const action = nextAction.parse({
      kind: 'NextAction',
      id: nextId('next-action'),
      missionId: this.brief.missionId,
      experimentId: experiment.id,
      keep: supported.length > 0 ? supported : ['measurement completed — no assumption was supported or contradicted decisively'],
      change:
        contradicted.length > 0
          ? contradicted
          : experiment.changedVariables.map((v) => `${v}: no assumption contradicted — next experiment deliberately changes this variable (no blind repeats)`),
      recommendation:
        direction === 'below'
          ? `observed ${observedValue} on ${observedMetricKey} fell below the preserved forecast [${forecast.low}..${forecast.high}]: keep the format elements that held, rework the ${experiment.changedVariables[0]} variant before scaling, and re-forecast with the ${forecastErrorRatio !== null ? `${forecastErrorRatio.toFixed(2)}x ` : ''}calibration correction`
          : direction === 'above'
            ? `observed ${observedValue} on ${observedMetricKey} beat the preserved forecast (expected ${forecast.expected}): keep the winning elements, scale this pattern, and test the next ${experiment.changedVariables[0]} variant against it`
            : `observed ${observedValue} on ${observedMetricKey} landed ${direction === 'within' ? 'within' : 'against'} the preserved forecast [${forecast.low}..${forecast.high}]: keep the supported elements and deliberately change ${experiment.changedVariables[0]} in the next experiment${isProxy ? ' — proxy-labeled conclusion only' : ''}`,
      evidence: [evRef(`experiment:${experiment.id}`, `recorded outcome ${observedValue} on ${observedMetricKey} vs preserved forecast`, this.now())],
    });
    return { result, simulation, action, comparison: { observedMetricKey, isProxy, withinForecastRange: withinRange, direction, forecastErrorRatio, note } };
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
