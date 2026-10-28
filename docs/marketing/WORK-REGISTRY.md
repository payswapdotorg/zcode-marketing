# WORK-REGISTRY

> Owned work orders, dependencies, status, evidence, commits, and remaining work. No task is complete merely because an agent reports that it finished — completion requires the recorded evidence. Last updated: 2026-10-28 (W2 closed; W1 organic verified; full-env gates recorded).

## Roles (blueprint §10)

| Role | Owner | Responsibility |
| --- | --- | --- |
| **TL** — architect & integration owner | `marketing-tl` (architecture-policy owner of module `marketing`) | Runtime boundary, fork baseline, architecture lock, interface contracts, product-level integration, regression gates, release acceptance |
| **Worker A** — platform access & connectors | open | Platform policy verification, acquisition/publishing adapters, pagination/retries, access-state reporting, source coverage matrix |
| **Worker B** — temporal data & analytics infrastructure | open | Ingestion, normalized records, observations, snapshots, provenance, historical replay, idempotency, persistence tests |
| **Worker C** — marketing intelligence & creative experience | open | Creative feature extraction, performance analysis, cross-source pattern discovery, evidence-backed briefs, evaluation fixtures, marketing UI |

Shared files are TL-owned or assigned to exactly one worker at a time. Workers integrate through reviewed contracts and test fixtures, never unstructured chat assumptions.

## Work orders

### W0-1 — Upstream audit and preservation baseline
- **Owner:** TL · **Status:** ✅ Complete (2026-10-28)
- **Deliverables:** `FEATURE-PRESERVATION-MATRIX.md`, `MARKETING-ARCHITECTURE-LOCK.md`, `MARKETING-NORTH-STAR.md`
- **Evidence:** source audit of upstream `zai-org/zcode@3c5b2276` (apps/packages/docs/AGENTS/architecture-policy/NOTICE); fork baseline = pushed mirror (branches `main`, `feat/ui-plugin`; tags `v3.14.3`, `v3.15.1`).
- **Environment limitation (honest):** upstream runtime not executed in the authoring sandbox (no pnpm/toolchain); W0 exit gate "demonstrate the existing runtime" is documented from source and must be re-confirmed in a full environment at W1 integration time.
- **Remaining for W0 closure:** none in this environment; full-env re-run recorded as an open blocker in `MARKETING-ROADMAP.md`.

### W1-1 — Marketing domain contracts freeze
- **Owner:** TL · **Status:** ✅ Complete (2026-10-28)
- **Deliverables:** `packages/marketing/src/domain/records.ts` (zod 4.6.5, runtime-validatable), `docs/marketing/MARKETING-DATA-MODEL.md`
- **Covers:** all canonical records — ProductBrief, CompetitorEntity/CompetitorCandidate, AdCreative, OrganicContent, MetricObservation (with metric semantics + version), CreativeFeatureSet, EvidenceRecord/EvidenceRef, CreativeHypothesis, CreativeArtifact, ExperimentRecord, SimulationRun, PublicationRecord, NextAction, CoverageReport, MarketMap.
- **Evidence:** demo run parses every record end-to-end (`evidence/2026-10-28-w2-loop-demo-run.txt`).

### W1-2 — Connector contract + typed errors + capability declarations
- **Owner:** TL (Worker A adopts) · **Status:** ✅ Contract complete; conformance implementation = sample reference (2026-10-28)
- **Deliverables:** `docs/marketing/PLATFORM-CONNECTOR-CONTRACT.md`, `packages/marketing/src/app/ports.ts`, `packages/marketing/src/adapters/sampleConnector.ts`
- **Notes:** capability-declared (research/analytics/publishing/scheduling/paidAds); `coverage_gap` is a normal result feeding CoverageReport; `policy_violation` aborts without retry; publish() exists iff capabilities.publishing (enforced in demo gate).

### W1-3 — Source access verification (gate-critical, blocks W1 exit)
- **Owner:** Worker A · **Status:** 🟡 Organic side verified; ad side blocked on credentials
- **Deliverables:** repeatable access tests for (a) YouTube public data — organic side, (b) one ad-intelligence source for the intended market — results committed under `docs/marketing/evidence/` and rows signed in `MARKETING-DATA-SOURCES.md`.
- **(a) Organic — VERIFIED 2026-10-28:** keyless YouTube public routes (uploads RSS + oEmbed + handle→channel-id resolution) implemented as a real connector (`connector:youtube-public`, research-only) and exercised live through the full connector contract: 15 organic records + 15 real view-count observations, idempotent ingest, honest coverage gaps, negative control. Evidence: `evidence/2026-10-28-w1-source-access-youtube-public.txt` (exit 0). Row signed in `MARKETING-DATA-SOURCES.md` ("YouTube public metadata — oEmbed + channel uploads RSS (keyless)"). The key-based Data API (per-video history) remains unverified — no credentials in this environment.
- **(b) Ad-intelligence — BLOCKED (honest):** Meta Ad Library `ads_archive` probed live without credentials: endpoint reachable, documented parameters validated, no data without an access token (typed `auth_required`, recorded in the same evidence file Part 2). Repeatable harness committed (`demo/runSourceVerification.ts` reads `META_AD_LIBRARY_TOKEN`); a credentialed Worker A run + intended-market decision closes the item.
- **Blocked by:** API credentials + intended market/geography definition (ad side only).

### W2-1 — Temporal data foundation (loop machinery)
- **Owner:** Worker B (TL implemented the slice) · **Status:** ✅ Complete (2026-10-28) — in-memory + SQLite production persistence
- **Deliverables:** `packages/marketing/src/app/temporalStore.ts` (`TemporalStorePort` + in-memory implementation: idempotent ingest by source identity, superseded-value revision recording, as-of queries, velocity over comparable windows, coverage ledger) and `packages/marketing/src/adapters/sqliteStore.ts` (`SqliteTemporalStore`: `node:sqlite`, repo-style immutable versioned migrations with checksummed append-only journal, append-only revision table preserving superseded values, close/reopen persistence). `MarketingMission` takes an injected store; workflows are storage-agnostic.
- **Evidence:** in-memory gates — `evidence/2026-10-28-w2-loop-demo-run.txt`; SQLite conformance (same gates + persistence-across-reopen) — `evidence/2026-10-28-w2-sqlite-persistence-conformance.txt` (exit 0).

### W2-2 — Capability catalog + routing rules
- **Owner:** TL · **Status:** ✅ Slice complete (2026-10-28)
- **Deliverables:** `packages/marketing/src/app/capabilityCatalog.ts` — cheapest-suitable routing with reliability bars, fallback, and recorded routing decisions; `docs/marketing/MARKETING-CAPABILITY-MAP.md`.
- **Notes:** extends the model registry concept; production wiring goes through the existing ZCode provider system (never a side-channel).

### W3-1 — Runtime integration (marketing tools in the CLI tool/plugin chain)
- **Owner:** TL · **Status:** ⬜ Open (W3 entry)
- **Deliverables:** `apps/zcode-cli/packages/marketing-plugin` registering marketing tools per the tool change chain spec (inputSchema/outputSchema, permission scopes, side-effect declarations), mission workspace flows, evidence viewer surfaces.
- **Acceptance:** a user describes a product, chooses a platform, and sees an evidence-backed report with explicit gaps and explainable opportunities.

### W4-1 — Creative briefs, prompt packs, asset validation rubrics
- **Owner:** Worker C · **Status:** ⬜ Open (machinery prototyped in workflows `draftCreative`; rubric machine-implementation pending)

### W5-1 — Authorized publishing adapters
- **Owner:** Worker A · **Status:** ⬜ Open (machinery + approval/idempotency contract in place; real connector + sandbox test account pending)

### W6-1 — Measurement & closed-loop learning against real outcomes
- **Owner:** Worker B + Worker C · **Status:** ⬜ Open (machinery exercised on labeled synthetic data; real calibration pending)

## Change log

| Date | Entry |
| --- | --- |
| 2026-10-28 | Fork created from `zai-org/zcode@3c5b2276` (public repo, full history + tags). W0 audit, governance doc set (10 files), architecture-policy registration of module `marketing`, marketing domain layer vertical slice (`packages/marketing`), loop demo all-gates-pass run recorded as evidence. Commit: `934e1e59` (main). |
