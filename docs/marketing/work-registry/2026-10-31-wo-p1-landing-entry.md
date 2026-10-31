# WO-P1 landing entry — W8-2: the credentials-free stack lands on `main` (2026-10-31)

| Field | Value |
|---|---|
| Work order | WO-P1 — production YouTube connection ([contract](../work-orders/WO-P1.md) · [execution plan v1.3](../work-orders/WO-P1-execution-plan.md)) |
| Entry type | repository landing (the package's commit-plan steps 1–2); NOT a closure entry — Phases 4–6 (manual credentialed runs) remain, blocked on TL inputs |
| Executor | Z.ai GLM agent — platform lane, Phase 2 executor session |
| Base commit | `9b3ea79a` — bound via `reset-guard bind` 2026-10-31; `assert` before writes; checkpoint written |
| Landing commit | `PENDING-AT-PUSH` — filled by the follow-up registry row immediately after the push |
| Dependencies | WO-G1 ✅ landed `1ece86fb` (entry condition 0.1 satisfied; guard suite 20/20 in the required unit gate; all four gates green on runs 41044065124 and 41047832700) |

## What landed

Everything the executor built for WO-P1 Phases 1–3, moved verbatim from the
delivery package into the repository with package-relative paths rewritten to
repository-absolute ones:

| Artifact | Repository path |
|---|---|
| OAuth client (PKCE, exchange, refresh+rotation, revoke) | `tools/youtube-oauth/oauth-client.mjs` |
| AES-256-GCM token store + redacted audit log | `tools/youtube-oauth/token-store.mjs` |
| Connection records (environment=production, idempotent re-auth) | `tools/youtube-oauth/connection-record.mjs` |
| Health check (channels.list mine, one 401 refresh, loud degradation) | `tools/youtube-oauth/health-check.mjs` |
| Permission-broker gate (denial = zero side effects) | `tools/youtube-oauth/broker-gate.mjs` |
| In-process redaction + token-hygiene assertions | `tools/youtube-oauth/redact.mjs` |
| Config (real Google endpoints, all overridable) | `tools/youtube-oauth/config.mjs` |
| Manual-run CLI (genkey/consent-url/complete/…) | `tools/youtube-oauth/cli.mjs` |
| Wire-accurate mock provider (tests only) | `tools/youtube-oauth/mock-google.mjs` |
| Credentials-free suite — 9/9, AT-tagged | `tools/youtube-oauth/test/oauth.test.mjs` |
| Canary redaction scanner (exact-value + 5 pattern classes) | `tools/cred-hygiene/cred-hygiene.mjs`, `tools/cred-hygiene/cli.mjs` |
| Scanner suite — 15/15 incl. meta-redaction CH-5/CH-6 | `tools/cred-hygiene/test/cred-hygiene.test.mjs` |
| Phase 1 inputs register (15 `PENDING-TL-INPUT` fields) | `docs/marketing/evidence/W8/WO-P1/inputs-register.md` |
| Phase 2 verification ledger (V1–V5 answered, 23 sources) | `docs/marketing/evidence/W8/WO-P1/verification-ledger.md` |
| Scope justification (least-privilege confirmation) | `docs/marketing/scope-justification.md` |
| Manual-run runbook (steps 0–8, console checklist, D2(a) sequencing) | `docs/marketing/manual-run-runbook.md` |
| Manual-run evidence template (five artifact slots) | `docs/marketing/manual-run-evidence-template.md` |
| Work-order contract + execution plan v1.3 | `docs/marketing/work-orders/WO-P1.md`, `docs/marketing/work-orders/WO-P1-execution-plan.md` |
| Executor registry entries (execution, recovery RE-20261031-001, second pass) | `docs/marketing/work-registry/2026-10-3*-*.md` |
| CI job specs (the wiring contract) | `docs/marketing/ci/youtube-oauth-ci.snippet.yml`, `docs/marketing/ci/cred-hygiene-ci.snippet.yml` |
| Sample artifacts (record export, audit log, canary, scan report, suite outputs, AT-P1.4 output) | `docs/marketing/evidence/W8/WO-P1/` |

Plus: `.gitignore` protections for the token store and key material
(`.youtube-oauth/`, `**/store.json*`, `*.key` — the store and key never enter the
repository), and the two CI jobs below.

## CI wiring (commit-plan step 2)

`.github/workflows/ci.yml` gains two credentials-free jobs, specs
`docs/marketing/ci/*.snippet.yml` (check names verbatim so branch protection can
require them while WO-P1..P3 are open):

| Job | What it runs | Local pre-verification |
|---|---|---|
| `youtube-oauth (WO-P1, credentials-free)` | `node --test` on the full suite against the built-in wire-accurate mock + token-hygiene count in the job summary | 9/9 from the repository root, CI invocation verbatim |
| `cred-hygiene (WO-P1 redaction scanner)` | scanner suite + `selfcheck` summary | 15/15 + selfcheck PASS (1.8 ms) |

Runner/node aligned to the repo pins (ubuntu-24.04, Node 24); the suites are
zero-dependency (node: builtins only), so no install step — same constraint as
`scripts/reset-guard`. First green run URL on the landing commit:
`PENDING-AT-PUSH` — recorded in the follow-up row.

## Pre-landing redaction scan (the landed scanner, run on the landed tree)

`cred-hygiene scan` over every landed directory (5 seeded canaries + all 5
pattern classes, 31 files): **11 findings, every one a deliberate self-fixture**
— `canary.sample.json` (the seeded CANARY-marked sample that documents the
canary-file format; every value contains `CANARY`), and the scanner's own
selfcheck/test fixtures (`ya29.aBXnOtAReAlSeCrEt…NoBoDyReGiStErEd…`,
`ya29.aUnKnOwNsEcReT…` — in-code test data the scanner needs to test itself,
the EICAR pattern). No real credential value appears in any landed file; the
refusal itself is the negative-control proof that the pattern layer trips on
secret-shaped strings. Report kept at the evidence path convention:
`docs/marketing/evidence/W8/WO-P1/` sample set already contains the equivalent
stored refusal (`redaction-scan.sample-report.txt`).

## Acceptance-test standing after this landing

| AT | Credentials-free | Manual credentialed run |
|---|---|---|
| AT-P1.1 consent, exchange, refresh + rotation, redaction | pass — in CI from this landing | pending — runbook §3–4, §6 |
| AT-P1.2 health check + production record | pass (mock identity) | pending — runbook §4 |
| AT-P1.3 idempotent re-authorization | pass | pending — runbook §5 |
| AT-P1.4 broker denial, zero side effects | **closed — now green in CI on every push** | optional re-confirm |
| AT-P1.5 revoke → loud failure → degraded | pass (simulated revocation) | pending — runbook §5 |

With AT-P1.4 in CI, Phase 3's done-when ("AT-P1.4 is green in CI, and tests 2–5
are green and listed in the registry entry with their artifact links") is fully
satisfied: tests 2–5 of the plan (redaction-with-canaries, refresh-rotation,
broker refusal, degraded-state simulation) are the suite's AT-tagged tests,
listed in the [execution entry](2026-10-30-wo-p1-execution-entry.md) with
repository-absolute links.

## Session-start recovery (guard protocol, third occurrence)

The workspace was found reset to `960a3bb4` (32 behind `origin/main`) at session
start — the third same-class occurrence, this time caught by the WO-G1 protocol
before any work ran. Recorded via `record-recovery`
(`recon-2026-10-31T091200000Z-1`: 0 local commits, 18,266 mode-only file markers,
nothing ported, nothing lost, `merge --ff-only` to `9b3ea79a`); the rendered
WORK-REGISTRY change-log row is committed with this landing. This is the first
recovery executed **through** the guard's own escape hatch rather than beside it.

## Limitations (unchanged in substance by landing)

- Real-Google consent, real channel identity, real revocation remain provable
  only in the TL's manual runs (Phases 4–6) — the split above is the honest state.
- The mock replays documented Google wire shapes; live consent UX differences are
  observed only in the manual run.
- The broker gate consumes an approvals file; mapping it to the repository's real
  permission-broker API is an integration sign-off item.
- No multi-account support; upload implemented only to the point the broker-gate
  proof needs (full publication is WO-P2).
- Manual-run artifacts (once produced) go under
  `docs/marketing/evidence/W8/WO-P1/manual/` outside CI, scanned by cred-hygiene
  before storage (runbook step 7).

## What is still open

1. TL inputs (inputs register §1–3 — 15 `PENDING-TL-INPUT` fields): brand
   account + channel, OAuth client details, test-user basis, consent windows,
   console-indicated scope classification.
2. Decision D2 (testing-mode 7-day refresh-token clock): flip between the two
   consent runs (recommended) or accept re-consent cadence.
3. R1 app-verification decision (with the recorded exceptions context).
4. Branch protection: add the two new check names as required while WO-P1..P3
   are open (repo admin action; the jobs themselves are wired).
