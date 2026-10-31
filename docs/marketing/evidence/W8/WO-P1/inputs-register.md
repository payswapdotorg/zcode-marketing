# WO-P1 Phase 1 — inputs and account-path confirmation register

| Field | Value |
|---|---|
| Work order | WO-P1 — production YouTube connection (Phase 1 of the [execution plan](../../../work-orders/WO-P1-execution-plan.md)) |
| Staged on | 2026-10-31 |
| Executor | Z.ai GLM agent — platform lane, Phase 2 executor session |
| Status | register staged; **completes when every `PENDING-TL-INPUT` field below is filled** (plan Phase 1 done-when) |

This register removes input uncertainty before the manual consent runs. Everything the
executor could record without the TL has been recorded; the TL-provided fields are
explicit and nothing is invented in their place.

## 1. Connection inputs (TL / brand)

| # | Field | Value | Source / note |
|---|---|---|---|
| 1.1 | Brand account that completes consent (Google account identity) | `PENDING-TL-INPUT` | Storage rule: the account email is redacted to its domain in all stored artifacts; full identity lives only in the run environment |
| 1.2 | Target channel the account owns (expected title; channel ID confirmed by the Phase 5 health check — never assumed) | `PENDING-TL-INPUT` | The health check's returned channel ID is the verified identity that lands in the connection record |
| 1.3 | Google Cloud project ID hosting the OAuth client | `PENDING-TL-INPUT` | Project ID is not a secret |
| 1.4 | OAuth client ID and client type (web / desktop) | `PENDING-TL-INPUT` | Client ID is not a secret and is recorded in full once provided; the client secret never enters any artifact |
| 1.5 | Authorized redirect URI(s) for the consent flow | `PENDING-TL-INPUT` | Must match the executor sandbox's callback endpoint exactly |
| 1.6 | API enablement state: YouTube Data API v3 and YouTube Analytics API enabled on the project | `PENDING-TL-INPUT` | Both APIs must be enabled before the Phase 4 run; Analytics enablement is checked now so WO-P3 is not blocked later |

## 2. Consent basis and publishing status

| # | Field | Value | Source / note |
|---|---|---|---|
| 2.1 | Test-user basis: the brand account is registered as a test user of the OAuth app while it is in testing mode (handoff entry 0.5) | `PENDING-TL-INPUT` | Recorded as the consent basis in the registry entry |
| 2.2 | **Decision D2 from the verification ledger:** after P1's consent evidence is captured, flip the app's publishing status to "In production" (recommended — removes the verified 7-day testing-mode refresh-token expiry) or stay in Testing with a scheduled re-consent cadence | `PENDING-TL-INPUT` — TL decision | Evidence and options: `verification-ledger.md` § V3, decision D2 + D2 refinement (second pass). Under option (a) the flip must land **between consent run 1 and consent run 2** — the official pages do not say the flip rescues a Testing-issued token, so run 2 is what issues the long-lived production token (runbook step 5). Blocks the WO-P3 planning assumption, not P1 itself |
| 2.3 | Console-indicated classification (non-sensitive / sensitive / restricted) of each requested scope, as shown when the three scopes are added to the consent-screen configuration | `PENDING-TL-INPUT` — recorded at console configuration | Official restricted-scope list contains no YouTube Data or YouTube Analytics scope (ledger V5 finding 3); the sensitive/non-sensitive split is shown per scope in the console. Decides the production-mode surface under D2 option (a) — unverified apps with sensitive/restricted scopes face the unverified-app screen and the 100-new-user cap |

## 3. Manual-run logistics

| # | Field | Value | Source / note |
|---|---|---|---|
| 3.1 | Run environment | executor sandbox with network access to Google OAuth and YouTube endpoints; artifacts land under `docs/marketing/evidence/W8/WO-P1/` | executor-confirmed at staging |
| 3.2 | Capture tooling for the consent-flow record | screen recording preferred, screenshots minimum; capture starts **before** the consent screen opens (plan Phase 4 step 1) | executor-confirmed at staging |
| 3.3 | Consent window 1 (initial consent + exchange + refresh + health check) | `PENDING-TL-INPUT` — date/time with the account owner available | A few minutes of the owner's time |
| 3.4 | Consent window 2 (provider-side revocation + re-authorization, AT-P1.5 + AT-P1.3) | `PENDING-TL-INPUT` — date/time, after window 1 | Same owner; revocation happens at the Google account permissions page during this window |

## 4. Guard protocol state (Phase 0.2)

| # | Field | Value |
|---|---|---|
| 4.1 | Session preflight | passed 2026-10-31 against base `9b3ea79a` after the third same-class sandbox reset was caught at session start and reconciled per protocol (guard recovery event `recon-2026-10-31T091200000Z-1`; nothing rebuilt — 0 local commits, mode-only noise discarded) |
| 4.2 | Work-order binding | WO-P1 bound to the base commit before any repository write; `assert` before each write session; `prepush` before push |
| 4.3 | Checkpoint | written at session start and end |

## 5. Entry-conditions cross-reference

| Plan entry | Condition | State |
|---|---|---|
| 0.1 | WO-G1 landed + `reset-guard` required check green | ✅ satisfied — landed `1ece86fb` 2026-10-30; guard suite 20/20 in the required unit gate; CI green (runs 41044065124, 41047832700) |
| 0.2 | Executor session armed (this register, § 4) | in place at session start |
| 0.3 | Brand account + target channel (§ 1.1–1.2) | `PENDING-TL-INPUT` |
| 0.4 | OAuth client details (§ 1.3–1.6) | `PENDING-TL-INPUT` |
| 0.5 | Test-user basis recorded (§ 2.1) | `PENDING-TL-INPUT` |

Phases 1–2 of the plan are now executed to the extent possible without the TL: this
register is staged, and the [verification ledger](verification-ledger.md) is **complete
— V1–V5 all answered** (V5 and open item O2 closed on the 2026-10-31 second pass; O1
resolved as far as documentation allows with empirical confirmation due at Phase 4/5,
non-blocking; O3 parked). Phase 3 (credentials-free hardening) is **complete**:
`tools/youtube-oauth/` (built 2026-10-30, re-verified 2026-10-31 — 9/9) plus the
`tools/cred-hygiene/` artifact scanner (15/15); its CI wiring landed 2026-10-31 (W8-2 —
the `youtube-oauth` and `cred-hygiene` jobs in `.github/workflows/ci.yml`). Only the
manual runs (Phases 4–6, per `docs/marketing/manual-run-runbook.md`) remain, and
they start when the entry conditions above clear.
