/**
 * Google Ads Transparency Center connector conformance tests (W1-3(b)).
 *
 * Fixture-only (no network) per PLATFORM-CONNECTOR-CONTRACT.md rule 1: the
 * wire fixtures below are REAL recorded responses from the public service
 * (captured 2026-10-29, region US; see evidence file) trimmed for focus.
 * Conformance rules exercised: typed errors, coverage honesty, idempotent
 * source identities, rate-limit behavior, schema-drift surfacing, region-map
 * honesty, bounded pagination.
 */
import { describe, expect, it } from 'vitest';
import {
  GoogleAdsTransparencyConnector,
  type TransparencyFetchLike,
} from '@zcode/marketing';
import { adCreative } from '@zcode/marketing';
import { advertiserCandidate } from '@zcode/marketing';

const SUGGESTIONS_URL = 'https://adstransparency.google.com/anji/_/rpc/SearchService/SearchSuggestions?authuser=';
const CREATIVES_URL = 'https://adstransparency.google.com/anji/_/rpc/SearchService/SearchCreatives?authuser=';

/** Recorded suggestion shape for 'Wacaco' (region US, 2026-10-29). */
const WACACO_SUGGESTIONS_BODY = JSON.stringify({
  1: [{ 1: { 1: 'Wacaco Company Limited', 2: 'AR14412319853346029569', 3: 'HK', 4: { 2: { 1: '100', 2: '200' } } } }],
});

/** Recorded creatives shape (trimmed to 2 entries, no continuation token). */
const WACACO_CREATIVES_BODY = JSON.stringify({
  1: [
    {
      1: 'AR14412319853346029569',
      2: 'CR15113976961002635265',
      3: { 3: { 2: '<img src="https://tpc.googlesyndication.com/archive/simgad/12660767253002200144" height="503" width="348">' } },
      4: 1,
      6: { 1: '1698208917', 2: 503414000 },
      7: { 1: '1787606306', 2: 228676000 },
      12: 'Wacaco Company Limited',
      13: 670,
    },
    {
      1: 'AR14412319853346029569',
      2: 'CR10768865612584189953',
      3: { 1: { 4: 'https://displayads-formats.googleusercontent.com/ads/preview/content.js?sig=ACiVB_xhnf-pCPR4Ff1HpYe2w2TirxsL8Q' } },
      4: 2,
      6: { 1: '1716876239', 2: 331169000 },
      7: { 1: '1787569050', 2: 52049000 },
      12: 'Wacaco Company Limited',
      13: 770,
    },
  ],
  4: '97',
  5: '97',
});

/** Recorded suggestion shapes ('Wacaco' + the healthCheck brand 'Nespresso', region US, 2026-10-29). */
const NESPRESSO_SUGGESTIONS_BODY = JSON.stringify({
  1: [{ 1: { 1: 'Nespresso USA, Inc', 2: 'AR16221477537186840577', 3: 'US', 4: { 2: { 1: '1000', 2: '2000' } }, 5: true } }],
});

const mkRequest = (country = 'US') => ({
  missionId: 'mission-atc-test',
  competitors: [advertiserCandidate('mission-atc-test', 'Wacaco', 'real espresso-maker brand')],
  platform: 'youtube' as const,
  country,
  from: '2026-10-21T00:00:00.000Z',
  to: '2026-10-29T00:00:00.000Z',
});

describe('google ads transparency connector (fixture wire, no network)', () => {
  const healthyFetch: TransparencyFetchLike = async (url, body) => {
    const decoded = decodeURIComponent(body);
    if (url.startsWith(SUGGESTIONS_URL)) {
      if (decoded.includes('Wacaco')) return { status: 200, body: WACACO_SUGGESTIONS_BODY };
      if (decoded.includes('Nespresso')) return { status: 200, body: NESPRESSO_SUGGESTIONS_BODY };
      return { status: 200, body: '{}' };
    }
    if (url.startsWith(CREATIVES_URL)) return { status: 200, body: WACACO_CREATIVES_BODY };
    return { status: 404, body: '' };
  };

  it('healthCheck resolves a known advertiser without credentials', async () => {
    const connector = new GoogleAdsTransparencyConnector(healthyFetch);
    const health = await connector.healthCheck();
    expect(health.ok).toBe(true);
    expect(health.detail).toContain('AR');
  });

  it('returns real-shape AdCreative records that parse the domain contract', async () => {
    const connector = new GoogleAdsTransparencyConnector(healthyFetch);
    const page = await connector.research(mkRequest());
    expect(page.accessMethod).toBe('publicTransparency');
    expect(page.ads.length).toBe(2);
    page.ads.forEach((a) => adCreative.parse(a));
    expect(page.ads.every((a) => a.id.startsWith('atc:') && a.source.sourceId === 'google-ads-transparency')).toBe(true);
    expect(page.ads.every((a) => a.platform === 'other' && a.format.startsWith('google-ads:'))).toBe(true);
    // Platform-reported dates are OUR observation timestamps' metadata, not the observation itself.
    expect(page.ads[0]!.firstObservedAt).toBe(page.ads[0]!.lastObservedAt);
    expect(page.ads[0]!.availableMetadata.platformReportedFirstShown).toBe('2023-10-25T04:41:57.000Z');
    expect(page.ads[0]!.availableMetadata.platformReportedLastShown).toBe('2026-08-24T21:18:26.000Z');
    // Image URL extracted from the recorded wire img tag.
    expect(page.ads[0]!.availableMetadata.imageUrl).toContain('tpc.googlesyndication.com/archive/simgad/');
  });

  it('records honest coverage: available per competitor + structural unavailable slices', async () => {
    const connector = new GoogleAdsTransparencyConnector(healthyFetch);
    const page = await connector.research(mkRequest());
    const bySlice = Object.fromEntries(page.coverage.map((c) => [c.slice, c]));
    expect(bySlice['paid-ads:Wacaco']?.state).toBe('available');
    expect(bySlice['paid-ads:Wacaco']?.note).toContain('AR14412319853346029569');
    expect(bySlice['paid-ads:Wacaco']?.note).toContain('~100-200 ads reported');
    expect(bySlice['paid-delivery-metrics:google-ads-transparency']?.state).toBe('unavailable');
    expect(bySlice['paid-surface-split:google-ads-transparency']?.state).toBe('unavailable');
    expect(bySlice['paid-targeting:google-ads-transparency']?.state).toBe('unavailable');
    expect(bySlice['request-budget:google-ads-transparency']?.state).toBe('available');
  });

  it('negative control: unknown advertiser is an honest gap, never invented data', async () => {
    const connector = new GoogleAdsTransparencyConnector(healthyFetch);
    const request = {
      ...mkRequest(),
      competitors: [advertiserCandidate('mission-atc-test', 'zz-no-such-advertiser', 'negative control')],
    };
    const page = await connector.research(request);
    expect(page.ads.length).toBe(0);
    const gap = page.coverage.find((c) => c.slice === 'paid-ads:zz-no-such-advertiser');
    expect(gap?.state).toBe('unavailable');
    expect(gap?.note).toContain('no advertiser suggestion');
  });

  it('region outside the verified geo map is a restricted gap (never speculated)', async () => {
    const connector = new GoogleAdsTransparencyConnector(healthyFetch);
    const page = await connector.research(mkRequest('BR'));
    expect(page.ads.length).toBe(0);
    expect(
      page.coverage.find((c) => c.slice === 'paid-ads-region-scope:google-ads-transparency')?.state,
    ).toBe('restricted');
    expect(page.coverage.find((c) => c.slice === 'paid-ads:Wacaco')?.state).toBe('unavailable');
  });

  it('rate limits surface as typed rate_limited details in coverage, never silent', async () => {
    const rateLimitedFetch: TransparencyFetchLike = async () => ({ status: 429, body: '' });
    const connector = new GoogleAdsTransparencyConnector(rateLimitedFetch);
    const page = await connector.research(mkRequest());
    expect(page.ads.length).toBe(0);
    const gap = page.coverage.find((c) => c.slice === 'paid-ads:Wacaco');
    expect(gap?.state).toBe('unavailable');
    expect(gap?.note).toContain('rate_limited');
  });

  it('wire-format drift surfaces as schema_drift coverage, never invented data', async () => {
    const driftFetch: TransparencyFetchLike = async () => ({ status: 200, body: 'not-json' });
    const connector = new GoogleAdsTransparencyConnector(driftFetch);
    const page = await connector.research(mkRequest());
    const gap = page.coverage.find((c) => c.slice === 'paid-ads:Wacaco');
    expect(gap?.state).toBe('unavailable');
    expect(gap?.note).toContain('schema_drift');
    expect(gap?.note).toContain('atc-wire-2026-10-29');
  });

  it('pagination is bounded and duplicates across pages are deduped locally', async () => {
    let calls = 0;
    const countingFetch: TransparencyFetchLike = async (url) => {
      if (url.startsWith(CREATIVES_URL)) {
        calls += 1;
        // Same page every time + a continuation token → the cap must stop it.
        return {
          status: 200,
          body: JSON.stringify({ 1: JSON.parse(WACACO_CREATIVES_BODY)['1'], 2: 'tok' + calls, 4: '97', 5: '97' }),
        };
      }
      return { status: 200, body: WACACO_SUGGESTIONS_BODY };
    };
    const connector = new GoogleAdsTransparencyConnector(countingFetch, { maxPagesPerAdvertiser: 3 });
    const page = await connector.research(mkRequest());
    expect(calls).toBe(3); // hard page cap held
    expect(page.ads.length).toBe(2); // identical pages deduped by creative id
    const budget = page.coverage.find((c) => c.slice === 'request-budget:google-ads-transparency');
    expect(budget?.note).toContain('4 bounded RPC call(s)'); // 1 suggestions + 3 creatives
  });

  it('capability declaration is research-only (no publish/analytics leak)', () => {
    const connector = new GoogleAdsTransparencyConnector(healthyFetch);
    expect(connector.meta.capabilities.research).toBe(true);
    expect(connector.meta.capabilities.publishing).toBe(false);
    expect(connector.meta.capabilities.analytics).toBe(false);
    expect(connector.meta.capabilities.paidAds).toBe(false);
    expect(connector.publish).toBeUndefined();
    expect(connector.meta.authModel).toBe('public');
    expect(connector.meta.supportedRegions).toContain('US');
  });
});
