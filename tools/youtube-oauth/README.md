# youtube-oauth — WO-P1 production YouTube connection

Implements the WO-P1 scope: production Google OAuth consent, secure token
storage with verified redaction, a pre-save account health check returning the
real channel identity, idempotent production connection records, a
permission-broker gate for write-scope operations, and degraded-state handling.
See the [phase-2 handoff](../../docs/marketing/PHASE2-HANDOFF.md), WO-P1.

Zero runtime dependencies (Node >= 18 built-ins). Two execution modes, one code
path:

- **Credentials-free** (CI and local): the test suite runs every flow against
  [`mock-google.mjs`](mock-google.mjs), a wire-accurate mock of the Google
  OAuth 2.0 + YouTube Data API v3 endpoints (real request/response shapes,
  status codes, and error bodies). No secrets, no network.
- **Production manual run** (the TL): the same CLI pointed at the real Google
  endpoints by simply omitting the mock overrides. This is the recorded manual
  run per handoff Section 8 — CI never receives secrets.

## Modules

| File | Responsibility |
|---|---|
| `oauth-client.mjs` | PKCE (S256) consent URL, code exchange, refresh with rotation handling, revocation |
| `token-store.mjs` | AES-256-GCM encrypted store (mandatory key, no plaintext fallback), redacted audit log, idempotent connection upserts |
| `connection-record.mjs` | Production connection records: verified channel identity, `environment=production`, idempotent re-authorization |
| `health-check.mjs` | Pre-save health check (`channels.list?mine=true`), one refresh on 401, loud failure + degraded marking |
| `broker-gate.mjs` | Permission-broker approval gate; write-scope denial exits before any API call or store mutation |
| `redact.mjs` | Redaction utilities + token-hygiene assertions (used by the tests and every export) |
| `config.mjs` | Endpoint configuration: real Google defaults, all overridable for the mock/tests |
| `cli.mjs` | Manual-run CLI (`genkey`, `consent-url`, `complete`, `healthcheck`, `refresh`, `revoke`, `status`, `export`, `upload`) |
| `mock-google.mjs` | Wire-accurate mock provider (tests only) |

## Quick start (manual production run)

```bash
node cli.mjs genkey                       # store in a chmod-600 keyfile
export GOOGLE_CLIENT_ID=...               # from the Google Cloud OAuth client
export GOOGLE_CLIENT_SECRET=...
export OAUTH_REDIRECT_URI=http://localhost:8080/oauth/callback
export YOUTUBE_TOKEN_STORE_KEYFILE=/secure/path/keyfile
node cli.mjs consent-url                  # open URL, consent as the channel owner
node cli.mjs complete --code CODE --state STATE
node cli.mjs status                       # channelId + environment=production
```

Full procedure with evidence capture: [`docs/marketing/manual-run-runbook.md`](../../docs/marketing/manual-run-runbook.md).

## Tests

```bash
node --test --test-reporter=spec "tools/youtube-oauth/test/*.test.mjs"
```

Nine tests, tagged with the stable identifiers AT-P1.1 … AT-P1.5 (plus
token-store, redaction, and CLI end-to-end coverage). The suite proves every
code path credentials-free; the parts of AT-P1.1/2/5 that inherently need a
real Google account close through the TL's recorded manual run — the registry
entry records that split explicitly.

## Security properties (all test-verified)

- Store encrypted at rest (AES-256-GCM); operation without a key is refused.
- No plaintext credential in logs, audit log, store file, or exports — enforced
  by the token-hygiene test scanning every output surface.
- Write-scope operations require a live permission-broker approval; denial
  performs zero API calls and zero store mutations.
- Revoked/expired authorization fails loudly and marks the connection degraded;
  degraded connections block write-scope use.
- Refresh-token rotation is handled: a rotated refresh token replaces the
  stored one.
