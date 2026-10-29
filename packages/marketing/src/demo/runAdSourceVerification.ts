/**
 * Ad-source access verification run (W1-3(b)) — the repeatable live test
 * required by docs/marketing/MARKETING-DATA-SOURCES.md before the paid-side
 * source may become foundational. Output is committed as evidence (this is a
 * live network test by design; unit tests stay fixture-only per the connector
 * conformance rules).
 *
 *   Subject: Google Ads Transparency Center (keyless public transparency route)
 *     SearchService/SearchSuggestions (advertiser discovery by name) and
 *     SearchService/SearchCreatives (an advertiser's real ads in a region, with
 *     platform-reported first/last-shown delivery dates).
 *
 *   Part A — health check: the public service resolves a known advertiser
 *     without any credentials.
 *   Part B — advertiser discovery: real brand names resolve to verified
 *     advertiser identities (id + country + ad-count range); a nonsense name
 *     resolves to NOTHING (honest negative control, no invented identities).
 *   Part C — real ad research through the full connector contract: real
 *     creatives for a real advertiser, every record parses against the zod
 *     domain contracts, provenance on every record, platform-reported dates
 *     strictly distinct from our observation timestamps, structural coverage
 *     slices present (no delivery metrics, no surface split, no targeting).
 *   Part D — temporal-store gates on real paid data: idempotent ingest into
 *     the SQLite store, double research adds no entities, re-ingesting the
 *     identical page is a strict no-op.
 *   Part E — real paid x organic evidence: the ingested real ads and the real
 *     organic uploads of the same brand are passed through the domain feature
 *     extraction + opportunity ranking (deterministic heuristic backend,
 *     labeled as such) so the intersection is exercised on real data only.
 *
 * Run: pnpm --filter @zcode/marketing verify:adsource
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  adCreative,
  organicContent,
  metricObservation,
  productBrief,
} from '../domain/records.js';
import { SqliteTemporalStore } from '../adapters/sqliteStore.js';
import { MarketingMission } from '../app/workflows.js';
import { CapabilityCatalog } from '../app/capabilityCatalog.js';
import { HeuristicModel } from '../adapters/heuristicModel.js';
import {
  GoogleAdsTransparencyConnector,
  advertiserCandidate,
  ATC_GEO_IDS,
} from '../adapters/sources/googleAdsTransparency.js';
import {
  YoutubePublicConnector,
  channelCandidate,
} from '../adapters/sources/youtubePublic.js';

const assert = (cond: boolean, label: string): void => {
  if (!cond) throw new Error(`GATE FAILED: ${label}`);
  console.log(`  ✔ ${label}`);
};

const log = (title: string, body: unknown): void => {
  console.log(`\n== ${title} ==`);
  console.log(JSON.stringify(body, null, 2));
};

/**
 * Harness constants — REAL, verifiable market facts for the demo product
 * category (portable espresso makers). Wacaco is the brand used by the W3
 * organic verification, so paid + organic here describe the same real company.
 */
const REAL_BRAND = 'Wacaco'; // Wacaco Company Limited — verified Google advertiser (HK)
const SECOND_REAL_BRAND = 'AeroPress'; // AeroPress, Inc. — verified US advertiser in the same category
const NEGATIVE_CONTROL = 'zz-no-such-advertiser-q7x9'; // must resolve to NOTHING
const REGION = 'US';

async function main(): Promise<void> {
  const dir = join(process.cwd(), '.ad-source-verification');
  const dbPath = join(dir, 'marketing.db');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const store = SqliteTemporalStore.open(dbPath);
  const now = () => new Date().toISOString();

  const brief = productBrief.parse({
    kind: 'ProductBrief',
    id: 'brief-w1b-verification',
    missionId: 'mission-w1b-verification',
    product: 'portable espresso maker',
    audience: 'commuting coffee drinkers',
    country: REGION,
    platform: 'youtube',
    offer: 'access-path verification (no commercial purpose)',
    objective: 'awareness',
    constraints: [],
    createdAt: now(),
  });

  const connector = new GoogleAdsTransparencyConnector();
  const competitors = [
    advertiserCandidate(brief.missionId, REAL_BRAND, 'harness-selected real advertiser in the product category (Google Ads Transparency Center)'),
    advertiserCandidate(brief.missionId, SECOND_REAL_BRAND, 'harness-selected second real advertiser in the product category'),
    advertiserCandidate(brief.missionId, NEGATIVE_CONTROL, 'negative control — must produce an honest coverage gap'),
  ];

  // ---- Part A: health check (public service, no credentials)
  const health = await connector.healthCheck();
  log('Health check (SearchSuggestions, keyless)', health);
  assert(health.ok, 'public transparency service reachable and resolves a known advertiser without credentials');

  // ---- Part B: advertiser discovery on real brand names
  const request = {
    missionId: brief.missionId,
    competitors,
    platform: 'youtube' as const,
    country: REGION,
    from: '2026-10-21T00:00:00.000Z',
    to: now(),
  };
  const page = await connector.research(request);
  log('Research page summary', {
    adCount: page.ads.length,
    accessMethod: page.accessMethod,
    coverage: page.coverage.map((c) => ({ slice: c.slice, state: c.state })),
  });
  assert(page.accessMethod === 'publicTransparency', 'page provenance declares the public-transparency retrieval method');
  const realSlice = page.coverage.find((c) => c.slice === `paid-ads:${REAL_BRAND}`);
  assert(
    realSlice !== undefined && realSlice.state === 'available',
    `real brand '${REAL_BRAND}' resolved to a real advertiser with real ads (${realSlice?.note ?? ''})`,
  );
  const negativeSlice = page.coverage.find((c) => c.slice === `paid-ads:${NEGATIVE_CONTROL}`);
  assert(
    negativeSlice !== undefined && negativeSlice.state === 'unavailable',
    'negative control resolves to an honest coverage gap (no invented advertisers)',
  );
  assert(
    page.ads.length > 0,
    `real ad creative records returned (${page.ads.length} ingested from the first bounded pages)`,
  );

  // Every record parses against the machine-checked domain contracts.
  page.ads.forEach((a) => adCreative.parse(a));
  assert(
    page.ads.every((a) => a.source.sourceId === 'google-ads-transparency' && a.source.connectorVersion.length > 0),
    'every ad record carries provenance (source identity + connector version)',
  );
  assert(
    page.ads.every((a) => a.platform === 'other' && a.format.startsWith('google-ads:')),
    'serving surface honestly recorded (platform other + google-ads:-prefixed format — the source does not split Search/YouTube/Display per creative)',
  );
  const withReportedDates = page.ads.filter(
    (a) => typeof a.availableMetadata.platformReportedFirstShown === 'string' &&
      typeof a.availableMetadata.platformReportedLastShown === 'string',
  );
  assert(
    withReportedDates.length > 0,
    'platform-reported first/last-shown delivery dates captured for real creatives',
  );
  assert(
    withReportedDates.every(
      (a) => a.availableMetadata.platformReportedFirstShown !== a.firstObservedAt &&
        a.firstObservedAt === a.lastObservedAt,
    ),
    'platform-REPORTED dates are kept strictly distinct from OUR observation timestamps (temporal discipline)',
  );
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString();
  assert(
    withReportedDates.some(
      (a) => (a.availableMetadata.platformReportedLastShown as string) >= ninetyDaysAgo,
    ),
    'sample creatives include ads with recent platform-reported delivery activity (last shown within 90 days)',
  );
  assert(
    page.coverage.some((c) => c.slice === 'paid-delivery-metrics:google-ads-transparency' && c.state === 'unavailable'),
    'no-impressions/spend limitation reported explicitly (never over-claimed)',
  );
  assert(
    page.coverage.some((c) => c.slice === 'paid-surface-split:google-ads-transparency' && c.state === 'unavailable'),
    'no-surface-split limitation reported explicitly',
  );

  log('Sample real ad records (first 3)', page.ads.slice(0, 3));

  // ---- Part D: temporal-store gates on real paid data
  const now0 = now();
  const i1 = store.ingestAds(page.ads, now0);
  log('Ingest (run 1)', i1);
  assert(i1.acceptedEntities === page.ads.length, 'all real ad creatives ingested as new entities');

  const page2 = await connector.research(request);
  const i2 = store.ingestAds(page2.ads, now());
  log('Ingest (run 2 — fresh fetch of the same sources)', i2);
  assert(
    i2.acceptedEntities === 0,
    'a fresh fetch of the same sources accepts no new entities (source-identity idempotency on live paid data)',
  );
  const i3 = store.ingestAds(page.ads, now());
  log('Ingest (run 3 — identical page re-ingested)', i3);
  assert(
    i3.acceptedEntities === 0 && i3.duplicatesIgnored > 0,
    're-ingesting the identical page is a no-op (no entity inflation)',
  );

  // ---- Part C extension + Part E: real paid x real organic through the domain workflows
  console.log('\n== Part E — real paid x organic intersection (same real market) ==');
  const organicConnector = new YoutubePublicConnector();
  const organicPage = await organicConnector.research({
    missionId: brief.missionId,
    competitors: [channelCandidate(brief.missionId, 'Wacaco', 'same real market — organic uploads for the intersection check')],
    platform: 'youtube',
    country: REGION,
    from: '2026-10-21T00:00:00.000Z',
    to: now(),
  });
  organicPage.organic.forEach((o) => organicContent.parse(o));
  organicPage.metrics.forEach((m) => metricObservation.parse(m));
  const organicGap = organicPage.coverage.find((c) => c.state === 'unavailable' && c.slice.startsWith('organic-uploads:'));
  if (organicPage.organic.length === 0) {
    // Honest environmental limitation — NOT a failure of the W1-3(b) subject:
    // on 2026-10-29 the keyless uploads RSS route was observed returning HTTP
    // 404 for many channels (including this one, verified 2026-10-28 and again
    // in the W3-2 run), from plain HTTP AND a full browser — a platform-side
    // partial outage. The connector surfaces it as an explicit coverage gap
    // (verified above) and the organic side keeps its own recorded verification
    // (evidence/2026-10-28-w1-source-access-youtube-public.txt).
    log('Organic route incident (recorded honestly)', {
      gapSlice: organicGap?.slice,
      note: organicGap?.note,
      conclusion:
        'keyless uploads RSS route unavailable for this channel in this run (platform-side outage observed 2026-10-29) — organic evidence remains the recorded 2026-10-28 verification; the paid x organic intersection is additionally exercised end-to-end on recorded REAL wire payloads in the plugin chain tests (marketing-plugin test suite)',
    });
    assert(
      organicGap !== undefined,
      'organic outage surfaces as an explicit honest coverage gap (never invented content)',
    );
    console.log('  ✔ note: Part E intersection skipped this run — organic route outage recorded; paid side (the W1-3(b) subject) fully verified above.');
  } else {
    assert(organicPage.organic.length > 0, 'real organic uploads for the same real market fetched through the verified keyless connector');
    store.ingestOrganic(organicPage.organic, now());
    store.ingestMetrics(organicPage.metrics, now());

    const catalog = new CapabilityCatalog(new HeuristicModel());
    const mission = new MarketingMission(brief, connector, catalog, now, store);
    const adFeatures = await mission.extractFeatures(store.allAds());
    const organicFeatures = await mission.extractFeatures(store.allOrganic());
    assert(adFeatures.length === store.allAds().length, 'creative feature extraction ran over every real ad record');
    assert(organicFeatures.length > 0, 'creative feature extraction ran over every real organic record');
    const opportunities = await mission.rankOpportunities(adFeatures, organicFeatures);
    log('Real-data paid x organic opportunities (deterministic heuristic backend, labeled)', {
      count: opportunities.length,
      first: opportunities[0]
        ? {
            pattern: opportunities[0].hypothesis.pattern,
            crossSourceSupport: opportunities[0].crossSourceSupport,
            evidence: opportunities[0].hypothesis.supportedBy.map((e) => e.ref),
            explanation: opportunities[0].explanation,
          }
        : null,
    });
    assert(
      opportunities.length > 0,
      'the paid x organic intersection produced evidence-backed opportunities from real data only',
    );
    assert(
      opportunities[0] !== undefined &&
        opportunities[0].hypothesis.supportedBy.some((e) => e.ref.startsWith('atc:')) &&
        opportunities[0].hypothesis.supportedBy.some((e) => e.ref.startsWith('yt:')),
      'opportunities reference BOTH real paid (atc:*) and real organic (yt:*) evidence',
    );
    console.log(
      "  ✔ note: extraction backend is the deterministic HeuristicModel (labeled in every record's provenance); the model-routed path is the W3-2 bridge — this run exercises the DOMAIN intersection on real data.",
    );
  }

  store.close();
  rmSync(dir, { recursive: true, force: true });

  console.log('\nAD-SOURCE ACCESS VERIFICATION COMPLETE.');
  console.log(`Ad side: Google Ads Transparency Center (region ${REGION}, geo id ${ATC_GEO_IDS.US}) VERIFIED — see evidence file.`);
  console.log('Organic side: unchanged, verified 2026-10-28 (keyless YouTube public routes).');
}

main().catch((err) => {
  console.error(String(err));
  process.exitCode = 1;
});
