# WO-P1 Phase 2 — scope and policy verification ledger

| Field | Value |
|---|---|
| Work order | WO-P1 — production YouTube connection (Phase 2 of the [execution plan](../../../work-orders/WO-P1-execution-plan.md)) |
| Checked on | 2026-10-31 (UTC) — two passes: the initial check, and a same-day second pass that closed V5/O2 and resolved O1 as far as current documentation allows |
| Checker | Z.ai GLM agent — platform lane, Phase 2 executor session |
| Method | Direct fetch of official Google documentation pages; quotes below are exact. Every source listed was actually opened on the check date. No policy number in this ledger comes from memory or from third-party summaries, except where explicitly marked unverified. |
| Status | V1–V5 answered (V5 closed on the second pass) · O2 closed · O1 resolved as far as documentation allows — empirical confirmation at Phase 4/5, non-blocking · O3 parked · decisions D1–D3 recorded; D2 requires the TL, now with a sharpened option (a) |

## Summary

| Row | Question (from the plan) | Status | Short finding |
|---|---|---|---|
| V1 | Least-privilege scope set for upload + read-back | **answered** | Upload path entirely inside `youtube.upload`; read-back scope justified at scope level from the official scope table — the per-method tables are no longer published (O1 → empirical at Phase 4/5, non-blocking) |
| V2 | Does `yt-analytics.readonly` cover WO-P3's metric families | **answered** | Views, watch time, average view duration/percentage, subscribers gained/lost, likes, comments, shares all available; per-video filter confirmed |
| V3 | Testing-mode test-user limits; short refresh-token clock | **answered — critical** | Official: refresh tokens expire after **7 days** while publishing status is Testing (external user type). YouTube scopes are not exempt |
| V4 | Current quota policy for the upload path | **answered — changed twice since 2025** | New three-bucket model: 100 uploads/day, 100 searches/day, 10,000 units/day for everything else |
| V5 | Consent-screen information requirements | **answered** (second pass) | Field list, 100-test-user ceiling, scope classification, and both warning screens confirmed from the pages' current homes |

## V1 — upload and read-back scopes

**Question.** Is `youtube.upload` + `youtube.readonly` the least-privilege set for WO-P2's upload and read-back verification path, or does any step request a broader scope?

**Sources (opened 2026-10-31).**
- `https://developers.google.com/youtube/v3/docs/videos/insert`
- `https://developers.google.com/youtube/v3/docs/thumbnails/set`
- `https://developers.google.com/youtube/v3/docs/videos/list`

**Findings.**

1. `videos.insert` (the upload call) is authorized by any of:
   `https://www.googleapis.com/auth/youtube.upload`, `…/auth/youtube`,
   `…/auth/youtubepartner`, `…/auth/youtube.force-ssl`. Its quota impact, verbatim:
   "100 calls per day. A call to this method has a quota cost of 1 unit in the Video
   Uploads quota bucket."
2. `thumbnails.set` (custom thumbnail on upload) is authorized by the same four scopes —
   including `youtube.upload` — with "a quota cost of approximately 50 units."
3. `videos.list` (read-back verification) retrieves a video by `id` with
   `part=snippet,status,contentDetails,statistics`, covering title, privacy state, and
   duration — exactly the read-back AT-P2.2 needs. Neither this page nor `channels.list`
   carries a per-method scope table anymore (re-confirmed on the second pass, 2026-10-31;
   the docs restructure removed them) — see the O1 resolution below.

**Finding.** The entire upload path — video upload plus thumbnail — sits inside
`youtube.upload`; the broader `youtube.force-ssl` is not required by any documented
upload-path method. Read-back by `id` is confirmed possible; the exact scope that
authorizes it is expected to be `youtube.readonly` but was not confirmed from a per-method
table this round.

**Decision D1 (scope set).** Keep the work order's three-scope set —
`youtube.upload` + `youtube.readonly` + `yt-analytics.readonly`. Before the consent screen
is shown, the implementation cross-checks the store/broker configuration so that no
`youtube.force-ssl` or `youtube` (full) scope is requested anywhere in the W5 machinery
(plan risk row 5). The granted-scope list displayed at consent is captured as part of the
AT-P1.1 evidence, which settles O1 empirically for the read-back scope.

**O1 — resolved as far as documentation allows (second pass, 2026-10-31).** The per-method
authorization tables were removed from the reference pages in the docs restructure:
`videos.list` was re-fetched (documents no authorizing scope; quota cost 1 unit; some
`part` values owner-only) and `channels.list` was fetched for the first time (documents
only the special-case `…/auth/youtubepartner-channel-audit` scope for the `auditDetails`
part, plus quota cost 1 unit). What current official documentation does publish is the
scope table in the YouTube Data API OAuth guide, which describes the read-back choice:
`youtube.readonly` — "View your YouTube account", versus `youtube.force-ssl` — "See,
edit, and permanently delete your YouTube videos, ratings, comments and captions".
`youtube.readonly` therefore remains the least-privilege read-back scope at scope level,
and the definitive per-method proof lands empirically at Phase 4/5 — where the failure
mode is safe: if the granted scope set did not authorize `channels.list mine=true`, the
pre-save health check fails loudly and nothing is stored. O1's state changes from
open-doc-check to empirical-at-Phase-4/5; it gates nothing.

## V2 — analytics scope coverage

**Question.** Does `yt-analytics.readonly` cover the metric families WO-P3 intends to collect for owned videos?

**Sources (opened 2026-10-31).**
- `https://developers.google.com/youtube/analytics/reference`
- `https://developers.google.com/youtube/analytics/channel_reports`

**Findings.**

1. Scope description, verbatim: "View YouTube Analytics reports for your YouTube content.
   This scope provides access to user activity metrics, like view counts and rating
   counts." (The monetary variant, `yt-analytics-monetary.readonly`, adds revenue and ad
   performance metrics — not requested by WO-P1.)
2. Channel-report video metrics confirmed available: `views`, `estimatedMinutesWatched`,
   `averageViewDuration`, `averageViewPercentage`, `subscribersGained`, `subscribersLost`,
   `likes`, `dislikes`, `comments`, `shares`, `videosAddedToPlaylists`, `engagedViews`.
3. Per-video filtering confirmed: "You can filter the report to only return data for a
   specific video or country" — filter `video==VIDEO_ID`.

**Finding.** Yes. Every metric family WO-P3 names for owned publications — views, watch
time, subscribers — plus engagement detail is covered by `yt-analytics.readonly`, without
the monetary scope.

## V3 — testing-mode consent and the refresh-token clock (critical)

**Question.** While the OAuth app is in testing mode: what are the current test-user limits, and do refresh tokens issued in testing mode expire on a short clock?

**Sources (opened 2026-10-31).**
- `https://developers.google.com/identity/protocols/oauth2` (refresh-token expiration section)

**Findings.**

1. Verbatim: "A Google Cloud Platform project with an OAuth consent screen configured for
   an external user type and a publishing status of 'Testing' is issued a refresh token
   expiring in 7 days, unless the only OAuth scopes requested are a subset of name, email
   address, and user profile (through the userinfo.email, userinfo.profile, openid scopes,
   or their OpenID Connect equivalents)."
2. The exemption clause covers only identity scopes. The YouTube and YouTube Analytics
   scopes WO-P1 requests are not in that subset, so **the 7-day refresh-token expiry
   applies to this connection while the app remains in Testing status**. This is current
   policy as of 2026-10-31 — the plan's risk table previously carried it as "unverified";
   it is now verified.
3. The same document lists user revocation as a token-invalidation cause ("The user has
   revoked your app's access.") — the exact mechanism AT-P1.5's manual run exercises.
4. The test-user ceiling is confirmed on the second pass — see V5 finding 2: 100 test
   users while publishing status is Testing. It does not constrain P1: the brand's own
   account is one test user regardless of the ceiling.

**Consequences for the phase.**

- P1 closes fine under testing mode: consent, exchange, refresh, and the health check all
  happen within one session.
- WO-P3 requires "at least two distinct collection times" and WO-P4 spans successive
  experiments across weeks. Under testing mode, every refresh token dies within 7 days of
  issuance, so each of those waves either completes inside the window or waits for
  re-consent.

**Decision D2 — required from the TL (this is the R1 decision, now with a verified fact behind it).**

- **Option (a) — recommended:** flip the OAuth consent screen's publishing status to
  "In production" once P1's consent evidence is captured, before WO-P3 starts. This
  ends the 7-day clock for tokens issued from then on — per the refinement below, the
  flip does not rescue the token issued in Testing, so the post-flip re-consent
  (Phase 6 run 2) is what issues the long-lived token. Trade-off: until Google's app
  verification completes, the brand's own account sees the unverified-app warning
  screen during consent; for the brand consenting to its own application this is
  acceptable, and verification can run in parallel if wider rollout is expected.
- **Option (b):** stay in Testing and accept a scheduled re-consent cadence (at least
  weekly) through WO-P4. Each re-consent incidentally re-proves AT-P1.3 idempotency and
  exercises the degraded-state path, but it puts a human in the critical path of every
  credentialed wave and risks mid-experiment token death.

The executor's recommendation is (a). The decision is recorded here and in the inputs
register; WO-P3/WO-P4 planning assumes (a) until the TL says otherwise.

**D2 refinement (second pass, 2026-10-31).** The current "Manage App Audience" page
states the expiry mechanism exactly: "Authorizations by a test user will expire seven
days from the time of consent. If your OAuth client requests an offline access type and
receives a refresh token, that token will also expire." That page says **nothing** about
testing-issued tokens surviving a later change of publishing status. Safe reading — an
inference, labeled as such: **the flip itself does not rescue a token issued in
Testing**; under option (a) the long-lived production token must come from a re-consent
*after* the flip. The plan already schedules that re-consent: Phase 6's consent run 2 of
2 (needed anyway for AT-P1.3) issues it, provided the TL flips the publishing status
between run 1 and run 2 — the runbook now says so explicitly. Also verified for the
option (a) cost picture: flipping to production is not verification. For unverified
apps, "unverified apps that are accessing restricted or sensitive scopes have a 100
new-user cap restriction," and "the user cap applies over the entire lifetime of the
project, and it cannot be reset or changed"; "This cap is removed only after an app has
been successfully verified." With exactly one authorizing user (the brand's own
account), the cap is immaterial to P1 — but it belongs in the R1 decision.

## V4 — quota policy (changed twice inside the phase window)

**Question.** What does the current quota policy say about the upload path WO-P2 will use?

**Sources (opened 2026-10-31).**
- `https://developers.google.com/youtube/data/determine_quota_cost` (Quota Calculator)
- `https://developers.google.com/youtube/data/guides/quota_and_compliance_audits`
- `https://developers.google.com/youtube/v3/revision_history`

**Findings.**

1. Default allocation, verbatim: "Projects that enable the YouTube Data API have a
   default quota allocation of 100 `search.list` calls, 100 `videos.insert` calls, and
   10,000 units per day combined for all other endpoints." And: "The `search.list` and
   `videos.insert` methods have their own quota buckets. Each of these methods has a
   default daily limit of 100 per day. The quota cost is 1 per call."
2. Relevant per-method costs: `videos.insert` — 1 unit from the Video Uploads bucket
   (100/day); `videos.list` — 1; `channels.list` — 1; `videos.update` — 50;
   `thumbnails.set` — approximately 50. "All API requests, including invalid requests,
   incur a quota cost of at least one point." "Daily quotas reset at midnight Pacific
   Time (PT)."
3. Revision history: on **2025-12-04** the upload quota cost changed "from approximately
   1600 units to approximately 100 units"; on **2026-06-01** the API moved
   `videos.insert` and `search.list` into their own buckets; on **2026-06-03** a new
   `videos.batchGetStats` method appeared (own bucket, default 10,000 units/day, cost 1).
4. Compliance audit, verbatim: "If you would like to request additional quota beyond the
   default allocation, you must first complete an audit to show that your project is in
   compliance with the YouTube API Services Terms of Service." An audit completed within
   the last 12 months underpins quota-extension requests.

**Finding.** The quota model the W5-era work was planned against (≈1,600 units per
upload, ≈6 uploads/day from one 10,000-unit pool) **no longer exists**. A default project
now gets 100 uploads/day in a dedicated bucket, with reads at 1 unit from the general
pool. Any W5-era recorded quota assumption still cited in WO-P2's planning documents is
stale and must be re-derived from the current calculator — this is exactly why the work
order says to verify at implementation time rather than trust recorded numbers.

**Decision D3 (quota).** Risk R2's likelihood drops materially: WO-P2's single-publication
scope (one upload, thumbnail, a handful of 1-unit reads) fits far inside the default
allocation, and no quota extension or audit is needed for P1–P3 as scoped. AT-P2.5
(quota-exceeded handling) stays exactly as designed — the failure path is still tested
even though the ceiling is now distant. Note for test design: quota resets at midnight
PT and even invalid requests cost at least 1 unit, so the quota-failure simulation must
not assume free retries.

**Open item O3.** A third-party summary claimed the compliance audit is required to
upload public videos at all. The official audit page fetched above states the audit
requirement only for quota **beyond the default allocation**. The third-party claim is
recorded here as unverified and contradicted-by-the-page-fetched; if WO-P2 planning ever
depends on it, re-read the audit page and the YouTube API Services Terms in full at that
time.

## V5 — consent-screen information requirements (answered — second pass, 2026-10-31)

**Question.** What consent-screen information must be present for the brand's account to consent lawfully and knowingly (app name, privacy policy, scopes shown)?

**Status.** Answered. The first pass found the historical support pages moved (404 or
redirected to navigation hubs); the second pass located their current homes — the help
articles were renumbered under the "OAuth App Verification Help Center" — and answered
all four sub-questions carried as O2.

**Sources (opened 2026-10-31, second pass).**
- `https://support.google.com/cloud/answer/13461325` — Submitting your app for verification (the consent-screen field table)
- `https://support.google.com/cloud/answer/15549945` — Manage App Audience (test users, expiry, test-user warning)
- `https://support.google.com/cloud/answer/13464325` — Restricted Scopes (the restricted-scope list)
- `https://support.google.com/cloud/answer/7454865` — Unverified app warnings
- `https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification`
- `https://developers.google.com/workspace/guides/configure-oauth-consent`

**Findings.**

1. **Consent-screen field list (O2-1).** The official configuration table lists: User
   type, App name, User support email, App logo, App home page, App privacy policy, App
   ToS, Authorized domains, Developer contact information, Scopes, Add test users,
   Optional info, Summary. Quotes that matter for P1: External user type — "Your app
   will start in the 'test mode' and will only be available to users you add to the
   'test users' list"; Add test users — "available only to apps which are still in the
   'test' phase" (and not available once the app is published to production); Scopes —
   "Only request the narrowest scopes that are needed for your app's
   functionality." What the user actually sees at consent: the app name and logo, the
   user support email, and links to the privacy policy and terms of service (the
   brand-verification page, describing the consent screen's populated components), plus
   the requested scopes (the consent-screen guide: it "tells users which app is
   requesting access to their data and what kind of data (scopes) the app needs"). Home-page, privacy-policy, and
   authorized-domains requirement details live on their own linked pages — read them
   if/when the verification track (R1) is opened; they are not gating for testing-mode
   consent, whose required inputs are the app name, user support email, user type, and
   developer contact information.
2. **Test-user ceiling (O2-2).** Verbatim: "Projects configured with a publishing status
   of Testing are limited to up to 100 test users listed in the OAuth consent screen. A
   test user consumes a project's test user quota once added to the project." The
   commonly-cited 100 figure is confirmed current.
3. **Scope classification (O2-3).** Two parts. (i) The current restricted-scope list
   contains **no YouTube Data API or YouTube Analytics scope** — the restricted families
   are Gmail, Google Drive, Google Fit, Google Chat, Data Portability, Photos Ambient,
   and Google Health; the only YouTube-named entries are `dataportability.youtube.*`
   scopes (a different API family WO-P1 does not request). None of the three requested
   scopes is restricted. (ii) The sensitive/non-sensitive split is not published as a
   page — the console shows it per scope: "Once the scopes are added they are classified
   and listed as non-sensitive, sensitive and restricted," and "scope categories
   (non-sensitive, sensitive, or restricted) are indicated automatically in the Google
   Cloud Console." The runbook's pre-run checklist now includes recording the
   console-indicated classification of each requested scope at Phase 4 prep, because it
   determines the production-mode surface (see finding 4 and the D2 refinement).
4. **Unverified-app warning (O2-4).** Two distinct surfaces, both now documented. In
   Testing mode, before a test user authorizes: "Google will display a warning message
   before allowing a specified test user to authorize scopes requested by your project's
   OAuth clients. The warning message confirms the user has test access to your project
   but should consider the risks associated with granting access to their data to an
   unverified app." Separately, the "unverified app" screen appears before the consent
   screen when "the scopes requested in your app code differ from the scopes requested
   in your OAuth consent screen configuration page" — so the console's scope
   configuration must exactly match the code's scope request; this match is now a
   runbook pre-run check. Either screen, if shown, belongs in the consent-flow capture
   (AT-P1.1 evidence): the record shows what the consenting user actually saw.

**Finding.** V5 no longer blocks Phase 4. The concrete pre-run configuration checklist
deriving from these findings is in the runbook (step 0), and the consent-flow record
captures whatever screens the flow actually shows.

**R1 context (for the TL's app-verification decision; not a P1 blocker).** The official
exceptions page lists categories where verification is not mandatory, with quotes:
"Personal Use apps: If the app is for your personal use (fewer than 100 users), you and
your limited number of users can continue using the app without going through
verification (users will be allowed to click through 'unverified app' warning screens
during sign-in)"; "Development/Testing/Staging apps: Apps in development/testing/staging
mode are not subject to verification"; "Service-owned Data Only: The app only accesses
its own data (using a Service Account), and not user data" — not applicable, P1's path
is OAuth user consent; "Internal Use apps… only available for apps created under a
Google Workspace Organization. You will not need to submit your app for verification"
and "Your app will not be subject to the unverified app screen or the 100-user cap if
it's designated as internal-only" — applicable only if the brand account is a Workspace
organization account. Universal regardless of category: "All apps that integrate with
Google APIs are required to comply with Google's API Services User Data Policy
regardless of whether they have been verified."

## Decisions and open items — consolidated

| ID | Type | Statement | Owner | State |
|---|---|---|---|---|
| D1 | decision | Keep `youtube.upload` + `youtube.readonly` + `yt-analytics.readonly`; verify no broader scope is requested anywhere before consent; capture the granted-scope list in AT-P1.1 evidence | executor | adopted |
| D2 | decision required | Testing-mode 7-day refresh-token expiry is verified current. (a) flip to In production after P1 consent — recommended, and the flip must be followed by a re-consent (Phase 6 run 2) because the official pages do not say the flip rescues a Testing-issued token; or (b) scheduled re-consent cadence | **TL** | pending — blocks WO-P3 planning assumption |
| D3 | decision | Quota risk downgraded per the new three-bucket model; no extension or audit needed for P1–P3; WO-P2 re-derives quota numbers from the current calculator, never from W5-era records | executor | adopted |
| O1 | open → resolved | Per-method scope tables for `videos.list` / `channels.list` no longer published; `youtube.readonly` justified at scope level from the official scope table; definitive proof empirical at Phase 4/5 (safe failure mode: pre-save health check fails loudly, nothing stored) | executor | resolved 2026-10-31 — empirical confirmation at Phase 4/5, non-blocking |
| O2 | open → closed | Consent-screen field list, 100-test-user ceiling, scope classification (no YouTube scope is restricted; sensitive split console-indicated), and both warning screens — all answered from the pages' current homes (V5 findings 1–4) | executor | closed 2026-10-31 |
| O3 | open | Third-party claim "audit required for public uploads" — unverified; re-read the audit page / API Terms if WO-P2 ever depends on it | executor | parked |

## Sources

All opened 2026-10-31; no other source contributed a finding to this ledger. Sources
1–11 are from the first pass; sources 12–23 are from the second pass (same day), which
located the current homes of the moved help articles.

1. YouTube Data API Quota Calculator — `https://developers.google.com/youtube/data/determine_quota_cost`
2. Quota and compliance audits — `https://developers.google.com/youtube/data/guides/quota_and_compliance_audits`
3. Using OAuth 2.0 to Access Google APIs (refresh-token expiration) — `https://developers.google.com/identity/protocols/oauth2`
4. `videos.insert` reference — `https://developers.google.com/youtube/v3/docs/videos/insert`
5. `videos.list` reference — `https://developers.google.com/youtube/v3/docs/videos/list` (re-fetched on the second pass — no per-method scope table, confirmed)
6. `thumbnails.set` reference — `https://developers.google.com/youtube/v3/docs/thumbnails/set`
7. `channels.list` reference — `https://developers.google.com/youtube/v3/docs/channels/list` (fetched on the second pass — no general per-method scope table, confirmed; see the O1 resolution)
8. YouTube Analytics and Reporting APIs reference — `https://developers.google.com/youtube/analytics/reference`
9. YouTube Analytics channel reports — `https://developers.google.com/youtube/analytics/channel_reports`
10. YouTube Data API revision history — `https://developers.google.com/youtube/v3/revision_history`
11. Attempted on the first pass, no usable findings (page moved or navigation hub): `https://support.google.com/cloud/answer/13464320`, `https://support.google.com/cloud/answer/13463073`, `https://support.google.com/cloud/answer/9110914`, `https://developers.google.com/youtube/data/guides/authentication`, `https://developers.google.com/youtube/v3/guides/authentication`, `https://developers.google.com/identity/protocols/oauth2/production-readiness`
12. Submitting your app for verification (consent-screen field table; scope classification on add) — `https://support.google.com/cloud/answer/13461325`
13. Manage App Audience (test users, 7-day expiry, test-user warning) — `https://support.google.com/cloud/answer/15549945`
14. When is verification not needed (exception categories) — `https://support.google.com/cloud/answer/13464323`
15. Restricted Scopes (the restricted-scope list; no YouTube Data/Analytics scopes) — `https://support.google.com/cloud/answer/13464325`
16. OAuth App Verification FAQ (100 new-user cap; cap applies over project lifetime) — `https://support.google.com/cloud/answer/13463817`
17. Unverified app warnings (when the unverified-app screen displays; scope-match rule) — `https://support.google.com/cloud/answer/7454865`
18. OAuth App Verification Help Center (hub; scope categories console-indicated) — `https://support.google.com/cloud/answer/13463073`
19. YouTube Data API OAuth guide, mobile & desktop (the scope description table) — `https://developers.google.com/youtube/data/guides/auth/installed-apps`
20. Submit for brand verification (consent-screen components; draft/publish branding) — `https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification`
21. Restricted scope verification (annual re-verification; security assessment) — `https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification`
22. Configure the OAuth consent screen and choose scopes (Workspace guide; minimal flow) — `https://developers.google.com/workspace/guides/configure-oauth-consent`
23. Re-checked on the second pass and confirmed still dead: `https://support.google.com/cloud/answer/13464320` (404 — the FAQ content now lives at source 16); `https://developers.google.com/identity/protocols/oauth2/production-readiness` (404 — its content now lives in the sub-pages, sources 20–21). `answer/13463073` and `answer/9110914` resolve to the Help Center hub (source 18) rather than their old standalone content.
