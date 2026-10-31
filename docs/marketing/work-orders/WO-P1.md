---
id: WO-P1
title: "Production YouTube connection"
wave: "W8"
lane: platform
gate: P1
depends_on: [WO-G1]
status: open
acceptance_tests: [AT-P1.1, AT-P1.2, AT-P1.3, AT-P1.4, AT-P1.5]
tl_signoffs:
  contract: pending
  integration: pending
  evidence: pending
  acceptance: pending
---

# WO-P1 — Production YouTube connection

> Wave W8 · platform lane · gate: P1 · depends on: WO-G1

**Objective.** Establish a real, user-authorized connection to a brand's YouTube channel through production Google OAuth — stored securely, health-checked, and labeled as production.

**Why now.** Every production gate downstream (P2, P3, P4) depends on this connection. The W5 machinery exists and its wire shapes are real; what is missing is a production consent and a real channel behind it.

**Dependencies.** WO-G1 (guards active before any credentialed work begins).

**Scope.**

1. Complete the production OAuth consent flow with a real Google account that owns the target channel, using a minimal scope set — `youtube.upload`, `youtube.readonly`, `yt-analytics.readonly` — confirmed at implementation time as the least-privilege set satisfying WO-P2 and WO-P3.
2. Secure token storage: protection at rest, full redaction in logs, and refresh handling with rotation covered by tests.
3. Pre-save account health check against the production endpoint, returning real channel identity (channel ID, title, connection metadata).
4. Connection record persisted with `environment=production` and the verified channel identity; re-authorization is idempotent — the same channel updates the record rather than duplicating it.
5. Permission-broker approval required before any write-scope use; denial exits without side effects.
6. Degraded-state handling: revoked or expired authorization marks the connection degraded and fails loudly on next use.

**Implementation notes.** Google OAuth apps in testing mode are limited to a small set of test users; that is acceptable for closing P1 with the brand's own account. Formal app verification should start in parallel if broader rollout is expected. Verify current consent and quota policies at implementation time rather than relying on recorded numbers.

**Out of scope.** Publishing anything (WO-P2), analytics collection (WO-P3), multi-account support.

**Acceptance tests.**

- [ ] AT-P1.1 — A real account completes consent; code exchange and token refresh succeed; no plaintext credential appears in any log or artifact, verified by the redaction test.
- [ ] AT-P1.2 — The health check returns real production channel metadata and the connection is stored with `environment=production` and the verified channel ID.
- [ ] AT-P1.3 — Re-authorizing the same channel updates the existing connection; the connection count does not increase.
- [ ] AT-P1.4 — A write-scope operation without permission-broker approval is refused, and the denial path leaves no side effects.
- [ ] AT-P1.5 — Revoking access at the provider causes the next health check to fail loudly and the connection to be marked degraded.

**Evidence requirements.** Consent-flow record (screenshots or recording), redacted token-store audit log, health-check response excerpt, connection-record export, and the acceptance-run log — stored as a recorded manual run, no secrets in CI.

**Registry and CI.** The registry entry links all artifacts and states the test-user basis for consent. Token-hygiene tests remain in the credentials-free suite.

---

Closure requirements: Section 4 of the [phase-2 handoff](../PHASE2-HANDOFF.md). Evidence and registry conventions: Section 8 of the same document. Update `status` and `tl_signoffs` in the front matter as the order progresses.

Execution plan: [WO-P1-execution-plan.md](WO-P1-execution-plan.md) — phased sequence, run-type split (credentials-free vs. recorded manual runs), entry conditions, and the acceptance-test closure map.
