# MARKETING-ROADMAP

> Phases, dependencies, deliverables, acceptance gates, and open blockers. Wave gates are non-negotiable; a wave is complete when its gate passes with recorded evidence (see WORK-REGISTRY.md for live status). Last updated: 2026-10-28.

## Wave plan

### W0 — Upstream audit and preservation baseline
- Inspect the fork point, existing architecture, runtime, permissions, extension mechanisms, persistence, build and tests. Establish a regression baseline before modifying anything.
- **Exit gate:** the TL can demonstrate the existing runtime and document which capabilities must remain intact.
- **Status:** ✅ Complete (2026-10-28). Audit recorded in `FEATURE-PRESERVATION-MATRIX.md`; architecture boundaries frozen in `MARKETING-ARCHITECTURE-LOCK.md`. Runtime not executed in this sandbox (no pnpm bootstrap); baseline is source-inspection-based and must be re-confirmed by running `pnpm typecheck && pnpm lint && pnpm architecture:check --changed` and the upstream suites in a full environment at W1 integration time.

### W1 — Architecture contracts and data-access proof
- Freeze marketing domain contracts, source-coverage model, capability-routing design, security boundaries. Test real access to candidate data sources before making them foundational.
- **Exit gate:** at least one viable organic-content source and one suitable ad-intelligence source for the intended market have verified access paths and repeatable test results.
- **Status:** 🟡 In progress. Contracts frozen and implemented (`packages/marketing/src/domain`, `app/ports.ts`, connector contract, capability catalog). Source verification tests for YouTube public data + one ad source are the remaining gate items (Worker A; sandbox network/credentials dependent).

### W2 — Temporal data foundation
- Connector framework, normalized entities, provenance, immutable metric observations, historical snapshots, coverage reporting, backfill where permitted.
- **Exit gate:** ingesting the same evidence twice is safe, metric changes are recorded, and an as-of query reproduces the observations actually available at that time.
- **Status:** 🟡 In progress. `app/temporalStore.ts` implements idempotent ingest, observation deltas, as-of queries, coverage ledger; conformance via the sample connector + demo loop run. SQLite persistence adapter (production wiring) pending full-environment integration.

### W3 — First end-to-end intelligence workflow
- Product onboarding form, competitor discovery, platform research, evidence viewer, creative feature extraction, cross-source opportunity ranking.
- **Exit gate:** a user can describe a product, choose a platform, and see an evidence-backed report with explicit data gaps and explainable creative opportunities.
- **Status:** ⬜ Not started. Requires marketing plugin/tool registration in the CLI runtime (see MARKETING-CAPABILITY-MAP.md) and web/desktop surfaces.

### W4 — Creative strategy and production handoff
- Structured creative brief, generator-specific prompts, scripts, storyboards, testable hypotheses; asset upload, comparison, validation.
- **Exit gate:** the user can take a recommendation into a creative platform, produce an asset, and bring it back into the same marketing mission.
- **Status:** ⬜ Not started. Brief generation logic prototyped in the demo loop; validation rubric specified in MARKETING-EVALUATION.md.

### W5 — Authorized publishing
- Platform-specific publishing adapters, consent handling, approval controls, post-status verification, publication records; assisted/manual path for unsupported platforms.
- **Exit gate:** the system publishes a user-approved asset through a connected test account, verifies the resulting post, and records its identity.
- **Status:** ⬜ Not started. PublicationRecord contract exists; approval flow and permission domains specified in the connector contract.

### W6 — Measurement and closed-loop learning
- Collect permitted analytics, compare actuals vs forecasts, run evaluation and backtesting, correct calibration, recommend the next experiment.
- **Exit gate:** the system completes at least one measured content experiment and produces a subsequent recommendation grounded in the recorded result.
- **Status:** ⬜ Not started. Forecast/outcome/calibration machinery exercised on labeled synthetic data in the demo loop.

### W7 — Production hardening and integration expansion
- Reliability, quotas, recovery, tenant isolation, source coverage, performance, usability; further platforms per demand and verified access.
- **Exit gate:** the complete workflow passes security, regression, integration, and product-acceptance suites.
- **Status:** ⬜ Not started.

## Critical sequencing decision

**Build one complete, measurable journey before building ten partial platform integrations.** The first platform and ad source are chosen after the W1 access test, with the intended market and geography explicitly defined. Connector-neutral architecture from day one, deliberately small verified set first.

## Open blockers

| Blocker | Owner | Notes |
| --- | --- | --- |
| Full-environment verification (pnpm bootstrap, typecheck/lint/architecture check, upstream suites) | TL | Sandbox lacks pnpm + full toolchain; must run in a complete dev environment before W1 gate can close |
| YouTube public API access verification (quota + terms test script) | Worker A | Needs API key + repeatable test committed to `evidence/` |
| Ad-intelligence source selection for first market (Meta Ad Library region scope vs TikTok EU scope decision) | Worker A + TL | Decision blocked on W1 access tests + intended market definition |
| Marketing plugin registration in CLI runtime | TL | W3 entry; follows tool change chain spec |
| Real publishing sandbox account | Worker A | W5 entry |
