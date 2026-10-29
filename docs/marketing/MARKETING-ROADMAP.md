# MARKETING-ROADMAP

> Phases, dependencies, deliverables, acceptance gates, and open blockers. Wave gates are non-negotiable; a wave is complete when its gate passes with recorded evidence (see WORK-REGISTRY.md for live status). Last updated: 2026-10-29 (W1 complete: both sides of the access gate now verified — organic via keyless YouTube public routes, paid via the Google Ads Transparency Center; initial market: US / YouTube; live-mode tool chain now runs on real paid data).

## Wave plan

### W0 — Upstream audit and preservation baseline
- Inspect the fork point, existing architecture, runtime, permissions, extension mechanisms, persistence, build and tests. Establish a regression baseline before modifying anything.
- **Exit gate:** the TL can demonstrate the existing runtime and document which capabilities must remain intact.
- **Status:** ✅ Complete (2026-10-28). Audit recorded in `FEATURE-PRESERVATION-MATRIX.md`; architecture boundaries frozen in `MARKETING-ARCHITECTURE-LOCK.md`. Full-environment re-verification executed and recorded on 2026-10-28: `evidence/2026-10-28-full-env-verification.txt` (pnpm bootstrap, root `pnpm typecheck` incl. `packages/marketing`, `pnpm lint`, `pnpm architecture:check --changed`, `pnpm test:architecture`, `pnpm db:schema:check` — all pass, limitations stated in the evidence file).

### W1 — Architecture contracts and data-access proof
- Freeze marketing domain contracts, source-coverage model, capability-routing design, security boundaries. Test real access to candidate data sources before making them foundational.
- **Exit gate:** at least one viable organic-content source and one suitable ad-intelligence source for the intended market have verified access paths and repeatable test results.
- **Status:** ✅ Complete (2026-10-29). Contracts frozen and implemented (`packages/marketing/src/domain`, `app/ports.ts`, connector contract, capability catalog). **Initial market recorded: United States / YouTube.** Organic side: keyless YouTube public routes — `connector:youtube-public`, live repeatable test `evidence/2026-10-28-w1-source-access-youtube-public.txt` (verified 2026-10-28; 2026-10-29 route-availability incident recorded in the ledger, surfaced as explicit coverage gaps). Ad side: **Google Ads Transparency Center keyless public route** — `connector:google-ads-transparency`, live repeatable test `evidence/2026-10-29-w1-ad-source-google-atc.txt`: real advertisers resolved by name, 184 real ad creatives ingested idempotently into the SQLite temporal store, honest negative control, platform-reported delivery dates distinct from observation timestamps, structural limitations reported on every page. Meta Ad Library API remains the credentialed growth path (not a W1 blocker).

### W2 — Temporal data foundation
- Connector framework, normalized entities, provenance, immutable metric observations, historical snapshots, coverage reporting, backfill where permitted.
- **Exit gate:** ingesting the same evidence twice is safe, metric changes are recorded, and an as-of query reproduces the observations actually available at that time.
- **Status:** ✅ Complete (2026-10-28). `app/temporalStore.ts` defines `TemporalStorePort`; the in-memory implementation and the production SQLite persistence adapter (`adapters/sqliteStore.ts`, `node:sqlite`, repo-style immutable versioned migrations) both pass the identical gate set — idempotent ingest, duplicate no-op, explicit revisions preserved in an append-only revision table, as-of queries, velocity, plus close/reopen persistence (`evidence/2026-10-28-w2-sqlite-persistence-conformance.txt`). MarketingMission accepts an injected store; workflows are storage-agnostic.

### W3 — First end-to-end intelligence workflow
- Product onboarding form, competitor discovery, platform research, evidence viewer, creative feature extraction, cross-source opportunity ranking.
- **Exit gate:** a user can describe a product, choose a platform, and see an evidence-backed report with explicit data gaps and explainable creative opportunities.
- **Status:** 🟡 In progress — W3-1 slice complete (2026-10-28); W3-2 real-model bridge complete (2026-10-29). Marketing tools run in the CLI plugin chain: `apps/zcode-cli/packages/marketing-plugin` (official plugin `marketing`, stdio MCP server, default-enabled) registers `marketing_mission_start/_list`, `marketing_discover_competitors`, `marketing_research_platform`, `marketing_analyze_creative`, `marketing_rank_opportunities`, `marketing_mission_report`, `marketing_evidence_view` — each with zod inputSchema + outputSchema (outputs reuse the canonical domain records) and side-effect annotations; missions persist in the workspace (`.zcode/marketing/` JSON index + one SQLite temporal store per mission, reusing the W2 persistence adapter). The full chain ran through a real spawned MCP server process and passed the W2 gates plus the W3 gate: evidence/2026-10-28-w3-plugin-chain-run.txt. W3-2 closed the structured-extraction gap: model tasks route to the session's provider-routed model through the MCP sampling channel (`zcode:routed:<model>` provenance per record; labeled heuristic fallback recorded on channel failure), proven on real uploads with a real model in evidence/2026-10-29-w3-2-sampling-bridge-run.txt. **Live-mode paid side: closed 2026-10-29 (W1-3(b))** — live youtube missions now compose `connector:google-ads-transparency` (real ads from the Google Ads Transparency Center; the full chain demo exercises the real service); the `paid_source_gap` typed error fires only when a mission genuinely observes zero ads, with per-competitor resolution outcomes recorded in the coverage report. Remaining for W3 closure: rendered evidence-viewer UI panel (follow-up order; in-tool outputs satisfy the wave gate) — the panel should grow into the user-facing marketing research workspace (next major order, review Priority 3).

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
| ~~Ad-intelligence source selection for first market~~ | Worker A + TL | ✅ Closed 2026-10-29 — initial market recorded (**US / YouTube**); paid side verified via the keyless **Google Ads Transparency Center** public route (`connector:google-ads-transparency`; evidence/2026-10-29-w1-ad-source-google-atc.txt: 184 real creatives, idempotent live ingest, honest negative control). Meta Ad Library API stays open as the credentialed growth path for Meta-platform markets. |
| Keyless uploads-RSS route availability (platform-side partial outage, 2026-10-29) | Worker A | route returned HTTP 404 for many channels (incl. previously verified ones), from plain HTTP and a full browser; connector surfaces explicit coverage gaps; prior organic verification stands; re-confirm at next live organic use and extend the key-based Data API path when credentials exist |
| ~~Marketing plugin registration in CLI runtime~~ | TL | ✅ Closed 2026-10-28 — official plugin `marketing` registered (`apps/zcode-cli/packages/marketing-plugin`, default-enabled, stdio MCP server + skill); tools follow the tool change chain contract with zod input/output schemas; evidence: `evidence/2026-10-28-w3-plugin-chain-run.txt`. Real-model bridge for structured extraction: ✅ closed 2026-10-29 (W3-2, `evidence/2026-10-29-w3-2-sampling-bridge-run.txt`); evidence-viewer UI panel stays a follow-up order. |
| Real ZCode-host/provider end-to-end verification of the sampling bridge (production provider registry + configured credentials) | TL | W3-2 evidence used a protocol-conformant backend (sandbox lacks CLI provider credentials); wire path/provenance identical — a full-env run through the actual host provider registry remains required before production model routing is treated as fully verified (review Priority 2) |
| User-facing marketing research workspace (evidence-viewer panel → branded research experience) | TL + Worker C | next major order after the ad-source closure (review Priority 3) |
| Real publishing sandbox account | Worker A | W5 entry |
