# WO-P5 closure — wave-2: as-of snapshot exports + panel screenshots (gate P5 closed)

- **Work order:** WO-P5 — Historical intelligence integrity (`docs/marketing/PHASE2-HANDOFF.md` §5, `docs/marketing/work-orders/WO-P5-execution-plan.md`).
- **Executor:** TL (session 2026-11-02; wave-1 was the Workers R + C concurrent wave, recorded in `2026-10-31-w8-3-wo-p5-concurrent-wave.md` — this entry is the TL-executed follow-up that entry scheduled "before W10").
- **What this entry closes:** the two artifacts wave-1 recorded as deferred (its §5, honest limitations), completing the WO-P5 work-order record and closing **gate P5**.

## 1. Delivered artifact A — exported as-of snapshots (incl. the no-observation case)

`packages/marketing/src/demo/runP5SnapshotExport.ts`, runnable as `pnpm --filter @zcode/marketing demo:p5-snapshots` (package script `demo:p5-snapshots`). It exports the canonical synthetic fixture history (identical timeline to `test/historicalIntegrity.test.ts`: T1/T2/T3 observations plus between/before/after as-of times, `fixture:p5` source ids, 2026-01 timestamps — synthetic, labeled as such, zero network) as:

- `docs/marketing/evidence-artifacts/p5-snapshots/as-of-snapshots.json` — the six as-of snapshots through BOTH engines (in-memory `TemporalStore` and the SQLite production adapter, temp-dir database) plus the twelve workflow-level signal evaluations (both subjects × six as-of times) carrying the `noObservation` contract field verbatim.
- `docs/marketing/evidence-artifacts/p5-snapshots/as-of-snapshots.txt` — the same evidence in readable form.

The script is itself gated (any violation throws before writing): cross-engine byte-identical snapshots at all six as-of times; the between-observations as-of (2026-01-08) reproduces the 2026-01-05 snapshot exactly (no interpolation); the pre-coverage as-of (2026-01-02) returns the explicit empty series; the workflow-level pre-coverage signal carries `reason: before_coverage`, the never-observed subject carries `reason: not_observed`, valued signals never carry the field, and the post-coverage signal is total 2200 / velocity 600. This closes the plan §5 requirement "exported as-of snapshots including one no-observation case" — both no-observation reasons are exported, at the store level and the workflow level.

## 2. Delivered artifact B — panel screenshots at a browser E2E drive

`apps/zcode-cli/packages/marketing-plugin/scripts/w3-4-panel-e2e.mjs` gained two gates (inserted after gate 6b, before the W4 gates; the full 19-gate drive re-ran green, exit 0, no page errors):

- The SECOND mission (agent-started in gate 6, objective **awareness**, demo mode) is discovered, user-confirmed, and researched agent-side through the real server (research gets an extended 120 s MCP request timeout — demo mode still runs the real keyless public connector alongside the fixtures). Switching the panel to it through its own sidebar UI (`selectMission` → the panel loads the report through the bridge itself) renders its signals card.
- **Why the no-observation case is honest, not staged:** the demo fixtures' ad subjects (`ad-rivalone-v0`/`ad-rivaltwo-v0`) carry impressions only, and the awareness primary metric `views` has an **empty proxy ladder** (`PROXY_LADDER.views = []`), so `performanceSignals()` derives `not_observed` for them through the ordinary production path — while the organic fixture subjects (`yt-101`/`yt-102`, three views snapshots each) render real totals and velocity in the same card. The gates assert: an explicit chip matching /no observation.*not observed/i; every ad-fixture row carries the chip and no total/velocity values; every organic-fixture row carries `velocity/7d`; real public-feed subjects (`yt:<videoId>`), if the live connector resolves any, only ever add rows.
- **AT-P5.4 at the panel:** the `.point-of-use-coverage` hint renders inline at the signals card, matching /coverage at point of use/i and naming the feeding sources (`sample-adlib`/`sample-platform`, or the coverage slices' own source ids on the fallback path).
- Screenshots `docs/marketing/evidence-artifacts/10-no-observation-signals.png` and `11-point-of-use-coverage.png`: both `scrollIntoViewIfNeeded()` the asserted element before the shot, so it is in the captured viewport by Playwright's contract. The hint sits at the top of the signals card and the chips on its rows, so the two shots converge on the same scrolled view — one view, both surfaces, stated here rather than implied by two identical files.

Evidence transcript: `docs/marketing/evidence/2026-11-02-wo-p5-wave2-panel-e2e.txt` (19 gates, chromium 143 through the MCP Apps AppBridge host, the real bundled plugin server over /rpc).

## 3. Wave-1 follow-up notes closed

- The wave-1 integration-review note about `AsOfQueryOptions`/`SignalNoObservation` not being re-exported from the package root index: checked 2026-11-02 — no consumer imports either name (the plugin's panel types `NoObservation` structurally in its own `ui/types.ts`; the only other references are the build output). Unchanged, per the wave-1 resolution ("if any consumer needs the named export").
- `insufficient_window` remains the documented defensive residual (wave-1 §5): implemented in the derivation, currently unproducible through the proxy-ladder walk, no test asserts it. Carried forward unchanged — closing gate P5 does not claim it.

## 4. Gate-P5 closure statement (handoff §6)

The gate row reads: *"P5 — Historical integrity | WO-P5 | Reproducible as-of queries with clear source and observation-time semantics | Fixture runs, snapshot exports, no-observation case, UI disclosure."* All four artifact classes are stored and linked: fixture runs (`packages/marketing/test/historicalIntegrity.test.ts` in the root CI suite, wave-1), snapshot exports + no-observation case (`evidence-artifacts/p5-snapshots/`, this entry), UI disclosure (panel test suite in CI from wave-1 + the browser-gate evidence and screenshots above). The full acceptance set AT-P5.1–AT-P5.5 was reviewed green at wave-1 (store, workflow, report-text and panel levels); this entry adds the two deferred closure artifacts on top of that record. **Gate P5 is closed.**

## 5. Honest limits

- The panel screenshots are DOM-asserted and scroll-framed, but the two shots are one converged view (stated in §2); no pixel-level assertion is claimed beyond what the Playwright gates check.
- The browser drive runs in this dev sandbox (real Chromium, real spawned server, real bridge), not the CI container — the CI-runnable form of the panel assertions remains the plugin test suite (`65/65` at wave-1; the driver is a demo/evidence script, as it was for W3-4/W4/W5/W6).
- Session hygiene: this wave-2 work was produced twice — the first pass (export script + evidence, driver extension drafted) was destroyed by the third authoring-sandbox recycle between sessions before any commit/push; origin/main was intact, recovery followed the WO-G1 protocol (fetch → ancestor check → `reset --hard origin/main` → reinstall → re-apply). Recorded in the WORK-REGISTRY change log. No pushed state was ever lost.

## 6. CI acceptance

Landing commit `155f387b` — CI run **41432290482** (2026-11-02), all six gates green: governance (lint / schema / architecture), typecheck (full tsc chain), unit (complete root suite + cli plugin chains — including the Reset-guard pre-flight (WO-G1) step, the root suite with the WO-P5 fixture suite, the bootstrap plugin-registry suite, the adapters plugin conformance suite, and the marketing plugin suite, each step concluded success), youtube-oauth, cred-hygiene, desktop e2e (electron, container, replay-isolated). The export script itself is demo evidence run on demand (`demo:p5-snapshots`); its package is covered in CI by typecheck/build and the domain fixture suite.
