# WO-P1 registry entry — second verification pass: V5/O2 closed, O1 resolved (2026-10-31)


> **Repository landing note (2026-10-31, W8-2).** Landed verbatim as the dated
> record from the executor's delivery package; its `PENDING-AT-PUSH` markers are
> resolved by the landing entry —
> [`2026-10-31-wo-p1-landing-entry.md`](2026-10-31-wo-p1-landing-entry.md).
| Field | Value |
|---|---|
| Work order | WO-P1 — production YouTube connection |
| Entry type | additive documentation round (no code change; no recovery event — nothing diverged) |
| Executor | Z.ai GLM agent — platform lane, Phase 2 executor session |
| Date | 2026-10-31 (second pass, after the reconciliation recorded in RE-20261031-001) |
| Base commit | unchanged — `PENDING-AT-PUSH` (WO-G1 still awaiting the TL's push; nothing here writes to any remote) |

## What this round did

The Phase 2 verification ledger carried two open items after the first pass: **O1**
(per-method scope tables for `videos.list` / `channels.list`) and **O2** (V5,
consent-screen requirements — the official support pages had moved). O2 was due
before the Phase 4 consent run, so this round found the pages' current homes and
closed it, and pushed O1 as far as current documentation allows.

Session-start discipline per the RE-20261031-001 lesson: existing packages and zips
inventoried first; all three suites re-run fresh before any edit —
**youtube-oauth 9/9, cred-hygiene 15/15, sandbox-guard 7/7.**

## Findings recorded (all quotes exact, all sources opened 2026-10-31)

- **V5/O2 closed.** Consent-screen field list (answer/13461325), 100-test-user
  ceiling (answer/15549945), scope classification — **no YouTube Data or Analytics
  scope is on the restricted list** (answer/13464325; only `dataportability.youtube.*`
  scopes, a different API family), sensitive split console-indicated (answer/13461325,
  answer/13463073), and both warning surfaces (answer/15549945, answer/7454865).
- **O1 resolved as far as documentation allows.** The per-method authorization tables
  no longer exist on the reference pages (both re-fetched; `channels.list` fetched for
  the first time). The official OAuth guide's scope table justifies `youtube.readonly`
  ("View your YouTube account") at scope level; definitive per-method proof is
  empirical at Phase 4/5, where the failure mode is safe (pre-save health check fails
  loudly, nothing stored). Non-blocking.
- **D2 sharpened for the TL.** The official pages are silent on whether a
  Testing→Production flip rescues a Testing-issued refresh token; safe reading
  (labeled as inference): it does not. Under option (a) the flip must land between
  consent run 1 and consent run 2 — run 2 issues the long-lived production token.
  Flipping ≠ verification: unverified apps with console-sensitive scopes keep the
  unverified-app screen and the 100-new-user cap (answer/13463817, answer/13464323) —
  immaterial for one authorizing user, material for R1.
- **R1 context added.** Official exception categories where verification is not
  mandatory (answer/13464323): Personal Use (<100 users), Development/Testing/Staging,
  Service-owned data (service account — N/A to P1's OAuth path), Internal Use
  (Workspace org — no unverified screen, no cap). Recorded for the TL's R1 decision;
  P1's path (External + testing mode) is unaffected either way.

## Files changed

| File | Change |
|---|---|
| `docs/marketing/evidence/W8/WO-P1/verification-ledger.md` | V5 rewritten open→answered (4 findings + R1 context); V1 finding 3 + O1 resolution; V3 finding 4 + D2 refinement; decisions table (O1 resolved, O2 closed, D2 sharpened); sources 12–23 |
| `docs/marketing/evidence/W8/WO-P1/inputs-register.md` | §2.2 D2 field carries the flip-between-runs requirement; new §2.3 console-indicated scope classification (15 `PENDING-TL-INPUT` fields total); closing paragraph reflects the complete ledger |
| `docs/marketing/manual-run-runbook.md` | Step 0.4 console pre-run checklist (basics, test user, scope-match rule, classification recording, optional branding fields); step 3 capture note for warning screens; step 5 D2(a) sequencing for the publishing-status flip |
| `docs/marketing/work-orders/WO-P1-execution-plan.md` | v1.2: state map Phase 2 row; Phase 4 step 2 capture note; Phase 6 step 3 D2(a) note; risk-table D2 row refinement |
| `docs/marketing/evidence/W8/WO-P1/broker-refusal.test-output.txt` | new — occupies the Phase 7 manifest slot for AT-P1.4 (CI artifact pointer; run URL `PENDING-AT-PUSH`) |

No code changed; no test changed; all suites pass unchanged after the round
(9/9 + 15/15 re-verified post-edit).

## Verification of this round

- All quotes in the ledger were extracted from the fetched pages on the check date;
  the two pages not reachable through the web-fetch tool were retrieved directly
  (curl) and read in full — the method note in the ledger header covers this.
- Nothing in this round touched credentials, stores, or any remote. Guard protocol
  unchanged (`PENDING-AT-PUSH` state preserved throughout).

## What is still open (unchanged owners)

1. WO-G1 push + `PENDING-AT-PUSH` closure entries (TL).
2. Inputs register §1–3 (TL/brand; now 15 fields including §2.3).
3. Decision D2 (TL) — now with the sharpened option (a) sequencing.
4. R1 app-verification decision (TL) — with the new exceptions context.
