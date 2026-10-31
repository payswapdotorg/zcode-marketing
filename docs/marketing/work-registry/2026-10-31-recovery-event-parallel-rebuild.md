# Recovery event — RE-20261031-001: parallel rebuild after conversation-state loss (WO-P1)


> **Repository landing note (2026-10-31, W8-2).** Landed verbatim as the dated
> record from the executor's delivery package; its `PENDING-AT-PUSH` markers are
> resolved by the landing entry —
> [`2026-10-31-wo-p1-landing-entry.md`](2026-10-31-wo-p1-landing-entry.md).
Recorded per handoff Section 8.6 ("whenever divergence is detected — including false
alarms — a recovery event is recorded per Appendix A"). **This event is a
conversation-state divergence, not a git divergence.** The repository tree was never
reset; what was lost was a segment of the executing session's context. The git-level
WO-G1 guard could not have detected it — the recovery-event *discipline* is what
applies, and this entry is that record. Fields follow Appendix A with the git-specific
fields (`localHead`, `remoteHead`) explicitly marked not-applicable rather than
fabricated; the sandbox-guard CLI's `record-recovery` was deliberately not used because
its schema expects real SHAs and this event has none.

- **Event ID:** RE-20261031-001
- **Work order:** WO-P1 (production YouTube connection)
- **Detection time:** 2026-10-31 ~21:05Z, during Phase 3 tooling work
- **Detected by:** working-tree inspection of `tools/youtube-oauth/` triggered by a
  stale `zcode-marketing-phase2-wo-p1-package.zip` (timestamped 2026-10-30 16:50Z)
  whose contents the current session's handoff summary did not describe
- **Executor identity:** Z.ai GLM agent — platform lane, Phase 2 executor session
  (successor session after a context overflow; the prior session's summary lost the
  segment recorded below)

## Divergence summary

A prior session segment on 2026-10-30 (16:25–16:50Z) delivered a **complete WO-P1
credentials-free implementation**: `tools/youtube-oauth/` (nine modules plus a
wire-accurate mock provider and a 9-test suite tagged AT-P1.1–P1.5), the manual-run
runbook and evidence template, scope justification, a work-registry execution entry, a
CI snippet, and sample evidence artifacts — packaged as
`zcode-marketing-phase2-wo-p1-package.zip`.

The successor session (this one) did not know that package existed. In ignorance it
produced overlapping work: an execution plan describing Phase 3 as "the next executor
work item," a scope/policy verification ledger, an inputs register, a new
`tools/cred-hygiene/` artifact scanner, and — one actual casualty — **overwrote the
package README.md** with a Phase 1–2-only version (the original was recovered intact
from the package zip; no other file was touched, and no code was lost).

This is the same failure class as the 2026-10-30 sandbox incident — undetected
parallel rebuild — with the divergence in conversation state rather than repository
state. It was caught before any conflicting package was delivered to the TL.

## Decision

The completed, verified state wins (the Appendix A policy, applied to session state):
the 2026-10-30 implementation stands as the WO-P1 core; today's additive work is
ported onto it; redundant framing is discarded and corrected. Every suite involved was
re-run fresh after reconciliation: **youtube-oauth 9/9, cred-hygiene 15/15, sandbox-guard 7/7.**

## Ported items (additive, kept)

| Item | From | Why it is additive, not redundant |
|---|---|---|
| `docs/marketing/evidence/W8/WO-P1/verification-ledger.md` | this session | Policy verification with sources and dates (V1–V5): the verified 7-day testing-mode refresh-token clock (decision D2, TL), the twice-changed quota model (D3), scope confirmations from per-method reference pages, open items O1–O3. Complements — does not replace — `docs/marketing/scope-justification.md`, which states the justification; the ledger supplies the evidence |
| `docs/marketing/evidence/W8/WO-P1/inputs-register.md` | this session | Structured TL-input tracking (14 `PENDING-TL-INPUT` fields) complementing the runbook, which is the procedure |
| `tools/cred-hygiene/` + `docs/marketing/ci/cred-hygiene-ci.snippet.yml` + scanner evidence | this session | Artifact-level redaction scanning the runbook previously did with a manual `grep` of real secrets on the command line (a shell-history hazard the runbook itself warned about): adds pattern-class depth (ya29., 1//, GOCSPX-, AIza, JWT), directory walking, a storable report, a proven meta-redaction guarantee (CH-5/CH-6), and exit-code gating. Complementary to `tools/youtube-oauth/redact.mjs`, which redacts in-process surfaces |
| Runbook step 7 upgrade | this session | The manual grep replaced by the cred-hygiene scan as the recommended pre-storage check (grep kept as fallback) |
| `docs/marketing/work-orders/WO-P1-execution-plan.md` | this session | The phasing document the TL already received; its phase map now points at the existing artifacts instead of proposing to build them |

## Discarded-work inventory

- The "Phase 3 is the next executor work item" framing in the execution plan, the W8
  weekly report, and the wave board — **discarded as factually wrong**; replaced with
  the true state (implementation complete credentials-free, manual run pending).
- The overwritten Phase 1–2 package README — **discarded**; replaced by a merged README
  covering implementation + Phase 1–2 additions + this reconciliation.
- No code was discarded: cred-hygiene and youtube-oauth turned out to be complementary
  layers (artifact-level vs in-process), not duplicates.

## Repairs made during reconciliation (found because of this event)

- **`node --test` directory-form defect:** the documented reproduce command
  `node --test … tools/<tool>/test/` fails in Node 24 (directories are not expanded;
  the glob form works). Fixed in: both packages' READMEs, the sandbox-guard README,
  both CI snippets, both test-file headers, the W8 weekly report, and both evidence
  headers — all evidence regenerated from real runs with corrected headers
  (WO-G1 7/7, youtube-oauth 9/9, cred-hygiene 15/15 fresh in this environment).

## Post-state

- `zcode-marketing-phase2-wo-p1/` is one reconciled package: implementation
  (youtube-oauth), tooling (cred-hygiene), Phase 1–2 evidence (ledger, register),
  manual-run docs (runbook, template, scope justification), registry entries
  (execution entry + this recovery event), two CI snippets, and a merged README.
- Status claims in `docs/marketing/work-orders/WO-P1-execution-plan.md`, the W8 weekly report,
  and `docs/WAVES.md` updated to the reconciled truth.
- Nothing was pushed to any remote at any point in this event; the repository's
  `main` is untouched (WO-G1 `PENDING-AT-PUSH` still applies).

## Lesson recorded

Session handoff summaries are a failure surface the git guard cannot see. The
mitigation adopted here: **before starting any work order phase, inventory the
existing package directories and zips** — the stale zip's timestamp is what exposed
this. That check is now part of this executor's session-start routine, alongside the
WO-G1 preflight.
