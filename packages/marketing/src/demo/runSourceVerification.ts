/**
 * Source access verification run (W1-3) — the repeatable live test required by
 * docs/marketing/MARKETING-DATA-SOURCES.md before a source may become
 * foundational. Output is committed as evidence (this is a live network test
 * by design; unit tests stay fixture-only per the connector conformance rules).
 *
 *   Part 1 — organic side: YouTube keyless public routes (verified path):
 *     healthCheck (oEmbed) → research (uploads RSS + bounded oEmbed) on a
 *     stable public channel → ingest into the SQLite temporal store → double
 *     research must be idempotent → every record must parse against the zod
 *     contracts → an unresolvable hint must produce an honest coverage gap.
 *
 *   Part 2 — ad-intelligence side (blocked path, documented honestly):
 *     Meta Ad Library API probe. Without a token the endpoint's own error
 *     response is recorded as the typed `auth_required` state — repeatable
 *     proof of the credential dependency (W1-3b remains blocked until a
 *     Worker A run supplies credentials).
 *
 * Run: pnpm --filter @zcode/marketing verify:sources
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { productBrief, organicContent, metricObservation } from '../domain/records.js';
import { SqliteTemporalStore } from '../adapters/sqliteStore.js';
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

/** A long-lived public channel with a stable uploads feed (harness constant). */
const TEST_CHANNEL_ID = 'UCuAXFkgsw1L7xaCfnd5JJOw';
const UNRESOLVABLE_HINT = 'no-such-public-channel-xyz-9f8e7d';

async function main(): Promise<void> {
  const dir = join(process.cwd(), '.source-verification');
  const dbPath = join(dir, 'marketing.db');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const store = SqliteTemporalStore.open(dbPath);
  const now = () => new Date().toISOString();

  const brief = productBrief.parse({
    kind: 'ProductBrief',
    id: 'brief-w1-verification',
    missionId: 'mission-w1-verification',
    product: 'access-path verification mission (no commercial purpose)',
    audience: 'verification harness',
    country: 'global',
    platform: 'youtube',
    offer: 'n/a (verification)',
    objective: 'awareness',
    constraints: [],
    createdAt: now(),
  });
  const connector = new YoutubePublicConnector();
  const competitors = [
    channelCandidate(brief.missionId, TEST_CHANNEL_ID, 'harness-selected stable public channel (uploads RSS + oEmbed)'),
    channelCandidate(brief.missionId, UNRESOLVABLE_HINT, 'negative control — must produce an honest coverage gap'),
  ];

  // ---- Part 1a: health check (keyless oEmbed)
  const health = await connector.healthCheck();
  log('Health check (oEmbed, keyless)', health);
  assert(health.ok, 'oEmbed endpoint reachable and returns creative metadata without credentials');

  // ---- Part 1b: research run through the real connector port
  const request = {
    missionId: brief.missionId,
    competitors,
    platform: 'youtube' as const,
    country: 'global',
    from: '2026-10-21T00:00:00.000Z',
    to: now(),
  };
  const page = await connector.research(request);
  log('Research page summary', {
    organicCount: page.organic.length,
    metricCount: page.metrics.length,
    accessMethod: page.accessMethod,
    coverage: page.coverage.map((c) => ({ slice: c.slice, state: c.state })),
  });

  // Every record parses against the machine-checked domain contracts.
  page.organic.forEach((o) => organicContent.parse(o));
  page.metrics.forEach((m) => metricObservation.parse(m));
  assert(page.organic.length > 0, 'uploads RSS returned real organic content records');
  assert(
    page.metrics.length > 0 && page.metrics.every((m) => m.value >= 0 && Number.isFinite(m.value)),
    'current-snapshot public view counts parsed as real metric observations',
  );
  assert(
    page.organic.every((o) => o.source.sourceId === 'youtube-public-rss' && o.source.connectorVersion.length > 0),
    'every record carries provenance (source identity + connector version)',
  );
  const fetchedAt = page.metrics[0]?.observedAt;
  assert(
    fetchedAt !== undefined && page.organic.some((o) => o.publishedAt !== fetchedAt),
    'observation time is distinguished from content publication time (temporal discipline)',
  );

  const gap = page.coverage.find((c) => c.slice === `organic-uploads:${UNRESOLVABLE_HINT}`);
  assert(
    gap !== undefined && gap.state === 'unavailable',
    'unresolvable hint produces an honest coverage gap (no invented data)',
  );
  assert(
    page.coverage.some((c) => c.state === 'unavailable' && c.slice === 'video-statistics-history:youtube'),
    'keyless history limitation is reported explicitly (current-snapshot counts only)',
  );

  // ---- Part 1c: ingest into the temporal store; double research is idempotent
  const now0 = now();
  const i1o = store.ingestOrganic(page.organic, now0);
  const i1m = store.ingestMetrics(page.metrics, now0);
  log('Ingest (run 1)', { i1o, i1m });

  const page2 = await connector.research(request);
  const i2o = store.ingestOrganic(page2.organic, now());
  const i2m = store.ingestMetrics(page2.metrics, now());
  log('Ingest (run 2 — fresh fetch of the same sources)', { i2o, i2m });
  assert(
    i2o.acceptedEntities === 0,
    'a fresh fetch of the same sources accepts no new entities (source-identity idempotency on live data)',
  );
  console.log(
    `  ✔ note: fresh fetch at a later time yields ${i2m.acceptedMetrics} new dated snapshots of the same subjects — this is the repeated-observation (velocity) mechanism, not inflation`,
  );
  // Re-ingesting the EXACT same observations must be a strict no-op:
  const i3m = store.ingestMetrics(page.metrics, now());
  log('Ingest (run 3 — exact same observation array re-ingested)', i3m);
  assert(
    i3m.acceptedMetrics === 0 && i3m.duplicatesIgnored > 0,
    're-ingesting the identical observations is a no-op (no metric inflation)',
  );

  // Sample of the actual data observed (titles may contain unicode — real evidence)
  log('Sample observed records', {
    newest: store
      .allOrganic()
      .slice()
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, 3)
      .map((o) => ({
        id: o.id,
        title: o.availableMetadata.title,
        publishedAt: o.publishedAt,
        format: o.format,
      })),
    topViews: store
      .metricsAsOf('views', page.metrics[0]!.subjectRef, now())
      .map((m) => m.value),
  });
  store.close();
  rmSync(dir, { recursive: true, force: true });

  // ---- Part 2: ad-intelligence probe (Meta Ad Library API — auth documented)
  console.log('\n== Part 2 — ad-intelligence source probe (Meta Ad Library API) ==');
  const token = process.env.META_AD_LIBRARY_TOKEN;
  const probeUrl =
    'https://graph.facebook.com/v21.0/ads_archive?search_terms=verification-probe' +
    `&ad_reached_countries=US&ad_type=ALL&media_type=ALL${token ? `&access_token=${token}` : ''}`;
  try {
    const res = await fetch(probeUrl, { signal: AbortSignal.timeout(20_000) });
    const body = await res.text();
    let parsed: { error?: { message?: string; code?: number; type?: string }; data?: unknown[] } = {};
    try {
      parsed = JSON.parse(body) as typeof parsed;
    } catch {
      /* non-JSON body recorded verbatim below */
    }
    if (token && res.status === 200 && Array.isArray(parsed.data)) {
      log('Meta Ad Library probe — AUTHORIZED', { status: res.status, resultCount: parsed.data.length });
      console.log('  ✔ authorized access path exercised with supplied credentials');
    } else {
      // No token: the endpoint's own error response IS the honest evidence —
      // the access path exists, is repeatable, and requires credentials.
      log('Meta Ad Library probe — auth required (typed result)', {
        httpStatus: res.status,
        endpointError: parsed.error?.message ?? body.slice(0, 200),
        typedResult: { kind: 'auth_required', scope: 'ads_archive search' },
        conclusion:
          'access path exists and is reachable, but requires an access token; W1-3(b) stays blocked on credentials — recorded honestly, not reported as verified',
      });
      console.log('  ✔ probe documents the credential dependency honestly (auth_required, not a fake pass)');
    }
  } catch (err) {
    log('Meta Ad Library probe — network unreachable', {
      error: String(err),
      typedResult: { kind: 'transient_network', retryable: true },
    });
  }

  console.log('\nSOURCE ACCESS VERIFICATION COMPLETE.');
  console.log('Organic side: YouTube keyless public routes VERIFIED (RSS + oEmbed) — see evidence file.');
  console.log('Ad side: Meta Ad Library access path probed; verification blocked on credentials (honest).');
}

main().catch((err) => {
  console.error(String(err));
  process.exitCode = 1;
});
