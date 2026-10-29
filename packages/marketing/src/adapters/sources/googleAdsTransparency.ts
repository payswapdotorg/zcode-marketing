/**
 * Google Ads Transparency Center connector — the first VERIFIED real paid-side
 * (ad-intelligence) source of the marketing domain (W1-3(b) subject).
 *
 * Access path (keyless, public, no account; verified 2026-10-29):
 *   The Ads Transparency Center (https://adstransparency.google.com) is Google's
 *   public transparency service for ads that ran on Google surfaces (Search,
 *   YouTube, Display and partner inventory). The connector calls the same public
 *   data endpoints the site itself serves to every visitor — no authentication,
 *   no cookies, no account, no bypassing of any access control:
 *     - SearchService/SearchSuggestions — advertiser discovery by name with
 *       advertiser id, advertiser country, ad-count range and verified flag
 *     - SearchService/SearchCreatives — the ads of one advertiser in one region:
 *       creative id, creative preview/image URL, format code, first/last shown
 *   Both respond to POST with an `f.req=` urlencoded JSON envelope (the site's
 *   own wire format, captured and verified live — see evidence file).
 *
 * Honesty rules encoded here (docs/marketing/MARKETING-DATA-SOURCES.md):
 *   - the wire format is the public service's own data channel, NOT an officially
 *     documented API: stable as verified today, may drift — the connector maps
 *     unknown shapes to explicit schema_drift/unavailable coverage, never to
 *     invented data; the official-API growth path for ad intelligence stays open
 *     (Meta Ad Library API once credentials exist);
 *   - capabilities.research ONLY — analytics/publishing/scheduling/paidAds are
 *     not declared, so those operations do not exist on this connector;
 *   - pagination is capped per advertiser and every RPC call is counted and
 *     reported in a coverage slice (bounded, rate-limit friendly; a 429 is an
 *     honest `restricted` slice with a retry hint, never a silent gap);
 *   - the serving surface (Search vs YouTube vs Display) is NOT exposed per
 *     creative → platform is recorded as 'other' and every format is prefixed
 *     'google-ads:'; per-creative region lists are not exposed either;
 *   - first/last shown dates are PLATFORM-REPORTED delivery metadata → stored
 *     in availableMetadata, strictly distinct from our own observation
 *     timestamps (firstObservedAt/lastObservedAt are when WE observed);
 *   - impressions/spend/ROAS/targeting are NOT exposed by the source → explicit
 *     `unavailable` slices, so no conclusion may rest on them;
 *   - an advertiser that cannot be resolved, or a mission region outside the
 *     verified geo map, is a coverage gap — never a hard failure of the whole
 *     research run (organic children keep their own results).
 *
 * Layer: adapters — all network I/O lives here and nowhere else.
 */
import type { AdCreative, CompetitorCandidate } from '../../domain/records.js';
import type {
  ConnectorMeta,
  CoverageSlice,
  MarketingConnector,
  ResearchPage,
  ResearchRequest,
} from '../../app/ports.js';
import { ConnectorFailure } from '../../app/ports.js';

/**
 * Injectable POST fetch so fixture tests never hit the network (conformance
 * rule 1). Receives the already-encoded urlencoded body the wire format uses.
 */
export type TransparencyFetchLike = (url: string, body: string) => Promise<{ status: number; body: string }>;

const defaultFetch: TransparencyFetchLike = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-same-domain': '1',
      'user-agent': 'zcode-marketing-verification/0.1 (public transparency endpoints only)',
    },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  return { status: res.status, body: await res.text() };
};

/**
 * Google geo criterion ids, live-verified 2026-10-29 (one SearchSuggestions
 * probe per region; see evidence/2026-10-29-w1-ad-source-google-atc.txt).
 * Regions NOT in this map are an honest `restricted` coverage gap — extend the
 * map only after a recorded live verification, never speculatively.
 */
export const ATC_GEO_IDS: Readonly<Record<string, number>> = {
  US: 2840,
  GB: 2826,
  CA: 2124,
  AU: 2036,
  DE: 2276,
  FR: 2504,
  JP: 2392,
  HK: 2604,
};

const SUGGESTIONS_URL = 'https://adstransparency.google.com/anji/_/rpc/SearchService/SearchSuggestions?authuser=';
const CREATIVES_URL = 'https://adstransparency.google.com/anji/_/rpc/SearchService/SearchCreatives?authuser=';

/** Wire-version marker: bump when the observed envelope changes (drift guard). */
const WIRE_VERSION = 'atc-wire-2026-10-29';

const meta: ConnectorMeta = {
  id: 'connector:google-ads-transparency',
  version: '0.1.0',
  platform: 'other',
  capabilities: {
    research: true,
    analytics: false,
    publishing: false,
    scheduling: false,
    paidAds: false,
  },
  authModel: 'public',
  verificationRef:
    'MARKETING-DATA-SOURCES.md#google-ads-transparency-center (verified 2026-10-29, evidence/2026-10-29-w1-ad-source-google-atc.txt)',
  supportedRegions: Object.keys(ATC_GEO_IDS),
  expectedFreshness: 'live service; per-ad first/last shown dates are platform-reported',
  retentionNote:
    'public archive of ads that ran on Google surfaces; no impressions/spend/targeting, no per-creative surface split; wire format is the public service data channel (unofficial, may drift)',
};

interface AdvertiserSuggestion {
  name: string;
  advertiserId: string;
  country?: string;
  adCountMin?: number;
  adCountMax?: number;
  verified?: boolean;
}

interface WireCreative {
  advertiserId: string;
  creativeId: string;
  formatCode?: number;
  advertiserName?: string;
  previewUrl?: string;
  imageUrl?: string;
  platformFirstShownSec?: number;
  platformLastShownSec?: number;
  platformActivitySignal?: number;
}

/** f.req envelope, exactly as the public service itself sends it. */
const encodeEnvelope = (payload: unknown): string => `f.req=${encodeURIComponent(JSON.stringify(payload))}`;

const numOrUndefined = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined;

const isoFromWireSeconds = (v: unknown): string | undefined => {
  const sec = numOrUndefined(v);
  if (sec === undefined || sec <= 0) return undefined;
  return new Date(sec * 1000).toISOString();
};

const FORMAT_NAMES: Record<number, string> = {
  1: 'display image',
  2: 'html5 display',
  3: 'html5 display (versioned assets)',
};

export class GoogleAdsTransparencyConnector implements MarketingConnector {
  readonly meta = meta;

  constructor(
    private readonly fetchLike: TransparencyFetchLike = defaultFetch,
    private readonly opts: { pageSize?: number; maxPagesPerAdvertiser?: number; suggestionLimit?: number } = {},
  ) {
    this.pageSize = opts.pageSize ?? 40;
    this.maxPagesPerAdvertiser = opts.maxPagesPerAdvertiser ?? 3;
    this.suggestionLimit = opts.suggestionLimit ?? 10;
  }

  private readonly pageSize: number;
  private readonly maxPagesPerAdvertiser: number;
  private readonly suggestionLimit: number;

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    try {
      const suggestions = await this.searchSuggestions('Nespresso', ATC_GEO_IDS.US!);
      const first = suggestions.find((s) => s.advertiserId.startsWith('AR'));
      return {
        ok: first !== undefined,
        detail:
          first !== undefined
            ? `public transparency service reachable — suggestion '${first.name}' (${first.advertiserId}) resolved without credentials`
            : 'service reachable but no advertiser suggestion returned',
      };
    } catch (err) {
      return { ok: false, detail: `transparency service unreachable: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  async research(request: ResearchRequest): Promise<ResearchPage> {
    const retrievedAt = new Date().toISOString();
    const ads: AdCreative[] = [];
    const coverage: CoverageSlice[] = [];
    const seenCreativeIds = new Set<string>();
    let rpcCalls = 0;

    const country = request.country.trim().toUpperCase();
    const geoId = ATC_GEO_IDS[country];

    if (geoId === undefined) {
      coverage.push({
        slice: 'paid-ads-region-scope:google-ads-transparency',
        state: 'restricted',
        sourceId: meta.id,
        connectorVersion: meta.version,
        region: country,
        note: `region '${request.country}' is outside the verified ATC geo map (${Object.keys(ATC_GEO_IDS).join(', ')}); extend the map only after a recorded live verification — no paid data invented`,
      });
      for (const competitor of request.competitors) {
        coverage.push(this.gapSlice(competitor.displayName, `region '${request.country}' not in the verified geo map`));
      }
    } else {
      for (const competitor of request.competitors) {
        try {
          rpcCalls += 1;
          const { best, all } = await this.resolveAdvertiser(competitor.displayName, geoId);
          const { creatives, reportedTotal, pages } = await this.fetchCreatives(best.advertiserId, geoId);
          rpcCalls += pages;

          let unmappedFormats = 0;
          for (const creative of creatives) {
            const record = this.toAdCreative(creative, request.missionId, country, retrievedAt);
            if (!record) continue;
            if (FORMAT_NAMES[creative.formatCode ?? -1] === undefined) unmappedFormats += 1;
            if (seenCreativeIds.has(record.id)) continue;
            seenCreativeIds.add(record.id);
            ads.push(record);
          }

          const countRange =
            best.adCountMin !== undefined && best.adCountMax !== undefined
              ? `~${best.adCountMin}-${best.adCountMax} ads reported`
              : 'ad-count range not reported';
          const window = this.reportedWindow(creatives);
          coverage.push({
            slice: `paid-ads:${competitor.displayName}`,
            state: ads.length > 0 || creatives.length > 0 ? 'available' : 'unavailable',
            sourceId: meta.id,
            connectorVersion: meta.version,
            region: country,
            dateWindow: window,
            note:
              creatives.length > 0
                ? `resolved to '${best.name}' (${best.advertiserId}${best.country ? `, ${best.country}` : ''}${best.verified ? ', verified advertiser' : ''}); ${countRange}; service reported ${reportedTotal ?? 'unknown'} total; ingested first ${creatives.length} creative(s) over ${pages} bounded page(s)${all.length > 1 ? `; ${all.length - 1} alternate suggestion(s) not chosen` : ''}`
                : `resolved to '${best.name}' (${best.advertiserId}) but the service reports no ads for region ${country} — recorded honestly, not a failure`,
          });
          if (unmappedFormats > 0) {
            coverage.push({
              slice: `paid-ad-format-map:${competitor.displayName}`,
              state: 'partial',
              sourceId: meta.id,
              connectorVersion: meta.version,
              note: `${unmappedFormats} creative(s) carry a format code outside the verified map — format recorded as 'google-ads: format code N (unmapped)' with raw fields preserved`,
            });
          }
        } catch (err) {
          if (err instanceof ConnectorFailure) {
            const e = err.error;
            const detail =
              e.kind === 'schema_drift'
                ? `schema_drift — expected wire ${e.expectedVersion}, got ${e.gotVersion}`
                : 'detail' in e && e.detail
                  ? e.detail
                  : e.kind;
            coverage.push(this.gapSlice(competitor.displayName, detail));
            continue;
          }
          throw err;
        }
      }
    }

    // Honest, structural limitations of this source — stated on every page.
    coverage.push(
      {
        slice: 'paid-delivery-metrics:google-ads-transparency',
        state: 'unavailable',
        sourceId: meta.id,
        connectorVersion: meta.version,
        note: 'the transparency service exposes no impressions, spend, clicks or conversions — no ROAS/performance conclusion may rest on this source',
      },
      {
        slice: 'paid-surface-split:google-ads-transparency',
        state: 'unavailable',
        sourceId: meta.id,
        connectorVersion: meta.version,
        note: 'per-creative serving surface (Search vs YouTube vs Display) is not exposed; creatives are recorded as platform "other" with google-ads:-prefixed formats',
      },
      {
        slice: 'paid-targeting:google-ads-transparency',
        state: 'unavailable',
        sourceId: meta.id,
        connectorVersion: meta.version,
        note: 'audience targeting / keywords are not exposed by the public transparency service',
      },
      {
        slice: 'wire-format-stability:google-ads-transparency',
        state: 'partial',
        sourceId: meta.id,
        connectorVersion: meta.version,
        note: `the f.req envelope (${WIRE_VERSION}) is the public service's own data channel, not a documented API; unknown shapes surface as explicit coverage gaps, never as invented data — official-API growth path stays open (Meta Ad Library, credentials pending)`,
      },
      {
        slice: 'request-budget:google-ads-transparency',
        state: 'available',
        sourceId: meta.id,
        connectorVersion: meta.version,
        note: `${rpcCalls} bounded RPC call(s) this run (page size ${this.pageSize}, page cap ${this.maxPagesPerAdvertiser} per advertiser) — rate-limit friendly by design`,
      },
    );

    return { ads, organic: [], metrics: [], coverage, accessMethod: 'publicTransparency' };
  }

  // publish()/analytics() intentionally do NOT exist: capabilities declare
  // research only (contract: publish() exists iff capabilities.publishing).

  private gapSlice(displayName: string, detail: string): CoverageSlice {
    return {
      slice: `paid-ads:${displayName}`,
      state: 'unavailable',
      sourceId: meta.id,
      connectorVersion: meta.version,
      note: `not resolvable through the public transparency service in this run: ${detail}`,
    };
  }

  /** Advertiser discovery: the service's own suggestion endpoint, by name. */
  private async searchSuggestions(query: string, geoId: number): Promise<AdvertiserSuggestion[]> {
    const payload = encodeEnvelope({
      1: query,
      2: this.suggestionLimit,
      3: this.suggestionLimit,
      4: [geoId],
      5: { 1: 1 },
    });
    const res = await this.fetchLike(SUGGESTIONS_URL, payload);
    if (res.status === 429) {
      throw new ConnectorFailure({ kind: 'rate_limited', quotaScope: 'google-ads-transparency', retryAfterMs: 60_000 });
    }
    if (res.status !== 200) {
      throw new ConnectorFailure({ kind: 'transient_network', retryable: res.status >= 500, attempt: 1 });
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(res.body) as Record<string, unknown>;
    } catch {
      throw new ConnectorFailure({ kind: 'schema_drift', expectedVersion: WIRE_VERSION, gotVersion: 'non-json' });
    }
    const entries = Array.isArray(parsed['1']) ? (parsed['1'] as unknown[]) : [];
    const suggestions: AdvertiserSuggestion[] = [];
    for (const entry of entries) {
      if (typeof entry !== 'object' || entry === null) continue;
      const adv = (entry as Record<string, unknown>)['1'];
      if (typeof adv !== 'object' || adv === null) continue;
      const a = adv as Record<string, unknown>;
      const name = typeof a['1'] === 'string' ? a['1'] : undefined;
      const advertiserId = typeof a['2'] === 'string' ? a['2'] : undefined;
      if (!name || !advertiserId) continue;
      const counts = (typeof a['4'] === 'object' && a['4'] !== null ? a['4'] : {}) as Record<string, unknown>;
      const range = (typeof counts['2'] === 'object' && counts['2'] !== null ? counts['2'] : {}) as Record<string, unknown>;
      suggestions.push({
        name,
        advertiserId,
        country: typeof a['3'] === 'string' ? a['3'] : undefined,
        adCountMin: numOrUndefined(range['1']),
        adCountMax: numOrUndefined(range['2']),
        verified: a['5'] === true,
      });
    }
    return suggestions;
  }

  /** Pick the best name match among the service's own suggestions — no invented identities. */
  private async resolveAdvertiser(
    displayName: string,
    geoId: number,
  ): Promise<{ best: AdvertiserSuggestion; all: AdvertiserSuggestion[] }> {
    const query = displayName.trim();
    if (query.length < 2) {
      throw new ConnectorFailure({
        kind: 'coverage_gap',
        coverageState: 'unavailable',
        detail: `competitor hint '${displayName}' is too short for advertiser-name resolution`,
      });
    }
    const suggestions = await this.searchSuggestions(query, geoId);
    if (suggestions.length === 0) {
      throw new ConnectorFailure({
        kind: 'coverage_gap',
        coverageState: 'unavailable',
        detail: `no advertiser suggestion for '${query}' in the searched region`,
      });
    }
    const lower = query.toLowerCase();
    const scored = suggestions
      .map((s) => {
        const name = s.name.toLowerCase();
        const score =
          name === lower ? 3 : name.startsWith(lower) || lower.startsWith(name) ? 2 : name.includes(lower) || lower.includes(name) ? 1 : 0;
        const midpoint = (s.adCountMin ?? 0) + (s.adCountMax ?? 0);
        return { s, score, midpoint };
      })
      .sort((a, b) => b.score - a.score || b.midpoint - a.midpoint);
    const bestScored = scored[0];
    if (!bestScored || bestScored.score <= 0) {
      throw new ConnectorFailure({
        kind: 'coverage_gap',
        coverageState: 'unavailable',
        detail: `no advertiser suggestion for '${query}' matches the name closely enough (best: '${scored[0]?.s.name ?? 'none'}')`,
      });
    }
    return { best: bestScored.s, all: suggestions };
  }

  private async fetchCreatives(
    advertiserId: string,
    geoId: number,
  ): Promise<{ creatives: WireCreative[]; reportedTotal?: number; pages: number }> {
    const creatives: WireCreative[] = [];
    let reportedTotal: number | undefined;
    let token: string | undefined;
    let pages = 0;
    for (let page = 0; page < this.maxPagesPerAdvertiser; page += 1) {
      const payload = encodeEnvelope({
        2: this.pageSize,
        3: {
          8: [geoId],
          12: { 1: '', 2: true },
          13: { 1: [advertiserId] },
        },
        ...(token ? { 4: token } : {}),
        7: { 1: 1, 2: 0, 3: 1 },
      });
      const res = await this.fetchLike(CREATIVES_URL, payload);
      pages += 1;
      if (res.status === 429) {
        throw new ConnectorFailure({ kind: 'rate_limited', quotaScope: 'google-ads-transparency', retryAfterMs: 60_000 });
      }
      if (res.status !== 200) {
        throw new ConnectorFailure({ kind: 'transient_network', retryable: res.status >= 500, attempt: page + 1 });
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(res.body) as Record<string, unknown>;
      } catch {
        throw new ConnectorFailure({ kind: 'schema_drift', expectedVersion: WIRE_VERSION, gotVersion: 'non-json' });
      }
      const list = parsed['1'];
      if (!Array.isArray(list)) {
        if (pages === 1 && Object.keys(parsed).length === 0) {
          // Empty object response: the service's own "no ads for this region".
          return { creatives: [], reportedTotal: undefined, pages };
        }
        throw new ConnectorFailure({ kind: 'schema_drift', expectedVersion: WIRE_VERSION, gotVersion: 'unknown-shape' });
      }
      for (const raw of list) {
        const mapped = this.mapWireCreative(raw);
        if (mapped) creatives.push(mapped);
      }
      if (reportedTotal === undefined) reportedTotal = numOrUndefined(parsed['4']);
      token = typeof parsed['2'] === 'string' && parsed['2'] !== '' ? (parsed['2'] as string) : undefined;
      if (!token) break;
    }
    return { creatives, reportedTotal, pages };
  }

  private mapWireCreative(raw: unknown): WireCreative | undefined {
    if (typeof raw !== 'object' || raw === null) return undefined;
    const c = raw as Record<string, unknown>;
    const advertiserId = typeof c['1'] === 'string' ? c['1'] : undefined;
    const creativeId = typeof c['2'] === 'string' ? c['2'] : undefined;
    if (!advertiserId || !creativeId) return undefined;
    const content = (typeof c['3'] === 'object' && c['3'] !== null ? c['3'] : {}) as Record<string, unknown>;
    const htmlContent = (typeof content['3'] === 'object' && content['3'] !== null ? content['3'] : {}) as Record<string, unknown>;
    const html5 = (typeof content['1'] === 'object' && content['1'] !== null ? content['1'] : {}) as Record<string, unknown>;
    const imgHtml = typeof htmlContent['2'] === 'string' ? htmlContent['2'] : undefined;
    const firstShown = (typeof c['6'] === 'object' && c['6'] !== null ? c['6'] : {}) as Record<string, unknown>;
    const lastShown = (typeof c['7'] === 'object' && c['7'] !== null ? c['7'] : {}) as Record<string, unknown>;
    return {
      advertiserId,
      creativeId,
      formatCode: numOrUndefined(c['4']),
      advertiserName: typeof c['12'] === 'string' ? c['12'] : undefined,
      previewUrl: typeof html5['4'] === 'string' ? html5['4'] : undefined,
      imageUrl: imgHtml ? (/src="([^"]+)"/.exec(imgHtml)?.[1] ?? undefined) : undefined,
      platformFirstShownSec: numOrUndefined(firstShown['1']),
      platformLastShownSec: numOrUndefined(lastShown['1']),
      platformActivitySignal: numOrUndefined(c['13']),
    };
  }

  private toAdCreative(
    creative: WireCreative,
    missionId: string,
    region: string,
    retrievedAt: string,
  ): AdCreative | undefined {
    const formatCode = creative.formatCode;
    const formatName = formatCode !== undefined ? FORMAT_NAMES[formatCode] : undefined;
    return {
      kind: 'AdCreative',
      id: `atc:${creative.creativeId}`,
      missionId,
      advertiserId: creative.advertiserId,
      source: {
        sourceId: 'google-ads-transparency',
        sourceRecordId: creative.creativeId,
        connectorVersion: meta.version,
      },
      platform: 'other',
      format:
        formatCode === undefined
          ? 'google-ads: format code unknown'
          : formatName !== undefined
            ? `google-ads: ${formatName}`
            : `google-ads: format code ${formatCode} (unmapped)`,
      firstObservedAt: retrievedAt,
      lastObservedAt: retrievedAt,
      variations: [],
      availableMetadata: {
        advertiserName: creative.advertiserName,
        advertiserId: creative.advertiserId,
        region,
        formatCode,
        imageUrl: creative.imageUrl,
        previewUrl: creative.previewUrl,
        platformReportedFirstShown: isoFromWireSeconds(creative.platformFirstShownSec),
        platformReportedLastShown: isoFromWireSeconds(creative.platformLastShownSec),
        platformReportedActivitySignal: creative.platformActivitySignal,
      },
    };
  }

  private reportedWindow(creatives: WireCreative[]): string | undefined {
    const starts = creatives
      .map((c) => isoFromWireSeconds(c.platformFirstShownSec))
      .filter((d): d is string => d !== undefined)
      .sort();
    const ends = creatives
      .map((c) => isoFromWireSeconds(c.platformLastShownSec))
      .filter((d): d is string => d !== undefined)
      .sort();
    if (starts.length === 0 || ends.length === 0) return undefined;
    return `${starts[0]!.slice(0, 10)}..${ends[ends.length - 1]!.slice(0, 10)} (platform-reported first/last shown)`;
  }
}

/** Candidate helper for verification runs (no invented relevance claims). */
export function advertiserCandidate(
  missionId: string,
  displayName: string,
  relevanceReason: string,
): CompetitorCandidate {
  return {
    kind: 'CompetitorCandidate',
    id: `candidate:${displayName}`,
    missionId,
    displayName,
    aliases: [],
    identityConfidence: 1,
    relevanceReason,
    evidence: [
      {
        ref: 'internal:verification-harness',
        accessMethod: 'internalReasoning',
        observedAt: new Date().toISOString(),
        supports: 'harness-selected public advertiser for access-path verification',
      },
    ],
    userConfirmed: false,
  };
}
