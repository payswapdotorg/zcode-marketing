/**
 * @zcode/marketing — marketing domain layer for the ZCode fork.
 *
 * Authoritative governance: docs/marketing/
 *  - MARKETING-NORTH-STAR.md        product goal, journey, non-goals
 *  - MARKETING-ARCHITECTURE-LOCK.md runtime reuse, forbidden parallel implementations
 *  - MARKETING-CAPABILITY-MAP.md   capability → runtime/extension-point mapping
 *  - MARKETING-DATA-SOURCES.md      source ledger + coverage honesty rules
 *  - MARKETING-DATA-MODEL.md        canonical records + temporal semantics
 *  - PLATFORM-CONNECTOR-CONTRACT.md connector interfaces, typed errors, conformance
 *  - MARKETING-EVALUATION.md        benchmarks, calibration, gates
 *  - MARKETING-ROADMAP.md           waves W0–W7 + open blockers
 *  - FEATURE-PRESERVATION-MATRIX.md upstream preservation baseline
 *  - WORK-REGISTRY.md               work orders, ownership, evidence
 *
 * The existing ZCode runtime is the only execution engine (no second planner
 * loop). This package provides domain contracts, workflows, ports, and
 * adapters that the runtime invokes through its tool/plugin extension points.
 */
export * from './domain/records.js';
export { TemporalStore } from './app/temporalStore.js';
export type { IngestResult, TemporalStorePort } from './app/temporalStore.js';
export { CapabilityCatalog } from './app/capabilityCatalog.js';
export type { RoutingChoice, RoutingDecision } from './app/capabilityCatalog.js';
export { MarketingMission } from './app/workflows.js';
export type { OpportunityScore } from './app/workflows.js';
export type {
  ConnectorError,
  ConnectorCapabilities,
  ConnectorMeta,
  CoverageSlice,
  MarketingConnector,
  CreativeToolAdapter,
  ModelCapability,
  ModelPort,
  ModelTask,
  PublishRequest,
  PublishOutcome,
  ResearchPage,
  ResearchRequest,
} from './app/ports.js';
export { ConnectorFailure } from './app/ports.js';
export { SampleConnector } from './adapters/sampleConnector.js';
export { HeuristicModel } from './adapters/heuristicModel.js';
export { FallbackModelPort } from './adapters/fallbackModel.js';
export { SqliteTemporalStore } from './adapters/sqliteStore.js';
export { YoutubePublicConnector, channelCandidate } from './adapters/sources/youtubePublic.js';
export type { FetchLike } from './adapters/sources/youtubePublic.js';
export {
  GoogleAdsTransparencyConnector,
  advertiserCandidate,
  ATC_GEO_IDS,
} from './adapters/sources/googleAdsTransparency.js';
export type { TransparencyFetchLike } from './adapters/sources/googleAdsTransparency.js';
export { paidFixtures, organicFixtures, groundTruth } from './adapters/fixtures.js';
