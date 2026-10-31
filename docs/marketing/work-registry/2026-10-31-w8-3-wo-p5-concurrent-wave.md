# W8-3 — WO-P5 first concurrent worker wave (WO-G2 evidence)

**Date:** 2026-10-31 · **Base:** `6a02a4c1` (WO-G2/WO-P5 re-bound after the staffing commit; original base `8882e74a`) · **Executors:** Worker R + Worker C (independent agent sessions) · **TL:** `marketing-tl` (staffing, briefs, reviews, integration, landing)

This entry is the WO-G2 evidence record for the first concurrent worker wave and the WO-P5 wave-1 landing record. The staffing itself (roster, protocol, TL role) is `docs/marketing/workers.md`; the wave plan and the pinned integration contract are `docs/marketing/work-orders/WO-P5-execution-plan.md`.

## 1. Session evidence (AT-G2.4 concurrency format, workers.md §5)

| Lane | Worker identity | Runtime session ID | Spawned (UTC) | Completed (UTC) | Commit |
|---|---|---|---|---|---|
| research | `zcode-worker-r <worker-r@zcode-marketing.invalid>` | `agent-875156c9-0761-478e-b79b-9af488f7b725` | 2026-10-31T03:52:02Z | 2026-10-31T04:22:55Z (report received) | `3799494e` |
| creative | `zcode-worker-c <worker-c@zcode-marketing.invalid>` | `agent-6ab57240-3b54-41aa-bcc6-b4e206fc8c2c` | 2026-10-31T03:52:02Z | 2026-10-31T04:22:55Z (report received) | `f0371018` |

Both sessions were spawned in the same batch (one message, two parallel invocations) and executed concurrently for ~31 minutes of wall-clock overlap, each in its own context (neither saw the TL's conversation; each discovered the other's uncommitted tree changes only as filesystem facts, handled per brief). Workers made no git mutations; the TL reviewed, gated, committed (with worker authorship), and pushed. Concurrency evidence form: two lanes, one work order, same wave — the distinct-work-order form of AT-G2.4 follows when gate P1 closes and WO-P2/WO-P3 unblock (recorded, not implied).

## 2. What landed

**Worker R — WO-P5 store semantics (`3799494e`):** `MetricObservation` gains additive `reportedAt?` + `recordType` (defaulted; old records parse unchanged) with filterable as-of queries (`AsOfQueryOptions`); `firstObservation()` distinguishes pre-coverage from never-observed; `performanceSignals()` carries the pinned `noObservation` contract field exactly when `velocity`/`total` are both undefined, reason derived from the series' actual state; the anti-fabrication floor (AT-P5.5) — the introducing batch fixes each `(metricKey, subjectRef)` series' floor at its minimum `observedAt`; later earlier-dated records are rejected loudly (`rejectedBeforeFloor` count + per-record `rejected_before_floor` audit, checked before the duplicate/supersede paths) in BOTH the in-memory store and the SQLite adapter (additive; floor derived from persisted data, survives close/reopen); SQLite reads zod-parse legacy rows into the defaulted `recordType`. New fixture suite `packages/marketing/test/historicalIntegrity.test.ts` (21 tests: AT-P5.1 ×3, AT-P5.2 ×6, AT-P5.3 ×5, AT-P5.5 ×7).

**Worker C — WO-P5 panel disclosure (`f0371018`):** `performanceSignalShape` gains the optional contract field (SDK output validation accepts the seam; older output stays valid); valueless signals render an explicit localized no-observation chip + verbatim detail (older shapes → honest fallback wording, never an inferred reason); point-of-use coverage disclosure (handoff §11) inline in the signals card and opportunities list — each feeding source's window/limit from the report's coverage slices, with the organic feed's rolling-window caveat; the standalone coverage card stays the full view and now carries `dateWindow`; `CoverageSlice` mirror corrected to the canonical five states; 7 string-table keys in both locales; 6 new panel tests (AT-P5.4 ×2, AT-P5.2 ×3 + the schema-contract seam test).

## 3. TL review record (AT-G2.2 sign-offs)

**Contract review — Worker R: ACCEPTED with one recorded deviation.** The implementation matches brief §3 and the pinned contract verbatim. Deviation: three files outside the §1 list (`adapters/fixtures.ts` +3, `adapters/sources/youtubePublic.ts` +4, `adapters/sources/youtubePublish.ts` +6 lines) — compile-forced because the pinned zod `.default()` makes `recordType` required on the output type at every `MetricObservation` construction site. The TL verified each diff: additive, honestly labeled (`youtubePublic` = first_party_observation; `youtubePublish` analytics daily rows = source_reported with `reportedAt`), and each directly implements AT-P5.3's "present on all new production observations". Deviation accepted; recorded here rather than silently absorbed.

**Contract review — Worker C: ACCEPTED with three recorded extensions.** (a) `CoverageSlice.state` widened from the stale `ok|partial|gap` mirror to the canonical five states (a genuine stale-mirror fix; render path already had the fallback); (b) the full coverage card additionally shows `dateWindow` (keeps the full card fuller than the compact point-of-use form — within brief intent); (c) the report TEXT line also states absence (`no observation — reason: detail`), serving AT-P5.2's "every access path". All additive; no existing test asserted the old formats.

**Integration review (AT-G2.3 seam): PASSED with one finding resolved.** Seam = store/workflow → report payload → panel rendering. Verified: field name, reason enum, and optionality match EXACTLY on both sides (`SignalNoObservation` in workflows.ts ↔ `noObservation` in `performanceSignalShape` ↔ `NoObservation` in ui/types.ts). Finding: the two lanes typed the seam independently (correct — separate packages); resolution = the schema-declaration test Worker C added pins the plugin side to the contract, and Worker R's workflow tests pin the emit side; the TL re-ran the combined tree (plugin 65/65 covers both lanes together). Second finding, resolved by design: Worker R's `index.ts` export gap (`AsOfQueryOptions`/`SignalNoObservation` exported from their modules but not the package root index) — accepted as-is for this wave (the plugin imports the workflow type structurally, not by name); noted for the WO-P5 follow-up entry if any consumer needs the named export.

**Evidence review: PASSED.** TL independently re-ran every gate on the combined tree before committing (worker self-reports are not evidence — registry rule): marketing package 46/46 (publish 16, rubric 9, historicalIntegrity 21) + typecheck + oxlint 0/0; plugin build within budget (panel.html 651 KiB), 65/65, oxlint 0 errors; `architecture:check --changed` 0 violations; guard asserts re-bound to `6a02a4c1`; husky pre-push chain green on the push.

**Acceptance review:** AT-P5.1 ✅ (fixture-reproducible as-of snapshots, cross-engine parity), AT-P5.2 ✅ (store + workflow + report text + panel, first-class and tested at each level), AT-P5.3 ✅ (additive fields, old-record parse, filterable), AT-P5.4 ✅ (point-of-use windows/limits, both locales, evidence-fallback path), AT-P5.5 ✅ (floor rejection typed + audited in both engines, honest-duplicate path, per-series scope, reopen survival).

## 4. CI acceptance

Run **41168618339** on `f0371018` (2026-10-31), all six gates green: governance, typecheck, unit — root suite **19,977 passed | 21 skipped** (2,054 files; the +21 over the prior 19,956 baseline is exactly the new fixture suite), bootstrap 47/47, adapters 79/79, marketing-plugin **65/65**, reset-guard 20/20 fork-isolated, `Reset-guard pre-flight (WO-G1)` step passing — youtube-oauth 9/9, cred-hygiene 15/15, desktop-e2e. Counts from that run's logs.

## 5. Honest limitations and follow-ups

- `insufficient_window` is implemented as the documented defensive residual — the proxy-ladder walk currently makes it unproducible in `performanceSignals()`; no test asserts it (the worker declined to claim a gate it cannot honestly produce). If the ladder walk ever changes, the derivation is already in place.
- WO-P5 work-order closure (gate P5) still needs the follow-up entry before W10: exported as-of snapshots including one no-observation case, and panel screenshots at the next browser E2E drive (per the plan §5 — recorded deferral, not an omission).
- Worker P (publishing/measurement lane) remains staffed-but-blocked on WO-P1 entry conditions 0.3–0.5 (TL/brand inputs: brand account/channel, OAuth client, test-user basis) — AT-G2.1's "three identities executing" completes when that unblocks.
- The `verify:sources` live-network demo failed environmentally during Worker R's session (YouTube uploads-RSS route returning no content — the same platform-side flakiness recorded 2026-10-29); it exercises live network, not the changed paths, and CI does not run it by design.
- Session-hygiene note: the wave ran on base `6a02a4c1` (the staffing commit) after a same-session re-bind; the workers' briefs referenced `6a02a4c1` as HEAD, which the TL verified before spawning.
