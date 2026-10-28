# MARKETING-DATA-MODEL

> Canonical records, metric observations, evidence provenance, and temporal semantics. Owned by Worker B (temporal data & analytics). Implemented in `packages/marketing/src/domain/`. Last updated: 2026-10-28 (W2 foundation).

## Design stance

These are **domain contracts**, not a mandate for eleven unrelated database systems. Related records stay cohesive; persistence follows ZCode's established storage and migration patterns. The record set below is the canonical list; `packages/marketing/src/domain/records.ts` is the machine-readable source (zod schemas — runtime-validatable, per repo convention, because these records cross process/storage/LLM boundaries).

## Canonical records

| Record | Purpose | Key fields (beyond id/version) |
| --- | --- | --- |
| `ProductBrief` | Product, audience, market, offer, objective, constraints | product, audience, country, platform, offer, objective, constraints, createdByMission |
| `CompetitorEntity` | Companies, brands, sellers, accounts, landing pages with identity confidence | displayName, aliases[], identityConfidence, relevanceReason, evidenceRefs[], sourceRecords[] |
| `AdCreative` | Observable ad content, advertiser, variations, source identifiers | advertiserId, sourceIds{}, variations[], format, firstObservedAt, lastObservedAt |
| `OrganicContent` | Public content, author/account, format, publication timestamp, available metadata | authorId, platform, format, publishedAt, sourceIds{}, availableMetadata |
| `MetricObservation` | A metric value at a particular observation time, with source and metric definition | subjectRef, metricKey, value, observedAt, source, metricDef (semantics + version) |
| `CreativeFeatureSet` | Extracted hooks, topics, formats, messages, narrative structures, CTAs | subjectRef, hooks[], narrative[], offerStructure, visualStructure, extractionModelRef |
| `EvidenceRecord` | Source reference, observation period, provenance, access method, confidence | sourceType, sourceRef, accessMethod, retrievedAt, confidence, coverageState |
| `CreativeHypothesis` | Proposed strategy, supporting evidence, predicted outcome, uncertainty | pattern, supportedBy[], contradictedBy[], predictedOutcome, uncertainty, confidence |
| `CreativeArtifact` | Generated prompt, storyboard, script, uploaded asset, approved version | briefRef, kind (promptPack/script/storyboard/uploadedAsset), status, approvedBy |
| `ExperimentRecord` | Hypothesis, variants, publication details, goal, measurement window, result | hypothesisRef, variants[], goalMetric, measurementWindow, result |
| `SimulationRun` | Forecast assumptions, model/version, projected outcome range, calibration | hypothesisRef, assumptions, modelRef, projectedRange, calibrationRef |

Mission-level composites: `MarketMap` (competitor set + corrections), `TopicCluster`, `PerformanceSignal`, `CoverageReport` (see MARKETING-DATA-SOURCES.md), `PublicationRecord`, `ExperimentResult`, `NextAction` (see MARKETING-CAPABILITY-MAP.md).

## Temporal semantics — the "time machine"

Three kinds of time, preserved separately and never conflated:

1. **Live monitoring** — collect available updates through supported webhooks, polling, authorized APIs; show latest successful observation time and the source's expected freshness.
2. **Historical replay** — reconstruct what the system **actually observed** during a past period, from dated snapshots (as-of queries).
3. **Counterfactual simulation** — what could happen under different choices; stored separately (`SimulationRun`) and never merged into observed history.

Every observation carries at minimum: `observed_at` (when the system saw it), `published_at` (source event time, when applicable), `ingested_at` (when it entered the store), plus connector version, source record identity, metric semantics (and metric definition version when it matters), applicable region, and retention restrictions on source data.

## Idempotency and immutability rules (implemented in `packages/marketing/src/app/temporalStore.ts` — `TemporalStorePort` — and `packages/marketing/src/adapters/sqliteStore.ts` — production SQLite persistence)

- Ingesting the same record twice creates **no** duplicate entity and **no** metric inflation: source identity (`sourceId` + `sourceRecordId`) + observation window deduplicate.
- Changes are new observations or explicit revisions — **history is never silently rewritten**.
- As-of queries return the observations available at that time, never accidentally substituting current values.
- The time machine **cannot** reconstruct states it never recorded; missing history is honestly reported unless an eligible archive, licensed source, or user-provided historical report supplies it (acquisition method 4).
- Read models: `allAds()`, `allOrganic()`, `allMetrics()` (added W3-1 for the evidence viewer — additive, no write-path change), `latestCoverage()`, plus the as-of/velocity queries above. Everything a tool or surface shows must come from these read models, never from side caches.

## Measurement discipline (encoded in the engine, not left to the model)

- **Separate rankings per objective.** Awareness → reach/impressions/qualified views; Engagement → shares/saves/meaningful comments/rates; Traffic → outbound clicks/landing visits; Leads → qualified leads/CPL; Sales → attributed purchases/CVR/revenue/ACOS; Retention → repeat purchases/CLV when measurable.
- Competitor conversion/spend data is usually unavailable → observable signals are used and **labeled** accordingly.
- **Like-for-like comparisons**: account size, content age, country, format, publication period, paid-vs-organic. Use repeated snapshots to compute **velocity**, never rank a 2-day-old video's total views against a 6-month-old one.
- For ads: supported delivery info, observed duration, variation count, impressions/reach where exposed; direct outcome metrics only where legitimately accessible. **Ad longevity is a clue, not proof of profitability.**
- Raw observations are retained, not just final scores, because platform metric definitions change.

## Scoring separation (creative opportunity ranking)

1. **Observed performance** — what the evidence directly says.
2. **Cross-source support** — how consistently the pattern appears across independent eligible sources.
3. **Predicted performance** — the model's estimate for the user's particular objective.
4. **Confidence** — completeness, comparability, statistical informativeness of the evidence.

Every recommendation ships with an explanation, contrary examples, and missing-data notes. Calibration is recomputed against recorded results over time; a fixed scoring formula is not embedded permanently in a prompt.

## What users can ask once this is real

- Which competitors entered or disappeared from a market last month?
- Which ads have been observed repeatedly, and how did their hooks/offers/formats change?
- Which content formats are gaining momentum rather than accumulating views?
- What did the strategy engine recommend before we published a specific campaign?
- Which forecast was wrong, which assumption failed, and what did the next experiment learn?

This requires preserving **the system's own decisions** (hypotheses, forecasts, approvals) with the same rigor as external market evidence — hence `SimulationRun` and `ExperimentRecord` are first-class records, and `EvidenceRecord` covers internal provenance too.
