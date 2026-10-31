# WO-P1 manual run runbook — production YouTube consent (recorded manual run)

This is the TL's credentialed procedure. Per handoff Section 8 it happens
outside CI, is recorded, and its artifacts are stored under
`docs/marketing/evidence/W8/WO-P1/manual/` (gitignored if they contain anything sensitive —
they must not, see step 7). Everything below the consent click uses the same
code path the credentials-free suite verified.

**Expected duration:** 20–30 minutes, plus Google Cloud console time if the
OAuth client does not exist yet.

## 0. Prerequisites

1. A Google Cloud project with an OAuth 2.0 **Web application** client.
   Authorized redirect URI: something you control, e.g.
   `http://localhost:8080/oauth/callback` (the code appears in the redirect
   URL — no server needed; copy it from the browser address bar).
2. The publishing mode **Testing** with the brand's Google account added as a
   test user. This is sufficient to close P1 (WO-P1 implementation note; risk
   R1). If broader rollout is expected, start the app-verification track in
   parallel — it is the long pole, not this run.
3. Verify at run time (do not trust recorded numbers):
   - current quota policy for the YouTube Data API,
   - current consent-screen behavior for testing-mode apps,
   - the minimal scope set (see `docs/marketing/scope-justification.md`).
4. **Console pre-run checklist** (from the verification ledger, V5 findings —
   checked against the current official pages 2026-10-31):
   - Consent-screen basics configured: app name, user support email, developer
     contact information, user type **External** (external apps "start in the
     'test mode'"; Internal is only available under a Workspace organization).
   - The brand account added as a **test user** (testing mode allows up to 100
     test users; "Add test users" is available only while the app is in the
     test phase).
   - **Scope match:** add exactly the three scopes this run requests —
     `youtube.upload`, `youtube.readonly`, `yt-analytics.readonly` — to the
     consent-screen configuration. Official rule: when "the scopes requested in
     your app code differ from the scopes requested in your OAuth consent
     screen configuration page, your users see an 'unverified app' screen."
     The code's request and the console's configuration must match exactly.
   - **Record the console-indicated classification** (non-sensitive /
     sensitive / restricted) shown for each of the three scopes when added —
     it goes into the inputs register and the run log; it decides the
     production-mode surface if the TL adopts decision D2 option (a). No
     YouTube Data or Analytics scope is on the restricted list (ledger V5
     finding 3); the console shows the sensitive split.
   - Home-page / privacy-policy / logo / authorized-domains fields: optional
     for testing-mode consent; required later if the verification track (R1)
     opens — read their requirement pages at that time (ledger sources 12, 20).

## 1. Generate the store key

```bash
node tools/youtube-oauth/cli.mjs genkey
# store the 64-hex-char key in /secure/path/yt-oauth.key  (chmod 600, operator-only)
```

Losing the key makes the token store unrecoverable (by design). Back it up
securely or accept re-consent as the recovery path.

## 2. Configure

```bash
export GOOGLE_CLIENT_ID='<from Google Cloud console>'
export GOOGLE_CLIENT_SECRET='<from Google Cloud console>'
export OAUTH_REDIRECT_URI='http://localhost:8080/oauth/callback'
export YOUTUBE_TOKEN_STORE=/secure/path/wo-p1-store.json
export YOUTUBE_TOKEN_STORE_KEYFILE=/secure/path/yt-oauth.key
```

Do not put these in the repository, CI variables, or any artifact.

## 3. Consent as the channel owner

```bash
node tools/youtube-oauth/cli.mjs consent-url
```

Open the printed URL in a browser **signed in as the account that owns the
brand's channel**, approve the requested scopes (youtube.upload,
youtube.readonly, yt-analytics.readonly), then copy the `code` parameter from
the redirect URL.

**Whose browser (recorded finding, 2026-10-31):** this must be the owner's
browser or any human-operated trusted browser — **not** an automated browser in
the executor sandbox. A controlled sign-in attempt from the sandbox's
automation browser was refused by Google at the email step ("This browser or
app may not be secure"); Google Accounts blocks automation browsers, so the
consent click cannot be automated. The division of labor the localhost-redirect
design already supports: the owner opens the consent URL and copies the `code`
from the redirect address bar; the executor CLI (running in the sandbox, where
the token and Data API endpoints are verified reachable) performs the exchange,
health check, storage, and redaction scan.

Capture note: while the app is in Testing mode, Google shows the test-user
warning before the authorization ("a warning message… confirms the user has
test access to your project but should consider the risks associated with
granting access to their data to an unverified app"). If any warning or
unverified-app screen appears, it belongs in the consent-flow capture — the
record shows what the consenting user actually saw, not an idealized flow.

## 4. Complete the connection

```bash
node tools/youtube-oauth/cli.mjs complete --code '<code>' --state '<state from step 3>'
```

Success prints the verified production channel identity:

```
Pre-save health check PASSED — verified production channel:
  channelId: UC...
  title:     ...
  environment: production
  NEW connection stored
```

If the pre-save health check fails, nothing is stored — fix the cause (wrong
account, revoked test-user status) and re-run from step 3.

## 5. Verify the acceptance behaviors

```bash
node tools/youtube-oauth/cli.mjs status          # environment=production, degraded=false
node tools/youtube-oauth/cli.mjs healthcheck UC...   # HEALTH CHECK PASS
```

- **Idempotency (AT-P1.3):** repeat steps 3–4 with the same account; the
  output must say `UPDATED existing connection` and `status` must still list
  exactly one connection.
- **Degradation (AT-P1.5):** revoke access at
  `https://myaccount.google.com/permissions`, then run `healthcheck` again —
  it must fail loudly and `status` must show `degraded=true`.
- **Decision D2, option (a) sequencing (if the TL adopts it):** after consent
  run 1's evidence is captured (step 7) and **before** the re-authorization
  below, flip the publishing status to "In production" in the Google Cloud
  console (OAuth consent screen → Publishing status → Publish App). The
  official pages do not say the flip rescues a Testing-issued refresh token
  (ledger, D2 refinement — safe reading: it does not), so the re-authorization
  that follows is what issues the long-lived production token for WO-P2/WO-P3.
  Test-user management is unavailable in production status, so the brand
  account's authorization happens as a regular (unverified-app) consent —
  capture whatever screens the flow shows, as above.
- **Broker gate (AT-P1.4):** already closed credentials-free; optionally
  re-confirm by attempting `upload` without an approvals file — it must refuse
  with `No permission-broker approval` and exit 3.

## 6. Refresh and rotation check (AT-P1.1)

```bash
node tools/youtube-oauth/cli.mjs refresh UC...
# "Token refreshed for UC... (refresh token ROTATED and replaced)."
```

## 7. Capture the evidence (see manual-run-evidence-template.md)

1. Consent-flow record — screen recording or screenshots of the consent screen
   and the success redirect.
2. Redacted token-store audit log — the `auditLog` section of
   `node tools/youtube-oauth/cli.mjs export` (contains actions and channel
   IDs only).
3. Health-check response excerpt — the `healthcheck` / `complete` output
   including channelId and title.
4. Connection-record export — the `export` output (verify: no token fields
   present at all).
5. Acceptance-run log — timestamps and commands for steps 3–6 with results.

Before storing anything, scan every artifact for the access/refresh token and
client secret. The export never contains them, but the acceptance log is
hand-assembled, so scan it. **Use the cred-hygiene scanner** (added 2026-10-31;
see the reconciliation note in the package README) — it takes the secret values
from a scratch file instead of the command line, adds pattern-class depth for
anything unregistered, and produces a report that is itself safe to store:

```bash
# scratch file OUTSIDE the repository; never commit it; delete after the scan
cat > /secure/path/scan-canaries.json <<'EOF'
["<access token>", "<refresh token>", "<client secret>"]
EOF

node tools/cred-hygiene/cli.mjs scan \
  --canary-file /secure/path/scan-canaries.json \
  --out docs/marketing/evidence/W8/WO-P1/manual/redaction-scan.report.json \
  docs/marketing/evidence/W8/WO-P1/manual/
# exit 0 = clean (silent) · exit 3 = REFUSED — a finding is printed; fix before storing.
# The JSON report is safe to keep as evidence even when clean (meta-redaction is
# proven by tests CH-5/CH-6: the report never contains what it finds).

rm /secure/path/scan-canaries.json
```

Minimal-environment fallback (know the hazard: secrets on the command line enter
shell history — use a scratch file for the values and clear the history after):

```bash
grep -r -F -e '<access token>' -e '<refresh token>' -e '<client secret>' docs/marketing/evidence/W8/WO-P1/manual/ && echo LEAK || echo clean
```

## 8. Close out

Fill the manual-run evidence template, register the entry
(`docs/marketing/work-registry/2026-10-31-wo-p1-closure-entry.md`), flip WO-P1 front
matter in `docs/marketing/work-orders/WO-P1.md`, and record the closure row in
`docs/marketing/WORK-REGISTRY.md`. Gate P1 is closed when AT-P1.1–P1.5 all
have the manual-run artifacts linked.
