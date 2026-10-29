/**
 * Marketing application ports — the ONLY boundaries adapters may implement.
 *
 * Governance: docs/marketing/PLATFORM-CONNECTOR-CONTRACT.md (connectors) and
 * MARKETING-CAPABILITY-MAP.md (capability routing). Business logic expresses
 * intent through these ports; it never performs I/O itself (CLI 外部 I/O 边界
 * 收敛规则). Layer: app.
 */
import type {
  AccessMethod,
  CoverageState,
  MetricObservation,
  OrganicContent,
  Platform,
  AdCreative,
  CompetitorCandidate,
} from '../domain/records.js';

/** Typed connector errors — no stringly-typed failures, no silent gaps. */
export type ConnectorError =
  | { kind: 'auth_required'; scope: string; reauthHint?: string }
  | { kind: 'permission_denied'; operation: string; policy: string }
  | { kind: 'rate_limited'; retryAfterMs?: number; quotaScope?: string }
  /** Normal result for legitimately missing data — feeds the CoverageReport. */
  | { kind: 'coverage_gap'; coverageState: CoverageState; detail: string }
  | { kind: 'transient_network'; retryable: boolean; attempt?: number }
  | { kind: 'schema_drift'; expectedVersion: string; gotVersion: string }
  /** Would breach source policy — refuse, never retry. */
  | { kind: 'policy_violation'; rule: string };

export class ConnectorFailure extends Error {
  constructor(public readonly error: ConnectorError) {
    super(`connector failure: ${error.kind}`);
    this.name = 'ConnectorFailure';
  }
}

/** Capabilities are declared, not implied: one operation never grants another. */
export interface ConnectorCapabilities {
  research: boolean;
  analytics: boolean;
  publishing: boolean;
  scheduling: boolean;
  /** Separate permission domain — organic approval never authorizes paid ads. */
  paidAds: boolean;
}

export interface ConnectorMeta {
  id: string;
  version: string;
  platform: Platform;
  capabilities: ConnectorCapabilities;
  authModel: 'apiKey' | 'oauthUser' | 'public' | 'import';
  /** Reference into docs/marketing/MARKETING-DATA-SOURCES.md; only verified rows may become foundational. */
  verificationRef: string;
  supportedRegions: string[];
  expectedFreshness: string;
  retentionNote: string;
}

export interface CoverageSlice {
  slice: string;
  state: CoverageState;
  sourceId: string;
  connectorVersion: string;
  region?: string;
  dateWindow?: string;
  note: string;
}

export interface ResearchRequest {
  missionId: string;
  competitors: CompetitorCandidate[];
  platform: Platform;
  country: string;
  /** ISO date window the research must honestly stay inside. */
  from: string;
  to: string;
}

export interface ResearchPage {
  ads: AdCreative[];
  organic: OrganicContent[];
  metrics: MetricObservation[];
  /** Honest per-slice coverage for THIS response — mandatory, never empty. */
  coverage: CoverageSlice[];
  /** Provenance for the whole page (access method is per-source policy). */
  accessMethod: AccessMethod;
}

/** Platform metadata + bytes for a direct publish (W5). */
export interface PublishAsset {
  bytes: Uint8Array;
  mimeType: string;
  title: string;
  description: string;
  tags: string[];
  privacyStatus: 'public' | 'unlisted' | 'private';
}

export interface PublishRequest {
  missionId: string;
  artifactId: string;
  /** Idempotency key — retrying the same publish must not duplicate the post. */
  idempotencyKey: string;
  approvedBy: string;
  /**
   * W5: the asset to publish (bytes + platform metadata composed from the
   * artifact's pack). Absent for assisted handoff — nothing to upload.
   */
  asset?: PublishAsset;
}

export interface PublishOutcome {
  externalPostId?: string;
  url?: string;
  /** True when no direct publishing API exists and we hand off manually. */
  assistedHandoff: boolean;
}

/** Post-status verification result (W5 gate: verify the resulting post). */
export interface PublicationVerification {
  exists: boolean;
  /** Platform-reported upload/processing state when the account route is used. */
  uploadStatus?: string;
  privacyStatus?: string;
  title?: string;
  publishedAt?: string;
  detail: string;
}

/** Authorized-account analytics request (W6; present iff capabilities.analytics). */
export interface AnalyticsRequest {
  missionId: string;
  /** External post ids (platform identities) to collect for. */
  subjectExternalIds: string[];
  metrics: string[];
  from: string;
  to: string;
}

export interface AnalyticsPage {
  observations: MetricObservation[];
  /** Honest per-slice coverage for THIS response — mandatory, never empty. */
  coverage: CoverageSlice[];
  accessMethod: AccessMethod;
}

/**
 * The connector port. research() is required iff capabilities.research;
 * publish() iff capabilities.publishing; analytics() iff capabilities.analytics;
 * verifyPublication() iff capabilities.publishing. Adapters own all I/O.
 */
export interface MarketingConnector {
  readonly meta: ConnectorMeta;
  research(request: ResearchRequest): Promise<ResearchPage>;
  publish?(request: PublishRequest): Promise<PublishOutcome>;
  /** Post-status verification through the connected account (W5 gate). */
  verifyPublication?(input: { externalPostId: string }): Promise<PublicationVerification>;
  /** Authorized-account analytics (W6). */
  analytics?(request: AnalyticsRequest): Promise<AnalyticsPage>;
  healthCheck(): Promise<{ ok: boolean; detail: string }>;
}

/** Creative production tools are separate adapters, never part of research. */
export interface CreativeToolAdapter {
  readonly id: string;
  readonly supportedDurationsSec: number[];
  readonly supportedAspectRatios: string[];
  buildPromptPack(input: {
    brief: Record<string, unknown>;
    constraints: string[];
  }): { prompt: string; negativeConstraints: string[]; formatSpec: Record<string, unknown> };
}

/** What the strategy engine may ask a model to do — capability-routed, recorded. */
export type ModelTask =
  | 'classifyCaptions'
  | 'extractCreativeFeatures'
  | 'synthesizeStrategy'
  | 'scoreOpportunity'
  | 'draftBrief'
  | 'validateAsset';

export interface ModelCapability {
  modelRef: string;
  tasks: ModelTask[];
  /** 0..1 relative cost for budget-aware routing ("cheapest suitable"). */
  relativeCost: number;
  /** 0..1 expected reliability for its declared tasks. */
  reliability: number;
  structuredOutput: boolean;
}

export interface ModelPort {
  readonly capabilities: ModelCapability[];
  /** The runtime router picks; adapters only declare. */
  runStructured<T>(task: ModelTask, input: unknown, outputSchema: { parse: (v: unknown) => T }): Promise<{
    value: T;
    modelRef: string;
  }>;
}
