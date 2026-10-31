# WO-P1 manual-run evidence template

Fill during the manual run (runbook step 7). Store artifacts under
`docs/marketing/evidence/W8/WO-P1/manual/`. Every artifact must pass the secret scan before
storage; the registry entry links each file by repository-absolute path.

- **Run date / operator:**
- **Google account basis:** testing-mode consent with the brand's own account
  (test user). Verification status of the OAuth app:
- **Scopes granted at consent:** youtube.upload, youtube.readonly, yt-analytics.readonly

## Artifact 1 — Consent-flow record

- File: `docs/marketing/evidence/W8/WO-P1/manual/consent-recording.*` (screenshots or recording)
- Shows: the consent screen naming the app and the three scopes; the completed
  redirect.
- Timestamp matches the acceptance-run log.

## Artifact 2 — Redacted token-store audit log

- File: `docs/marketing/evidence/W8/WO-P1/manual/token-store-audit-log.json`
- Source: `export` → `auditLog` section (actions, channel IDs, timestamps only).
- Shape reference (mock-generated, environment=mock):
  `docs/marketing/evidence/W8/WO-P1/token-store-audit-log.sample.json`

## Artifact 3 — Health-check response excerpt

- File: `docs/marketing/evidence/W8/WO-P1/manual/health-check-output.txt`
- Must contain: `HEALTH CHECK PASS`, the real channelId, the channel title,
  `environment=production`.

## Artifact 4 — Connection-record export

- File: `docs/marketing/evidence/W8/WO-P1/manual/connection-record-export.json`
- Source: `export` output. Must contain no token fields whatsoever.
- Shape reference (mock-generated, environment=mock):
  `docs/marketing/evidence/W8/WO-P1/connection-record-export.sample.json`

## Artifact 5 — Acceptance-run log

- File: `docs/marketing/evidence/W8/WO-P1/manual/acceptance-run-log.md`
- Format: one block per acceptance test — command, timestamp, exit code,
  observed output, and the AT identifier it closes:

```
AT-P1.1 — consent + exchange + refresh(rotation) — <ts> — exit 0 — <output excerpt>
AT-P1.2 — health check + production record — <ts> — exit 0 — channelId UC... 
AT-P1.3 — re-authorization idempotent — <ts> — exit 0 — "UPDATED existing connection", 1 connection
AT-P1.4 — broker denial (credentials-free closure re-confirmed) — <ts> — exit 3 — no side effects
AT-P1.5 — revoke → degraded — <ts> — exit 1 — HEALTH CHECK FAIL, degraded=true
```

## Negative results (record, do not hide)

Any refusal, failed exchange, quota error, or consent-screen surprise goes
here verbatim with its timestamp — per handoff Section 8.5 negative results
are registry-worthy evidence.
