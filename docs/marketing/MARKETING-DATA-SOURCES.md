# MARKETING-DATA-SOURCES

> Source-by-source record of API availability, permissions, regions, fields, freshness, retention, quotas, and limitations. Owned by Worker A (platform access), TL-approved. Connector implementations must be built **only** from entries marked "access path verified". Last updated: 2026-10-28 (W1 live verification: YouTube keyless public routes verified; Meta Ad Library probed — credentials still required).

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

### Meta Ad Library (+ associated transparency interfaces)
- **Use for:** eligible ads, advertisers, creative variations, delivery history.
- **Known constraint:** the official interface's commercial-ads coverage is region-limited (documented EU/UK commercial transparency scope over the past year; the multi-year global scope applies to political and social-issue ads). It is **not** a universal commercial-ad archive.
- **Status:** candidate. Access path probed live 2026-10-28: the `ads_archive` API endpoint is reachable and its documented parameters validate, but a request without an access token returns no data (`evidence/2026-10-28-w1-source-access-youtube-public.txt`, Part 2). **Verified conclusion: the access path exists and is repeatable, but requires credentials — not yet verified with data.** Do not build foundational dependencies on it until Worker A records a credentialed, repeatable test in `evidence/`.
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
- **Status:** **Access path verified: 2026-10-28** — live repeatable test `evidence/2026-10-28-w1-source-access-youtube-public.txt` (15 organic records + 15 real view-count observations ingested idempotently through the connector contract; negative control produced an honest coverage gap). Organic-side verification item of W1-3(a) is satisfied by this row; the key-based Data API row above remains the growth path for per-video history.

### YouTube Analytics API (authorized)
- **Use for:** deeper metrics for a connected, authorized channel.
- **Known constraint:** requires OAuth authorization by the channel owner or properly authorized account.
- **Status:** candidate for user-authorized method (3), W6 scope.

### Additional ad libraries and social platforms
- **Use for:** expand competitor discovery, organic analysis, authorized publishing.
- **Rule:** each integration is added **only after** Worker A verifies its current access conditions, permitted use, fields, rate limits, and geographic coverage, and records them here.

### Publishing targets (capability-declared, separate permission domain)
- TikTok Content Posting API (direct publishing and upload-to-draft, subject to setup and access requirements) — candidate for W5.
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
