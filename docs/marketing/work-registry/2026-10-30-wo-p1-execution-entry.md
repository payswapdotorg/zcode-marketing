# Work-order execution entry — WO-P1 (status: implementation complete, manual credentialed run pending)

> **Repository landing note (2026-10-31, W8-2).** This entry was written in the
> executor's delivery package while WO-P1 had no repository base; it is landed
> verbatim as the dated record. Its `PENDING-AT-PUSH` markers are resolved by the
> landing entry —
> [`docs/marketing/work-registry/2026-10-31-wo-p1-landing-entry.md`](2026-10-31-wo-p1-landing-entry.md)
> (base bound `9b3ea79a`; WO-G1 landed `1ece86fb`; CI wiring live).

This is an **execution entry**, not a closure entry. Per handoff Section 8.7
the split between credentials-free verification and the credentialed manual
run is stated plainly: the code paths are fully tested credentials-free; the
real-Google-account consent (the part that inherently needs credentials) is
the TL's recorded manual run per `docs/marketing/manual-run-runbook.md`. WO-P1 closes
only when the manual-run artifacts exist and every AT below carries both its
credentials-free result and its manual-run result where applicable.

- **Work-order ID:** WO-P1
- **Title:** Production YouTube connection
- **Executor identity:** Z.ai GLM agent — platform lane, Phase 2 executor session
- **Base commit:** `f2400d4` (reviewed baseline); implementation lands as its own commit — `PENDING-AT-PUSH`
- **Dependencies honored:** WO-G1 guard suite delivered (commit `PENDING-AT-PUSH`); per W8 sequencing no credentialed work runs until the reset guard is a required CI check.

## Acceptance-test status

| AT | Credentials-free result (wire-accurate mock) | Manual credentialed run |
|---|---|---|
| AT-P1.1 consent, exchange, refresh + rotation, redaction | **pass** — `docs/marketing/evidence/W8/WO-P1/credentials-free-suite-output.txt` | pending — runbook steps 3, 4, 6 |
| AT-P1.2 health check + production record | **pass** (mock channel identity; record carries environment=production) | pending — real channel via runbook step 4 |
| AT-P1.3 idempotent re-authorization | **pass** | pending — repeat consent, runbook step 5 |
| AT-P1.4 broker denial, zero side effects | **pass** — closed credentials-free (0 API calls, store byte-identical, positive control) | optional re-confirm, runbook step 5 |
| AT-P1.5 revocation → loud failure → degraded | **pass** (provider-side revocation simulated on the mock) | pending — real revoke at Google, runbook step 5 |

## Artifacts (repository-absolute paths)

- `docs/marketing/evidence/W8/WO-P1/credentials-free-suite-output.txt` — 9/9 tests, AT-tagged
- `docs/marketing/evidence/W8/WO-P1/connection-record-export.sample.json` — artifact shape, mock-generated, labeled environment=mock
- `docs/marketing/evidence/W8/WO-P1/token-store-audit-log.sample.json` — audit-log shape, mock-generated
- `tools/youtube-oauth/` — implementation: oauth-client, token-store, connection-record, health-check, broker-gate, redact, config, cli, mock-google + test suite
- `docs/marketing/manual-run-runbook.md`, `docs/marketing/manual-run-evidence-template.md`, `docs/marketing/scope-justification.md`

## Token-hygiene evidence

- Token-hygiene test in the credentials-free suite scans five output surfaces
  (module logs, encrypted store file, audit log, consent record, connection
  export) for five secret values — zero hits.
- Store encrypted AES-256-GCM; operation without a key refused; wrong key
  rejected loudly (all tested).
- Evidence generator scans every produced artifact for mock credential markers
  before writing — zero hits.

## CI run

Landed 2026-10-31 (W8-2): the credentials-free suite runs in CI as the dedicated
`youtube-oauth` job in `.github/workflows/ci.yml` (spec:
`docs/marketing/ci/youtube-oauth-ci.snippet.yml`; token-hygiene stays in
credentials-free CI per the work order). The first green run URL on the landing
commit is recorded in the
[landing entry](2026-10-31-wo-p1-landing-entry.md).

## Limitations and negative results

- The mock replays documented Google wire shapes; behavior differences in
  Google's live consent UX (screen text, testing-mode user caps, quota errors)
  are observed only in the manual run — the runbook's negative-results section
  captures them.
- The permission-broker gate reads an approvals file (`broker-approvals.json`
  shape); mapping it to the repository's real permission-broker API is an
  integration sign-off item, not a code change.
- No multi-account support (out of scope by the work order).
- Upload (`videos.insert`) is implemented only to the point WO-P1 needs for the
  broker-gate proof; full publication mechanics belong to WO-P2.

## TL review sign-offs (per WO-G2)

contract — pending · integration — pending · evidence — pending · acceptance — pending
