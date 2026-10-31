# WO-P1 execution plan — Production YouTube connection

| Field | Value |
|---|---|
| Work order | [WO-P1](WO-P1.md) — gate P1 (real account) |
| Lane | platform |
| Plan version | 1.3 — 2026-10-31 (v1.2 records the same-day second verification pass; v1.3 records the repository landing: base bound, entry condition 0.1 satisfied, CI wiring live) |
| Planner | Z.ai GLM agent — platform lane, Phase 2 executor session |
| Base commit | `9b3ea79a` — WO-P1 bound to it 2026-10-31 (`reset-guard` bind; checkpoint written) |
| Status | Phases 1–3 executed and **landed on `main`** (W8-2, 2026-10-31 — see the landing entry `docs/marketing/work-registry/2026-10-31-wo-p1-landing-entry.md`); Phase 2 verification ledger complete — V1–V5 all answered (the same-day second pass closed V5/O2 and resolved O1 as far as current documentation allows); Phases 4–6 (manual runs) blocked on Phase 0 entry conditions 0.3–0.5 (TL/brand inputs). Recovery event RE-20261031-001 records the parallel-rebuild reconciliation |

This plan is the execution companion to the work order. The work order is the contract
(objective, scope, acceptance tests, evidence requirements); this document says in what
order the work happens, which parts run credentials-free versus as recorded manual runs,
what gets verified before a real credential ever exists, and what only the TL can provide.
Closure and evidence conventions follow Sections 4 and 8 of the
[phase-2 handoff](../PHASE2-HANDOFF.md); guard protocol terms follow
its Appendix A. Where this plan and an engineering reality discovered during execution
conflict, the conflict and its resolution go to the work registry — not a silent deviation.

## 0. Entry conditions (all must hold before Phase 1)

| # | Condition | Owner | State |
|---|---|---|---|
| 0.1 | WO-G1 guard suite landed on `main` and the `reset-guard` CI check is green and marked required | TL | ✅ satisfied 2026-10-30 — WO-G1 landed at `1ece86fb`; guard suite 20/20 inside the required unit gate; all four CI gates green (runs 41044065124, 41047832700) |
| 0.2 | Executor session armed: `preflight` passes, WO-P1 bound with base commit, checkpoint written | platform lane | ✅ satisfied 2026-10-31 — bound to `9b3ea79a` after the third same-class sandbox reset was caught at session start and reconciled (guard recovery event `recon-2026-10-31T091200000Z-1`) |
| 0.3 | Brand-owned Google account identified, with the target YouTube channel it owns | TL / brand | `PENDING-TL-INPUT` |
| 0.4 | Google Cloud project and OAuth client available for this connection (client type, redirect URIs recorded) | TL / brand | `PENDING-TL-INPUT` |
| 0.5 | Test-user basis for consent recorded (the brand account is a test user of the OAuth app while it is in testing mode) | TL | `PENDING-TL-INPUT` |

Hard rule from the handoff: **no credentialed work exists in a workspace that can silently
diverge.** If 0.1 is not satisfied, this plan stops before Phase 4 (the first phase that
touches credentials). Phases 1–3 are deliberately credentials-free so they may proceed in
parallel with the WO-G1 push, but nothing in them writes to the production connection store.

## 1. Phase map

| Phase | Content | Credentials | Closes |
|---|---|---|---|
| 1 | Inputs and account-path confirmation | none | — |
| 2 | Scope and policy verification (recorded) | none | — |
| 3 | Token-store hardening, broker refusal, degraded simulation | none — test-only | AT-P1.4 |
| 4 | Production consent, exchange, refresh (manual run) | real | AT-P1.1 |
| 5 | Health check and connection record | real | AT-P1.2, AT-P1.3 |
| 6 | Provider-side revocation and degraded state (manual run) | real | AT-P1.5 |
| 7 | Evidence packaging and registry closure | none | — |

Sequencing rationale, stated once: **everything testable is tested before a real token
exists.** By the time the first production credential is issued (Phase 4), the storage
protection, redaction, refresh rotation, broker refusal, and degraded-state handling
around it are already green in the credentials-free suite. The manual phases then only
demonstrate against production what the suite already proves in test.

### Execution-state map (reconciled 2026-10-31)

| Phase | Artifact | State |
|---|---|---|
| 1 — inputs register | `docs/marketing/evidence/W8/WO-P1/inputs-register.md` | staged; completes when the TL fills § 1–3 |
| 2 — verification ledger | `docs/marketing/evidence/W8/WO-P1/verification-ledger.md` (+ `docs/marketing/scope-justification.md`, the justification it evidences) | V1–V5 answered (second pass closed V5/O2; O1 resolved as far as docs allow — empirical at Phase 4/5); D2 awaits the TL, option (a) sharpened: flip between the two consent runs |
| 3 — credentials-free hardening | `tools/youtube-oauth/` (9/9, wire-accurate mock — built 2026-10-30) + `tools/cred-hygiene/` artifact scanner (15/15 — 2026-10-31) | complete, re-verified fresh; CI wiring landed 2026-10-31 (W8-2: `youtube-oauth` + `cred-hygiene` jobs in `.github/workflows/ci.yml`; run URL recorded in the landing entry) |
| 4 — consent manual run | `docs/marketing/manual-run-runbook.md` steps 3–4, 6 | blocked on entry conditions |
| 5 — health check + record | runbook step 4; record shape proven in `docs/marketing/evidence/W8/WO-P1/connection-record-export.sample.json` | blocked on entry conditions |
| 6 — revocation + re-auth | runbook step 5 (revoke at provider, re-consent closes AT-P1.3) | blocked on entry conditions |
| 7 — evidence + closure | `docs/marketing/manual-run-evidence-template.md`; execution entry exists, closure entry after the manual run | template ready |

Phase 3's implementation predates this plan (2026-10-30) — the plan was written in
ignorance of it and both were reconciled on 2026-10-31; the map above is the reconciled
truth, and [`docs/marketing/work-registry/2026-10-31-recovery-event-parallel-rebuild.md`](../work-registry/2026-10-31-recovery-event-parallel-rebuild.md) (in the WO-P1 package) is the record.

## 2. Phase 1 — Inputs and account-path confirmation

Goal: remove every input uncertainty that would otherwise interrupt the manual run.

1. Record the inputs register: brand account identity (email redacted to its domain in
   stored artifacts), channel identity expected, OAuth client ID (not secret — record
   freely), client type, redirect URI, and the TL-provided test-user basis (entry 0.5).
2. Confirm with the TL which account completes consent and when the owner is available;
   the consent manual run (Phase 4) needs a human on the brand side for a few minutes.
3. Confirm where the manual run happens: executor sandbox with network access to
   Google endpoints, artifacts later committed under `docs/marketing/evidence/W8/WO-P1/`.
4. Guard protocol: `bind` WO-P1 to the base commit before any repository write; the
   inputs register is the first artifact.

**Done when** the inputs register exists at `docs/marketing/evidence/W8/WO-P1/inputs-register.md` with
no `PENDING-TL-INPUT` markers left.

## 3. Phase 2 — Scope and policy verification

Goal: satisfy the work order's implementation note — *verify current consent, scope, and
quota policies at implementation time rather than relying on recorded numbers* — with a
recorded verification ledger, not memory.

Verification ledger (one row per question; fields: question, source URL, date checked,
finding, decision). Minimum rows:

| # | Question to verify | Feeds |
|---|---|---|
| V1 | Is `youtube.upload` + `youtube.readonly` the least-privilege set for WO-P2's upload and read-back verification path, or does any step of the existing W5 machinery request a broader scope (`youtube.force-ssl`) that should be narrowed first? | scope set |
| V2 | Does `yt-analytics.readonly` cover the metric families WO-P3 intends to collect for owned videos? | scope set |
| V3 | While the OAuth app is in testing mode: what are the current test-user limits, and do refresh tokens issued in testing mode expire on a short clock? (Historically documented as a 7-day expiry — treat as unverified until checked.) | consent cadence, R1 |
| V4 | What does the current quota policy say about the upload path WO-P2 will use? (Recorded for WO-P2's planning; P1 itself performs no uploads.) | R2 |
| V5 | What consent-screen information must be present for the brand's account to consent lawfully and knowingly (app name, privacy policy, scopes shown)? | consent record |

Findings are recorded with the URLs and dates actually consulted. If V3 confirms a short
refresh-token clock in testing mode, the decision row records the chosen mitigation —
accept a re-consent cadence, or move the app to production status — and flags it to the
TL, because it affects WO-P2/WO-P3 continuity.

**Done when** the ledger has all rows answered with sources and the TL has seen any
decision that constrains later waves.

## 4. Phase 3 — Credentials-free hardening (test-only)

Goal: make the protection around the future production token provable in CI, before the
token exists. Builds on the existing W5/W7 token-hygiene pattern — audit first, then
extend.

1. **Token-store audit.** Audit the existing W5 token store against the WO-P1
   requirements: protection at rest, full redaction in logs, refresh handling with
   rotation. Record gaps; implement deltas; no rewrite of the store engine.
2. **Redaction test with canary values.** Extend the token-hygiene test: inject canary
   token values (access-token-shaped, refresh-token-shaped, client-secret-shaped) through
   the real storage and logging paths, then scan every artifact and log surface the run
   produces for those exact values. Exact-value scanning, not pattern-matching alone.
3. **Refresh-rotation test.** When the provider returns a new refresh token, the store
   replaces the old one; the old value is gone from storage and absent from logs. If the
   provider does not rotate, the test asserts the store reuses correctly and never
   duplicates.
4. **Broker refusal test (AT-P1.4).** A write-scope operation without permission-broker
   approval is refused; the refusal path performs no store mutation, no API call, and no
   state change — the test asserts all three, not just the refusal message.
5. **Degraded-state simulation test.** Simulated provider rejection (revocation /
   expiry class errors) marks the connection degraded and fails loudly on next use; no
   silent retry storm, no zero-filled health data.
6. All of the above joins the credentials-free suite; the plugin and guard suites stay
   green; per-run test counts printed in the job summary (handoff Section 9.3).

**Done when** AT-P1.4 is green in CI, and tests 2–5 are green and listed in the
registry entry with their artifact links.

## 5. Phase 4 — Production consent (manual run, recorded)

Goal: a real account completes real consent; the first production credential exists —
briefly observed, fully redacted.

Protocol:

1. Pre-run: guard `assert` (base binding intact), workspace labeled `environment=production`,
   screen recording or screenshot capture started **before** the consent screen opens.
2. The brand account owner completes the production OAuth consent flow with the scope set
   from the Phase 2 ledger. The consent screen itself is captured (screenshots at minimum;
   recording preferred) — this is the consent-flow record the evidence list requires.
   Any test-user warning or unverified-app screen shown before the consent screen is part
   of the record (ledger V5 finding 4): the capture shows what the consenting user
   actually saw.
3. Code exchange executes against the production token endpoint; token refresh executes
   immediately after, proving both halves of AT-P1.1 while the run is being recorded.
4. Post-run, before anything is stored: run the redaction scan from Phase 3 over every
   captured artifact and the run log. The scan output (canaries and real-value classes
   found = 0) is itself an artifact.
5. Token lands only in the protected store. The run log stores shapes and lengths, never
   values.

**Done when** AT-P1.1 has: consent capture, redacted run log, and the redaction-scan
output — all under `docs/marketing/evidence/W8/WO-P1/`.

## 6. Phase 5 — Health check and connection record

Goal: the connection becomes a verified production record of a real channel.

1. Pre-save account health check against the production endpoint; the response returns
   real channel identity (channel ID, title, connection metadata). Response excerpt is
   stored redacted.
2. Connection record persisted with `environment=production` and the verified channel
   ID (AT-P1.2). The record export is an artifact.
3. **Re-authorization idempotency (AT-P1.3).** A second consent run for the same channel
   updates the existing record; connection count for that channel stays at one. This
   second consent run is deliberately deferred to **Phase 6 step 3**, where re-consent is
   needed anyway — one consent event demonstrates both the idempotency and the recovery
   from degraded state.

**Done when** AT-P1.2 is green on the recorded evidence and the record export shows
`environment=production` with the verified channel ID.

## 7. Phase 6 — Provider-side revocation and degraded state (manual run, recorded)

Goal: AT-P1.5 demonstrated the honest way — by actually losing access — with the
connection restored afterward for WO-P2.

1. With the TL informed, the brand account owner revokes the app's access at the
   provider (Google account permissions page).
2. Next health check is run: it must **fail loudly** and the connection record must be
   marked degraded. The failure output and the degraded record are the AT-P1.5 artifacts.
   This failure is a required negative result — recorded, not avoided.
3. Re-authorize the same channel (consent run 2 of 2): the record updates — connection
   count does not increase (completing AT-P1.3) — and the connection returns to a healthy
   state ready for WO-P2. The degraded episode remains in the record's history and in the
   registry entry. **If D2 option (a) is adopted**, the publishing-status flip happens
   between run 1 and this run (runbook step 5): the official pages do not say the flip
   rescues a Testing-issued refresh token (ledger D2 refinement), so this re-consent is
   what issues the long-lived production token WO-P2/WO-P3 will use.

**Done when** AT-P1.5 and AT-P1.3 are both green on recorded evidence, and the
connection's final state is healthy with its degraded episode preserved.

## 8. Phase 7 — Evidence packaging and registry closure

Artifact manifest (all under `docs/marketing/evidence/W8/WO-P1/`, names fixed now so the registry entry
can be written against them):

| File | Content | Backs |
|---|---|---|
| `inputs-register.md` | Phase 1 inputs, test-user basis | entry 0.5 |
| `verification-ledger.md` | Phase 2 scope/policy findings with sources and dates | implementation note |
| `consent-run-1/` | consent capture (screenshots/recording), redacted exchange+refresh log, redaction-scan output | AT-P1.1 |
| `health-check-response.redacted.txt` | production channel identity excerpt | AT-P1.2 |
| `connection-record.export.json` | `environment=production`, verified channel ID, record history | AT-P1.2, AT-P1.3 |
| `broker-refusal.test-output.txt` | CI artifact pointer for the credentials-free refusal test | AT-P1.4 |
| `revocation-run/` | loud-failure output, degraded record export, re-auth run 2 evidence | AT-P1.5, AT-P1.3 |
| `acceptance-run.log` | the full manual-run log, redacted | all |

Registry entry per Section 4 of the handoff: work-order ID, executor identity, base
commit, AT results keyed by identifier, artifact links (repository-absolute), CI run
covering the credentials-free additions, limitations, and the manual-run storage
location. Explicitly stated limitations will include: consent obtained under testing-mode
test-user basis (not app verification), the V3 finding and its mitigation, and anything
the provider did not return that the work order expected.

Then the four TL sign-offs (contract, integration, evidence, acceptance) flip in
`docs/marketing/work-orders/WO-P1.md`, and the closure row lands in
`docs/marketing/WORK-REGISTRY.md`. Gate P1 closes on that record.

## 9. Acceptance-test matrix

| Test | Demonstrated by | Run type | Closes in |
|---|---|---|---|
| AT-P1.1 — consent, exchange, refresh; no plaintext credential anywhere | consent capture + redacted logs + redaction scan (canary exact-value test green) | manual run + credentials-free test | Phase 4 |
| AT-P1.2 — health check returns real production channel metadata; record has `environment=production` + verified channel ID | health-check response excerpt + record export | manual run | Phase 5 |
| AT-P1.3 — re-auth of same channel updates record; count does not increase | consent run 2 + connection-record history | manual run | Phase 6 |
| AT-P1.4 — write-scope without broker approval refused; no side effects | refusal test asserting no store mutation, no API call, no state change | credentials-free CI | Phase 3 |
| AT-P1.5 — revocation at provider → loud failure + degraded marking | real provider-side revocation, then re-auth restore | manual run + credentials-free simulation | Phase 6 |

## 10. Risks and mitigations (WO-P1 slice of the risk register)

| ID | Risk | Mitigation in this plan |
|---|---|---|
| R1 | OAuth verification delays restrict consent beyond the brand's own test users | Close P1 under testing-mode consent with the brand account as test user (accepted by the work order); app verification starts in parallel only if the TL expects wider rollout — TL decision recorded in Phase 2 ledger |
| R9 | Credentialed manual runs leak secrets into stored artifacts | Canary redaction scan over every artifact before storage; scan output is an artifact; CI never receives secrets |
| — | Testing-mode refresh tokens expire on a short clock (**verified current 2026-10-31**: 7 days while publishing status is Testing — see `docs/marketing/evidence/W8/WO-P1/verification-ledger.md` V3) | Ledger decision D2: flip to In production after P1 consent (recommended) or accept re-consent cadence; TL decides because WO-P2/WO-P3 continuity depends on it. Second-pass refinement: the flip itself is not documented to rescue a Testing-issued token — the post-flip re-consent (Phase 6 run 2) issues the production token; the flip must land between the two consent runs |
| — | Consent manual run stalls waiting for the brand account owner | Phase 1 schedules the human before Phase 4 starts; Phases 1–3 proceed meanwhile |
| — | Reused W5 machinery requests broader scopes than the work order allows | V1 scope audit precedes consent; narrow before the consent screen is ever shown |

## 11. Effort and calendar

| Phase | Executor effort | Wall-clock dependency |
|---|---|---|
| 1 | 0.5 day | TL/brand inputs |
| 2 | 0.5 day | none |
| 3 | 1–2 days | none |
| 4 | 0.5 day | brand owner available |
| 5 | 0.5 day | after 4 |
| 6 | 0.5 day | brand owner available (revoke + re-consent) |
| 7 | 0.5 day | after 3–6 |

Total ≈ 4–5 executor-days. Fits the remainder of W8 **only if** Phase 0 entry
conditions clear promptly; otherwise P1 closure slips and, with it, the W8 exit
criterion — the tracker already says so, and this plan does not paper over it.

## 12. What this plan cannot promise (stated now, not discovered later)

- The two `PENDING-TL-INPUT` groups (account/channel/client inputs; test-user basis) and
  the `PENDING-AT-PUSH` WO-G1 entry condition are outside the executor's control; the
  plan's calendar assumes they clear within W8.
- Google policy findings (V1–V5) are unverified until Phase 2 runs; this plan quotes no
  recorded numbers for them, per the work order's own instruction.
- Token counts, quotas, and consent-screen policy statements appearing in any artifact
  must come from the ledger or the run output, never from this plan's text.
