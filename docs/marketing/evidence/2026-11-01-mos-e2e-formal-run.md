# MOS e2e — formal single-spec container run (Docker admission evidence)

- **Date:** 2026-11-01 · **Result:** ✅ **GREEN** — Docker admission prerequisite satisfied
- **Run:** `MOS e2e (formal single-spec container run)` #4 — id `41363702225`, head `6a91ef97`
  (main), event `push`, completed **success**; job `desktop e2e (MOS flavor, single spec,
  container, replay-isolated)` completed success, run attempt 1.
- **Configuration:** `E2E_SPEC=./test/e2e/ui-shell/mos-product-flavor.test.ts`,
  `ZCODE_MOS_IDENTITY=1` (marketing-flavor e2e build — the identity axis participates in the
  build fingerprint), `E2E_NETWORK_MODE=replay-isolated` (network-isolated container,
  credentials-free), via `.github/workflows/mos-e2e-formal.yml`.
- **Environment:** GitHub-hosted `ubuntu-24.04`, Electron/chrome 146.0.7680.80, Docker
  container per `Dockerfile.desktop-e2e`, `--shm-size 2g`, driver-cache volume.
- **Admitted spec:** `packages/desktop/test/e2e/ui-shell/mos-product-flavor.test.ts` — six
  e2e acceptance tests, all green: AT-MOS-3 brand badge (mark "M", aria "MOS", badge doubles
  as the sidebar dock toggle) · AT-MOS-4 composer discovery (honest task-note line, three
  marketing quick-start chips, click = prompt prefill with **no session created** — pane
  stays `data-session-id="draft"`) · AT-MOS-6 real PTY terminal (typed
  `printf 'MOS_%s\n' PTY_ALIVE` echoed `MOS_PTY_ALIVE` through xterm) · AT-MOS-9 Marketing
  connections (ledger-true rows only: 2 verified / 1 implemented-not-connected / 2
  candidate; account row renders "Not connected") · AT-MOS-10 About MOS / Current State
  (product "MOS · The Marketing OS", base runtime ZCode Desktop, honest "Not configured"
  update state) · AT-MOS-8 store capabilities card (four capability names, "Nothing is
  installed automatically").

## Iteration record (honest)

The spec had never executed under the wdio harness (the 4GB authoring sandbox cannot run
it — recorded in `2026-11-01-mos-e2e-environment-record.txt`). The formal-run path required
three iterations, each verified in the container:

| Run | Commit | Outcome | Finding |
| --- | --- | --- | --- |
| #1 `41361086411` | `3bedd53d` | failure | undiagnosable from the API — job logs and artifact downloads are admin-gated for the push token |
| #2 `41362031960` | `fb36ec62` | failure | observability added (tee + `::error::` annotations); diagnosis: `switchToCodingMode` never opened the profile menu, so the "Interface mode" menuitem never existed in the DOM |
| #3 `41363117413` | `721d3e16` | failure | mode switch fixed (open `TID_LOGIN_TRIGGER` first, wait `aria-expanded=false` after); diagnosis: `assertNoSessionStarted` counted permanent draft-state chrome (`v4-session-pane` + sr-only `v4-session-title`) — the correct no-session signal is the pane's `data-session-id="draft"` |
| #4 `41363702225` | `6a91ef97` | **success** | all six tests green |

Both spec fixes mirror patterns proven in the existing suite (`general-coding-mode.test.ts`
switchMode; `helpers/v4-conversation.ts` draft-state detection). Run #2's passing
assertions before the switch (badge mark "M", English task-note line) also confirmed the
container app renders en-US and the MOS identity build is byte-correct.

## Admission recorded in this change

- `scripts/test-desktop-e2e-container.sh`: `MOS_VERIFIED_E2E_SPEC` + `mos` preset (defaults
  `ZCODE_MOS_IDENTITY=1`, refuses an explicit `=0` because the spec asserts brand surfaces
  absent from default builds). The preset is the maintainer-facing one-command formal/local
  run; the CI `desktop-e2e` job keeps the default-identity admitted set (a second container
  run per push would double the job without buying default-flavor protection).
- `.github/workflows/mos-e2e-formal.yml`: `scripts/test-desktop-e2e-container.sh` added to
  the path triggers so container-script changes re-verify the MOS formal run.

With this run, all three honestly-recorded sandbox limits of the MOS stream are closed by
authoritative CI evidence (full typecheck chain + complete unit suite via CI run #14 on
`881e763d` — see `2026-11-01-mos-ci-acceptance.md` — and the e2e halves via this run).
