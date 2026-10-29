# MARKETING-ROADMAP

> Phases, dependencies, deliverables, acceptance gates, and open blockers. Wave gates are non-negotiable; a wave is complete when its gate passes with recorded evidence (see WORK-REGISTRY.md for live status). Last updated: 2026-10-29 (W3-4 complete: the rendered marketing workspace panel — the branded research experience — is live and browser-verified; W4 is the active wave).

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
- **Status:** ✅ Complete (2026-10-29). W3-1 (2026-10-28): official plugin `marketing` registered in the CLI tool chain (`apps/zcode-cli/packages/marketing-plugin`, stdio MCP server, default-enabled) with the full tool set (`marketing_mission_start/_list`, `marketing_discover_competitors`, `marketing_research_platform`, `marketing_analyze_creative`, `marketing_rank_opportunities`, `marketing_mission_report`, `marketing_evidence_view`), missions persisted under `.zcode/marketing/` (JSON index + one SQLite temporal store per mission), full chain run through a real spawned MCP server process (`evidence/2026-10-28-w3-plugin-chain-run.txt`). W3-2 (2026-10-29): structured extraction routes through the host MCP sampling channel with `zcode:routed:<model>` provenance and labeled heuristic fallback (`evidence/2026-10-29-w3-2-sampling-bridge-run.txt`). W3-3 (2026-10-29): **production path verified through the REAL host** — `zcode agent-server` with a real personal provider in its provider registry (GLM glm-4-plus): the real agent loop executed all six tools (6/6, real permission broker), extraction routed with `zcode:routed:glm-4-plus` provenance, the deterministic sampling-kill run stamped the labeled fallback (35/35), mission state persisted (`evidence/2026-10-29-w3-3-real-host-provider-run.txt`). Live-mode paid side: closed by W1-3(b) — missions compose `connector:google-ads-transparency` (real ads; `paid_source_gap` only on genuinely observed zero ads). **W3-4 (2026-10-29): the rendered marketing workspace panel — the branded research experience — shipped as the plugin's first UI surface** (`ui://marketing/panel.html`, office-panel convention; onboarding → discovery → research → honest coverage → separated-score opportunities → provenance evidence tab; agent tool results forward to the panel automatically) and verified in REAL Chromium through the MCP Apps AppBridge host with the desktop sandbox CSP: 8/8 gates, visual verification recorded (`evidence/2026-10-29-w3-4-panel-e2e.txt` + 5 PNG artifacts). The panel is the user-facing product surface the W4–W6 waves build out.

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
| ~~Marketing plugin registration in CLI runtime~~ | TL | ✅ Closed 2026-10-28 — official plugin `marketing` registered (`apps/zcode-cli/packages/marketing-plugin`, default-enabled, stdio MCP server + skill); tools follow the tool change chain contract with zod input/output schemas; evidence: `evidence/2026-10-28-w3-plugin-chain-run.txt`. Real-model bridge: ✅ closed 2026-10-29 (W3-2) and ✅ verified through the real host 2026-10-29 (W3-3). Evidence-viewer UI panel = review Priority 3, next order. |
| ~~Real ZCode-host/provider end-to-end verification of the sampling bridge~~ | TL | ✅ Closed 2026-10-29 (W3-3) — `zcode agent-server` (the real host) executed the full marketing chain with a real personal provider in its provider registry (GLM glm-4-plus): 6/6 tools through the real agent loop + permission broker, `zcode:routed:glm-4-plus` provenance, labeled-fallback proof via the deterministic sampling-kill proxy (`evidence/2026-10-29-w3-3-real-host-provider-run.txt`, reproduce with `demo:w3-3`). |
| ~~User-facing marketing research workspace (evidence-viewer panel → branded research experience)~~ | TL + Worker C | ✅ Closed 2026-10-29 (W3-4) — `ui://marketing/panel.html` shipped with the plugin (0.3.0, ui.surfaces manifest entry, tool `_meta.ui` routing) and verified in real Chromium through the MCP Apps AppBridge host: onboarding → discovery → research → honest coverage → opportunities → evidence trail, agent results forward to the panel (`evidence/2026-10-29-w3-4-panel-e2e.txt`). Grows through W4–W6 as the product surface. |
| Real publishing sandbox account | Worker A | W5 entry |
