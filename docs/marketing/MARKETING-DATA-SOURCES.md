# MARKETING-DATA-SOURCES

> Source-by-source record of API availability, permissions, regions, fields, freshness, retention, quotas, and limitations. Owned by Worker A (platform access), TL-approved. Connector implementations must be built **only** from entries marked "access path verified". Last updated: 2026-10-29 (W1-3(b) live verification: Google Ads Transparency Center keyless public route VERIFIED — the paid-side blocker is closed; initial market defined: United States / YouTube; keyless uploads-RSS route incident recorded honestly).

## Why this file exists

Data access is the biggest product risk. Ambition: discover the ads companies are running and the organic content that performs best. Reality: **no universal API guarantees access to every advertiser's creatives, historical metrics, targeting information, and conversions across every platform, country, and date range.** Therefore the product maintains a **data coverage ledger** alongside research results, distinguishing **verified data / estimated signals / unavailable data / inaccessible sources**, rather than silently filling gaps.

The system must never report "all ads discovered", "the highest-converting creative", or "the best-performing strategy" unless the evidence supports it. An ad running a long time is a research signal, not proof of profitability; a million-view video can sell less than a ten-thousand-view video with a qualified audience. That distinction lives in the analytical engine (`packages/marketing`), not in a prompt.

## Four data acquisition methods (architecture supports all four from day one)

1. **Official APIs and approved integrations** — primary route for structured, repeatable research and authorized account operations.
2. **Public transparency tools** — where no permitted API dataset exists, help users locate, review, and collect evidence through access methods the platform allows.
3. **User-authorized account connections and imports** — connect a brand's own analytics/advertising accounts, or accept supported reports and data exports.
4. **Historical archives and licensed data sources** — deeper historical baselines where provenance, coverage, and usage rights are clear.

Constraints that apply to every method: never bypass authentication controls, CAPTCHAs, rate limits, or platform restrictions; never treat a logged-in browser as permission to extract unlimited data.

## Source ledger

### Initial market decision (W1 gate input, recorded 2026-10-29)

**First market: United States. Platform: YouTube.** Organic side: keyless YouTube public routes (verified 2026-10-28). Paid side: Google Ads Transparency Center, region US (geo criterion id 2840) — ads that ran on Google surfaces including YouTube, by the same competitor set. Meta Ad Library API remains the credentialed growth path for Meta-platform markets once credentials exist (row below stays open for that purpose; it is no longer the W1 blocker).

### Google Ads Transparency Center (keyless public transparency route)
- **Use for:** paid-side (ad-intelligence) research — advertiser discovery by name, ad-count ranges, and an advertiser's real ads in a region with creative preview/image URLs, format, and platform-reported first/last-shown dates. Implemented by `connector:google-ads-transparency` (`packages/marketing/src/adapters/sources/googleAdsTransparency.ts`, capabilities: research ONLY, authModel: public, retrieval method: publicTransparency).
- **Access:** https://adstransparency.google.com — Google's public transparency service. The connector calls the same public data endpoints the site serves every visitor (`SearchService/SearchSuggestions` and `SearchService/SearchCreatives`, POST `f.req=` urlencoded JSON): no authentication, no cookies, no account, no bypassing of any access control. Verified with plain HTTP from the verification sandbox; wire fixtures recorded in the plugin tests.
- **Known constraints (reported in every CoverageReport):** the wire format is the public service's own data channel, NOT an officially documented API (drift risk — connector maps unknown shapes to explicit `schema_drift` coverage, never to invented data); per-creative serving surface (Search vs YouTube vs Display) is not exposed (records use platform `other` + `google-ads:`-prefixed formats); impressions/spend/clicks/ROAS/targeting are not exposed (`unavailable` slices, never over-claimed); first/last-shown dates are platform-REPORTED delivery metadata kept strictly separate from our own observation timestamps; ad-count ranges are platform estimates; pagination is capped per advertiser (page cap 3, page size 40) and every RPC call is counted in a coverage slice; regions are limited to the live-verified geo map (US GB CA AU DE FR JP HK — extend only after a recorded live verification).
- **Status:** **Access path verified: 2026-10-29** — live repeatable test `evidence/2026-10-29-w1-ad-source-google-atc.txt`: real advertisers resolved by name (Wacaco Company Limited `AR14412319853346029569`, HK, ~100–200 ads in US; AeroPress, Inc. `AR12134087531020943361`, US, ~96 ads), 184 real ad creatives ingested idempotently through the connector contract into the SQLite temporal store, negative control resolved to an honest coverage gap, delivery-metadata discipline verified (platform-reported dates distinct from observation timestamps), live-mode tool chain exercised against the real service (W3 chain re-run, all gates pass). **This closes W1-3(b) and the W1 exit gate.**

### Meta Ad Library (+ associated transparency interfaces)
- **Use for:** eligible ads, advertisers, creative variations, delivery history.
- **Known constraint:** the official interface's commercial-ads coverage is region-limited (documented EU/UK commercial transparency scope over the past year; the multi-year global scope applies to political and social-issue ads). It is **not** a universal commercial-ad archive.
- **Status:** candidate. Access path probed live 2026-10-28: the `ads_archive` API endpoint is reachable and its documented parameters validate, but a request without an access token returns no data (`evidence/2026-10-28-w1-source-access-youtube-public.txt`, Part 2). **Verified conclusion: the access path exists and is repeatable, but requires credentials — not yet verified with data.** No longer the W1 blocker (the keyless Google Ads Transparency Center row above closes it); remains the preferred official-API route for Meta-platform markets. Do not build foundational dependencies on it until Worker A records a credentialed, repeatable test in `evidence/`.
- **Freshness/retention/quotas:** TBD by Worker A during credentialed W1 verification.

### TikTok Commercial Content API
- **Use for:** search public ads and commercial content, supported advertiser metadata.
- **Known constraint:** access requires an approved application; the documented dataset initially covers EU ads.
- **Status:** candidate. Access path NOT verified.

### TikTok Research Tools
- **Use for:** optional research connector for eligible research projects.
- **Known constraint:** ordinary commercial users are not eligible. **Do not make access to these tools a prerequisite for the product.**
- **Status:** not planned for W1–W3; revisit only with an eligible project.

### YouTube Data API (public)
- **Use for:** discover videos, collect accessible public video statistics.
- **Known constraint:** public metrics are useful performance signals but do not reveal creators' private analytics.
- **Status:** key-based access remains **unverified** (no API credentials in this environment). The keyless subset of public organic data is covered by the verified row below.

### YouTube public metadata — oEmbed + channel uploads RSS (keyless)
- **Use for:** recent channel uploads (rolling ~15-entry feed), current-snapshot public view counts per video, per-video creative metadata (title, author, thumbnail).
- **Access:** documented platform endpoints, no credentials: `youtube.com/oembed?url=<video>&format=json`, `youtube.com/feeds/videos.xml?channel_id=<id>`, plus public handle→channel-id resolution. Implemented by `connector:youtube-public` (`packages/marketing/src/adapters/sources/youtubePublic.ts`, capabilities: research ONLY).
- **Known constraints (reported in every CoverageReport):** feed carries a rolling window of recent uploads, not history; view counts are current snapshots (history requires the key-based Data API); channel resolution works for channel ids and handles, not arbitrary search terms; private analytics stay out of scope (not_connected).
- **Status:** **Access path verified: 2026-10-28** — live repeatable test `evidence/2026-10-28-w1-source-access-youtube-public.txt` (15 organic records + 15 real view-count observations ingested idempotently through the connector contract; negative control produced an honest coverage gap). Organic-side verification item of W1-3(a) is satisfied by this row; the key-based Data API row above remains the growth path for per-video history. **Route-availability incident (recorded honestly, 2026-10-29):** during the W1-3(b) verification run the uploads RSS route returned HTTP 404 for many channels — including Wacaco's `UC-y91EU3KtDG_yZuSxeMI6w`, which served the 15 real uploads for both the 2026-10-28 verification and the 2026-10-29 W3-2 run — from plain HTTP AND a full Chrome browser (platform-side partial outage; some mega-channels still served). The connector surfaces this as an explicit `unavailable` coverage gap, never as missing data. The 2026-10-28 verification stands as the recorded evidence. **Re-confirmed 2026-10-29 (later the same day): the route has RECOVERED** — fresh live run `evidence/2026-10-29-live-reverification-rss-recovered.txt`: verify:sources 11/11 gates (subject channel `available` again, 15 real records idempotent), and BOTH the incident channel (Wacaco `UC-y91EU3KtDG_yZuSxeMI6w`) and the verification subject serve HTTP 200 with 15 entries (direct probes recorded in the same file). The honest-gap behavior during the outage stays as designed and is the durable lesson.

### YouTube Data API — connected-account publishing (user-authorized method 3)
- **Use for:** publishing an APPROVED produced asset through the brand's own connected channel; post-status verification (videos.list); connected-account analytics for W6 measurement.
- **Connector:** `connector:youtube-publish` (`packages/marketing/src/adapters/sources/youtubePublish.ts`) — capabilities `analytics + publishing` ONLY (`research`/`scheduling`/`paidAds` never implied; calling research is a typed refusal). Wire protocol: the REAL Data API v3 resumable-upload path (POST upload session with Bearer + idempotency key → PUT bytes to the pre-authorized session URL → 201 Video resource) + videos.list for verification + the Analytics API v2 report shapes for permitted measurement.
- **Idempotency:** one publication per artifact (idempotency key `<artifact>:<mission>:organic`); a persisted record with the same key IS the answer — retries can never duplicate a post (in-process map + persisted PublicationRecord).
- **Auth hygiene:** the access token lives only in the workspace credential area (`.zcode/marketing/connections.json`) and inside connector requests — never echoed by a tool, never written into mission records (grep-enforced by the plugin tests and the evidence runs).
- **Environment honesty:** every connection carries an `environment` label (`production`/`sandbox`); a sandbox (test-account) publication is never presented as a production post — the label travels on the publication record, the coverage slices, and the panel.
- **Verification status (W5):** wire protocol implemented against the real Data API v3 shapes and verified against a local sandbox test endpoint (bearer-validated) through a real spawned server — `evidence/2026-10-29-w5-authorized-publishing.txt`; the assisted/manual path verified LIVE through the keyless public oEmbed route against a real public video. Production googleapis OAuth (a real channel's credentials) is NOT verified in this environment — the connector serves it through the identical code path (`dataBase: https://www.googleapis.com`), and the first production connection will be recorded the same way before any production publication claim.

### YouTube Analytics API (authorized)
- **Use for:** deeper metrics for a connected, authorized channel — the W6 permitted-analytics route for measuring the brand's own publications (daily totals, e.g. views).
- **Known constraint:** requires OAuth authorization by the channel owner or properly authorized account; only permitted metrics for the connected channel's own videos are collected.
- **Status:** ✅ Verified for the connected-account path (W6, 2026-10-29) — real Analytics API v2 report shapes through the sandbox test account (daily views ingested idempotently, coverage verbatim), `evidence/2026-10-29-w6-closed-loop.txt`; production OAuth pending a real channel.

### Additional ad libraries and social platforms
- **Use for:** expand competitor discovery, organic analysis, authorized publishing.
- **Rule:** each integration is added **only after** Worker A verifies its current access conditions, permitted use, fields, rate limits, and geographic coverage, and records them here.

### Publishing targets (capability-declared, separate permission domain)
- **YouTube Data API (connected account)** — ✅ verified W5 (2026-10-29): `connector:youtube-publish`, the publishing + analytics capability set, sandbox test account verified through a real spawned server; see the connected-account row above.
- TikTok Content Posting API (direct publishing and upload-to-draft, subject to setup and access requirements) — candidate for a later wave; connecting an unverified platform is a typed refusal today.
- Connectors must declare support per operation class: `research`, `analytics`, `publishing`, `scheduling`. **Access to one operation never implies permission for the others.** Organic publishing and paid advertising are separate permission domains; paid execution additionally requires its own approval, budget caps, and audit trail (post-W6 decision).

## Coverage ledger model (implemented in `packages/marketing`)

Every research run produces a `CoverageReport` with per-slice coverage states:

| State | Meaning |
| --- | --- |
| `available` | Verified source returned data for this slice (source, country, date, advertiser scope recorded) |
| `partial` | Some data returned; explicitly scoped what was not covered |
| `unavailable` | Source exists but no permitted access path for this slice |
| `not_connected` | Requires user authorization not yet granted |
| `restricted` | Source policy limits this slice (region, date range, advertiser access) |

Each state carries: source id, connector version, retrieval method, applicable region, date window, and the conclusion it supports. Research conclusions must reference the coverage state they rest on (e.g. "sufficient for a preliminary creative hypothesis, not for a definitive ranking of competitors by sales or ROAS").

## Verification protocol (per source, before an integration is foundational)

1. Desk audit: record documented access conditions, permitted use, fields, quotas, regions (this file).
2. Live test: repeatable test script under `packages/marketing/src/adapters` fixtures; result JSON committed to `docs/marketing/evidence/`.
3. Worker A signs the row above with `Access path verified: <date> <test ref>`.
4. TL approval moves the source from "candidate" to "foundational".
