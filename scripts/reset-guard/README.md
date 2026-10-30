# Reset-guard — WO-G1 sandbox-reset prevention (Phase 2, Wave W8)

The failure class this guard makes mechanically impossible to repeat
silently: **an authoring sandbox reset to an old commit while `origin/main`
already held the completed implementation, followed by an undetected parallel
rebuild.** It occurred twice on 2026-10-30 (recorded in
`docs/marketing/WORK-REGISTRY.md`); the second occurrence was caught by this
wave's own protocol before any duplicated work ran.

The guard is the enforcing complement to `scripts/check-workspace-freshness.mjs`
(that upstream tool is advisory at session start; it does not gate pushes,
bind work orders to base commits, write checkpoints, or recognize a recorded
reconciliation). Both run at session start; only this one gates pushes.

**Zero dependencies by design** — node: builtins only, no workspace install
needed. A guard that requires `node_modules` would be unusable in exactly the
broken environments it guards against (a freshly reset sandbox with no
install, a purged workspace).

## Commands (run from the repository root)

| Purpose | Command |
| --- | --- |
| Session-start pre-flight | `pnpm run reset-guard:pre-flight` |
| Bind a work order to its base commit | `node scripts/reset-guard/cli.mjs bind --wo WO-XX` |
| Re-assert the base before any write | `node scripts/reset-guard/cli.mjs assert --wo WO-XX` |
| Pre-push gate (wired into `verify:pre-push`) | `pnpm run reset-guard:pre-push` (or `node scripts/reset-guard/cli.mjs guard-push [--expect <sha>]`) |
| Session checkpoint | `node scripts/reset-guard/cli.mjs checkpoint write` / `checkpoint read` |
| Record a sandbox-divergence recovery | `node scripts/reset-guard/cli.mjs record-recovery --input '<json or @file>'` |
| Human state summary | `node scripts/reset-guard/cli.mjs status` |
| Simulated integration run (evidence) | `node scripts/reset-guard/demo-incident-recovery.mjs` |

Exit codes: **0** = passed (silently — AT-G1.5: a passing guard prints
nothing), **1** = refused (report on stdout), **2** = usage/operational error
(stderr). `--no-fetch` judges the last-fetched refs (offline/tests).

## The five scopes (work-order contract → implementation)

1. **Pre-flight (scope 1):** fetch `origin`, compare `HEAD` against
   `origin/main`; behind/diverged without a recorded reconciliation → refuse
   and print the divergence report (local HEAD, remote HEAD, ahead/behind
   counts, incoming commit subjects).
2. **Work-order base binding (scope 2):** `bind` records the base commit the
   order was accepted on (`.reset-guard/work-orders.json`); `assert`
   re-asserts `HEAD` unchanged — or that a reconciliation record explicitly
   covers the divergence — before any write. Two coverage shapes are
   recognized: the sandbox reset away from the base (current HEAD is the
   recorded stale local; the recorded winning remote contains the bound
   base), and the bound base itself being the superseded stale local.
3. **Pre-push guard (scope 3):** refuses a push when the working tree is
   dirty (every offending file named), when the base is behind/diverged
   without a recorded reconciliation (the route the 2026-10-30 parallel
   rebuild escaped through), or when `HEAD` does not match `--expect`. The
   guard's own state directory never dirties the tree.
4. **Checkpoint (scope 4):** `.reset-guard/checkpoint.json` (gitignored) —
   schema v1: `schemaVersion`, `repositoryUrl`, `head`, `branch`,
   `dirtyFiles[]`, `openWorkOrders[{id, base, boundAt}]`, `writtenAt`.
   Writes are validated before persisting; reads reject malformed payloads
   with every violation listed.
5. **Recovery events (scope 5):** `record-recovery` validates the six
   required fields (detection time, local + remote states, divergence
   summary, decision, ported items, discarded-work inventory), persists the
   machine-readable record, and renders the WORK-REGISTRY change-log row to
   commit. Recorded events are the escape hatch recognized by scopes 1–3.

## Reconciliation protocol (unchanged policy, operationalized)

The completed remote state wins unless a verified-additive local improvement
exists, in which case it is ported and redundant work is discarded. The guard
records decisions; it never makes them. On a refused pre-flight:

1. `record-recovery` with the six fields (the CLI prints the registry row),
2. `git merge --ff-only origin/main` or `git reset --hard origin/main`,
3. commit the rendered row into `docs/marketing/WORK-REGISTRY.md`,
4. re-run the pre-flight — it now passes, explicitly reconciled.

## Acceptance tests (AT-G1.1–AT-G1.5) and wiring

`resetGuard.test.mjs` maps 1:1 to the acceptance tests: every case builds a
real throwaway git repository pair (bare origin + clone) in a temp directory —
fully hermetic, no network. The suite runs in the root unit suite's
fork-isolated serial project (the house convention for real-git subprocess
tests) and is therefore a required CI check on every run; the CI unit job also
runs the explicit `Reset-guard pre-flight (WO-G1)` step against its own
checkout. `verify:pre-push` (husky) runs `guard-push` first.

| AT | Test group |
| --- | --- |
| AT-G1.1 | stale base refuses with divergence report (CLI + library, diverged shape, WO-base refusal after a reset) |
| AT-G1.2 | dirty-tree push refusal naming files (modified + untracked, CLI, stale-base push, unexpected HEAD) |
| AT-G1.3 | checkpoint round-trip + schema rejection (wrong version, bad sha, non-array fields, bad JSON, unknown fields) |
| AT-G1.4 | simulated divergence → complete recovery event + registry row; reconciliation unblocks guards; incomplete events rejected |
| AT-G1.5 | clean state passes silently (empty stdout, exit 0); guard state never dirties; whole chain well under a second |
