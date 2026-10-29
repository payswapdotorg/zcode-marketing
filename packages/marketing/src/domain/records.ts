/**
 * Marketing domain — canonical records (machine-checked contracts).
 *
 * Governance: docs/marketing/MARKETING-DATA-MODEL.md is the authoritative
 * description; this file is the machine-readable source. Records cross
 * process / storage / LLM boundaries, so every schema is runtime-validatable
 * (zod, repo convention) — never rely on TypeScript types alone.
 *
 * Layer: domain (pure, zero I/O — enforced by architecture policy).
 */
import { z } from 'zod';

/** ISO-8601 date-time strings; all three kinds of time are distinct. */
export const isoDateTime = z.string().min(1);

/** Objective classes keep rankings separate (MARKETING-DATA-MODEL.md). */
export const marketingObjective = z.enum([
  'awareness',
  'engagement',
  'traffic',
  'leads',
  'sales',
  'retention',
]);
export type MarketingObjective = z.infer<typeof marketingObjective>;

export const platform = z.enum(['youtube', 'tiktok', 'meta', 'other']);
export type Platform = z.infer<typeof platform>;

/** How a piece of evidence was obtained — drives what conclusions it permits. */
export const accessMethod = z.enum([
  'officialApi',
  'publicTransparency',
  'authorizedAccount',
  'importedReport',
  'licensedArchive',
  'internalReasoning',
]);
export type AccessMethod = z.infer<typeof accessMethod>;

/** Honest coverage states — a gap is a normal result, never invented data. */
export const coverageState = z.enum([
  'available',
  'partial',
  'unavailable',
  'not_connected',
  'restricted',
]);
export type CoverageState = z.infer<typeof coverageState>;

/** Reference to the evidence a conclusion rests on; mandatory on recommendations. */
export const evidenceRef = z.object({
  /** Source identity, e.g. "connector:sample/creative:ad-2" or "internal:hypothesis:h1". */
  ref: z.string().min(1),
  accessMethod,
  /** When the evidence was retrieved/observed. */
  observedAt: isoDateTime,
  /** Honest note on what this evidence does and does not support. */
  supports: z.string().min(1),
});
export type EvidenceRef = z.infer<typeof evidenceRef>;

export const productBrief = z.object({
  kind: z.literal('ProductBrief'),
  id: z.string().min(1),
  missionId: z.string().min(1),
  product: z.string().min(1),
  landingUrl: z.string().optional(),
  audience: z.string().min(1),
  country: z.string().min(1),
  platform,
  offer: z.string().min(1),
  objective: marketingObjective,
  constraints: z.array(z.string()).default([]),
  createdAt: isoDateTime,
});
export type ProductBrief = z.infer<typeof productBrief>;

export const competitorCandidate = z.object({
  kind: z.literal('CompetitorCandidate'),
  id: z.string().min(1),
  missionId: z.string().min(1),
  displayName: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  /** 0..1 — a keyword overlap is not automatically a direct competitor. */
  identityConfidence: z.number().min(0).max(1),
  relevanceReason: z.string().min(1),
  evidence: z.array(evidenceRef),
  /** User corrections are kept as explicit revisions, never merged silently. */
  userConfirmed: z.boolean().default(false),
});
export type CompetitorCandidate = z.infer<typeof competitorCandidate>;

export const marketMap = z.object({
  kind: z.literal('MarketMap'),
  id: z.string().min(1),
  missionId: z.string().min(1),
  competitors: z.array(z.string()),
  productCategories: z.array(z.string()).default([]),
  buyerProblems: z.array(z.string()).default([]),
  differentiators: z.array(z.string()).default([]),
  audienceSegments: z.array(z.string()).default([]),
});
export type MarketMap = z.infer<typeof marketMap>;

/** Source identity: (sourceId, sourceRecordId) makes ingestion idempotent. */
export const sourceIdentity = z.object({
  sourceId: z.string().min(1),
  sourceRecordId: z.string().min(1),
  connectorVersion: z.string().min(1),
});
export type SourceIdentity = z.infer<typeof sourceIdentity>;

export const adCreative = z.object({
  kind: z.literal('AdCreative'),
  id: z.string().min(1),
  missionId: z.string().min(1),
  advertiserId: z.string().min(1),
  source: sourceIdentity,
  platform,
  format: z.string().min(1),
  /** Repeated observations over time are how duration/variation is measured. */
  firstObservedAt: isoDateTime,
  lastObservedAt: isoDateTime,
  variations: z.array(z.string()).default([]),
  landingUrl: z.string().optional(),
  /**
   * Creative-adjacent source metadata (additive, W1-3(b) 2026-10-29 — mirrors
   * OrganicContent.availableMetadata): platform-reported delivery dates,
   * creative preview/image URLs, advertiser identity. Platform-REPORTED values
   * live here, strictly distinct from our own observation timestamps above
   * (firstObservedAt/lastObservedAt are when WE observed the creative).
   */
  availableMetadata: z.record(z.string(), z.unknown()).default({}),
});
export type AdCreative = z.infer<typeof adCreative>;

export const organicContent = z.object({
  kind: z.literal('OrganicContent'),
  id: z.string().min(1),
  missionId: z.string().min(1),
  source: sourceIdentity,
  platform,
  authorId: z.string().min(1),
  format: z.string().min(1),
  publishedAt: isoDateTime,
  availableMetadata: z.record(z.string(), z.unknown()).default({}),
});
export type OrganicContent = z.infer<typeof organicContent>;

/**
 * A metric value at an observation time. Semantics + version travel with the
 * value because platform definitions change (MARKETING-DATA-MODEL.md).
 */
export const metricObservation = z.object({
  kind: z.literal('MetricObservation'),
  id: z.string().min(1),
  missionId: z.string().min(1),
  /** Entity this metric describes, e.g. "content:yt-101". */
  subjectRef: z.string().min(1),
  metricKey: z.string().min(1),
  value: z.number().nonnegative(),
  /** observedAt != publishedAt != ingestedAt — never conflate them. */
  observedAt: isoDateTime,
  source: sourceIdentity,
  metricDefinition: z.string().min(1),
  metricDefinitionVersion: z.string().min(1),
  region: z.string().optional(),
});
export type MetricObservation = z.infer<typeof metricObservation>;

export const hookPattern = z.object({
  hook: z.string().min(1),
  attentionPattern: z.string().min(1),
});
export type HookPattern = z.infer<typeof hookPattern>;

export const creativeFeatureSet = z.object({
  kind: z.literal('CreativeFeatureSet'),
  id: z.string().min(1),
  missionId: z.string().min(1),
  subjectRef: z.string().min(1),
  hooks: z.array(hookPattern),
  narrative: z.array(z.string()),
  offerStructure: z.string().optional(),
  visualStructure: z.string().optional(),
  /** Which model produced this extraction — recorded, never implicit. */
  extractionModelRef: z.string().min(1),
  evidence: z.array(evidenceRef),
});
export type CreativeFeatureSet = z.infer<typeof creativeFeatureSet>;

export const coverageReport = z.object({
  kind: z.literal('CoverageReport'),
  id: z.string().min(1),
  missionId: z.string().min(1),
  generatedAt: isoDateTime,
  slices: z.array(
    z.object({
      /** What is being covered, e.g. "competitor-ad-library:EU". */
      slice: z.string().min(1),
      state: coverageState,
      sourceId: z.string().min(1),
      connectorVersion: z.string().min(1),
      region: z.string().optional(),
      dateWindow: z.string().optional(),
      note: z.string().min(1),
    }),
  ),
  /** The conclusion the available evidence supports — never stronger. */
  supportsConclusion: z.string().min(1),
});
export type CoverageReport = z.infer<typeof coverageReport>;

export const creativeHypothesis = z.object({
  kind: z.literal('CreativeHypothesis'),
  id: z.string().min(1),
  missionId: z.string().min(1),
  /** Explainable feature bundle proposed as the winning intersection. */
  pattern: z.object({
    problem: z.string().min(1),
    message: z.string().min(1),
    hook: z.string().min(1),
    format: z.string().min(1),
    demonstration: z.string().min(1),
    cta: z.string().min(1),
  }),
  supportedBy: z.array(evidenceRef).min(1),
  contradictedBy: z.array(evidenceRef),
  predictedOutcome: z.object({
    objective: marketingObjective,
    /** Ranges, not point estimates — honesty about uncertainty. */
    low: z.number(),
    expected: z.number(),
    high: z.number(),
    metricKey: z.string().min(1),
  }),
  /** Confidence is evidence completeness, not model vibes. */
  confidence: z.number().min(0).max(1),
});
export type CreativeHypothesis = z.infer<typeof creativeHypothesis>;

export const creativeArtifact = z.object({
  kind: z.literal('CreativeArtifact'),
  id: z.string().min(1),
  missionId: z.string().min(1),
  hypothesisId: z.string().min(1),
  kindOf: z.enum(['promptPack', 'script', 'storyboard', 'uploadedAsset']),
  status: z.enum(['draft', 'review', 'approved', 'rejected', 'published']),
  /** Generator-agnostic core + generator-specific prompt pack. */
  brief: z.record(z.string(), z.unknown()),
  promptPack: z.record(z.string(), z.unknown()).default({}),
  approvedBy: z.string().optional(),
});
export type CreativeArtifact = z.infer<typeof creativeArtifact>;

export const publicationRecord = z.object({
  kind: z.literal('PublicationRecord'),
  id: z.string().min(1),
  missionId: z.string().min(1),
  artifactId: z.string().min(1),
  platform,
  /** Idempotency key — retries can never silently create duplicate posts. */
  idempotencyKey: z.string().min(1),
  externalPostId: z.string().optional(),
  url: z.string().optional(),
  approvedBy: z.string().min(1),
  publishedAt: isoDateTime,
  status: z.enum(['pending', 'published', 'verified', 'failed']),
  /** Assisted handoff when no direct publishing integration is available. */
  assistedHandoff: z.boolean().default(false),
});
export type PublicationRecord = z.infer<typeof publicationRecord>;

export const experimentRecord = z.object({
  kind: z.literal('ExperimentRecord'),
  id: z.string().min(1),
  missionId: z.string().min(1),
  hypothesisId: z.string().min(1),
  artifactId: z.string().min(1),
  publicationId: z.string().min(1),
  goalMetricKey: z.string().min(1),
  /** The one or two variables deliberately changed in this experiment. */
  changedVariables: z.array(z.string()).min(1),
  measurementWindowDays: z.number().int().positive(),
  startedAt: isoDateTime,
  result: z
    .object({
      /** Original forecast is preserved verbatim — never rewritten. */
      forecastPreserved: z.boolean(),
      observedMetricKey: z.string().min(1),
      observedValue: z.number(),
      /** Which assumptions were supported / contradicted by the outcome. */
      supported: z.array(z.string()),
      contradicted: z.array(z.string()),
      completedAt: isoDateTime,
    })
    .optional(),
});
export type ExperimentRecord = z.infer<typeof experimentRecord>;

export const simulationRun = z.object({
  kind: z.literal('SimulationRun'),
  id: z.string().min(1),
  missionId: z.string().min(1),
  hypothesisId: z.string().min(1),
  /** Counterfactuals are stored separately from observed history. */
  assumptions: z.array(z.string()).min(1),
  modelRef: z.string().min(1),
  projectedRange: z.object({ low: z.number(), expected: z.number(), high: z.number() }),
  /** Calibration against recorded outcomes; appended, not overwritten. */
  calibrationHistory: z
    .array(
      z.object({
        evaluatedAt: isoDateTime,
        forecastError: z.number(),
        note: z.string().min(1),
      }),
    )
    .default([]),
});
export type SimulationRun = z.infer<typeof simulationRun>;

export const nextAction = z.object({
  kind: z.literal('NextAction'),
  id: z.string().min(1),
  missionId: z.string().min(1),
  experimentId: z.string().min(1),
  /** Keep successful elements, change the weakest contradicted assumption. */
  keep: z.array(z.string()).min(1),
  change: z.array(z.string()).min(1),
  recommendation: z.string().min(1),
  evidence: z.array(evidenceRef),
});
export type NextAction = z.infer<typeof nextAction>;

/** Discriminated union of all canonical records. */
export const marketingRecord = z.discriminatedUnion('kind', [
  productBrief,
  competitorCandidate,
  marketMap,
  adCreative,
  organicContent,
  metricObservation,
  creativeFeatureSet,
  coverageReport,
  creativeHypothesis,
  creativeArtifact,
  publicationRecord,
  experimentRecord,
  simulationRun,
  nextAction,
]);
export type MarketingRecord = z.infer<typeof marketingRecord>;
