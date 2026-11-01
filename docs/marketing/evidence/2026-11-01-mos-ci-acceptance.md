# MOS stream — CI acceptance record (landing commit 881e763d)

- **Date:** 2026-11-01 (run created 15:03:04Z) · **Queried:** 2026-11-01, GitHub Actions API (runs + jobs endpoints)
- **Run:** `CI` #14 — id `41319212488`, head `881e763d` (main), event `push` — **completed / success**
- **Jobs (6/6 green):**

| Job | Conclusion | What it proves for the MOS stream |
| --- | --- | --- |
| governance (lint / schema / architecture) | success | lint 0 errors, db schema compatible, architecture tests 36/36, `architecture:check --changed` 0 violations — the `mos-product-flavor` managed module and the `productIdentity.ts` policy exception hold in CI |
| typecheck (full tsc chain) | success | the **full 18-project root typecheck chain** the 4GB authoring sandbox could not run (it verified only the per-project subset: shared / ui / desktop main / e2e) |
| unit (complete root suite + cli plugin chains) | success | the **complete root unit suite at default workers** (sandbox OOMs at 4 workers; it verified a 158-test targeted battery + the 1,314-file affected suite at `ZCODE_TEST_MAX_WORKERS=1` during the pre-push guard). The MOS unit specs (`productIdentity`, `desktopProductIdentity`, `desktopMosPackagingIdentity`, `mos-product-flavor/contract`, ui template/connection/config tests) ran within this suite. |
| youtube-oauth (WO-P1, credentials-free) | success | regression protection — the MOS commit did not disturb the WO-P1 stack |
| cred-hygiene (WO-P1 redaction scanner) | success | regression protection — no credential-pattern regressions introduced |
| desktop e2e (electron, container, replay-isolated) | success | the 4 replay-admitted container specs passed on the MOS commit — the commit did not break the admitted e2e set. **The MOS spec itself is NOT in that set** (see below). |

## Environment-limited items — status after run 14

Of the three honestly-recorded sandbox limits in the MOS-07 record:

1. **Full root typecheck chain** — CLOSED by this run (job green).
2. **Complete unit suite at default workers** — CLOSED by this run (job green).
3. **wdio e2e halves (AT-MOS-3/4/6/8/9/10 in `test/e2e/ui-shell/mos-product-flavor.test.ts`)** — still open: the container job runs only the 5 formally admitted specs; admission requires a green formal single-spec Docker run first (`E2E_SPEC` run, then `e2e:docker:admit` per `scripts/test-desktop-e2e-container.sh`).

This commit adds the missing mechanism so item 3 can be executed from CI:
`workflow_dispatch` inputs on the CI workflow — `e2e_spec` (spec override for the
desktop-e2e job) and `mos_identity` (runs the job with `ZCODE_MOS_IDENTITY=1`;
the container script now forwards the identity env into the Docker run, and the
e2e build already fingerprints on it — `ensure-e2e-desktop-build.mjs` axis list —
because the identity changes the `__ZCODE_PRODUCT_FLAVOR__` define baked into the
bundle). Push-triggered runs are unchanged: empty inputs fall back to the exact
CI preset pinned before.

**Post-script (same day):** the stored push token lacks repository-admin rights,
and `workflow_dispatch` requires them — the dispatch API returned
`403 Must have admin rights to Repository`. The operative trigger is therefore a
dedicated formal-run workflow, `.github/workflows/mos-e2e-formal.yml`: a single
job pinning `E2E_SPEC=./test/e2e/ui-shell/mos-product-flavor.test.ts` and
`ZCODE_MOS_IDENTITY=1`, triggered by pushes to main that touch the workflow file
or the MOS spec itself (its adding push included), plus `workflow_dispatch` for
users with admin rights. The ci.yml inputs remain available for a future admin
run. The formal run's URL is the admission evidence for the MOS spec.

## Follow-up recorded in this same change

- WORK-REGISTRY change log: CI acceptance row for the MOS landing commit.
- The formal single-spec MOS container run (dedicated workflow, MOS identity
  build) is the next step; its outcome lands in a dated evidence file and, on
  green, the spec's admission path.
