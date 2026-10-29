/**
 * YouTube public-data connector — the first real (non-sample) connector of the
 * marketing domain layer, and the W1 access-verification subject for the
 * organic side (docs/marketing/MARKETING-DATA-SOURCES.md).
 *
 * Access path (keyless, documented, public):
 *   - oEmbed:    https://www.youtube.com/oembed?url=<video>&format=json
 *     creative metadata (title, author, thumbnail) for one public video
 *   - uploads RSS: https://www.youtube.com/feeds/videos.xml?channel_id=<id>
 *     the channel's recent uploads with current public view counts
 *   - channel page canonical id: https://www.youtube.com/@<handle>
 *     resolves a handle to its stable channel id (externalId)
 *
 * Honesty rules encoded here (PLATFORM-CONNECTOR-CONTRACT.md):
 *   - capabilities.research ONLY — analytics/publishing/scheduling/paidAds are
 *     not declared, so those operations do not exist on this connector;
 *   - the RSS feed exposes a CURRENT snapshot of view counts, not history;
 *     that limitation is reported as an explicit coverage slice;
 *   - a channel that cannot be resolved is a coverage_gap, never invented data;
 *   - no authenticated scraping, no bypassing of rate limits (one feed request
 *     per channel, bounded oEmbed sampling).
 *
 * Layer: adapters — all network I/O lives here and nowhere else.
 */
import type {
  MetricObservation,
  OrganicContent,
} from '../../domain/records.js';
import type {
  ConnectorMeta,
  MarketingConnector,
  ResearchPage,
  ResearchRequest,
} from '../../app/ports.js';
import { ConnectorFailure } from '../../app/ports.js';
import type { CompetitorCandidate } from '../../domain/records.js';

/** Injectable fetch so fixture tests never hit the network (conformance rule 1). */
export type FetchLike = (url: string) => Promise<{ status: number; body: string }>;

const defaultFetch: FetchLike = async (url) => {
  const res = await fetch(url, {
    headers: { 'user-agent': 'zcode-marketing-verification/0.1 (public endpoints only)' },
    signal: AbortSignal.timeout(20_000),
  });
  return { status: res.status, body: await res.text() };
};

const meta: ConnectorMeta = {
  id: 'connector:youtube-public',
  version: '0.1.0',
  platform: 'youtube',
  capabilities: {
    research: true,
    analytics: false,
    publishing: false,
    scheduling: false,
    paidAds: false,
  },
  authModel: 'public',
  verificationRef:
    'MARKETING-DATA-SOURCES.md#youtube-public-metadata (verified 2026-10-28, evidence/2026-10-28-w1-source-access-youtube-public.txt)',
  supportedRegions: ['global'],
  expectedFreshness: 'uploads RSS: near-real-time; oEmbed: on-demand',
  retentionNote:
    'keyless public endpoints only; the feed carries a rolling window of recent uploads (~15) and current-snapshot view counts, not full history',
};

interface RssEntry {
  videoId: string;
  channelId: string;
  title: string;
  author: string;
  published: string;
  views: number;
  url: string;
  isShort: boolean;
}

const tag = (xml: string, name: string): string =>
  new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)?.[1]?.trim() ?? '';

const decodeEntities = (s: string): string =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const parseRss = (xml: string): RssEntry[] =>
  (xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? []).map((e) => ({
    videoId: tag(e, 'yt:videoId'),
    channelId: tag(e, 'yt:channelId'),
    title: decodeEntities(tag(e, 'title')),
    author: decodeEntities(tag(e, 'name')),
    published: tag(e, 'published'),
    views: Number(/<media:statistics views="(\d+)"/.exec(e)?.[1] ?? Number.NaN),
    url: /<link rel="alternate" href="([^"]+)"/.exec(e)?.[1] ?? '',
    isShort: /\/shorts\//.test(e),
  }));

const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;

export class YoutubePublicConnector implements MarketingConnector {
  readonly meta = meta;
  /** How many feed entries get oEmbed enrichment (bounded, rate-limit friendly). */
  private readonly oembedSampleSize: number;

  constructor(
    private readonly fetchLike: FetchLike = defaultFetch,
    opts: { oembedSampleSize?: number } = {},
  ) {
    this.oembedSampleSize = opts.oembedSampleSize ?? 1;
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    try {
      const json = await this.oembed('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      return {
        ok: typeof json.title === 'string' && json.title.length > 0,
        detail: `oEmbed healthy — sample title: ${String(json.title).slice(0, 60)}`,
      };
    } catch (err) {
      return { ok: false, detail: String(err) };
    }
  }

  async research(request: ResearchRequest): Promise<ResearchPage> {
    const organic: OrganicContent[] = [];
    const metrics: MetricObservation[] = [];
    const coverage: ResearchPage['coverage'] = [];
    const retrievedAt = new Date().toISOString();

    for (const competitor of request.competitors) {
      try {
        const channelId = await this.resolveChannelId(competitor.displayName);
        const { xml, entries } = await this.fetchUploadsFeed(channelId);
        for (const entry of entries) {
          organic.push({
            kind: 'OrganicContent',
            id: `yt:${entry.videoId}`,
            missionId: request.missionId,
            source: {
              sourceId: 'youtube-public-rss',
              sourceRecordId: entry.videoId,
              connectorVersion: meta.version,
            },
            platform: 'youtube',
            authorId: entry.channelId,
            format: entry.isShort ? 'short (9:16 vertical)' : 'video (channel upload)',
            publishedAt: entry.published,
            availableMetadata: {
              title: entry.title,
              author: entry.author,
              url: entry.url,
              feedWindow: tag(xml, 'updated'),
            },
          });
          if (!Number.isNaN(entry.views)) {
            // Current-snapshot public stat, observed now — observed_at is the
            // observation time, published_at is the content's own time.
            metrics.push({
              kind: 'MetricObservation',
              id: `ytobs:${entry.videoId}:views:${retrievedAt}`,
              missionId: request.missionId,
              subjectRef: `yt:${entry.videoId}`,
              metricKey: 'views',
              value: entry.views,
              observedAt: retrievedAt,
              source: {
                sourceId: 'youtube-public-rss',
                sourceRecordId: entry.videoId,
                connectorVersion: meta.version,
              },
              metricDefinition: 'platform-public-stat',
              metricDefinitionVersion: 'rss-v1',
            });
          }
        }
        coverage.push({
          slice: `organic-uploads:${competitor.displayName}`,
          state: 'available',
          sourceId: meta.id,
          connectorVersion: meta.version,
          region: 'global',
          dateWindow: `last ${entries.length} uploads`,
          note: `keyless uploads RSS resolved for channel ${channelId}; current-snapshot view counts included`,
        });
        // Bounded oEmbed enrichment (rate-limit friendly sampling).
        for (const entry of entries.slice(0, this.oembedSampleSize)) {
          const enriched = await this.oembed(`https://www.youtube.com/watch?v=${entry.videoId}`);
          const target = organic.find((o) => o.source.sourceRecordId === entry.videoId);
          if (target && typeof enriched.title === 'string') {
            target.availableMetadata.oembedTitle = enriched.title;
            target.availableMetadata.thumbnailUrl = enriched.thumbnail_url;
          }
        }
        coverage.push({
          slice: `creative-metadata:${competitor.displayName}`,
          state: this.oembedSampleSize >= entries.length ? 'available' : 'partial',
          sourceId: meta.id,
          connectorVersion: meta.version,
          note:
            this.oembedSampleSize >= entries.length
              ? 'oEmbed metadata for every feed entry'
              : `oEmbed metadata sampled for ${this.oembedSampleSize} of ${entries.length} feed entries (bounded requests)`,
        });
      } catch (err) {
        if (err instanceof ConnectorFailure) {
          coverage.push({
            slice: `organic-uploads:${competitor.displayName}`,
            state: 'unavailable',
            sourceId: meta.id,
            connectorVersion: meta.version,
            note: `not resolvable through permitted public routes in this run: ${err.error.kind} — ${'detail' in err.error ? err.error.detail : ''}`,
          });
          continue;
        }
        throw err;
      }
    }

    coverage.push(
      {
        slice: 'video-statistics-history:youtube',
        state: 'unavailable',
        sourceId: meta.id,
        connectorVersion: meta.version,
        note:
          'keyless routes expose current-snapshot counts only; per-video historical time series require the key-based Data API (unverified — no credentials in this environment)',
      },
      {
        slice: 'private-analytics:youtube',
        state: 'not_connected',
        sourceId: meta.id,
        connectorVersion: meta.version,
        note: 'creator private analytics require an authorized account connection (W6 scope)',
      },
    );

    return { ads: [], organic, metrics, coverage, accessMethod: 'officialApi' };
  }

  // publish()/analytics() intentionally do NOT exist: capabilities declare
  // research only (contract: publish() exists iff capabilities.publishing).

  /**
   * W5: verify a publicly accessible video URL through the permitted keyless
   * oEmbed route — post-status verification for manually published posts.
   * Honest outcomes only: an unresolvable URL is reported as not verified,
   * never as a failure of the platform.
   */
  async verifyPublicVideo(videoUrl: string): Promise<{
    exists: boolean;
    title?: string;
    authorName?: string;
    thumbnailUrl?: string;
    detail: string;
  }> {
    try {
      const json = await this.oembed(videoUrl);
      return {
        exists: typeof json.title === 'string' && (json.title as string).length > 0,
        ...(typeof json.title === 'string' ? { title: json.title as string } : {}),
        ...(typeof json.author_name === 'string' ? { authorName: json.author_name as string } : {}),
        ...(typeof json.thumbnail_url === 'string' ? { thumbnailUrl: json.thumbnail_url as string } : {}),
        detail: `oEmbed resolved the URL through the keyless public route`,
      };
    } catch (err) {
      if (err instanceof ConnectorFailure && err.error.kind === 'coverage_gap') {
        return { exists: false, detail: `not verifiable through the keyless public route: ${err.error.detail}` };
      }
      throw err;
    }
  }

  private async resolveChannelId(input: string): Promise<string> {
    const trimmed = input.trim();
    if (CHANNEL_ID_RE.test(trimmed)) return trimmed;
    if (trimmed.startsWith('@') || /^[\w.-]{2,40}$/.test(trimmed)) {
      const handle = trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
      const res = await this.fetchLike(`https://www.youtube.com/${handle}`);
      if (res.status !== 200) {
        throw new ConnectorFailure({
          kind: 'coverage_gap',
          coverageState: 'unavailable',
          detail: `channel '${input}' not found through public routes (HTTP ${res.status})`,
        });
      }
      const id = /"externalId":"(UC[A-Za-z0-9_-]{22})"/.exec(res.body)?.[1];
      if (!id) {
        throw new ConnectorFailure({
          kind: 'coverage_gap',
          coverageState: 'unavailable',
          detail: `channel '${input}' page did not expose a resolvable public channel id`,
        });
      }
      return id;
    }
    throw new ConnectorFailure({
      kind: 'coverage_gap',
      coverageState: 'unavailable',
      detail: `competitor hint '${input}' is neither a channel id nor a handle — public resolution not possible without a search API (key-based, unverified)`,
    });
  }

  private async fetchUploadsFeed(channelId: string): Promise<{ xml: string; entries: RssEntry[] }> {
    const res = await this.fetchLike(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,
    );
    if (res.status === 404) {
      throw new ConnectorFailure({
        kind: 'coverage_gap',
        coverageState: 'unavailable',
        detail: `no uploads feed for channel ${channelId} (HTTP 404)`,
      });
    }
    if (res.status === 429) {
      throw new ConnectorFailure({ kind: 'rate_limited', quotaScope: 'youtube-public-rss', retryAfterMs: 60_000 });
    }
    if (res.status !== 200) {
      throw new ConnectorFailure({ kind: 'transient_network', retryable: res.status >= 500, attempt: 1 });
    }
    const entries = parseRss(res.body);
    if (entries.length === 0) {
      throw new ConnectorFailure({
        kind: 'coverage_gap',
        coverageState: 'unavailable',
        detail: `uploads feed for ${channelId} returned no entries`,
      });
    }
    return { xml: res.body, entries };
  }

  private async oembed(videoUrl: string): Promise<Record<string, unknown>> {
    const res = await this.fetchLike(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`,
    );
    if (res.status === 404 || res.status === 400) {
      throw new ConnectorFailure({
        kind: 'coverage_gap',
        coverageState: 'unavailable',
        detail: `oEmbed has no metadata for ${videoUrl} (HTTP ${res.status})`,
      });
    }
    if (res.status === 429) {
      throw new ConnectorFailure({ kind: 'rate_limited', quotaScope: 'youtube-oembed', retryAfterMs: 60_000 });
    }
    if (res.status !== 200) {
      throw new ConnectorFailure({ kind: 'transient_network', retryable: res.status >= 500, attempt: 1 });
    }
    return JSON.parse(res.body) as Record<string, unknown>;
  }
}

/** Candidate helper for verification runs (no invented relevance claims). */
export function channelCandidate(
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
        supports: 'harness-selected public channel for access-path verification',
      },
    ],
    userConfirmed: false,
  };
}
